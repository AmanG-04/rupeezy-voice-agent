"""Phase 10 cross-call memory tests.

These exercise the read-side helper `get_lead_context()` against an isolated
SQLite DB seeded with synthesized Conversation + HandoffRow rows. No external
services — the seeding bypasses the live scoring pipeline by writing pre-built
HandoffRecord JSON directly via `persist_handoff`.

Reuses the `isolated_db` fixture pattern from test_persistence.py.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.scoring.schemas import (
    CallMeta,
    Classification,
    Contact,
    Discovery,
    HandoffRecord,
    NextAction,
    ObjectionRaised,
    SignalBreakdown,
)


# ---------- fixtures ----------


@pytest.fixture()
def isolated_db(monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the engine at a temp SQLite file. Mirrors test_persistence.py."""
    fd, raw = tempfile.mkstemp(suffix=".db", prefix="rupeezy_lm_test_")
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


# ---------- helpers ----------


def _signals() -> SignalBreakdown:
    return SignalBreakdown(
        stated_intent=0.5,
        engagement=0.6,
        network_size=0.4,
        objection_pattern=0.5,
        affirmative_cues=0.5,
        deferrals=0.6,
    )


def _seed_lead_with_call(
    lead_id: str,
    *,
    conv_id: str,
    bucket: str = "warm",
    summary: str = "advisor with 12 clients, asked for comparison sheet",
    started_at: str = "2026-05-02T10:00:00+00:00",
    ended_at: str = "2026-05-02T10:08:00+00:00",
    objections: list[ObjectionRaised] | None = None,
    unresolved_questions: list[str] | None = None,
    discovery: Discovery | None = None,
) -> None:
    """Write a Lead + completed Conversation + HandoffRow."""
    from app.agent.conversation import Conversation as InMemConv
    from app.agent.conversation import Message
    from app.db.repo import (
        init_db,
        persist_conversation,
        persist_handoff,
        upsert_lead,
    )

    init_db()
    upsert_lead(lead_id=lead_id, name="Test Lead", phone="+919999999999")

    conv = InMemConv(
        conv_id=conv_id,
        lead_id=lead_id,
        started_at=started_at,
    )
    conv.messages.append(Message(role="user", text="hi"))
    conv.messages.append(Message(role="assistant", text="Hi, this is Aria."))
    conv.ended_at = ended_at
    conv.ended_by = "lead"
    conv.language = "english"
    persist_conversation(conv, channel="text")

    handoff = HandoffRecord(
        lead_id=conv_id,
        contact=Contact(name="Test Lead", phone="+919999999999", language_used="english"),
        call=CallMeta(
            started_at=started_at,
            ended_at=ended_at,
            duration_sec=480,
            turn_count=8,
            ended_by="lead",
        ),
        classification=Classification(
            bucket=bucket,  # type: ignore[arg-type]
            confidence=0.85,
            rationale="seeded",
            signal_breakdown=_signals(),
        ),
        discovery=discovery
        or Discovery(
            current_role="advisor",
            current_broker="Zerodha",
            estimated_clients=12,
            has_nism_series_vii=True,
        ),
        objections_raised=objections or [],
        unresolved_questions=unresolved_questions or [],
        next_action=NextAction(type="whatsapp_link_sent"),
        summary_short=summary,
    )
    persist_handoff(handoff)


# ---------- tests ----------


def test_no_prior_call_returns_none(isolated_db: Path) -> None:
    from app.agent.lead_memory import get_lead_context
    from app.db.repo import init_db, upsert_lead

    init_db()
    upsert_lead(lead_id="lead_never_called", name="Ghost", phone="+910000000000")

    assert get_lead_context("lead_never_called") is None


def test_empty_lead_id_returns_none(isolated_db: Path) -> None:
    from app.agent.lead_memory import get_lead_context
    from app.db.repo import init_db

    init_db()
    assert get_lead_context("") is None


