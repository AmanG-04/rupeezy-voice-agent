"""Pydantic models matching Appendix A §7.1 handoff payload.

This is the contract between the post-call pipeline and:
  - the dashboard (Phase 5),
  - the WhatsApp sender (Phase 8),
  - the warm-transfer / RM CRM (out of scope for the demo, mocked).

Anything in here that changes is a public API change for the rest of the system.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# ---------- enums (kept as Literal for free-form tooling) ----------

Bucket = Literal["hot", "warm", "cold"]
Role = Literal["mfd", "advisor", "agent", "influencer", "other", "unknown"]
ObjectionId = Literal[
    "existing_broker",
    "not_enough_contacts",
    "client_support",
    "trustworthiness",
    "think_about_it",
    "security_deposit",
    "nism_required",
    "other",
]
Resolution = Literal["true", "false", "partial"]
NextActionType = Literal[
    "warm_transfer",
    "rm_callback",
    "whatsapp_link_sent",
    "nurture_sequence",
    "dnd",
]


# ---------- nested models ----------


class SignalBreakdown(BaseModel):
    """Per-signal scores. Each in [0.0, 1.0]. Drive the bucket decision."""

    stated_intent: float = Field(..., ge=0.0, le=1.0)
    engagement: float = Field(..., ge=0.0, le=1.0)
    network_size: float = Field(..., ge=0.0, le=1.0)
    objection_pattern: float = Field(..., ge=0.0, le=1.0)
    affirmative_cues: float = Field(..., ge=0.0, le=1.0)
    deferrals: float = Field(..., ge=0.0, le=1.0)


class Discovery(BaseModel):
    current_role: Role = "unknown"
    current_broker: str | None = None
    estimated_clients: int | None = None
    estimated_aum_inr: int | None = None
    has_nism_series_vii: bool | None = None


class ObjectionRaised(BaseModel):
    id: ObjectionId
    raised_at_turn: int = Field(..., ge=0)
    resolved: Resolution
    notes: str = ""


class NextAction(BaseModel):
    type: NextActionType
    scheduled_for: str | None = None  # ISO 8601 if scheduled
    assigned_rm: str | None = None


# ---------- top-level handoff record ----------


class Classification(BaseModel):
    bucket: Bucket
    confidence: float = Field(..., ge=0.0, le=1.0)
    signal_breakdown: SignalBreakdown
    rationale: str = Field(
        ...,
        description=(
            "Why this bucket — one sentence the RM will read. "
            "References specific moments in the call."
        ),
    )


class Contact(BaseModel):
    name: str = "Unknown"
    phone: str = ""
    language_used: str = "english"


class CallMeta(BaseModel):
    started_at: str
    ended_at: str | None
    duration_sec: int = Field(..., ge=0)
    turn_count: int = Field(..., ge=0)
    ended_by: str = "agent"  # agent | lead | dropped


class HandoffRecord(BaseModel):
    """Full handoff payload — what gets persisted + shown to the RM."""

    lead_id: str
    contact: Contact
    call: CallMeta
    classification: Classification
    discovery: Discovery
    objections_raised: list[ObjectionRaised] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)
    next_action: NextAction
    summary_short: str = Field(..., max_length=500)
    transcript_url: str | None = None
