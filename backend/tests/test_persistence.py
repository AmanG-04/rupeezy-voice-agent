"""Phase 4 persistence tests.

Uses an isolated SQLite DB so it doesn't pollute the dev one. No external
services — pure DB roundtrip for the in-memory Conversation + HandoffRecord
shapes.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

from app.scoring.schemas import (
    CallMeta,
    Classification,
    Contact,
    Discovery,
    HandoffRecord,
    NextAction,
    SignalBreakdown,
)


@pytest.fixture()
def isolated_db(monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the engine at a temp SQLite file for the duration of the test."""
    fd, raw = tempfile.mkstemp(suffix=".db", prefix="rupeezy_test_")
    os.close(fd)
    p = Path(raw)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{p.as_posix()}")
    # Force re-creation of the cached engine + session factory.
    from app import config as cfg_mod
    from app.db import engine as engine_mod

    cfg_mod.get_settings.cache_clear()
    engine_mod._engine = None
    engine_mod._SessionLocal = None
    try:
        yield p
    finally:
        # Dispose the engine so SQLite releases the file handle on Windows
        # (otherwise unlink raises PermissionError).
        if engine_mod._engine is not None:
            engine_mod._engine.dispose()
        engine_mod._engine = None
        engine_mod._SessionLocal = None
        cfg_mod.get_settings.cache_clear()
        p.unlink(missing_ok=True)


def _sample_conversation():
    """Build an in-memory Conversation by importing the dataclass directly."""
    from app.agent.conversation import Conversation as InMemConv, Message

    c = InMemConv(
        conv_id="conv_test_001",
        started_at="2026-05-04T10:00:00+00:00",
    )
    c.messages.append(Message(role="user", text="Hi who is this?"))
    c.messages.append(Message(role="assistant", text="Hi, this is Aria from Rupeezy."))
    c.ended_at = "2026-05-04T10:00:30+00:00"
    c.ended_by = "lead"
    c.language = "english"
    return c


def _sample_handoff(conv_id: str = "conv_test_001") -> HandoffRecord:
    return HandoffRecord(
        lead_id=conv_id,
        contact=Contact(name="Test", phone="", language_used="english"),
        call=CallMeta(
            started_at="2026-05-04T10:00:00+00:00",
            ended_at="2026-05-04T10:00:30+00:00",
            duration_sec=30,
            turn_count=4,
            ended_by="lead",
        ),
        classification=Classification(
            bucket="warm",
            confidence=0.85,
            rationale="lead asked for comparison sheet",
            signal_breakdown=SignalBreakdown(
                stated_intent=0.2,
                engagement=0.7,
                network_size=0.4,
                objection_pattern=0.6,
                affirmative_cues=0.5,
                deferrals=0.7,
            ),
        ),
        discovery=Discovery(current_role="advisor", estimated_clients=12),
        objections_raised=[],
        unresolved_questions=[],
        next_action=NextAction(type="whatsapp_link_sent"),
        summary_short="Advisor with 12 clients, asked for comparison sheet.",
    )


def test_init_db_creates_tables(isolated_db: Path) -> None:
    from app.db.repo import init_db
    from app.db.engine import get_engine
    from sqlalchemy import inspect

    init_db()
    insp = inspect(get_engine())
    table_names = set(insp.get_table_names())
    assert {"leads", "conversations", "messages", "handoff_records"}.issubset(table_names)


def test_persist_conversation_roundtrip(isolated_db: Path) -> None:
    from app.db.repo import init_db, persist_conversation, get_conversation_row

    init_db()
    conv = _sample_conversation()
    persist_conversation(conv, channel="text")

    row = get_conversation_row(conv.conv_id)
    assert row is not None
    assert row.id == "conv_test_001"
    assert row.ended_by == "lead"
    assert row.language_used == "english"
    assert row.duration_sec == 30
    assert len(row.messages) == 2
    assert row.messages[0].role == "user"
    assert row.messages[1].role == "assistant"
    assert "Aria" in row.messages[1].text


def test_persist_handoff_roundtrip(isolated_db: Path) -> None:
    from app.db.repo import init_db, persist_conversation, persist_handoff, get_handoff_row

    init_db()
    persist_conversation(_sample_conversation(), channel="text")
    persist_handoff(_sample_handoff())

    row = get_handoff_row("conv_test_001")
    assert row is not None
    assert row.bucket == "warm"
    assert row.next_action == "whatsapp_link_sent"
    assert "comparison sheet" in row.summary_short
    # The full payload should round-trip the original HandoffRecord exactly.
    payload = json.loads(row.payload_json)
    assert payload["lead_id"] == "conv_test_001"
    assert payload["classification"]["bucket"] == "warm"
    assert payload["discovery"]["current_role"] == "advisor"


def test_persist_conversation_is_idempotent(isolated_db: Path) -> None:
    """Re-persisting the same conversation should not duplicate messages."""
    from app.db.repo import init_db, persist_conversation, get_conversation_row

    init_db()
    conv = _sample_conversation()
    persist_conversation(conv, channel="text")
    persist_conversation(conv, channel="text")
    persist_conversation(conv, channel="text")

    row = get_conversation_row(conv.conv_id)
    assert row is not None
    assert len(row.messages) == 2


def test_funnel_counts(isolated_db: Path) -> None:
    from app.db.repo import init_db, persist_conversation, persist_handoff, funnel_counts

    init_db()
    # 3 conversations, 2 with handoffs.
    for i, bucket in enumerate(["hot", "warm", "cold"]):
        from app.agent.conversation import Conversation as InMemConv, Message

        c = InMemConv(
            conv_id=f"conv_{i}",
            started_at="2026-05-04T10:00:00+00:00",
        )
        c.messages.append(Message(role="user", text="x"))
        c.messages.append(Message(role="assistant", text="y"))
        # 31s on 'hot' so it counts as engaged; 10s on 'warm' so it does not.
        if bucket == "hot":
            c.ended_at = "2026-05-04T10:00:31+00:00"
        elif bucket == "warm":
            c.ended_at = "2026-05-04T10:00:10+00:00"
        else:
            c.ended_at = "2026-05-04T10:00:05+00:00"
        c.ended_by = "lead"
        persist_conversation(c, channel="text")

        h = _sample_handoff(conv_id=f"conv_{i}")
        h.classification.bucket = bucket  # type: ignore[assignment]
        persist_handoff(h)

    counts = funnel_counts()
    assert counts["contacted"] == 3
    assert counts["engaged"] == 1  # only 'hot' was >30s
    assert counts["hot"] == 1
    assert counts["warm"] == 1
    assert counts["cold"] == 1
    assert counts["qualified"] == 2