def test_prior_call_summary_returned(isolated_db: Path) -> None:
    from app.agent.lead_memory import get_lead_context

    # Seed a call ended ~3 days ago.
    ended = (datetime.now(timezone.utc) - timedelta(days=3, hours=2)).isoformat()
    started = (datetime.now(timezone.utc) - timedelta(days=3, hours=2, minutes=8)).isoformat()
    _seed_lead_with_call(
        lead_id="lead_001",
        conv_id="conv_lm_001",
        bucket="warm",
        summary="Advisor with 12 clients, asked for comparison sheet.",
        started_at=started,
        ended_at=ended,
    )

    ctx = get_lead_context("lead_001")
    assert ctx is not None
    assert ctx.lead_id == "lead_001"
    assert ctx.prior_call_count >= 1
    assert ctx.last_bucket == "warm"
    assert ctx.last_call_summary is not None
    assert "comparison sheet" in ctx.last_call_summary
    assert ctx.last_call_ended_at is not None
    assert "day" in ctx.time_since_last_call_human
    # discovery extraction
    assert ctx.discovery.get("current_role") == "advisor"
    assert ctx.discovery.get("current_broker") == "Zerodha"
    assert ctx.discovery.get("estimated_clients") == 12
    assert ctx.discovery.get("has_nism_series_vii") is True


def test_unresolved_questions_extracted(isolated_db: Path) -> None:
    from app.agent.lead_memory import get_lead_context

    _seed_lead_with_call(
        lead_id="lead_002",
        conv_id="conv_lm_002",
        unresolved_questions=[
            "exact margin funding rate",
            "white-label availability",
        ],
    )
    ctx = get_lead_context("lead_002")
    assert ctx is not None
    assert ctx.unresolved_questions == [
        "exact margin funding rate",
        "white-label availability",
    ]


def test_unresolved_objections_filter(isolated_db: Path) -> None:
    """Three objections (true / false / partial) → only the two non-true ones
    surface as unresolved."""
    from app.agent.lead_memory import get_lead_context

    objections = [
        ObjectionRaised(id="existing_broker", raised_at_turn=2, resolved="true", notes=""),
        ObjectionRaised(id="security_deposit", raised_at_turn=4, resolved="false", notes=""),
        ObjectionRaised(id="trustworthiness", raised_at_turn=5, resolved="partial", notes=""),
    ]
    _seed_lead_with_call(
        lead_id="lead_003",
        conv_id="conv_lm_003",
        objections=objections,
    )
    ctx = get_lead_context("lead_003")
    assert ctx is not None
    assert set(ctx.unresolved_objections) == {"security_deposit", "trustworthiness"}
    assert "existing_broker" not in ctx.unresolved_objections


def test_time_since_human_format(isolated_db: Path) -> None:
    """Exercise the humanized time string. We can't assert on absolute string
    because it's relative to "now", but we CAN assert format invariants."""
    from app.agent.lead_memory import _humanize_delta

    now = datetime.now(timezone.utc)

    # Sub-hour: floors to "1h ago" (no 'seconds' / 'minutes' artefacts).
    assert _humanize_delta(now - timedelta(seconds=5)) == "1h ago"
    assert _humanize_delta(now - timedelta(minutes=30)) == "1h ago"

    # 2 hours.
    assert _humanize_delta(now - timedelta(hours=2)) == "2h ago"

    # Days.
    assert _humanize_delta(now - timedelta(days=1, hours=3)) == "1 day ago"
    assert _humanize_delta(now - timedelta(days=3, hours=2)) == "3 days ago"

    # Weeks.
    assert _humanize_delta(now - timedelta(days=14)) == "2 weeks ago"
    assert _humanize_delta(now - timedelta(days=7, hours=5)) == "1 week ago"

    # None → "recently".
    assert _humanize_delta(None) == "recently"


