"""SQLAlchemy ORM models.

Schema mirrors PLAN.md Phase 4 spec:
  leads(id, name, phone, language_pref, created_at, dnd, last_called_at)
  conversations(id, lead_id, started_at, ended_at, duration_sec, language_used,
                channel, ended_by)
  messages(id, conversation_id, turn, role, text, audio_url, created_at)
  handoff_records(id, conversation_id, bucket, confidence,
                  signal_breakdown_json, summary_short, payload_json, created_at)
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    language_pref: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    dnd: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_called_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="lead", cascade="all, delete-orphan"
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    lead_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("leads.id"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_sec: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    language_used: Mapped[str] = mapped_column(String(20), default="unknown", nullable=False)
    channel: Mapped[str] = mapped_column(
        String(20), default="text", nullable=False
    )  # text | voice
    ended_by: Mapped[str | None] = mapped_column(String(20), nullable=True)

    lead: Mapped[Lead | None] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.turn",
    )
    handoff: Mapped["HandoffRow | None"] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        uselist=False,
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    turn: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant
    text: Mapped[str] = mapped_column(Text, nullable=False)
    audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class HandoffRow(Base):
    """Persisted HandoffRecord. The full structured object is kept as JSON in
    payload_json — the columns alongside it (bucket, confidence, summary) are
    denormalised for fast dashboard listing/filtering without parsing the JSON.
    """

    __tablename__ = "handoff_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    bucket: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    summary_short: Mapped[str] = mapped_column(Text, nullable=False)
    next_action: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    conversation: Mapped[Conversation] = relationship(back_populates="handoff")


class WhatsappLog(Base):
    """Phase 8 — record of every WhatsApp follow-up dispatched (or skipped).

    Status taxonomy:
      - ``sent_mock``       : MockSender persisted the rendered template; no
                              real API call went out. Default for the demo.
      - ``sent_cloud_api``  : CloudApiSender successfully posted to Meta's
                              Cloud API (production path; not implemented).
      - ``failed``          : Send attempted and errored.
      - ``skipped``         : Sender deliberately did not send (e.g. DND
                              lead, or a cold lead with no nurture touch).
                              No DB row is written for skipped — the
                              returned object exists only in memory.
    """

    __tablename__ = "whatsapp_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    template_id: Mapped[str] = mapped_column(String(40), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    to_phone: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="sent_mock")
    response_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
