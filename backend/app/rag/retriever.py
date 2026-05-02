"""Top-k cosine retrieval over the chunk store.

Stateless. Loads chunks + embedding matrix into memory once per Retriever
instance (fine for ~30 chunks). Phase 4 swaps the store for pgvector but the
Retriever's public surface stays the same.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.rag.chunker import Chunk
from app.rag.embeddings import embed_query
from app.rag.store import load_all

_DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "rupeezy.db"


@dataclass(slots=True)
class Hit:
    chunk: Chunk
    score: float        # cosine similarity, [-1, 1] (normalised vectors → [0, 1])

    def __repr__(self) -> str:
        head = self.chunk.heading[:50] + ("…" if len(self.chunk.heading) > 50 else "")
        return f"Hit(score={self.score:.3f}, §{self.chunk.section or '_'}, '{head}')"


class Retriever:
    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or _DEFAULT_DB
        self._chunks: list[Chunk] = []
        self._matrix: np.ndarray = np.zeros((0, 0), dtype=np.float32)
        self._loaded = False

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        self._chunks, self._matrix = load_all(self.db_path)
        self._loaded = True

    def reload(self) -> None:
        """Force re-read from store. Call after re-ingestion."""
        self._loaded = False
        self._ensure_loaded()

    def __len__(self) -> int:
        self._ensure_loaded()
        return len(self._chunks)

    def retrieve(self, query: str, k: int = 4) -> list[Hit]:
        self._ensure_loaded()
        if not self._chunks:
            return []

        q = embed_query(query)
        # Embeddings are already L2-normalised in embed_texts, so cosine = dot.
        scores = self._matrix @ q
        top = np.argsort(-scores)[:k]
        return [Hit(chunk=self._chunks[i], score=float(scores[i])) for i in top]
