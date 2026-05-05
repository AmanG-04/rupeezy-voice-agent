"""H/W/C classifier + post-call summarizer.

Runs once per ended conversation. Uses Gemini 2.5 Pro with response_schema for
structured output — no fragile prompt-then-parse.

Returns a Classification + Discovery + objections + summary that the
HandoffAssembler combines with conversation metadata into the full
HandoffRecord (Appendix §7.1).
"""

from __future__ import annotations

import json
import logging
from typing import Any

import google.generativeai as genai

from app.config import get_settings
from app.scoring.schemas import (
    Classification,
    Discovery,
    ObjectionRaised,
    SignalBreakdown,
)

log = logging.getLogger("rupeezy.scoring")

_genai_configured = False


def _ensure_genai() -> None:
    global _genai_configured
    if _genai_configured:
        return
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not set; cannot run classifier.")
    genai.configure(api_key=settings.gemini_api_key)
    _genai_configured = True


# JSON schema the model must populate. Mirrors the Pydantic models exactly.
# Keep this in lockstep with schemas.py.
_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "bucket",
        "confidence",
        "signal_breakdown",
        "rationale",
        "discovery",
        "objections_raised",
        "unresolved_questions",
        "summary_short",
        "language_used",
    ],
    "properties": {
        "bucket": {"type": "string", "enum": ["hot", "warm", "cold"]},
        "confidence": {"type": "number"},
        "signal_breakdown": {
            "type": "object",
            "required": [
                "stated_intent",
                "engagement",
                "network_size",
                "objection_pattern",
                "affirmative_cues",
                "deferrals",
            ],
            "properties": {
                "stated_intent": {"type": "number"},
                "engagement": {"type": "number"},
                "network_size": {"type": "number"},
                "objection_pattern": {"type": "number"},
                "affirmative_cues": {"type": "number"},
                "deferrals": {"type": "number"},
            },
        },
        "rationale": {"type": "string"},
        "discovery": {
            "type": "object",
            "required": ["current_role"],
            "properties": {
                "current_role": {
                    "type": "string",
                    "enum": ["mfd", "advisor", "agent", "influencer", "other", "unknown"],
                },
                "current_broker": {"type": "string"},
                "estimated_clients": {"type": "integer"},
                "estimated_aum_inr": {"type": "integer"},
                "has_nism_series_vii": {"type": "boolean"},
            },
        },
        "objections_raised": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "raised_at_turn", "resolved"],
                "properties": {
                    "id": {
                        "type": "string",
                        "enum": [
                            "existing_broker",
                            "not_enough_contacts",
                            "client_support",
                            "trustworthiness",
                            "think_about_it",
                            "security_deposit",
                            "nism_required",
                            "other",
                        ],
                    },
                    "raised_at_turn": {"type": "integer"},
                    "resolved": {"type": "string", "enum": ["true", "false", "partial"]},
                    "notes": {"type": "string"},
                },
            },
        },
        "unresolved_questions": {"type": "array", "items": {"type": "string"}},
        "summary_short": {"type": "string"},
        "language_used": {
            "type": "string",
            "enum": ["english", "hindi", "hinglish", "other"],
        },
    },
}


_RUBRIC = """\
You are a sales-call analyst for Rupeezy's Authorized Person (AP) partner program.
You read a finished conversation between an AI agent (Aria) and a lead, and you
produce a structured handoff record for the human Relationship Manager.

# Bucket thresholds (Appendix §5.2 — apply STRICTLY)

HOT — at least one of:
  - Lead used explicit signup intent ("send the link", "I want to sign up",
    "let's start", "kaise start karoon", or equivalent)
  - High engagement (>= 4 substantive turns) AND lead reported 20+ existing
    clients AND no unresolved objections
  - High engagement AND lead asked specifically about onboarding TAT, NISM exam,
    or commercial terms (these are buying questions)

WARM:
  - Engaged through 2 or more objections without rejecting and without explicit
    signup intent
  - Asked for time to think with a specific reason ("compare with X", "discuss
    with partner", "see security deposit terms")
  - Asked for material to review (link, brochure, comparison)
  - Smaller / unclear network (5–20 clients) but positive tone

COLD:
  - Hung up in <60s with no engagement
  - Hard rejection ("not interested", "stop calling", "remove my number")
  - Repeated deferrals with no specifics (3+ "call me later" with no time)
  - Wrong number / wrong profile

# Signals (each 0.0 to 1.0)

stated_intent       — explicit asks to sign up / send link
engagement          — talk ratio, message length, depth of follow-ups
network_size        — self-reported clients / audience / referrals
objection_pattern   — DETAILED objections = high (real interest); dismissive = low
affirmative_cues    — "interesting", "tell me more", "achha", "samajh gaya"
deferrals           — "call me later" without scheduling, "I'll think about it" with no specifics

# Discovery extraction

current_role: mfd | advisor | agent | influencer | other | unknown
current_broker: name of the broker the lead said they're with, or null
estimated_clients: integer the lead explicitly stated, or null if not mentioned
estimated_aum_inr: integer in rupees if stated explicitly, or null
has_nism_series_vii: true if lead said they have it, false if explicitly said no, null otherwise

# Objections

For each of the 5 core objections (and 2 secondary) the lead raised:
  - id (one of the enum)
  - raised_at_turn: 0-indexed turn number where the lead raised it
  - resolved: "true" if the agent's reply demonstrably addressed it AND the lead
    moved on / accepted; "partial" if the agent answered but the lead remained
    skeptical; "false" if the agent failed to address it.
  - notes: 1 short sentence — what the lead said and what shifted (if anything)

# unresolved_questions

Anything the agent said "let me have someone follow up on that" about — verbatim
or paraphrased. The RM uses these to prep the callback.

# summary_short

Two to three sentences. The RM should be able to read it in 10 seconds and know
exactly what to say when they pick up. Lead with role + network size, name the
strongest signal (positive or negative), end with the recommended next move.

# language_used

The dominant language across the lead's messages. Default 'english' if mixed
or ambiguous.

# rationale

One sentence — the single most important reason this lead is in this bucket.
Reference a specific moment in the conversation ("said 'send me the link' in
turn 5"; "two unresolved objections").
"""


