"""Unit tests for the deterministic next-action chooser.

Pure-function tests — no external services.
"""

from __future__ import annotations

from app.scoring.handoff import choose_next_action
from app.scoring.schemas import (
    Classification,
    ObjectionRaised,
    SignalBreakdown,
)


def _classification(bucket: str, confidence: float = 0.9) -> Classification:
    return Classification(
        bucket=bucket,  # type: ignore[arg-type]
        confidence=confidence,
        rationale="test rationale",
        signal_breakdown=SignalBreakdown(
            stated_intent=0.5,
            engagement=0.5,
            network_size=0.5,
            objection_pattern=0.5,
            affirmative_cues=0.5,
            deferrals=0.5,
        ),
    )


def test_hot_routes_to_warm_transfer() -> None:
    n = choose_next_action(
        classification=_classification("hot"),
        objections=[],
        ended_by="lead",
    )
    assert n.type == "warm_transfer"


def test_warm_routes_to_whatsapp_link() -> None:
    n = choose_next_action(
        classification=_classification("warm"),
        objections=[],
        ended_by="lead",
    )
    assert n.type == "whatsapp_link_sent"


def test_cold_default_routes_to_nurture() -> None:
    n = choose_next_action(
        classification=_classification("cold"),
        objections=[],
        ended_by="lead",
        rationale="lead disengaged",
        summary="lead lost interest after pitch",
    )
    assert n.type == "nurture_sequence"


def test_hard_rejection_text_routes_to_dnd_even_if_cold() -> None:
    n = choose_next_action(
        classification=_classification("cold"),
        objections=[],
        ended_by="lead",
        rationale="The lead requested to be removed from the calling list",
        summary="hard rejection",
    )
    assert n.type == "dnd"


def test_hard_rejection_overrides_warm_bucket_too() -> None:
    """Belt-and-braces: a 'warm' classification with a DND phrase still routes
    to DND, because the lead's stated wish takes precedence."""
    n = choose_next_action(
        classification=_classification("warm"),
        objections=[],
        ended_by="lead",
        rationale="lead said do not call",
        summary="",
    )
    assert n.type == "dnd"


def test_objection_based_hard_rejection() -> None:
    """Lead said 'think about it' but agent failed to address it AND lead ended."""
    objections = [
        ObjectionRaised(
            id="think_about_it",
            raised_at_turn=4,
            resolved="false",
            notes="lead just hung up",
        )
    ]
    n = choose_next_action(
        classification=_classification("cold"),
        objections=objections,
        ended_by="lead",
    )
    assert n.type == "dnd"
