"""Ingest APPENDIX_A.md into the chunk store.

Run from repo root:
    python scripts/ingest_appendix.py

Optional flags:
    --appendix PATH   path to a different markdown file
    --db PATH         override the SQLite DB path
    --dry-run         chunk only; do not embed or write
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.rag.chunker import chunk_markdown  # noqa: E402
from app.rag.embeddings import embed_texts  # noqa: E402
from app.rag.store import upsert_chunks  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("ingest")


def main() -> int:
    p = argparse.ArgumentParser(description="Ingest Appendix A into the RAG store")
    p.add_argument(
        "--appendix",
        type=Path,
        default=REPO_ROOT / "APPENDIX_A.md",
        help="Path to the appendix markdown file",
    )
    p.add_argument(
        "--db",
        type=Path,
        default=REPO_ROOT / "backend" / "data" / "rupeezy.db",
        help="Path to the SQLite chunk store",
    )
    p.add_argument("--dry-run", action="store_true", help="Chunk only; do not embed or write")
    args = p.parse_args()

    if not args.appendix.exists():
        log.error("Appendix not found: %s", args.appendix)
        return 1

    md = args.appendix.read_text(encoding="utf-8")
    chunks = chunk_markdown(md)
    log.info("Chunked %s into %d sections", args.appendix.name, len(chunks))
    for ch in chunks:
        snippet = ch.heading[:60] + ("…" if len(ch.heading) > 60 else "")
        log.info("  §%-6s %5d chars  %s", ch.section or "_", ch.char_count, snippet)

    if args.dry_run:
        log.info("Dry run — skipping embedding and write")
        return 0

    log.info("Embedding %d chunks (cached if unchanged)…", len(chunks))
    texts = [f"{ch.heading}\n\n{ch.text}" for ch in chunks]
    embeddings = embed_texts(texts, task_type="RETRIEVAL_DOCUMENT")
    log.info("Embeddings shape: %s", embeddings.shape)

    n = upsert_chunks(args.db, chunks, embeddings)
    log.info("Wrote %d chunks → %s", n, args.db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
