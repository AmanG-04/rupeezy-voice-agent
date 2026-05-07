"""Dashboard API.

Read-only views over the persisted conversations + handoffs. Phase 5 frontend
calls these to render the funnel, leads list, and drilldown.

Phase 8 also adds:
  GET  /api/dashboard/leads/{conv_id}/whatsapp  — log of WhatsApp follow-ups

Phase 9 also adds:
  POST /api/dashboard/leads/batch       — CSV upload, parses + dedupes + queues
  GET  /api/dashboard/leads/queue       — current dialer queue state
  POST /api/dashboard/leads/dial-next   — process one queued lead through the
                                          real conversation engine
"""

from __future__ import annotations

import csv
import io
import logging
import re
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.agent.dialer import SCENARIOS, QueuedLead, dial_next, enqueue, get_queue
from app.db.repo import (
    find_lead_by_phone,
    funnel_counts,
    get_conversation_row,
    get_handoff_row,
    list_handoff_rows,
    list_logs_for_conversation,
    upsert_lead,
)
from app.scoring.schemas import HandoffRecord

log = logging.getLogger("rupeezy.dashboard")

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


# ---------- Phase 9: batch upload + dialer queue ----------
#
# Important: these specific routes ('/leads/batch', '/leads/queue',
# '/leads/dial-next') are registered BEFORE the catch-all '/leads/{conv_id}'
# detail route below. FastAPI walks routes in registration order — without
# this, a request to '/leads/queue' would be swallowed by the path param.


_ALLOWED_LANGS = {"english", "hindi", "hinglish", "other"}


class BatchUploadResponse(BaseModel):
    inserted: int
    skipped_duplicates: int
    errors: list[str]


class QueuedLeadDTO(BaseModel):
    lead_id: str
    name: str
    phone: str
    language_pref: str
    status: str
    conv_id: str | None = None
    bucket: str | None = None


class QueueResponse(BaseModel):
    queued: list[QueuedLeadDTO]


def _normalize_phone(raw: str) -> str:
    """Keep digits + a single optional leading '+'. Empty if nothing usable."""
    s = (raw or "").strip()
    if not s:
        return ""
    plus = s.startswith("+")
    digits = re.sub(r"\D+", "", s)
    if not digits:
        return ""
    return f"+{digits}" if plus else digits


