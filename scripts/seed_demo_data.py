"""Seed the SQLite DB with realistic demo conversations + handoffs.

Loads the saved JSON artefacts from `demo_transcripts/handoff_*.json` (real
HandoffRecords from Phase 3 live runs) and inserts variations: 4 hot,
6 warm, 5 cold leads spread across English / Hindi / Hinglish so the
dashboard funnel and filters are visually meaningful for the demo video.

Usage:
    python scripts/seed_demo_data.py
    python scripts/seed_demo_data.py --reset   # wipe existing data first
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.agent.conversation import Conversation as InMemConv, Message  # noqa: E402
from app.db.repo import init_db, persist_conversation, persist_handoff  # noqa: E402
from app.scoring.schemas import HandoffRecord  # noqa: E402

# Variations to generate: (template_bucket, language, name, suffix)
# Total: 4 hot + 6 warm + 5 cold = 15 leads.
VARIATIONS: list[tuple[str, str, str]] = [
    # Hot
    ("hot", "english", "Aman Sharma — MFD, 60 clients"),
    ("hot", "hindi", "Priya Iyer — Insurance agent, 35 clients"),
    ("hot", "english", "Karthik Reddy — Influencer, 12k subs"),
    ("hot", "hinglish", "Ravi Mehta — Advisor, 80 clients"),
    # Warm
    ("warm", "english", "Sanjay Patel — Advisor, 12 clients"),
    ("warm", "hindi", "Neha Verma — MFD, 18 clients"),
    ("warm", "hinglish", "Vikram Singh — Agent, 22 clients"),
    ("warm", "english", "Anjali Desai — Influencer, 5k subs"),
    ("warm", "hindi", "Rajesh Khanna — Advisor, 9 clients"),
    ("warm", "english", "Pooja Rao — MFD, 14 clients"),
    # Cold
    ("cold", "english", "Mr. Bhat — wrong number"),
    ("cold", "hindi", "Anonymous — DND request"),
    ("cold", "english", "Mehul Shah — hard reject"),
    ("cold", "hinglish", "Unnamed — hung up"),
    ("cold", "english", "Sunil Kumar — not interested"),
]


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _shift_iso(iso: str, hours_back: float) -> str:
    dt = datetime.fromisoformat(iso)
    return (dt - timedelta(hours=hours_back)).isoformat()


def _load_template(bucket: str) -> dict:
    p = REPO_ROOT / "demo_transcripts" / f"handoff_{bucket}.json"
    if not p.exists():
        raise FileNotFoundError(
            f"Template handoff JSON not found: {p}\n"
            f"Run scripts/demo_handoff.py --bucket {bucket} first to generate it."
        )
    return json.loads(p.read_text(encoding="utf-8"))


def _make_lead(template: dict, *, bucket: str, language: str, name: str, hours_ago: float) -> tuple[InMemConv, HandoffRecord]:
    """Clone a template handoff with new lead_id, contact name, language,
    and shifted timestamps."""
    conv_id = _new_id()
    started_at = _shift_iso(template["call"]["started_at"], hours_ago)
    ended_at = _shift_iso(template["call"]["ended_at"], hours_ago)

    # Build a Conversation with placeholder transcript referencing the template.
    conv = InMemConv(
        conv_id=conv_id,
        started_at=started_at,
    )
    conv.ended_at = ended_at
    conv.ended_by = template["call"]["ended_by"]
    conv.language = language

    # Pull the realistic transcript out of the template (we used live runs).
    # The template doesn't store the transcript itself (it was in the
    # conversation, not the handoff), so synthesise a short stub keyed on bucket.
    stub_turns = _stub_transcript_for(bucket, language, name)
    for role, text in stub_turns:
        conv.messages.append(Message(role=role, text=text))  # type: ignore[arg-type]

    # Clone the handoff with new IDs / contact / timestamps.
    handoff_dict = json.loads(json.dumps(template))  # deep copy
    handoff_dict["lead_id"] = conv_id
    handoff_dict["contact"]["name"] = name
    handoff_dict["contact"]["language_used"] = language
    handoff_dict["call"]["started_at"] = started_at
    handoff_dict["call"]["ended_at"] = ended_at
    handoff_dict["call"]["turn_count"] = len(stub_turns)
    handoff = HandoffRecord.model_validate(handoff_dict)
    return conv, handoff


def _stub_transcript_for(bucket: str, language: str, name: str) -> list[tuple[str, str]]:
    """Short scripted transcript for seed data. Real demo transcripts come
    from live runs (Phase 3 demos in demo_transcripts/phase3.md)."""
    role_label = name.split("—")[1].strip() if "—" in name else "professional"
    if bucket == "hot":
        return [
            ("user", "Hi, who is this?"),
            ("assistant", f"Hi, this is Aria from Rupeezy — calling about our Authorized Person partner program."),
            ("user", f"I'm a {role_label}. Tell me about your brokerage split."),
            ("assistant", "100% lifetime, paid daily via the RISE Portal — vs Zerodha's typical 60–70% paid monthly."),
            ("user", "Send me the signup link, I want to start this week."),
            ("assistant", "Done — signup link is on its way to your WhatsApp. A senior partner manager will call you back within the hour."),
        ]
    if bucket == "warm":
        return [
            ("user", "Hello, who's calling?"),
            ("assistant", "Hi, this is Aria from Rupeezy. Calling about our partner program — got two minutes?"),
            ("user", f"I'm a {role_label}. What's the cost?"),
            ("assistant", "No joining fee. There's a one-time refundable security deposit of one lakh and a monthly subscription deducted from earnings — starts at ₹2,499."),
            ("user", "Hmm. Send me a comparison sheet, I'll think about it."),
            ("assistant", "Of course. I'll send it on WhatsApp. We can follow up Thursday — does that work?"),
        ]
    return [
        ("user", "Who is this?"),
        ("assistant", "Hi, this is Aria from Rupeezy — calling about our partner program. Is now a good time?"),
        ("user", "Not interested, please remove my number."),
        ("assistant", "Understood. I'll remove your number from our list immediately. Have a good day."),
    ]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true", help="Wipe existing leads/conversations first")
    args = p.parse_args()

    init_db()

    if args.reset:
        from app.db.engine import session_scope
        from app.db.models import Conversation as ConversationRow, HandoffRow, Lead, Message as MessageRow

        with session_scope() as s:
            s.query(MessageRow).delete()
            s.query(HandoffRow).delete()
            s.query(ConversationRow).delete()
            s.query(Lead).delete()
        print("[ok] Wiped existing data")

    # Pre-load templates once.
    templates = {b: _load_template(b) for b in ("hot", "warm", "cold")}

    inserted = 0
    for i, (bucket, language, name) in enumerate(VARIATIONS):
        # Stagger: hot=most recent, cold=oldest. Spread over ~6 hours.
        hours_ago = i * 0.4
        try:
            conv, handoff = _make_lead(
                templates[bucket],
                bucket=bucket,
                language=language,
                name=name,
                hours_ago=hours_ago,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[err] {name}: {e}")
            continue
        persist_conversation(conv, channel="text")
        persist_handoff(handoff)
        inserted += 1
        print(f"  + {bucket.upper():4} {language:8} {name}  -> {conv.conv_id}")

    print(f"\n[ok] Seeded {inserted}/{len(VARIATIONS)} leads")
    print(f"  Now run: cd backend && uvicorn app.main:app --reload")
    print(f"  Then visit: http://localhost:5173/dashboard")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
