"""End-to-end retrieval accuracy test.

Runs against a freshly-ingested SQLite store. Skipped if GEMINI_API_KEY is unset.

The test set is deliberately *paraphrased* — the agent at runtime won't see the
exact section headings, so retrieval must work on natural phrasings, English
+ Hindi + Hinglish, and across all 5 objections + fee + eligibility queries.

Acceptance bar: top-1 hits the expected section ≥ 80% of the time.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
APPENDIX = REPO_ROOT / "APPENDIX_A.md"
TEST_DB = REPO_ROOT / "backend" / "data" / "test_rupeezy.db"

requires_gemini = pytest.mark.skipif(
    not os.environ.get("GEMINI_API_KEY"),
    reason="GEMINI_API_KEY not set; skipping live-API retrieval test",
)


# (query, list of acceptable section numbers — top hit must match one of them)
TEST_QUERIES: list[tuple[str, list[str]]] = [
    # 5 core objections, paraphrased
    ("I'm already partnered with Zerodha, why should I switch?", ["4.1"]),
    ("Mere paas itne clients nahi hain abhi", ["4.2"]),
    ("If my client has a problem with the trading app, who fixes it?", ["4.3"]),
    ("How do I know Rupeezy is legit and won't run away with my money?", ["4.4"]),
    ("Mujhe sochne ka time chahiye, baad mein call kijiye", ["4.5"]),
    # Fee / commercial
    ("kya yeh program bilkul free hai", ["3.1", "3"]),
    ("How much do I pay every month?", ["3", "3.1"]),
    ("Is there a security deposit and is it refundable?", ["3", "10.9", "3.1"]),
    # Eligibility
    ("Do I need NISM certification to apply?", ["3", "10.8", "4.6"]),
    ("Can I run Facebook ads to find clients?", ["10.10", "8", "4.6"]),
    # Operational / handoff
    ("How do I send the WhatsApp follow-up to a hot lead?", ["9", "6"]),
    ("What signals make a lead Hot vs Warm?", ["5"]),
]


@requires_gemini
def test_retrieval_top1_accuracy() -> None:
    # Fresh DB so we don't pollute the dev one.
    if TEST_DB.exists():
        TEST_DB.unlink()
    TEST_DB.parent.mkdir(parents=True, exist_ok=True)

    from app.rag.chunker import chunk_markdown
    from app.rag.embeddings import embed_texts
    from app.rag.retriever import Retriever
    from app.rag.store import upsert_chunks

    md = APPENDIX.read_text(encoding="utf-8")
    chunks = chunk_markdown(md)
    embeddings = embed_texts(
        [f"{c.heading}\n\n{c.text}" for c in chunks],
        task_type="RETRIEVAL_DOCUMENT",
    )
    upsert_chunks(TEST_DB, chunks, embeddings)

    r = Retriever(db_path=TEST_DB)
    correct = 0
    failures: list[str] = []

    for query, expected_sections in TEST_QUERIES:
        hits = r.retrieve(query, k=3)
        top_section = hits[0].chunk.section if hits else ""
        if top_section in expected_sections:
            correct += 1
        else:
            top3 = ", ".join(f"§{h.chunk.section}" for h in hits)
            failures.append(
                f'  ✗ "{query}"\n      expected one of {expected_sections}, '
                f"got top-1 §{top_section} (top-3: {top3})"
            )

    accuracy = correct / len(TEST_QUERIES)
    msg = (
        f"\nTop-1 accuracy: {correct}/{len(TEST_QUERIES)} = {accuracy:.0%}\n"
        + "\n".join(failures)
    )
    print(msg)
    assert accuracy >= 0.80, msg


def teardown_module(_):  # noqa: ANN001
    """Clean up test DB."""
    if TEST_DB.exists():
        try:
            TEST_DB.unlink()
        except OSError:
            pass
    cache = TEST_DB.parent / "embeddings_cache"
    if cache.exists() and cache.is_dir():
        # Keep cache — it's a valid speedup for re-runs.
        pass
    # Clean any stray test artifacts (no-op)
    _ = shutil  # silence unused import (kept for future tests)
