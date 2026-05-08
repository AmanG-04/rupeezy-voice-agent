"""Measure direct Gemini chat latency for a minimal prompt.

Usage examples:

    python scripts/measure_gemini_latency.py
    python scripts/measure_gemini_latency.py --prompt "Hello."
    python scripts/measure_gemini_latency.py --model gemini-2.5-flash-lite --runs 3

This bypasses the app's conversation, RAG, and TTS layers so you can see
whether the configured Gemini model itself is slow.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

import google.generativeai as genai

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Measure direct Gemini response latency for a simple prompt."
    )
    parser.add_argument(
        "--prompt",
        default="Hello.",
        help="Prompt to send to Gemini. Default: %(default)r",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Override model name. Defaults to GEMINI_CHAT_MODEL from backend settings.",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=1,
        help="How many times to run the measurement. Default: %(default)s",
    )
    parser.add_argument(
        "--max-output-tokens",
        type=int,
        default=220,
        help="Generation cap used for the test. Default: %(default)s",
    )
    return parser


def measure_once(model_name: str, prompt: str, max_output_tokens: int) -> dict[str, object]:
    model = genai.GenerativeModel(
        model_name,
        generation_config={
            "temperature": 0.7,
            "top_p": 0.9,
            "top_k": 20,
            "max_output_tokens": max_output_tokens,
        },
    )

    started = time.perf_counter()
    first_token_ms: float | None = None
    chunks = 0
    parts: list[str] = []

    stream = model.generate_content(prompt, stream=True)
    for chunk in stream:
        text = getattr(chunk, "text", "") or ""
        if not text:
            continue
        chunks += 1
        if first_token_ms is None:
            first_token_ms = (time.perf_counter() - started) * 1000
        parts.append(text)

    total_ms = (time.perf_counter() - started) * 1000
    reply = "".join(parts).strip()
    return {
        "first_token_ms": first_token_ms,
        "total_ms": total_ms,
        "chunks": chunks,
        "reply_chars": len(reply),
        "reply_preview": reply[:200].replace("\n", " "),
    }


def main() -> int:
    args = build_parser().parse_args()
    settings = get_settings()
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY missing in backend settings.", file=sys.stderr)
        return 1

    model_name = args.model or settings.gemini_chat_model
    genai.configure(api_key=settings.gemini_api_key)

    print(f"model={model_name}")
    print(f"prompt={args.prompt!r}")
    print(f"runs={args.runs}")
    print()

    totals: list[float] = []
    firsts: list[float] = []

    for run_idx in range(1, args.runs + 1):
        print(f"[run {run_idx}] starting...")
        result = measure_once(model_name, args.prompt, args.max_output_tokens)
        first = result["first_token_ms"]
        total = float(result["total_ms"])
        totals.append(total)
        if isinstance(first, float):
            firsts.append(first)

        print(
            f"[run {run_idx}] first_token_ms="
            f"{first:.1f}" if isinstance(first, float) else f"[run {run_idx}] first_token_ms=none"
        )
        print(f"[run {run_idx}] total_ms={total:.1f}")
        print(f"[run {run_idx}] chunks={result['chunks']}")
        print(f"[run {run_idx}] reply_chars={result['reply_chars']}")
        print(f"[run {run_idx}] reply_preview={result['reply_preview']}")
        print()

    if len(totals) > 1:
        print("summary:")
        if firsts:
            print(
                f"first_token_ms avg={statistics.mean(firsts):.1f} "
                f"min={min(firsts):.1f} max={max(firsts):.1f}"
            )
        print(
            f"total_ms avg={statistics.mean(totals):.1f} "
            f"min={min(totals):.1f} max={max(totals):.1f}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
