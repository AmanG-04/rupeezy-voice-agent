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

# Words that signal the user said something specific enough to warrant
# spending a Gemini embedding call to retrieve relevant Appendix chunks.
# Includes English + common Hindi/Hinglish equivalents. Conservative —
# false positives are cheap (one extra embedding); false negatives skip
# RAG when we'd actually want it.
_RAG_TRIGGER_WORDS = {
    # English question words
    "why", "how", "what", "when", "where", "who", "which", "whose",
    # Hindi / Hinglish question words
    "kaise", "kab", "kaun", "kya", "kitna", "kitne", "kahan",
    # Objection / fact-bearing verbs the agent must ground on
    "switch", "broker", "zerodha", "upstox", "angel", "groww", "5paisa",
    "motilal", "icici", "sharekhan", "kotak",
    "cost", "fee", "free", "deposit", "subscription", "charge", "price",
    "joining", "lakh", "rupees", "rupaye", "paisa", "paise",
    "nism", "exam", "certification", "certificate", "license", "regulation",
    "support", "help", "issue", "problem", "complaint",
    "trust", "reliable", "scam", "fraud", "safe", "regulated", "sebi",
    "client", "clients", "customer", "customers",
    "payout", "payment", "earn", "earning", "earnings", "income", "commission",
    "brokerage", "share", "split", "percent", "percentage",
    "send", "link", "whatsapp", "signup", "sign", "register",
    "later", "callback", "tomorrow", "evening",
    # Common multi-word triggers handled via substring below
}

# Phrases worth retrieving on even if no trigger word matches.
_RAG_TRIGGER_PHRASES = (
    "remove my number", "do not call", "stop calling", "don't call",
    "not interested", "i'll think", "call me later",
    "think about it", "send me", "ya think",
)

# Romanised regional words that strongly imply the speaker's language.
# When the picker says English but the user types one of these, we
# trust the script over the picker. Casefold + strip first.
_ROMAN_LANG_HINTS: dict[str, str] = {
    # Bengali
    "bhalobashi": "bn-IN",
    "ami": "bn-IN",
    "tomake": "bn-IN",
    "kemon": "bn-IN",
    "achho": "bn-IN",
    # Tamil
    "vanakkam": "ta-IN",
    "epadi": "ta-IN",
    "irukenga": "ta-IN",
    "neenga": "ta-IN",
    "namma": "ta-IN",
    # Telugu
    "namaste": "hi-IN",  # ambiguous Hindi/Telugu - default Hindi
    "ela": "te-IN",
    "unnaru": "te-IN",
    "meeru": "te-IN",
    # Marathi
    "kasa": "mr-IN",
    "kashi": "mr-IN",
    "ahat": "mr-IN",
    "tumhi": "mr-IN",
    # Gujarati
    "kem": "gu-IN",
    "chho": "gu-IN",
    "majama": "gu-IN",
    "su": "gu-IN",
}


def _detect_lang_from_text(text: str) -> str | None:
    """Detect language from a user's utterance text. Returns a BCP-47
    code or None if undetectable. Order:

    1. Script range — Devanagari/Tamil/Telugu/Bengali/Gujarati Unicode
       blocks are unambiguous and override anything else.
    2. Romanised regional word match — for Latin-script transliterations
       like "Bhalobashi" that the picker would label as English.
    3. None — fall back to the caller's existing lang_hint (the picker).

    The conversation engine prefers this detected lang over the picker
    hint when both are available, so the lead can switch languages
    mid-call without touching the picker.
    """
    if not text:
        return None
    # Script-based — first non-whitespace native-script char wins.
    for ch in text:
        cp = ord(ch)
        # Tamil    (U+0B80–U+0BFF)
        if 0x0B80 <= cp <= 0x0BFF:
            return "ta-IN"
        # Telugu   (U+0C00–U+0C7F)
        if 0x0C00 <= cp <= 0x0C7F:
            return "te-IN"
        # Bengali  (U+0980–U+09FF)
        if 0x0980 <= cp <= 0x09FF:
            return "bn-IN"
        # Gujarati (U+0A80–U+0AFF)
        if 0x0A80 <= cp <= 0x0AFF:
            return "gu-IN"
        # Devanagari (U+0900–U+097F) — could be Hindi OR Marathi. Both
        # use "नमस्कार" so we exclude it from the Marathi-specific sniff;
        # rely on words that are uniquely Marathi (काय/आहे/मला/तुम्ही).
        if 0x0900 <= cp <= 0x097F:
            t = text.lower()
            if any(m in t for m in ("काय", "आहे", "मला", "तुम्ही", "कसे", "कशी")):
                return "mr-IN"
            return "hi-IN"

    # Romanised hint match. Tokenise on non-alphanumerics, casefold.
    import re as _re

    tokens = {tok for tok in _re.split(r"[^a-zA-Z]+", text.lower()) if tok}
    for tok in tokens:
        if tok in _ROMAN_LANG_HINTS:
            return _ROMAN_LANG_HINTS[tok]

    return None


