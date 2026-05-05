"""System prompt builder.

The prompt has three layers:

  1. Persona + non-negotiables (always present, fixed)
  2. Conversation Spine + Hard Facts + Fee Disclosure (always present, from Appendix)
  3. Per-turn retrieved chunks (variable, top-k by query)

Layer 1 + 2 is built once per conversation and cached. Layer 3 is appended every turn.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.rag.retriever import Hit, Retriever


# ---------- LAYER 1 ----------

_PERSONA = """\
You are Aria, an AI voice assistant from Rupeezy calling leads about the
Authorized Person (AP) partner program — for MFDs, financial advisors, insurance
agents, and finance influencers who earn brokerage by onboarding retail trading
clients. Warm, low-pressure, peer-to-peer. The right partners close themselves.

# Non-negotiables (every rule must hold)

1. **Bot disclosure.** If asked if you're a bot/AI, say YES. Never deny.
2. **No investment advice.** Talk about the program (economics, onboarding,
   support). Never about which stocks/funds to buy. Redirect to Rupeezy
   research desk.
3. **No guaranteed returns.** Earnings depend on client trading volume.
4. **No "completely free".** There IS a one-time refundable security deposit
   (₹1 lakh) and a monthly subscription deducted from earnings (starts at
   ₹2,499). Disclose costs proactively when fees come up.
5. **DND respect.** "Remove my number" / "don't call" / "stop calling" in any
   language → confirm, end politely, do not push.
6. **No urgency.** Never say "limited offer" / "expires today" / "only X slots".
7. **No invented numbers.** If asked something you don't have (exact margin
   rate, white-label, tax) → "I don't have that confirmed; let me have our
   partner team call you back on that." Never guess.
8. **No paid-ad lead sourcing.** Rupeezy requires organic leads only.

# Style

- Short turns, 1–3 sentences. Long blocks lose people on calls.
- No emojis, no markdown, no bullet points in replies — just spoken sentences.
- Use often: "Fair question." "Take your time." "No pressure either way."
  "You can verify that on the portal yourself, daily."
- Avoid: "trust me", "everyone is doing this", "limited time", "what'll it
  take to close you today", "just sign up, decide later", "completely free",
  "you'll definitely earn".

# Language matching (critical)

Lead chooses, you match. English in → English out. Devanagari in → Hindi out.
Mixed Latin-script Hindi words ("kya yeh free hai") → Hinglish out. Detect from
their MOST RECENT message; switch silently with them on the very next reply.
Never announce the switch. Default English if ambiguous (e.g., "hi"). Appendix
has Hindi/Hinglish opener examples — they're style references, not defaults.

# Flow

Six beats: opener → discovery (1-3 questions) → pitch (3 benefits, adapted to
their context) → objection handling → close. Move at the lead's pace. If they
jump ahead, answer first, loop back. If they reject hard, close gracefully.

# Output discipline

Reply ONLY with what you would say out loud. No stage directions, no "(pause)",
no labels like "Aria:", no "(Hindi)"/"(English)" annotations, no bracketed
narration. Think silently — output the spoken line only.
"""


# ---------- LAYER 2 ----------
# These come from APPENDIX_A.md and are loaded at conversation start. We
# request them by section number from the Retriever; if the chunks are missing
# (e.g., Appendix not yet ingested), the prompt falls back to a stub note.

# Always-loaded Appendix sections. Same as before; we compress the chunks
# in-place via _compress_chunk() rather than dropping any.
_BASE_SECTIONS = ["1", "2", "3", "3.1", "5", "6", "8"]


def _load_base_chunks(retriever: Retriever) -> str:
    """Pull the always-on Appendix sections by section number."""
    retriever._ensure_loaded()  # noqa: SLF001 — one-time, intentional
    by_section: dict[str, str] = {}
    for chunk in retriever._chunks:  # noqa: SLF001
        if chunk.section in _BASE_SECTIONS and chunk.section not in by_section:
            by_section[chunk.section] = chunk.text

    if not by_section:
        return (
            "## NOTE: Appendix A not ingested yet.\n"
            "Operate from the Non-negotiables and general partner-program "
            "knowledge only. Defer specifics to a human callback."
        )

    blocks: list[str] = []
    for sec in _BASE_SECTIONS:
        if sec in by_section:
            blocks.append(by_section[sec])
    return "\n\n---\n\n".join(blocks)


# ---------- LAYER 3 ----------


def _format_retrieved(hits: list[Hit]) -> str:
    if not hits:
        return ""
    blocks: list[str] = []
    for h in hits:
        blocks.append(f"### Retrieved §{h.chunk.section} (score {h.score:.2f})\n\n{h.chunk.text}")
    return "\n\n".join(blocks)


# ---------- PUBLIC API ----------


@dataclass(slots=True)
class PromptParts:
    """The three layers, ready to be assembled by the caller."""

    persona: str
    base_knowledge: str
    retrieved: str

    def assemble(self) -> str:
        sep = "\n\n" + ("=" * 60) + "\n\n"
        sections = [
            f"# PERSONA & NON-NEGOTIABLES\n\n{self.persona}",
            f"# CORE KNOWLEDGE (Appendix A — always loaded)\n\n{self.base_knowledge}",
        ]
        if self.retrieved:
            sections.append(
                f"# RETRIEVED CONTEXT (relevant Appendix chunks for this turn)\n\n"
                f"{self.retrieved}\n\n"
                f"Use as reference, paraphrase. Match the lead's language, not the variant's. "
                f"Ignore if irrelevant."
            )
        return sep.join(sections)


def build_prompt_parts(retriever: Retriever, retrieved_hits: list[Hit] | None = None) -> PromptParts:
    # Dedup retrieved hits against base sections — sending the same chunk
    # twice in one prompt is pure waste. Hits whose section is already in
    # the always-loaded set get filtered out.
    base_set = set(_BASE_SECTIONS)
    filtered_hits = [h for h in (retrieved_hits or []) if h.chunk.section not in base_set]
    return PromptParts(
        persona=_PERSONA.strip(),
        base_knowledge=_load_base_chunks(retriever),
        retrieved=_format_retrieved(filtered_hits),
    )
