"""Phase 8 WhatsApp-sender tests.

Same isolated-DB fixture pattern as `test_persistence.py` — each test runs
against a temp SQLite file that's destroyed afterwards. We exercise the
real persistence layer (no mocks) so DB-shape regressions surface.
"""

from __future__ import annotations

import asyncio
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
    NextActionType,
    SignalBreakdown,
)


# ---------- fixture (mirrors test_persistence.py) ----------


@pytest.fixture()
def isolated_db(monkeypatch: pytest.MonkeyPatch) -> Path:
    fd, raw = tempfile.mkstemp(suffix=".db", prefix="rupeezy_wa_test_")
    os.close(fd)
    p = Path(raw)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{p.as_posix()}")
    from app import config as cfg_mod
    from app.db import engine as engine_mod

    cfg_mod.get_settings.cache_clear()
    engine_mod._engine = None
    engine_mod._SessionLocal = None
    try:
        yield p
    finally:
        if engine_mod._engine is not None:
            engine_mod._engine.dispose()
        engine_mod._engine = None
        engine_mod._SessionLocal = None
        cfg_mod.get_settings.cache_clear()
        p.unlink(missing_ok=True)


# ---------- handoff factory ----------


def _signals(**overrides: float) -> SignalBreakdown:
    base = dict(
        stated_intent=0.5,
        engagement=0.5,
        network_size=0.5,
        objection_pattern=0.5,
        affirmative_cues=0.5,
        deferrals=0.5,
    )
    base.update(overrides)
    return SignalBreakdown(**base)


def _handoff(
    *,
    conv_id: str = "conv_wa_001",
    bucket: str = "hot",
    next_action: NextActionType = "warm_transfer",
    name: str = "Priya",
    phone: str = "+919876543210",
    summary: str = "Test summary.",
) -> HandoffRecord:
    return HandoffRecord(
        lead_id=conv_id,
        contact=Contact(name=name, phone=phone, language_used="english"),
        call=CallMeta(
            started_at="2026-05-04T10:00:00+00:00",
            ended_at="2026-05-04T10:02:00+00:00",
            duration_sec=120,
            turn_count=6,
            ended_by="lead",
        ),
        classification=Classification(
            bucket=bucket,  # type: ignore[arg-type]
            confidence=0.9,
            rationale="test rationale",
            signal_breakdown=_signals(),
        ),
        discovery=Discovery(current_role="mfd", estimated_clients=40),
        objections_raised=[],
        unresolved_questions=[],
        next_action=NextAction(type=next_action),
        summary_short=summary,
    )


def _seed_conversation(conv_id: str) -> None:
    """Insert a parent Conversation row so the WhatsappLog FK is satisfied."""
    from app.agent.conversation import Conversation as InMemConv, Message
    from app.db.repo import init_db, persist_conversation

    init_db()
    c = InMemConv(conv_id=conv_id, started_at="2026-05-04T10:00:00+00:00")
    c.messages.append(Message(role="user", text="hi"))
    c.messages.append(Message(role="assistant", text="hello"))
    c.ended_at = "2026-05-04T10:02:00+00:00"
    c.ended_by = "lead"
    c.language = "english"
    persist_conversation(c, channel="text")


# ---------- tests ----------


def test_mock_sender_writes_log(isolated_db: Path) -> None:
    """Hot HandoffRecord → MockSender persists a row with sent_mock + §9.1."""
    from app.db.repo import list_logs_for_conversation
    from app.whatsapp.sender import MockSender

    _seed_conversation("conv_wa_hot")
    handoff = _handoff(conv_id="conv_wa_hot", bucket="hot", next_action="warm_transfer")

    log = asyncio.run(MockSender().send(handoff))

    assert log.status == "sent_mock"
    assert log.template_id == "hot"
    # Appendix §9.1 quick-reference bullets
    assert "100% lifetime" in log.body
    # Signup link placeholder
    assert "rupeezy.in/partner-signup" in log.body
    # Persisted, retrievable
    rows = list_logs_for_conversation("conv_wa_hot")
    assert len(rows) == 1
    assert rows[0].template_id == "hot"
    assert rows[0].status == "sent_mock"
    assert rows[0].id is not None


def test_dnd_skipped(isolated_db: Path) -> None:
    """DND next-action → no DB row written, returned status='skipped'."""
    from app.db.repo import list_logs_for_conversation
    from app.whatsapp.sender import MockSender

    _seed_conversation("conv_wa_dnd")
    # A cold lead the classifier hard-rejected → next_action='dnd'.
    handoff = _handoff(conv_id="conv_wa_dnd", bucket="cold", next_action="dnd")

    result = asyncio.run(MockSender().send(handoff))

    assert result.status == "skipped"
    # DB row count must be zero — skipped is a transient signal only.
    assert list_logs_for_conversation("conv_wa_dnd") == []


def test_warm_template_has_three_links(isolated_db: Path) -> None:
    """Appendix §9.2 — warm template carries 3 link placeholders."""
    from app.db.repo import list_logs_for_conversation
    from app.whatsapp.sender import MockSender

    _seed_conversation("conv_wa_warm")
    handoff = _handoff(
        conv_id="conv_wa_warm",
        bucket="warm",
        next_action="whatsapp_link_sent",
    )

    log = asyncio.run(MockSender().send(handoff))

    assert log.status == "sent_mock"
    assert log.template_id == "warm"
    # Three distinct https:// URLs in the rendered body.
    https_count = log.body.count("https://")
    assert https_count == 3, f"expected 3 links, found {https_count} in:\n{log.body}"
    # Persisted exactly once.
    assert len(list_logs_for_conversation("conv_wa_warm")) == 1


def test_cold_nurture_only(isolated_db: Path) -> None:
    """Cold + nurture_sequence sends; cold + dnd does NOT."""
    from app.db.repo import list_logs_for_conversation
    from app.whatsapp.sender import MockSender

    # Soft cold → nurture touch.
    _seed_conversation("conv_wa_cold_soft")
    soft = _handoff(
        conv_id="conv_wa_cold_soft",
        bucket="cold",
        next_action="nurture_sequence",
    )
    soft_log = asyncio.run(MockSender().send(soft))
    assert soft_log.status == "sent_mock"
    assert soft_log.template_id == "cold_nurture"
    soft_rows = list_logs_for_conversation("conv_wa_cold_soft")
    assert len(soft_rows) == 1

    # Hard cold → DND, nothing written.
    _seed_conversation("conv_wa_cold_hard")
    hard = _handoff(
        conv_id="conv_wa_cold_hard",
        bucket="cold",
        next_action="dnd",
    )
    hard_log = asyncio.run(MockSender().send(hard))
    assert hard_log.status == "skipped"
    assert list_logs_for_conversation("conv_wa_cold_hard") == []