# Map both BCP-47 codes (from voice picker) and short keys (from CSV
# language_pref column) to a human-readable label for the per-turn
# language override directive injected into the system prompt.
_LANG_LABELS: dict[str, str] = {
    # English variants
    "en-in": "English",
    "en-us": "English",
    "en-gb": "English",
    "english": "English",
    # Hindi
    "hi-in": "Hindi",
    "hindi": "Hindi",
    # Hinglish (Latin-script Hindi)
    "hinglish": "Hinglish (Latin-script Hindi)",
    # Regional
    "ta-in": "Tamil",
    "tamil": "Tamil",
    "te-in": "Telugu",
    "telugu": "Telugu",
    "mr-in": "Marathi",
    "marathi": "Marathi",
    "gu-in": "Gujarati",
    "gujarati": "Gujarati",
    "bn-in": "Bengali",
    "bengali": "Bengali",
}


def _should_retrieve(user_text: str, conv: "Conversation") -> bool:
    """Decide whether to spend an embedding API call on this turn.

    Skip retrieval when the user's message is short and content-free —
    the system prompt's always-on Appendix sections handle openers,
    acknowledgments, and small talk just fine.
    """
    text = user_text.strip().lower()
    if not text:
        return False

    # Long messages almost always have something worth retrieving.
    if len(text) >= 80:
        return True

    # Question marks are a strong signal of a fact-bearing question.
    if "?" in text:
        return True

    # Trigger words / phrases.
    if any(p in text for p in _RAG_TRIGGER_PHRASES):
        return True
    words = {w.strip(".,!?;:'\"") for w in text.split()}
    if words & _RAG_TRIGGER_WORDS:
        return True

    # Short greetings / acknowledgments / silence — skip RAG.
    return False

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
    # Phase 10: when populated, the prompt builder injects prior-call context.
    # The demo chat path leaves this None; the dialer / batch caller sets it.
    lead_id: str | None = None

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
    """In-memory store with a soft cap to keep Render's 512MB worker alive.

    The persistence layer (db.repo) is the durable record. This in-memory
    store only holds active + recently-ended conversations so subsequent
    /turn requests can pick up state without a DB round-trip. Beyond
    `_MAX_ENDED` ended conversations, the oldest are evicted.

    Active conversations (ended_at is None) are NEVER evicted — only the
    backlog of completed-but-not-yet-cleaned-up ones.
    """

    _MAX_ENDED: int = 100

    def __init__(self) -> None:
        self._convs: dict[str, Conversation] = {}

    def _evict_if_needed(self) -> None:
        ended = [
            (cid, c) for cid, c in self._convs.items() if c.ended_at is not None
        ]
        if len(ended) <= self._MAX_ENDED:
            return
        # Sort by end time (string ISO compare is fine — same TZ),
        # drop the oldest until we're under the cap.
        ended.sort(key=lambda x: x[1].ended_at or "")
        for cid, _ in ended[: len(ended) - self._MAX_ENDED]:
            self._convs.pop(cid, None)

    def create(self) -> Conversation:
        conv_id = uuid.uuid4().hex[:12]
        c = Conversation(conv_id=conv_id)
        self._convs[conv_id] = c
        self._evict_if_needed()
        return c

    def create_for_lead(self, lead_id: str) -> Conversation:
        """Create a conversation tied to a known lead. Phase 10 cross-call
        memory triggers automatically for leads that have prior completed calls.
        """
        conv_id = uuid.uuid4().hex[:12]
        c = Conversation(conv_id=conv_id, lead_id=lead_id)
        self._convs[conv_id] = c
        self._evict_if_needed()
        return c

    def get(self, conv_id: str) -> Conversation | None:
        return self._convs.get(conv_id)

    def end(self, conv_id: str, ended_by: str = "agent") -> Conversation | None:
        c = self._convs.get(conv_id)
        if c and not c.ended_at:
            c.ended_at = datetime.now(timezone.utc).isoformat()
            c.ended_by = ended_by
            self._evict_if_needed()
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
    "top_p": 0.9,                # tighter than 0.95 for snappier decoding
    "top_k": 20,                 # halved from 40 — fewer candidates per step,
                                 # measurably faster TTFT on flash-lite
    "max_output_tokens": 220,    # ~2 spoken sentences — keeps replies snappy
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
    k: int = 2,
    lang_hint: str | None = None,
) -> AsyncIterator[str]:
    """Process one user turn. Yields response token chunks as they stream.

    Side effects:
      - Appends the user message to conversation history immediately.
      - Appends the (full) assistant message to history once streaming completes.

    `lang_hint` is the frontend voice/chat picker's current language. When
    set, it's injected into the system_instruction as a per-turn directive
    so Gemini replies in that language regardless of what user_text looks
    like. Disambiguates romanised regional words ("Bhalobashi") that would
    otherwise be misclassified as English.
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

    # Decide whether to spend an embedding API call on this turn. The system
    # prompt's always-on chunks (§1, §2, §3, §3.1, §5, §6, §8) already cover
    # the opener, the spine, the hard facts, the qualification rubric, the
    # CTAs, and compliance. Per-turn retrieval is only useful when the user
    # said something specific — an objection, a question, or a fact-bearing
    # ask. Skipping retrieval on short / low-content turns saves quota +
    # ~200-500ms latency without hurting reply quality.
    hits: list = []
    if _should_retrieve(user_text, conv):
        try:
            hits = retriever.retrieve(user_text, k=k)
        except Exception as e:  # noqa: BLE001
            log.warning("retrieval failed: %s — proceeding without retrieved context", e)
            hits = []
    else:
        log.info("skipping retrieval (short/low-content turn): %r", user_text[:60])

    # Phase 10: if this conversation is bound to a known lead, pull cross-call
    # memory for the prompt. Cheap (one indexed SQL query) and best-effort —
    # any error here falls back to "no prior context" without breaking the turn.
    ctx = None
    if conv.lead_id:
        try:
            from app.agent.lead_memory import get_lead_context

            ctx = get_lead_context(conv.lead_id)
        except Exception as e:  # noqa: BLE001
            log.warning("lead_memory lookup failed for %s: %s", conv.lead_id, e)

    parts = build_prompt_parts(retriever, retrieved_hits=hits, lead_context=ctx)
    system_instruction = parts.assemble()

    # Per-turn language resolution.
    # Order of precedence:
    #   1. Detected language from THIS turn's text (script range or
    #      romanised hint like "Bhalobashi"). Trumps everything else
    #      because it represents what the lead just said.
    #   2. Picker hint passed by the frontend (lang_hint).
    # Effect: lead can switch languages mid-call without touching the
    # picker; we follow whatever they spoke.
    detected = _detect_lang_from_text(user_text)
    effective_lang = detected or lang_hint
    pretty = _LANG_LABELS.get((effective_lang or "").strip().lower(), None)
    log.info(
        "turn lang_hint=%r detected=%r -> pretty=%r (override: %s)",
        lang_hint, detected, pretty, bool(pretty),
    )
    if pretty:
        # NOTE: keep this as ONE single multi-line string. The previous
        # version used Python implicit string concatenation across lines
        # mixed with `f"=" * 60`, which Python parses as
        # `(f"...\n\n=" * 60)` — i.e. it duplicated the entire prepended
        # persona 60 times, producing a 1.2 MB prompt that confused the
        # model into refusing every language.
        sep = "=" * 60
        override = (
            f"\n\n{sep}\n\n"
            f"# THIS TURN — LANGUAGE OVERRIDE (highest priority)\n\n"
            f"The user has selected **{pretty}** as their conversation "
            f"language via the voice/chat picker. You MUST reply in "
            f"{pretty} for this turn, regardless of what the user's most "
            f"recent message looks like — it may be a single romanised "
            f"word, a script you might guess wrong about, or even silence.\n\n"
            f"The Appendix §1.2 opener template has a {pretty} version. "
            f"Use it (paraphrased) on the first turn; paraphrase naturally "
            f"on later turns.\n\n"
            f"Forbidden responses (these violate this directive):\n"
            f"  - 'I don't speak {pretty}'\n"
            f"  - 'I can speak English or Hindi'\n"
            f"  - 'Would you prefer to continue in English'\n"
            f"  - any deferral that suggests {pretty} is unsupported\n\n"
            f"{pretty} IS supported. The §1.2 template proves you can "
            f"produce it. This per-turn override SUPERSEDES any "
            f"compliance rule earlier in the prompt that says "
            f"'never insist on English' or 'offer a language-matched "
            f"callback' — those apply only when the user has not given "
            f"an explicit language preference. They have."
        )
        system_instruction = system_instruction + override

    settings = get_settings()
    chain = settings.chat_model_chain

    # History EXCLUDES the just-added user turn — Gemini takes that as the
    # "new" message via send_message.
    history = conv.to_history()[:-1]

    response_text_parts: list[str] = []
    is_rate_limit = False
    annotation_stripped = False
    chunk_count = 0
    used_model: str | None = None

    # Walk the chain. Switch to the next model only if THIS one fails BEFORE
    # we yielded anything user-visible. After the first chunk lands, the
    # client has already started rendering — at that point any failure is
    # surfaced as the polite filler instead of a silent model switch.
    for model_idx, model_name in enumerate(chain):
        if response_text_parts:
            break  # already streamed something — don't restart on a different model

        log.info("turn | conv=%s model=%s (try %d/%d)",
                 conv_id, model_name, model_idx + 1, len(chain))
        model = genai.GenerativeModel(
            model_name,
            system_instruction=system_instruction,
            generation_config=GENERATION_CONFIG,
            safety_settings=SAFETY_SETTINGS,
        )
        chat = model.start_chat(history=history)

        try:
            stream = chat.send_message(user_text, stream=True)
            for chunk in stream:
                piece = getattr(chunk, "text", "") or ""
                if not piece:
                    continue
                chunk_count += 1
                if not annotation_stripped:
                    piece = _LEADING_ANNOTATION.sub("", piece)
                    annotation_stripped = True
                    if not piece:
                        continue
                response_text_parts.append(piece)
                used_model = model_name
                yield piece
        except Exception as e:  # noqa: BLE001
            emsg = str(e)
            is_quota = "429" in emsg or "quota" in emsg.lower() or "rate" in emsg.lower()

            if response_text_parts:
                # Mid-stream failure — can't switch models cleanly. Send the
                # polite filler so the UI completes the turn.
                log.warning("mid-stream failure on %s after %d chunks: %s",
                            model_name, chunk_count, emsg[:200])
                filler = "Sorry, I lost the line for a moment. Could you say that again?"
                response_text_parts.append(filler)
                yield filler
                break

            if is_quota and model_idx + 1 < len(chain):
                # Quota exhausted on this model and we have more to try.
                next_model = chain[model_idx + 1]
                log.warning("model %s rate-limited; falling back to %s",
                            model_name, next_model)
                continue

            if is_quota:
                # Last model in the chain also rate-limited — surface a
                # quota-specific filler.
                log.warning("all %d models in chain rate-limited", len(chain))
                is_rate_limit = True
                fallback = "Just a second — let me check that and get back to you."
            else:
                log.exception("Gemini call failed (non-quota) on %s", model_name)
                fallback = "Sorry, I lost the line for a moment. Could you say that again?"
            response_text_parts.append(fallback)
            yield fallback
            break

    full_text = "".join(response_text_parts).strip()
    log.info(
        "turn done | conv=%s model=%s chunks=%d reply_chars=%d rate_limited=%s",
        conv_id, used_model or "none", chunk_count, len(full_text), is_rate_limit,
    )
    if full_text:
        conv.add("assistant", full_text)
    elif not is_rate_limit:
        log.warning("model returned empty reply; sending filler")
        filler = "Sorry, could you say that again?"
        conv.add("assistant", filler)
        yield filler
    if is_rate_limit:
        log.warning("rate-limited across all chain models; pacing recommended")

    # Best-effort persistence: write conversation snapshot to the DB. Failures
    # do not affect the user response — the in-memory store is still authoritative
    # for the current request.
    try:
        from app.db.repo import persist_conversation

        persist_conversation(conv, channel="text")
    except Exception:  # noqa: BLE001
        log.exception("failed to persist conversation %s", conv.conv_id)


# ---------- voice-mode wrapper: text streaming + parallel TTS ----------

# Sentence boundary: ., !, ? followed by whitespace or end-of-text. We also
# break on commas after a long enough run so a long sentence doesn't delay
# the first audio.
_SENTENCE_END_RE = re.compile(r"([.!?])(\s+|$)|([:;])\s+")
_MIN_SENTENCE_CHARS = 12       # don't TTS one-word fragments
_LONG_RUN_BREAK = 90           # also break on , when buffer exceeds this


def _next_sentence_break(buf: str) -> int:
    """Return the index *just past* the next sentence-ending punctuation in
    `buf`, or 0 if no break has appeared yet (meaning we keep buffering).
    """
    if len(buf) < _MIN_SENTENCE_CHARS:
        return 0
    # Find the earliest .!?:; followed by whitespace.
    m = _SENTENCE_END_RE.search(buf)
    if m:
        return m.end()
    # Fallback: if the buffer is long, break on the next comma + space.
    if len(buf) > _LONG_RUN_BREAK:
        i = buf.find(", ")
        if i > _MIN_SENTENCE_CHARS:
            return i + 2
    return 0


# Delivery style cue prepended to TTS calls so Aoede uses warm, salesy prosody.
# Per Google's docs, you can shape delivery this way without multi-speaker setup.
_TTS_STYLE_PROMPT = (
    "Say in a warm, friendly, professional, low-pressure sales tone. "
    "Speak with genuine warmth and confidence. Use natural pacing"
)


async def stream_user_turn_with_audio(
    conv_id: str,
    user_text: str,
    *,
    voice: str = "Aoede",
    k: int = 4,
) -> AsyncIterator[tuple[str, str | bytes]]:
    """Voice-mode turn loop.

    Yields a stream of (kind, payload) tuples:
      ("text", "<chunk>")     — raw text chunk (same as text-mode)
      ("audio", <wav bytes>)  — synthesized WAV for one sentence

    Sentences are TTS'd as they complete in the LLM stream. The browser plays
    the audio chunks sequentially while later sentences are still being
    synthesized — so first audio plays ~1.5–2.5s after the user finishes
    speaking, instead of waiting for the entire reply.
    """
    from app.tts.gemini_tts import synthesize  # local import so text mode stays cheap

    sentence_buf = ""
    full_text_parts: list[str] = []

    async def _tts(sentence: str) -> bytes:
        try:
            return await synthesize(sentence, voice=voice, style_prompt=_TTS_STYLE_PROMPT)
        except Exception as e:  # noqa: BLE001
            log.warning("TTS failed on sentence (%d chars): %s", len(sentence), e)
            return b""

    async for piece in stream_user_turn(conv_id, user_text, k=k):
        full_text_parts.append(piece)
        # Always emit the text chunk for the live transcript.
        yield ("text", piece)

        sentence_buf += piece
        # Drain any complete sentences out of the buffer.
        while True:
            split_at = _next_sentence_break(sentence_buf)
            if split_at == 0:
                break
            sentence = sentence_buf[:split_at].strip()
            sentence_buf = sentence_buf[split_at:]
            if sentence:
                wav = await _tts(sentence)
                if wav:
                    yield ("audio", wav)

    # Flush any trailing buffer (no terminal punctuation).
    tail = sentence_buf.strip()
    if tail:
        wav = await _tts(tail)
        if wav:
            yield ("audio", wav)

    log.info(
        "voice turn done | conv=%s chars=%d",
        conv_id, sum(len(p) for p in full_text_parts),
    )
