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

    with session_scope() as s:
        existing = s.get(ConversationRow, conv.conv_id)
        if existing is None:
            row = ConversationRow(
                id=conv.conv_id,
                lead_id=None,
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