def test_returns_most_recent_call_when_multiple(isolated_db: Path) -> None:
    """If a lead has multiple prior calls, only the latest is surfaced."""
    from app.agent.lead_memory import get_lead_context

    older_started = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    older_ended = (datetime.now(timezone.utc) - timedelta(days=10, minutes=-8)).isoformat()
    newer_started = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    newer_ended = (datetime.now(timezone.utc) - timedelta(days=2, minutes=-8)).isoformat()

    _seed_lead_with_call(
        lead_id="lead_004",
        conv_id="conv_lm_004_old",
        bucket="cold",
        summary="OLDER CALL — should not surface",
        started_at=older_started,
        ended_at=older_ended,
    )
    _seed_lead_with_call(
        lead_id="lead_004",
        conv_id="conv_lm_004_new",
        bucket="hot",
        summary="NEWER CALL — this is the one",
        started_at=newer_started,
        ended_at=newer_ended,
    )

    ctx = get_lead_context("lead_004")
    assert ctx is not None
    assert ctx.last_bucket == "hot"
    assert "NEWER CALL" in (ctx.last_call_summary or "")


def test_in_progress_call_does_not_count_as_prior(isolated_db: Path) -> None:
    """A conversation with ended_at == NULL should not be returned as a prior."""
    from app.agent.conversation import Conversation as InMemConv
    from app.agent.conversation import Message
    from app.agent.lead_memory import get_lead_context
    from app.db.repo import init_db, persist_conversation, upsert_lead

    init_db()
    upsert_lead(lead_id="lead_005", name="Active", phone="+910000000005")
    conv = InMemConv(conv_id="conv_lm_005_active", lead_id="lead_005")
    conv.messages.append(Message(role="user", text="hi"))
    # Note: no ended_at set
    persist_conversation(conv, channel="text")

    assert get_lead_context("lead_005") is None


def test_malformed_payload_returns_partial_context(isolated_db: Path) -> None:
    """If payload_json fails to parse, we still return what the dedicated
    columns gave us (bucket, summary, ended_at) — not None."""
    from app.agent.conversation import Conversation as InMemConv
    from app.agent.conversation import Message
    from app.agent.lead_memory import get_lead_context
    from app.db.engine import session_scope
    from app.db.models import HandoffRow
    from app.db.repo import init_db, persist_conversation, upsert_lead

    init_db()
    upsert_lead(lead_id="lead_006", name="Broken", phone="+910000000006")
    conv = InMemConv(
        conv_id="conv_lm_006",
        lead_id="lead_006",
        started_at="2026-05-01T10:00:00+00:00",
    )
    conv.messages.append(Message(role="user", text="hi"))
    conv.messages.append(Message(role="assistant", text="Hi, Aria here."))
    conv.ended_at = "2026-05-01T10:05:00+00:00"
    conv.ended_by = "lead"
    persist_conversation(conv, channel="text")

    # Insert a deliberately malformed handoff row.
    with session_scope() as s:
        s.add(
            HandoffRow(
                conversation_id="conv_lm_006",
                bucket="warm",
                confidence=0.5,
                summary_short="partial-data summary",
                next_action="rm_callback",
                payload_json="this is not valid json {{{",
            )
        )

    ctx = get_lead_context("lead_006")
    assert ctx is not None
    assert ctx.last_bucket == "warm"
    assert ctx.last_call_summary == "partial-data summary"
    # Empty because payload couldn't be parsed.
    assert ctx.unresolved_questions == []
    assert ctx.unresolved_objections == []
    assert ctx.discovery == {}


def test_prompt_includes_prior_call_section_when_context_present(
    isolated_db: Path,
) -> None:
    """build_prompt_parts injects the PRIOR CALL CONTEXT section iff
    lead_context is provided AND prior_call_count > 0."""
    from app.agent.lead_memory import get_lead_context
    from app.agent.system_prompt import build_prompt_parts
    from app.rag.retriever import Retriever

    _seed_lead_with_call(
        lead_id="lead_007",
        conv_id="conv_lm_007",
        unresolved_questions=["check with business partner"],
    )
    ctx = get_lead_context("lead_007")
    assert ctx is not None

    parts = build_prompt_parts(Retriever(), retrieved_hits=[], lead_context=ctx)
    assembled = parts.assemble()

    assert "PRIOR CALL CONTEXT" in assembled
    assert "Last bucket:" in assembled
    assert "check with business partner" in assembled

    # Without a context: section is absent.
    parts_none = build_prompt_parts(Retriever(), retrieved_hits=[], lead_context=None)
    assert "PRIOR CALL CONTEXT" not in parts_none.assemble()
