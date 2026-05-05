"""Run a scripted demo conversation against the live agent.

Used to validate Phase 2 quality manually + to capture transcripts for the
demo_transcripts/ directory.

Usage:
    python scripts/demo_chat.py
    python scripts/demo_chat.py --scenario hindi
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.agent.conversation import get_store, stream_user_turn  # noqa: E402


SCENARIOS: dict[str, list[str]] = {
    "english": [
        "Hi, who is this?",
        "I'm an MFD with about 30 active clients. What is this about?",
        "I'm already with Zerodha, why should I switch?",
        "Okay, what does it cost? Is there any joining fee?",
    ],
    "hindi": [
        "Hello, kaun bol raha hai?",
        "Main insurance agent hoon, 15 clients hain. Mere paas itne contacts nahi hain abhi.",
        "Kya yeh program bilkul free hai?",
        "Aap pe trust kaise karein, koi proof hai?",
    ],
    "hinglish": [
        "Haan boliye?",
        "I'm a finance YouTuber, 8k subscribers. Kya hai program?",
        "Main pehle se Angel One ke saath hoon — what's different?",
        "Achha — security deposit kitna hai aur refundable hai?",
    ],
    # Mid-call language switch: lead opens in English, switches to Hindi
    # after rapport is built. Tests Appendix §1 language-matching rule:
    # the agent must follow the lead, not fight it, and never announce
    # the switch.
    "mixed": [
        "Hi, who is this?",
        "I'm a financial advisor in Mumbai with about 25 clients.",
        "Theek hai — ek baat batao, brokerage split kya hai aapka?",
        "Aur cost? Joining fee aur deposit kitna hai?",
    ],
}


async def run(scenario: str) -> None:
    if scenario not in SCENARIOS:
        print(f"Unknown scenario: {scenario}. Available: {list(SCENARIOS)}")
        sys.exit(2)

    store = get_store()
    conv = store.create()
    print(f"=== Scenario: {scenario} ===")
    print(f"Conversation ID: {conv.conv_id}\n")

    # Free-tier limit on gemini-2.5-flash is 5 RPM. Pace conservatively at 18s
    # between turns so we never exceed it across runs.
    delay_between_turns = 18.0
    turns = SCENARIOS[scenario]
    for i, user_text in enumerate(turns):
        print(f"[lead] {user_text}")
        print("[aria] ", end="", flush=True)
        async for chunk in stream_user_turn(conv.conv_id, user_text):
            try:
                print(chunk, end="", flush=True)
            except UnicodeEncodeError:
                print(chunk.encode("ascii", "replace").decode("ascii"), end="", flush=True)
        print("\n")
        if i < len(turns) - 1:
            await asyncio.sleep(delay_between_turns)

    store.end(conv.conv_id, ended_by="lead")
    print(f"=== Ended ===")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", default="english", choices=list(SCENARIOS))
    args = p.parse_args()
    asyncio.run(run(args.scenario))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
