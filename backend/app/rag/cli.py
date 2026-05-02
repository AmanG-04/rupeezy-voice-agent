"""Quick CLI for poking the retriever.

Usage:
    cd backend
    python -m app.rag.cli "I'm already with another broker"
    python -m app.rag.cli --k 6 "kya yeh free hai"
    python -m app.rag.cli --stats
"""

from __future__ import annotations

import argparse
import sys

from app.rag.retriever import Retriever
from app.rag.store import count_chunks


def main() -> int:
    p = argparse.ArgumentParser(description="Probe the Appendix A retriever")
    p.add_argument("query", nargs="*", help="Free-text query")
    p.add_argument("--k", type=int, default=4, help="Top-k chunks to return")
    p.add_argument("--stats", action="store_true", help="Show store stats and exit")
    p.add_argument(
        "--show-text", action="store_true", help="Print the full chunk text, not just heading"
    )
    args = p.parse_args()

    r = Retriever()

    if args.stats:
        n = count_chunks(r.db_path)
        print(f"DB: {r.db_path}")
        print(f"Chunks: {n}")
        return 0

    if not args.query:
        p.print_usage()
        return 2

    query = " ".join(args.query)
    hits = r.retrieve(query, k=args.k)

    if not hits:
        print("No chunks. Run scripts/ingest_appendix.py first.", file=sys.stderr)
        return 1

    print(f'Query: "{query}"')
    print(f"Top {len(hits)} hits:")
    for i, h in enumerate(hits, 1):
        print(f"  {i}. [{h.score:.3f}] §{h.chunk.section or '_'} — {h.chunk.heading}")
        if args.show_text:
            preview = h.chunk.text[:300].replace("\n", " ")
            print(f"     {preview}{'…' if len(h.chunk.text) > 300 else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
