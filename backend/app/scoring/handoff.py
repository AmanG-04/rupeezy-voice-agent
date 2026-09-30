"""Assembles the full HandoffRecord from a finished Conversation.

Logic split:
  - classify_conversation()         → LLM-driven (classifier.py)
  - choose_next_action()            → deterministic from Classification + objections
  - build_handoff()                 → glues conversation metadata + classification
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.agent.conversation import Conversation
from app.scoring.classifier import classify_conversation
from app.scoring.evidence import extract_evidence
from app.scoring.schemas import (
    CallMeta,
    Classification,
    Contact,
    HandoffRecord,
    NextAction,
    NextActionType,
    ObjectionRaised,
)

log = logging.getLogger("rupeezy.scoring.handoff")


def _iso_to_seconds(start_iso: str, end_iso: str | None) -> int:
    if not end_iso:
        return 0
    try:
        s = datetime.fromisoformat(start_iso)
        e = datetime.fromisoformat(end_iso)
        return max(0, int((e - s).total_seconds()))
    except ValueError:
        return 0


_HARD_REJECT_PATTERNS = (
    "remove my number",
    "remove me",
    "remove from",
    "removed from",
    "remove their",
    "do not call",
    "don't call",
    "stop calling",
    "not interested",
    "block this number",
    "hard rejection",
    "dnd",
    "do-not-disturb",
    "mat karo call",
    "phone band karo",
)


def _has_hard_rejection(rationale: str, summary: str) -> bool:
    blob = f"{rationale} {summary}".lower()
    return any(p in blob for p in _HARD_REJECT_PATTERNS)


def choose_next_action(
    *,
    classification: Classification,
    objections: list[ObjectionRaised],
    ended_by: str,
    rationale: str = "",
    summary: str = "",
) -> NextAction:
    """Map (bucket, exit context) → next_action per Appendix §5.2 + §6.

    - Hard rejection / DND → 'dnd' regardless of bucket
    - Hot → warm_transfer (RM availability is checked separately downstream)
    - Warm → whatsapp_link_sent (and a follow-up callback is implied)
    - Cold → nurture_sequence (soft); 'dnd' if hard rejection inferred
    """
    # Two ways to detect a hard rejection:
    #   1. classifier flagged `think_about_it` as `resolved=false` after lead ended
    #   2. rationale/summary contains a hard-rejection phrase ("remove my number" etc.)
    hard_reject_via_text = _has_hard_rejection(rationale, summary)
    hard_reject = hard_reject_via_text

    bucket = classification.bucket

    next_type: NextActionType
    if hard_reject:
        next_type = "dnd"
    elif bucket == "hot":
        next_type = "warm_transfer"
    elif bucket == "warm":
        next_type = "whatsapp_link_sent"
    else:
        next_type = "nurture_sequence"

    return NextAction(type=next_type)


async def build_handoff(
    *,
    conversation: Conversation,
    contact: Contact | None = None,
) -> HandoffRecord:
    """Run the classifier on `conversation` and build a HandoffRecord.

    `contact` is optional in Phase 3 — the chat demo doesn't collect a name/phone
    yet. Phase 4 (persistence) wires it from the Lead profile.
    """
    if not conversation.ended_at:
        # We allow scoring an open conversation but log a warning; the dashboard
        # demo flow always ends first.
        log.warning("scoring an unended conversation %s", conversation.conv_id)

    messages = [{"role": m.role, "text": m.text} for m in conversation.messages]
    if not messages:
        raise ValueError("cannot score an empty conversation")

    (
        classification,
        discovery,
        objections,
        unresolved,
        summary_short,
        language_used,
    ) = await classify_conversation(
        messages=messages,
        business_name="custom" if conversation.settings.custom else "Rupeezy",
    )

    next_action = choose_next_action(
        classification=classification,
        objections=objections,
        ended_by=conversation.ended_by or "agent",
        rationale=classification.rationale,
        summary=summary_short,
    )
    from app.agent.opt_out import is_opt_out
    from app.db.repo import get_lead, mark_lead_dnd

    if contact is None and conversation.lead_id:
        lead = await asyncio.to_thread(get_lead, conversation.lead_id)
        if lead:
            contact = Contact(name=lead.name or "Unknown", phone=lead.phone or "",
                              language_used=language_used)
    explicit_opt_out = any(is_opt_out(m["text"]) for m in messages if m["role"] == "user")
    # Generated summaries cannot create a durable opt-out by themselves.
    if next_action.type == "dnd" and not explicit_opt_out:
        next_action = NextAction(type={
            "hot": "warm_transfer",
            "warm": "whatsapp_link_sent",
            "cold": "nurture_sequence",
        }[classification.bucket])
    if explicit_opt_out:
        next_action = NextAction(type="dnd")
        if conversation.lead_id:
            await asyncio.to_thread(mark_lead_dnd, conversation.lead_id)

    call_meta = CallMeta(
        started_at=conversation.started_at,
        ended_at=conversation.ended_at or datetime.now(timezone.utc).isoformat(),
        duration_sec=_iso_to_seconds(
            conversation.started_at,
            conversation.ended_at or datetime.now(timezone.utc).isoformat(),
        ),
        turn_count=len(messages),
        ended_by=conversation.ended_by or "agent",
    )

    return HandoffRecord(
        lead_id=conversation.lead_id or conversation.conv_id,
        conversation_id=conversation.conv_id,
        evidence=extract_evidence(messages, discovery),
        contact=contact or Contact(language_used=language_used),
        call=call_meta,
        classification=classification,
        discovery=discovery,
        objections_raised=objections,
        unresolved_questions=unresolved,
        next_action=next_action,
        summary_short=summary_short,
        transcript_url=None,  # Phase 4 will populate
    )
