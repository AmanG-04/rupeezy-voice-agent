"""Phase 9 — naive dialer simulator.

In-process queue + a step-by-step "process one lead" worker. Each lead in
the queue is "called" by:

  1. flipping its status to 'contacting'
  2. spinning up a Conversation in the in-memory store
  3. running a 3-turn scripted scenario through the real conversation engine
     (`stream_user_turn`) — so the LLM, RAG, and persistence path are all
     exercised, not faked
  4. running the post-call scoring pipeline (`build_handoff`)
  5. persisting the conversation + handoff
  6. flipping its status to 'completed'

We deliberately process *one lead per call* (driven by the
`POST /api/dashboard/leads/dial-next` endpoint) instead of running a
background worker — Gemini's free-tier RPM is tight, and the demo benefits
from judges seeing the funnel update one click at a time.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Literal

log = logging.getLogger("rupeezy.agent.dialer")

QueueStatus = Literal["queued", "contacting", "completed", "failed"]


@dataclass(slots=True)
class QueuedLead:
    lead_id: str
    name: str
    phone: str
    language_pref: str = "english"
    status: QueueStatus = "queued"
    conv_id: str | None = None
    bucket: str | None = None
    error: str | None = None


# Module-level queue. Order is significant — we process FIFO.
_queue: list[QueuedLead] = []


# Scripted scenario the dialer runs against every lead. Picked to:
#  - hit the §1 opener path
#  - exercise discovery (advisor + 15 clients in one shot for classifier)
#  - close with explicit signup cue so the bucket lands HOT consistently
#
# Two turns intentionally — the classifier needs <=4 messages and bucketing
# is determined by the explicit "send me the link" close. Each extra turn
# is +10-15s of Gemini latency and burns RPM, so we keep this minimal.
SCRIPT: tuple[str, ...] = (
    "Hi, I'm a financial advisor with about 15 clients. What is this about?",
    "Sounds great — send me the signup link, I'm interested.",
)


def enqueue(lead: QueuedLead) -> None:
    """Push a fresh QueuedLead onto the queue."""
    _queue.append(lead)


def get_queue() -> list[QueuedLead]:
    """Return the queue (live reference — callers should treat as read-only)."""
    return _queue


def reset_queue() -> None:
    """Test helper — wipes the in-memory queue."""
    _queue.clear()


def _next_queued() -> QueuedLead | None:
    for q in _queue:
        if q.status == "queued":
            return q
    return None


async def dial_next() -> dict | None:
    """Process the next queued lead end-to-end.

    Returns:
      - ``None`` if the queue is empty / nothing to dial
      - a dict ``{lead_id, conv_id, bucket, status, ...}`` on completion
    """
    lead = _next_queued()
    if lead is None:
        return None

    # Local imports avoid a circular dependency between `app.agent.dialer`
    # and `app.agent.conversation` at module import time.
    from app.agent.conversation import get_store, stream_user_turn
    from app.db.repo import persist_conversation, persist_handoff
    from app.scoring.handoff import build_handoff

    lead.status = "contacting"

    try:
        store = get_store()
        conv = store.create()
        lead.conv_id = conv.conv_id

        for user_text in SCRIPT:
            # Drain the stream — we don't need the per-token output here, only
            # the post-turn conversation state.
            async for _piece in stream_user_turn(conv.conv_id, user_text):
                pass

        # Mark the call ended so build_handoff has clean call meta.
        store.end(conv.conv_id, ended_by="lead")

        handoff = await build_handoff(conversation=conv)

        # Best-effort persistence (matches /end path semantics).
        try:
            persist_conversation(conv, channel="batch")
        except Exception:  # noqa: BLE001
            log.exception("dialer: failed to persist conversation %s", conv.conv_id)
        try:
            persist_handoff(handoff)
        except Exception:  # noqa: BLE001
            log.exception("dialer: failed to persist handoff for %s", conv.conv_id)

        # Mirror the /end route: fire WhatsApp follow-up best-effort.
        # DND filtered inside the sender; this is what makes the dashboard's
        # "📱 WhatsApp" panel populate for dialed leads.
        if handoff.next_action.type in (
            "warm_transfer",
            "whatsapp_link_sent",
            "nurture_sequence",
        ):
            try:
                from app.whatsapp.sender import get_sender

                sender = get_sender()
                await sender.send(handoff)
            except Exception:  # noqa: BLE001
                log.exception("dialer: whatsapp send failed for %s", conv.conv_id)

        lead.bucket = handoff.classification.bucket
        lead.status = "completed"

        return {
            "lead_id": lead.lead_id,
            "conv_id": conv.conv_id,
            "name": lead.name,
            "phone": lead.phone,
            "bucket": handoff.classification.bucket,
            "confidence": handoff.classification.confidence,
            "next_action": handoff.next_action.type,
            "status": "completed",
        }
    except Exception as e:  # noqa: BLE001
        log.exception("dialer failed for lead %s", lead.lead_id)
        lead.status = "failed"
        lead.error = f"{type(e).__name__}: {e}"
        return {
            "lead_id": lead.lead_id,
            "name": lead.name,
            "phone": lead.phone,
            "status": "failed",
            "error": lead.error,
        }


async def start_worker(*, sleep_between_sec: float = 2.5) -> None:
    """Drain the entire queue serially.

    Provided for parity with the spec; the demo path drives one lead per
    HTTP call via ``dial_next`` instead. Sleeps between leads to stay under
    Gemini's free-tier RPM.
    """
    while _next_queued() is not None:
        await dial_next()
        await asyncio.sleep(sleep_between_sec)
