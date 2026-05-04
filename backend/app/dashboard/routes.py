"""Dashboard API.

Read-only views over the persisted conversations + handoffs. Phase 5 frontend
calls these to render the funnel, leads list, and drilldown.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db.repo import (
    funnel_counts,
    get_conversation_row,
    get_handoff_row,
    list_handoff_rows,
)
from app.scoring.schemas import HandoffRecord

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


class FunnelResponse(BaseModel):
    contacted: int
    engaged: int
    qualified: int
    hot: int
    warm: int
    cold: int


class LeadRow(BaseModel):
    """Compact row for the dashboard table."""

    conv_id: str
    started_at: str
    duration_sec: int
    bucket: str
    confidence: float
    next_action: str
    summary_short: str
    language_used: str


class LeadDetail(BaseModel):
    handoff: HandoffRecord
    transcript: list[dict[str, str]]


@router.get("/funnel", response_model=FunnelResponse)
async def funnel() -> FunnelResponse:
    return FunnelResponse(**funnel_counts())


@router.get("/leads", response_model=list[LeadRow])
async def leads(bucket: str | None = None, limit: int = 200) -> list[LeadRow]:
    rows = list_handoff_rows(bucket=bucket, limit=limit)
    out: list[LeadRow] = []
    for r in rows:
        # We need started_at + duration from the conversation join.
        conv = r.conversation
        # `language_used` lives inside the JSON payload (handoff.contact.language_used).
        # Parse only what we need rather than hydrate the full HandoffRecord.
        try:
            handoff = HandoffRecord.model_validate_json(r.payload_json)
            language_used = handoff.contact.language_used
        except Exception:  # noqa: BLE001
            language_used = "unknown"
        out.append(
            LeadRow(
                conv_id=r.conversation_id,
                started_at=conv.started_at.isoformat() if conv.started_at else "",
                duration_sec=conv.duration_sec or 0,
                bucket=r.bucket,
                confidence=r.confidence,
                next_action=r.next_action,
                summary_short=r.summary_short,
                language_used=language_used,
            )
        )
    return out


@router.get("/leads/{conv_id}", response_model=LeadDetail)
async def lead_detail(conv_id: str) -> LeadDetail:
    row = get_handoff_row(conv_id)
    if row is None:
        raise HTTPException(404, f"no handoff for {conv_id}")
    handoff = HandoffRecord.model_validate_json(row.payload_json)

    conv = get_conversation_row(conv_id)
    transcript: list[dict[str, str]] = []
    if conv is not None:
        for m in conv.messages:
            transcript.append(
                {
                    "role": m.role,
                    "text": m.text,
                    "created_at": m.created_at.isoformat() if m.created_at else "",
                }
            )

    return LeadDetail(handoff=handoff, transcript=transcript)
