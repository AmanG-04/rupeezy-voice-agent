"""Cross-call memory (Phase 10).

When a lead has talked to the agent before, we want the next call to acknowledge
that — per Appendix A §5.3:

    1. Open with acknowledgement of the prior call.
    2. Skip benefits already covered unless the lead asks.
    3. Resume from the unresolved objection.
    4. Re-score, don't re-classify from scratch.

This module exposes a single read helper that the system-prompt builder calls
once per turn. The lookup is one indexed SQL query — no caching needed for the
hackathon.

Cold path: lead has no completed prior conversation → returns None and the
prompt builder skips the "PRIOR CALL CONTEXT" section entirely.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.db.repo import get_latest_completed_conversation_for_lead

log = logging.getLogger("rupeezy.lead_memory")


@dataclass(slots=True)
class LeadContext:
    """A compact snapshot of what we know from the lead's most recent call."""

    lead_id: str
    prior_call_count: int  # >=1 means this is a follow-up
    last_call_summary: str | None
    last_bucket: str | None  # 'hot' | 'warm' | 'cold'
    last_call_ended_at: str | None  # ISO 8601
    unresolved_questions: list[str] = field(default_factory=list)
    unresolved_objections: list[str] = field(default_factory=list)
    discovery: dict = field(default_factory=dict)
    time_since_last_call_human: str = ""


def _humanize_delta(ended_at: datetime | None) -> str:
    """Render the gap as 'Xh ago' / 'X days ago' / 'X weeks ago'.

    We deliberately do NOT emit 'X seconds ago' or 'X minutes ago' — a 5-second-old
    "prior call" is almost always a test artefact, and the agent shouldn't open
    a call with "we spoke 12 seconds ago". Floor to "1h ago" in that range.
    """
    if ended_at is None:
        return "recently"
    now = datetime.now(timezone.utc)
    if ended_at.tzinfo is None:
        ended_at = ended_at.replace(tzinfo=timezone.utc)
    delta = now - ended_at
    seconds = max(0, int(delta.total_seconds()))
    hours = seconds // 3600
    days = seconds // 86400
    weeks = days // 7

    if weeks >= 1:
        return f"{weeks} week{'s' if weeks != 1 else ''} ago"
    if days >= 1:
        return f"{days} day{'s' if days != 1 else ''} ago"
    if hours >= 1:
        return f"{hours}h ago"
    # Sub-hour: floor to 1h to avoid 'seconds ago' demo artefacts.
    return "1h ago"


def _safe_load_payload(payload_json: str | None) -> dict:
    if not payload_json:
        return {}
    try:
        data = json.loads(payload_json)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, TypeError) as e:
        log.warning("payload_json failed to parse: %s", e)
    return {}


def _extract_unresolved_objections(payload: dict) -> list[str]:
    """Return objection IDs whose resolved status is NOT 'true'."""
    raw = payload.get("objections_raised") or []
    out: list[str] = []
    for o in raw:
        if not isinstance(o, dict):
            continue
        if o.get("resolved") == "true":
            continue
        oid = o.get("id")
        if isinstance(oid, str):
            out.append(oid)
    return out


def _extract_unresolved_questions(payload: dict) -> list[str]:
    raw = payload.get("unresolved_questions") or []
    return [q for q in raw if isinstance(q, str)]


def _extract_discovery(payload: dict) -> dict:
    """Cherry-pick the discovery fields useful to the next-call prompt."""
    d = payload.get("discovery") or {}
    if not isinstance(d, dict):
        return {}
    keys = (
        "current_role",
        "current_broker",
        "estimated_clients",
        "estimated_aum_inr",
        "has_nism_series_vii",
    )
    return {k: d[k] for k in keys if k in d and d[k] is not None}


def get_lead_context(lead_id: str) -> LeadContext | None:
    """Return the lead's latest-call context, or None if no prior calls.

    "Prior call" = a Conversation with `lead_id == :id` AND `ended_at IS NOT NULL`.
    Take the most recent one (ORDER BY ended_at DESC). Join its HandoffRow,
    parse the payload for unresolved questions + objections + discovery.

    On any malformed payload we still return a partial LeadContext with whatever
    we could read; we never raise from this function.
    """
    if not lead_id:
        return None

    row = get_latest_completed_conversation_for_lead(lead_id)
    if row is None:
        return None

    handoff = row.handoff
    bucket: str | None = None
    summary: str | None = None
    payload: dict = {}
    if handoff is not None:
        bucket = handoff.bucket
        summary = handoff.summary_short
        payload = _safe_load_payload(handoff.payload_json)

    ended_at = row.ended_at
    ended_at_iso = ended_at.isoformat() if ended_at else None

    return LeadContext(
        lead_id=lead_id,
        prior_call_count=1,  # We only need >=1 to trigger follow-up mode.
        last_call_summary=summary,
        last_bucket=bucket,
        last_call_ended_at=ended_at_iso,
        unresolved_questions=_extract_unresolved_questions(payload),
        unresolved_objections=_extract_unresolved_objections(payload),
        discovery=_extract_discovery(payload),
        time_since_last_call_human=_humanize_delta(ended_at),
    )
