"""Repository helpers — small, testable functions over SQLAlchemy.

Each function is one transaction. Higher layers don't touch sessions.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.agent.conversation import Conversation as InMemConversation
from app.db.engine import get_engine, session_scope
from app.db.models import (
    Base,
    Conversation as ConversationRow,
    HandoffRow,
    Lead,
    Message,
    WhatsappLog,
)
from app.scoring.schemas import HandoffRecord


def init_db() -> None:
    """Create all tables if they don't exist. Safe to call repeatedly."""
    Base.metadata.create_all(bind=get_engine())


# ---------- Lead ----------


def upsert_lead(
    *,
    lead_id: str,
    name: str | None = None,
    phone: str | None = None,
    language_pref: str | None = None,
) -> None:
    """Create or update a Lead."""
    with session_scope() as s:
        existing = s.get(Lead, lead_id)
        if existing is None:
            s.add(
                Lead(
                    id=lead_id,
                    name=name,
                    phone=phone,
                    language_pref=language_pref,
                )
            )
        else:
            if name is not None:
                existing.name = name
            if phone is not None:
                existing.phone = phone
            if language_pref is not None:
                existing.language_pref = language_pref


def mark_lead_dnd(lead_id: str) -> None:
    with session_scope() as s:
        lead = s.get(Lead, lead_id)
        if lead:
            lead.dnd = True


def find_lead_by_phone(phone: str) -> Lead | None:
    """Look up a Lead by exact phone match. Used for batch-upload de-duplication."""
    if not phone:
        return None
    with session_scope() as s:
        return s.query(Lead).filter(Lead.phone == phone).one_or_none()


# ---------- Conversation + messages ----------


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def persist_conversation(conv: InMemConversation, *, channel: str = "text") -> None:
    """Upsert a Conversation + all its Messages from the in-memory representation.

    Idempotent: re-running with the same conversation produces the same DB row
    set (messages are wiped + re-inserted to keep turn ordering clean).
    """
    started_at = _parse_iso(conv.started_at) or datetime.now(timezone.utc)
    ended_at = _parse_iso(conv.ended_at)
    duration_sec = 0
    if ended_at and started_at:
        duration_sec = max(0, int((ended_at - started_at).total_seconds()))

    # Phase 10: an in-memory Conversation may carry a lead_id for cross-call
    # memory. Carry it through on insert. On update, only set it if the row
    # didn't already have one (don't clobber a value set elsewhere).
    in_mem_lead_id = getattr(conv, "lead_id", None)

    with session_scope() as s:
        existing = s.get(ConversationRow, conv.conv_id)
        if existing is None:
            row = ConversationRow(
                id=conv.conv_id,
                lead_id=in_mem_lead_id,
                started_at=started_at,
                ended_at=ended_at,
                duration_sec=duration_sec,
                language_used=conv.language or "unknown",
                channel=channel,
                ended_by=conv.ended_by,
            )
            s.add(row)
            s.flush()
            existing = row
        else:
            existing.ended_at = ended_at
            existing.duration_sec = duration_sec
            existing.language_used = conv.language or existing.language_used
            existing.ended_by = conv.ended_by or existing.ended_by
            if existing.lead_id is None and in_mem_lead_id is not None:
                existing.lead_id = in_mem_lead_id

        # Wipe & re-insert messages.
        s.query(Message).filter(Message.conversation_id == conv.conv_id).delete()
        for turn, m in enumerate(conv.messages):
            created = _parse_iso(m.created_at) or datetime.now(timezone.utc)
            s.add(
                Message(
                    conversation_id=conv.conv_id,
                    turn=turn,
                    role=m.role,
                    text=m.text,
                    audio_url=None,
                    created_at=created,
                )
            )


def persist_handoff(handoff: HandoffRecord) -> None:
    """Upsert a HandoffRow for the given handoff's conversation."""
    payload_json = handoff.model_dump_json()

    with session_scope() as s:
        existing = (
            s.query(HandoffRow)
            .filter(HandoffRow.conversation_id == handoff.lead_id)
            .one_or_none()
        )
        if existing is None:
            s.add(
                HandoffRow(
                    conversation_id=handoff.lead_id,
                    bucket=handoff.classification.bucket,
                    confidence=handoff.classification.confidence,
                    summary_short=handoff.summary_short,
                    next_action=handoff.next_action.type,
                    payload_json=payload_json,
                )
            )
        else:
            existing.bucket = handoff.classification.bucket
            existing.confidence = handoff.classification.confidence
            existing.summary_short = handoff.summary_short
            existing.next_action = handoff.next_action.type
            existing.payload_json = payload_json


# ---------- Read helpers (used by /api routes) ----------


def get_conversation_row(conv_id: str) -> ConversationRow | None:
    with session_scope() as s:
        return (
            s.query(ConversationRow)
            .options(selectinload(ConversationRow.messages))
            .filter(ConversationRow.id == conv_id)
            .one_or_none()
        )


