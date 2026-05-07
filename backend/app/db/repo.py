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
    """Returns counts for the conversion funnel.

    Implemented as TWO aggregate queries (one per table) instead of five
    sequential `.count()` calls. On Supabase's free-tier transaction
    pooler, sequential count queries consume one connection per
    round-trip and starve other concurrent dashboard polls under burst
    load — that produces intermittent 500 errors when the connection
    pool is briefly empty. Two aggregate queries cuts the round-trip
    count by 60% and keeps the connection held for the minimum time.
    """
    from sqlalchemy import case, func

    with session_scope() as s:
        # One row, three values: total conversations + count(duration > 30).
        conv_row = s.execute(
            select(
                func.count(ConversationRow.id).label("contacted"),
                func.count(
                    case((ConversationRow.duration_sec > 30, 1))
                ).label("engaged"),
            )
        ).one()

        # One row, three values: hot/warm/cold counts via FILTER.
        h_row = s.execute(
            select(
                func.count(case((HandoffRow.bucket == "hot", 1))).label("hot"),
                func.count(case((HandoffRow.bucket == "warm", 1))).label("warm"),
                func.count(case((HandoffRow.bucket == "cold", 1))).label("cold"),
            )
        ).one()

    contacted = int(conv_row.contacted or 0)
    engaged = int(conv_row.engaged or 0)
    hot = int(h_row.hot or 0)
    warm = int(h_row.warm or 0)
    cold = int(h_row.cold or 0)

    return {
        "contacted": contacted,
        "engaged": engaged,
        "qualified": hot + warm,
        "hot": hot,
        "warm": warm,
        "cold": cold,
    }


# ---------- Deletes (RM dashboard cleanup) ----------


def _delete_one_conversation(s, conv_id: str) -> int:
    """Delete children first, then the conversation row. Postgres enforces
    FK constraints in real-time, and the ORM-level `cascade="all,
    delete-orphan"` only fires if the children are loaded into the
    session — which doesn't always happen for relationships marked
    selectinload elsewhere. Doing the deletes explicitly works on both
    SQLite (where cascade was automatic) and Postgres (where it isn't
    unless we load + delete the rows ourselves)."""
    from sqlalchemy import delete as sa_delete

    # Children with FK to conversations.id and ondelete="CASCADE":
    s.execute(sa_delete(WhatsappLog).where(WhatsappLog.conversation_id == conv_id))
    s.execute(sa_delete(Message).where(Message.conversation_id == conv_id))
    s.execute(sa_delete(HandoffRow).where(HandoffRow.conversation_id == conv_id))
    # Now the parent.
    result = s.execute(sa_delete(ConversationRow).where(ConversationRow.id == conv_id))
    return int(result.rowcount or 0)


def delete_conversation(conv_id: str) -> int:
    """Delete a single conversation and everything cascaded from it
    (messages, handoff_records, whatsapp_log). Returns 1 if a row was
    deleted, 0 if not found."""
    with session_scope() as s:
        return _delete_one_conversation(s, conv_id)


def delete_conversations_by_bucket(bucket: str) -> int:
    """Delete every conversation whose handoff is in the given bucket.
    Returns the number of conversations removed."""
    if bucket not in {"hot", "warm", "cold"}:
        raise ValueError(f"unknown bucket: {bucket}")
    with session_scope() as s:
        # First find all conversation IDs in this bucket.
        ids = [
            row[0]
            for row in s.query(HandoffRow.conversation_id)
            .filter(HandoffRow.bucket == bucket)
            .all()
        ]
        count = 0
        for cid in ids:
            count += _delete_one_conversation(s, cid)
        return count