def _normalize_lang(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    return s if s in _ALLOWED_LANGS else "english"


def _normalize_scenario(raw: str | None) -> str:
    s = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    return s if s in SCENARIOS else "hot_advisor"


@router.post("/leads/batch", response_model=BatchUploadResponse)
async def upload_leads_batch(file: UploadFile = File(...)) -> BatchUploadResponse:
    """Parse a CSV upload, dedupe by phone, queue new leads for the dialer.

    CSV format (header row required, case-insensitive column names):
        name,phone,language_pref,source

    `name` and `phone` are required. `language_pref` defaults to 'english'
    when missing or unrecognised. `source` is accepted but currently unused.
    """
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")  # strip a BOM if Excel saved it
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = [(f or "").strip().lower() for f in (reader.fieldnames or [])]

    errors: list[str] = []
    if "name" not in fieldnames:
        errors.append("missing required column: 'name'")
    if "phone" not in fieldnames:
        errors.append("missing required column: 'phone'")
    if errors:
        return BatchUploadResponse(inserted=0, skipped_duplicates=0, errors=errors)

    inserted = 0
    skipped = 0

    def _get(row: dict, key: str) -> str:
        for k, v in row.items():
            if (k or "").strip().lower() == key:
                return (v or "").strip()
        return ""

    for line_no, row in enumerate(reader, start=2):  # header is line 1
        name = _get(row, "name")
        phone = _normalize_phone(_get(row, "phone"))
        language_pref = _normalize_lang(_get(row, "language_pref"))
        scenario = _normalize_scenario(_get(row, "scenario"))

        if not name:
            errors.append(f"line {line_no}: missing name")
            continue
        if not phone:
            errors.append(f"line {line_no}: missing or invalid phone")
            continue

        existing = find_lead_by_phone(phone)
        if existing is not None:
            skipped += 1
            continue

        lead_id = uuid.uuid4().hex[:12]
        try:
            upsert_lead(
                lead_id=lead_id,
                name=name,
                phone=phone,
                language_pref=language_pref,
            )
        except Exception as e:  # noqa: BLE001
            log.exception("upsert_lead failed for line %d", line_no)
            errors.append(f"line {line_no}: db error: {e}")
            continue

        enqueue(
            QueuedLead(
                lead_id=lead_id,
                name=name,
                phone=phone,
                language_pref=language_pref,
                scenario=scenario,
            )
        )
        inserted += 1

    return BatchUploadResponse(
        inserted=inserted,
        skipped_duplicates=skipped,
        errors=errors,
    )


@router.get("/leads/queue", response_model=QueueResponse)
async def leads_queue() -> QueueResponse:
    """Snapshot of the in-process dialer queue."""
    queued = [
        QueuedLeadDTO(
            lead_id=q.lead_id,
            name=q.name,
            phone=q.phone,
            language_pref=q.language_pref,
            status=q.status,
            conv_id=q.conv_id,
            bucket=q.bucket,
        )
        for q in get_queue()
    ]
    return QueueResponse(queued=queued)


@router.post("/leads/dial-next")
async def leads_dial_next() -> dict:
    """Process exactly one queued lead. Returns the resulting handoff summary,
    or `{idle: true}` if the queue has nothing to dial.

    Driven one-step-at-a-time so the demo can show the funnel populating in
    real time without burning Gemini RPM in a tight loop.
    """
    result = await dial_next()
    if result is None:
        return {"idle": True}
    return result


# ---------- demo seed (one-click judge demo) ----------


# Four canned personas — one per scenario — chosen to produce HOT/WARM/COLD/DND
# in a single processing pass so a judge sees every funnel path at once.
_DEMO_PERSONAS: list[dict] = [
    {
        "name": "Aman Sharma",
        "phone": "+919811001001",
        "language_pref": "english",
        "scenario": "hot_advisor",
    },
    {
        "name": "Priya Iyer",
        "phone": "+919811001002",
        "language_pref": "hindi",
        "scenario": "warm_mfd",
    },
    {
        "name": "Rohan Kapoor",
        "phone": "+919811001003",
        "language_pref": "english",
        "scenario": "cold_busy",
    },
    {
        "name": "Vikram Singh",
        "phone": "+919811001004",
        "language_pref": "english",
        "scenario": "dnd_hostile",
    },
]


@router.post("/leads/seed-demo")
async def leads_seed_demo() -> dict:
    """Seed the four canonical demo personas. Idempotent — leads already
    queued (matched by phone) are skipped.

    Returns the count enqueued so the frontend can decide whether to drive
    the dialer loop afterwards.
    """
    enqueued = 0
    for persona in _DEMO_PERSONAS:
        phone = _normalize_phone(persona["phone"])
        if not phone:
            continue
        if find_lead_by_phone(phone) is not None:
            continue
        lead_id = uuid.uuid4().hex[:12]
        try:
            upsert_lead(
                lead_id=lead_id,
                name=persona["name"],
                phone=phone,
                language_pref=persona["language_pref"],
            )
        except Exception:  # noqa: BLE001
            log.exception("seed-demo: upsert_lead failed for %s", persona["name"])
            continue
        enqueue(
            QueuedLead(
                lead_id=lead_id,
                name=persona["name"],
                phone=phone,
                language_pref=persona["language_pref"],
                scenario=persona["scenario"],
            )
        )
        enqueued += 1
    return {"enqueued": enqueued, "personas": len(_DEMO_PERSONAS)}


# ---------- Phase 8: WhatsApp logs ----------


class WhatsappLogDTO(BaseModel):
    """One row from `whatsapp_log` — what the dashboard drawer renders."""

    id: int
    template_id: str
    body: str
    to_phone: str
    sent_at: str
    status: str


@router.get("/leads/{conv_id}/whatsapp", response_model=list[WhatsappLogDTO])
async def lead_whatsapp_logs(conv_id: str) -> list[WhatsappLogDTO]:
    """Phase 8 — every WhatsApp message dispatched for this conversation.

    Empty list (not 404) when none exist, so the frontend can render a
    "no messages" placeholder without dealing with errors.
    """
    rows = list_logs_for_conversation(conv_id)
    return [
        WhatsappLogDTO(
            id=r.id,
            template_id=r.template_id,
            body=r.body,
            to_phone=r.to_phone or "",
            sent_at=r.sent_at.isoformat() if r.sent_at else "",
            status=r.status,
        )
        for r in rows
    ]


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