def list_conversation_rows(
    *,
    bucket: str | None = None,
    limit: int = 200,
) -> list[ConversationRow]:
    with session_scope() as s:
        stmt = (
            select(ConversationRow)
            .options(selectinload(ConversationRow.handoff))
            .order_by(ConversationRow.started_at.desc())
            .limit(limit)
        )
        if bucket:
            stmt = stmt.join(ConversationRow.handoff).where(HandoffRow.bucket == bucket)
        return list(s.scalars(stmt))


def get_handoff_row(conv_id: str) -> HandoffRow | None:
    with session_scope() as s:
        return (
            s.query(HandoffRow).filter(HandoffRow.conversation_id == conv_id).one_or_none()
        )


def get_latest_completed_conversation_for_lead(
    lead_id: str,
) -> ConversationRow | None:
    """Return the most recently ended Conversation for `lead_id`, with its
    HandoffRow eagerly loaded. None if the lead has never completed a call.

    A "completed" conversation is one with `ended_at IS NOT NULL`. In-progress
    calls are intentionally excluded — we only resurface context from finished
    prior calls (otherwise a second tab open at the same time would mis-trigger
    the follow-up opener).
    """
    with session_scope() as s:
        return (
            s.query(ConversationRow)
            .options(selectinload(ConversationRow.handoff))
            .filter(ConversationRow.lead_id == lead_id)
            .filter(ConversationRow.ended_at.is_not(None))
            .order_by(ConversationRow.ended_at.desc())
            .first()
        )


def list_handoff_rows(
    *,
    bucket: str | None = None,
    limit: int = 200,
) -> list[HandoffRow]:
    with session_scope() as s:
        stmt = (
            select(HandoffRow)
            .options(selectinload(HandoffRow.conversation))
            .order_by(HandoffRow.created_at.desc())
            .limit(limit)
        )
        if bucket:
            stmt = stmt.where(HandoffRow.bucket == bucket)
        return list(s.scalars(stmt))


# ---------- WhatsApp log (Phase 8) ----------


def persist_whatsapp_log(log_row: WhatsappLog) -> WhatsappLog:
    """Insert a WhatsApp log row. Returns the row with `id` populated.

    Caller passes a transient ORM object with the fields filled in
    (conversation_id, template_id, body, status, ...). We attach it to a
    fresh session, commit, and refresh so the autoincrement id is visible.
    """
    with session_scope() as s:
        s.add(log_row)
        s.flush()
        # Snapshot the autoincrement id while the row is still attached;
        # session_scope() will commit + close after this block exits.
        s.refresh(log_row)
    return log_row


def list_logs_for_conversation(conv_id: str) -> list[WhatsappLog]:
    """All WhatsApp logs for a conversation, oldest first."""
    with session_scope() as s:
        stmt = (
            select(WhatsappLog)
            .where(WhatsappLog.conversation_id == conv_id)
            .order_by(WhatsappLog.sent_at.asc(), WhatsappLog.id.asc())
        )
        return list(s.scalars(stmt))


# ---------- Funnel counts (used by dashboard) ----------


def funnel_counts() -> dict[str, int]:
    """Returns counts for the conversion funnel."""
    with session_scope() as s:
        contacted = s.query(ConversationRow).count()
        engaged = (
            s.query(ConversationRow)
            .filter(ConversationRow.duration_sec > 30)
            .count()
        )
        hot = s.query(HandoffRow).filter(HandoffRow.bucket == "hot").count()
        warm = s.query(HandoffRow).filter(HandoffRow.bucket == "warm").count()
        cold = s.query(HandoffRow).filter(HandoffRow.bucket == "cold").count()

    return {
        "contacted": contacted,
        "engaged": engaged,
        "qualified": hot + warm,
        "hot": hot,
        "warm": warm,
        "cold": cold,
    }


# ---------- Deletes (RM dashboard cleanup) ----------


def delete_conversation(conv_id: str) -> int:
    """Delete a single conversation and everything cascaded from it
    (messages, handoff_records, whatsapp_log). Returns 1 if a row was
    deleted, 0 if not found."""
    with session_scope() as s:
        row = (
            s.query(ConversationRow)
            .filter(ConversationRow.id == conv_id)
            .one_or_none()
        )
        if row is None:
            return 0
        s.delete(row)
        return 1


def delete_conversations_by_bucket(bucket: str) -> int:
    """Delete every conversation whose handoff is in the given bucket.
    Returns the number of conversations removed."""
    if bucket not in {"hot", "warm", "cold"}:
        raise ValueError(f"unknown bucket: {bucket}")
    with session_scope() as s:
        rows = (
            s.query(ConversationRow)
            .join(ConversationRow.handoff)
            .filter(HandoffRow.bucket == bucket)
            .all()
        )
        count = len(rows)
        for r in rows:
            s.delete(r)
        return count
