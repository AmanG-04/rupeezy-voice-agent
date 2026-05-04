"""End-to-end Phase 3 demo: run a scripted conversation against the live
backend, end it, and pretty-print the handoff record.

Usage:
    python scripts/demo_handoff.py
    python scripts/demo_handoff.py --bucket hot     # picks a Hot scenario
    python scripts/demo_handoff.py --bucket warm
    python scripts/demo_handoff.py --bucket cold
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent

BASE = "http://127.0.0.1:8000"

# Scripted scenarios designed to land in each bucket.
SCENARIOS: dict[str, list[str]] = {
    "hot": [
        "Hi, who is this?",
        "I'm an MFD with about 60 active clients. Tell me more.",
        "I'm currently with Zerodha — what's the brokerage split with you?",
        "Okay, that's interesting. What's the onboarding TAT once I apply?",
        "Send me the signup link. I want to start onboarding clients this week.",
    ],
    "warm": [
        "Hello, who are you?",
        "I'm a financial advisor, ~12 clients.",
        "What is the cost? Is there a security deposit?",
        "Hmm, let me think about it. Can you send me a comparison sheet?",
    ],
    "cold": [
        "Who is this?",
        "Not interested, please remove my number.",
    ],
}


def stream_turn(client: httpx.Client, conv_id: str, text: str) -> str:
    """POST a turn, accumulate streamed tokens, return the full reply."""
    parts: list[str] = []
    with client.stream(
        "POST",
        f"{BASE}/api/conversations/{conv_id}/turn",
        json={"text": text},
        headers={"Accept": "text/event-stream"},
        timeout=60.0,
    ) as r:
        r.raise_for_status()
        event_name = "message"
        data_lines: list[str] = []
        for line in r.iter_lines():
            if line == "":
                # End of one SSE message.
                if data_lines:
                    raw = "\n".join(data_lines)
                    if event_name == "token":
                        try:
                            parts.append(json.loads(raw)["text"])
                        except (KeyError, json.JSONDecodeError):
                            parts.append(raw)
                event_name = "message"
                data_lines = []
                continue
            if line.startswith("event:"):
                event_name = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
    return "".join(parts).strip()


def safe_print(s: str) -> None:
    """Print a string without dying on Windows cp1252 unicode encode errors."""
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode("ascii"))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--bucket", default="hot", choices=list(SCENARIOS))
    p.add_argument("--save", type=Path, help="Write handoff JSON to this path")
    p.add_argument(
        "--turn-delay",
        type=float,
        default=14.0,
        help="Seconds to wait between user turns (free-tier RPM pacing)",
    )
    args = p.parse_args()

    scenario = SCENARIOS[args.bucket]
    print(f"=== Demo handoff: scenario '{args.bucket}' ({len(scenario)} turns) ===\n")

    with httpx.Client() as client:
        # 1. Create conversation
        r = client.post(f"{BASE}/api/conversations", timeout=10.0)
        r.raise_for_status()
        conv_id = r.json()["conv_id"]
        print(f"conv_id={conv_id}\n")

        # 2. Run turns
        for i, user_text in enumerate(scenario):
            safe_print(f"[lead] {user_text}")
            try:
                reply = stream_turn(client, conv_id, user_text)
            except httpx.HTTPError as e:
                print(f"[error] turn failed: {e}")
                break
            safe_print(f"[aria] {reply}\n")
            if i < len(scenario) - 1:
                time.sleep(args.turn_delay)

        # 3. End conversation -> triggers pipeline
        print("\n--- Ending call & running post-call pipeline... ---\n")
        r = client.post(
            f"{BASE}/api/conversations/{conv_id}/end",
            json={"ended_by": "lead"},
            timeout=120.0,
        )
        r.raise_for_status()
        body = r.json()

        if body.get("handoff_error"):
            print(f"[handoff error] {body['handoff_error']}")
            return 1

        handoff = body["handoff"]
        if args.save:
            args.save.write_text(json.dumps(handoff, indent=2), encoding="utf-8")
            print(f"saved: {args.save}\n")

        c = handoff["classification"]
        bs = handoff["call"]
        d = handoff["discovery"]
        n = handoff["next_action"]
        objs = handoff["objections_raised"]
        unres = handoff["unresolved_questions"]

        safe_print(f"=== HANDOFF RECORD ===")
        safe_print(f"BUCKET:           {c['bucket'].upper()}  ({c['confidence']*100:.0f}% confidence)")
        safe_print(f"RATIONALE:        {c['rationale']}")
        safe_print(f"")
        safe_print(f"SUMMARY:          {handoff['summary_short']}")
        safe_print(f"")
        safe_print(f"DISCOVERY:        role={d['current_role']}  broker={d.get('current_broker') or '-'}  "
                   f"clients={d.get('estimated_clients') or '-'}  nism={d.get('has_nism_series_vii')}")
        safe_print(f"LANGUAGE:         {handoff['contact']['language_used']}")
        safe_print(f"")
        safe_print(f"SIGNALS (0-100):")
        for k, v in c["signal_breakdown"].items():
            safe_print(f"  {k:20} {int(v*100):3d}")
        safe_print(f"")
        safe_print(f"OBJECTIONS RAISED ({len(objs)}):")
        for o in objs:
            safe_print(f"  - {o['id']:25} resolved={o['resolved']:8}  turn {o['raised_at_turn']}")
            if o.get("notes"):
                safe_print(f"      notes: {o['notes']}")
        safe_print(f"")
        safe_print(f"UNRESOLVED QUESTIONS ({len(unres)}):")
        for q in unres:
            safe_print(f"  - {q}")
        safe_print(f"")
        safe_print(f"NEXT ACTION:      {n['type']}")
        safe_print(f"CALL:             duration={bs['duration_sec']}s  turns={bs['turn_count']}  ended_by={bs['ended_by']}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