def _format_transcript(messages: list[dict[str, str]]) -> str:
    """messages: [{role: 'user' | 'assistant', text: '...'}]"""
    lines: list[str] = []
    for i, m in enumerate(messages):
        speaker = "LEAD" if m["role"] == "user" else "ARIA"
        lines.append(f"[turn {i}] {speaker}: {m['text']}")
    return "\n\n".join(lines)


async def classify_conversation(
    *,
    messages: list[dict[str, str]],
) -> tuple[Classification, Discovery, list[ObjectionRaised], list[str], str, str]:
    """Run the classifier on a finished conversation transcript.

    Returns (classification, discovery, objections, unresolved_questions,
             summary_short, language_used).
    """
    _ensure_genai()
    settings = get_settings()

    transcript = _format_transcript(messages)
    user_payload = (
        f"Here is the full call transcript. Apply the rubric and produce the "
        f"structured handoff JSON.\n\n---\n\n{transcript}"
    )

    # Pro has tight free-tier quota and routinely 429s — every fallback round
    # adds ~5-10s. For the dialer + most demo paths, flash-lite-latest is
    # plenty for structured-output classification. Override with
    # CLASSIFIER_MODEL=gemini-2.5-pro if you want the slower/sharper model.
    import os
    primary = os.environ.get("CLASSIFIER_MODEL", "gemini-flash-lite-latest").strip()
    if not primary:
        primary = settings.gemini_reasoning_model

    model = genai.GenerativeModel(
        primary,
        system_instruction=_RUBRIC,
        generation_config={
            "temperature": 0.2,        # this is analysis, not creativity
            "max_output_tokens": 1500,
            "response_mime_type": "application/json",
            "response_schema": _RESPONSE_SCHEMA,
        },
    )

    response = await _generate_with_fallback(model, user_payload)

    raw = response.text
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        log.error("classifier returned non-JSON: %s\nraw: %s", e, raw[:1000])
        raise

    classification = Classification(
        bucket=data["bucket"],
        confidence=float(data["confidence"]),
        signal_breakdown=SignalBreakdown(**data["signal_breakdown"]),
        rationale=data["rationale"],
    )
    discovery = Discovery(**data["discovery"])
    objections = [ObjectionRaised(**o) for o in data["objections_raised"]]
    unresolved = list(data["unresolved_questions"])
    summary_short = data["summary_short"]
    language_used = data["language_used"]

    return classification, discovery, objections, unresolved, summary_short, language_used


_FALLBACK_CHAIN = [
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
]


async def _generate_with_fallback(model: Any, prompt: str) -> Any:
    """Tries the configured reasoning model; falls back through a chain of
    flash-lite variants on rate limit.

    Each variant in the chain hits a separate free-tier quota pool, so an
    exhausted Pro model doesn't have to block the pipeline.
    """
    try:
        return await model.generate_content_async(prompt)
    except Exception as e:  # noqa: BLE001
        emsg = str(e)
        if "429" not in emsg and "quota" not in emsg.lower():
            raise

    for fallback_id in _FALLBACK_CHAIN:
        log.warning("reasoning model rate-limited; trying fallback %s", fallback_id)
        try:
            fallback_model = genai.GenerativeModel(
                fallback_id,
                system_instruction=_RUBRIC,
                generation_config={
                    "temperature": 0.2,
                    "max_output_tokens": 1500,
                    "response_mime_type": "application/json",
                    "response_schema": _RESPONSE_SCHEMA,
                },
            )
            return await fallback_model.generate_content_async(prompt)
        except Exception as e:  # noqa: BLE001
            emsg = str(e)
            if "429" not in emsg and "quota" not in emsg.lower():
                raise
            continue

    raise RuntimeError(
        "All Gemini fallback models are rate-limited. "
        "Wait for quota to reset or upgrade the API tier."
    )
