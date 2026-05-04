"""Conversation engine — the agent's brain.

Stateless turn loop:
    user_turn(conv_id, "I'm with Zerodha already") -> async iterator of token chunks

The Conversation object holds the message history and per-conversation state
(language, lead profile, base prompt). One ConversationStore instance per process.

Phase 4 will move the store to Supabase; Conversation API stays.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

import google.generativeai as genai

from app.agent.system_prompt import build_prompt_parts
from app.config import get_settings
from app.rag.retriever import Retriever

# Defensive: strip any leading meta annotations the model might emit despite
# the system prompt forbidding them. Examples: "(Hindi)\n", "[Aria]:", etc.
_LEADING_ANNOTATION = re.compile(
    r"^\s*(?:\([^)]{1,30}\)|\[[^\]]{1,30}\])\s*[\n:]?\s*"
)

log = logging.getLogger("rupeezy.agent")

Role = Literal["user", "assistant"]


@dataclass(slots=True)
class Message:
    role: Role
    text: str
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


@dataclass(slots=True)
class Conversation:
    conv_id: str
    messages: list[Message] = field(default_factory=list)
    language: str = "unknown"  # english / hindi / hinglish / other / unknown
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    ended_at: str | None = None
    ended_by: str | None = None  # 'agent' | 'lead' | 'dropped'

    def add(self, role: Role, text: str) -> Message:
        msg = Message(role=role, text=text)
        self.messages.append(msg)
        return msg

    def to_history(self) -> list[dict[str, str]]:
        """Gemini contents format: list of {role, parts:[{text}]}.
        Gemini uses 'user' and 'model' for roles."""
        out: list[dict[str, str]] = []
        for m in self.messages:
            out.append(
                {
                    "role": "user" if m.role == "user" else "model",
                    "parts": [{"text": m.text}],
                }
            )
        return out


class ConversationStore:
    """In-memory store. Phase 4 swaps for Supabase."""

    def __init__(self) -> None:
        self._convs: dict[str, Conversation] = {}

    def create(self) -> Conversation:
        conv_id = uuid.uuid4().hex[:12]
        c = Conversation(conv_id=conv_id)
        self._convs[conv_id] = c
        return c

    def get(self, conv_id: str) -> Conversation | None:
        return self._convs.get(conv_id)

    def end(self, conv_id: str, ended_by: str = "agent") -> Conversation | None:
        c = self._convs.get(conv_id)
        if c and not c.ended_at:
            c.ended_at = datetime.now(timezone.utc).isoformat()
            c.ended_by = ended_by
        return c

    def list_all(self) -> list[Conversation]:
        return list(self._convs.values())


# ---------- module-level singletons (process-local) ----------

_store: ConversationStore | None = None
_retriever: Retriever | None = None
_genai_configured = False


def get_store() -> ConversationStore:
    global _store
    if _store is None:
        _store = ConversationStore()
    return _store


def get_retriever() -> Retriever:
    global _retriever
    if _retriever is None:
        _retriever = Retriever()
    return _retriever


def _ensure_genai() -> None:
    global _genai_configured
    if _genai_configured:
        return
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not set; cannot run conversation.")
    genai.configure(api_key=settings.gemini_api_key)
    _genai_configured = True


# ---------- the engine ----------


GENERATION_CONFIG = {
    "temperature": 0.7,          # warm but obedient to language-matching rule
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 500,    # ~3-5 spoken sentences before being cut
}

# Don't over-restrict — sales/objection-handling content is harmless. We only
# need the safety filters NOT to nuke a Hindi rebuttal as a false positive.
SAFETY_SETTINGS = [
    {"category": c, "threshold": "BLOCK_ONLY_HIGH"}
    for c in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    )
]


async def stream_user_turn(
    conv_id: str,
    user_text: str,
    *,
    k: int = 4,
) -> AsyncIterator[str]:
    """Process one user turn. Yields response token chunks as they stream.

    Side effects:
      - Appends the user message to conversation history immediately.
      - Appends the (full) assistant message to history once streaming completes.
    """
    _ensure_genai()
    store = get_store()
    retriever = get_retriever()

    conv = store.get(conv_id)
    if conv is None:
        raise ValueError(f"unknown conversation {conv_id}")
    if conv.ended_at:
        raise ValueError(f"conversation {conv_id} already ended")

    conv.add("user", user_text)

    # Retrieve relevant Appendix chunks for this turn.
    try:
        hits = retriever.retrieve(user_text, k=k)
    except Exception as e:  # noqa: BLE001
        log.warning("retrieval failed: %s — proceeding without retrieved context", e)
        hits = []

    parts = build_prompt_parts(retriever, retrieved_hits=hits)
    system_instruction = parts.assemble()

    settings = get_settings()
    model = genai.GenerativeModel(
        settings.gemini_chat_model,
        system_instruction=system_instruction,
        generation_config=GENERATION_CONFIG,
        safety_settings=SAFETY_SETTINGS,
    )

    # History EXCLUDES the just-added user turn — Gemini takes that as the
    # "new" message via send_message.
    history = conv.to_history()[:-1]
    chat = model.start_chat(history=history)

    response_text_parts: list[str] = []
    is_rate_limit = False
    # Buffer the first ~80 chars so we can strip a leading "(English)\n" or
    # "[Aria]:" annotation that may straddle multiple stream chunks.
    leading_buf = ""
    leading_flushed = False

    try:
        # google-generativeai's stream is a sync iterator; we wrap it in async.
        stream = chat.send_message(user_text, stream=True)
        for chunk in stream:
            piece = getattr(chunk, "text", "") or ""
            if not piece:
                continue
            if not leading_flushed:
                leading_buf += piece
                # Only flush once we have enough chars to confidently match
                # (or not match) a leading annotation, OR a newline appears.
                if len(leading_buf) < 80 and "\n" not in leading_buf:
                    continue
                cleaned = _LEADING_ANNOTATION.sub("", leading_buf)
                leading_flushed = True
                if cleaned.strip():
                    response_text_parts.append(cleaned)
                    yield cleaned
                continue
            response_text_parts.append(piece)
            yield piece

        # End-of-stream: flush any small buffer that never grew past the threshold.
        if not leading_flushed and leading_buf:
            cleaned = _LEADING_ANNOTATION.sub("", leading_buf)
            if cleaned.strip():
                response_text_parts.append(cleaned)
                yield cleaned
    except Exception as e:  # noqa: BLE001
        # Detect rate limit (429) — it has a clear, separate fallback line.
        emsg = str(e)
        if "429" in emsg or "quota" in emsg.lower() or "rate" in emsg.lower():
            is_rate_limit = True
            fallback = (
                "Just a second — let me check that and get back to you."
            )
        else:
            log.exception("Gemini streaming failed")
            fallback = (
                "Sorry, I lost the line for a moment. Could you say that again?"
            )
            log.error("error detail: %s", e)
        response_text_parts.append(fallback)
        yield fallback

    full_text = "".join(response_text_parts).strip()
    if full_text:
        conv.add("assistant", full_text)
    if is_rate_limit:
        log.warning("rate-limited; consider pacing turns or upgrading API tier")

    # Best-effort persistence: write conversation snapshot to the DB. Failures
    # do not affect the user response — the in-memory store is still authoritative
    # for the current request.
    try:
        from app.db.repo import persist_conversation

        persist_conversation(conv, channel="text")
    except Exception:  # noqa: BLE001
        log.exception("failed to persist conversation %s", conv.conv_id)
