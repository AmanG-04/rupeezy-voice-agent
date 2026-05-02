"""SQLite-backed chunk store.

Schema is intentionally tiny: one table, embeddings serialised as bytes.
Phase 4 swaps this for Supabase pgvector — same Retriever interface stays.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

import numpy as np

from app.rag.chunker import Chunk

_SCHEMA = """
CREATE TABLE IF NOT EXISTS appendix_chunks (
    chunk_id    TEXT PRIMARY KEY,
    section     TEXT NOT NULL,
    heading     TEXT NOT NULL,
    text        TEXT NOT NULL,
    char_count  INTEGER NOT NULL,
    embedding   BLOB NOT NULL,
    embed_dim   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_section ON appendix_chunks(section);
"""


@contextmanager
def _connect(db_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(db_path: Path) -> None:
    with _connect(db_path) as c:
        c.executescript(_SCHEMA)


def upsert_chunks(db_path: Path, chunks: list[Chunk], embeddings: np.ndarray) -> int:
    """Insert or replace chunks + embeddings. Returns row count written."""
    if len(chunks) != len(embeddings):
        raise ValueError(f"chunks/embeddings length mismatch: {len(chunks)} vs {len(embeddings)}")
    init_db(db_path)
    n = 0
    with _connect(db_path) as c:
        for ch, emb in zip(chunks, embeddings, strict=True):
            blob = emb.astype(np.float32).tobytes()
            c.execute(
                """
                INSERT INTO appendix_chunks
                  (chunk_id, section, heading, text, char_count, embedding, embed_dim)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chunk_id) DO UPDATE SET
                  section=excluded.section,
                  heading=excluded.heading,
                  text=excluded.text,
                  char_count=excluded.char_count,
                  embedding=excluded.embedding,
                  embed_dim=excluded.embed_dim
                """,
                (
                    ch.chunk_id,
                    ch.section,
                    ch.heading,
                    ch.text,
                    ch.char_count,
                    blob,
                    int(emb.shape[0]),
                ),
            )
            n += 1
    return n


def load_all(db_path: Path) -> tuple[list[Chunk], np.ndarray]:
    """Return all chunks + their (N, dim) embedding matrix."""
    init_db(db_path)
    with _connect(db_path) as c:
        rows = c.execute(
            "SELECT chunk_id, section, heading, text, char_count, embedding, embed_dim "
            "FROM appendix_chunks ORDER BY section, chunk_id"
        ).fetchall()

    if not rows:
        return [], np.zeros((0, 0), dtype=np.float32)

    chunks: list[Chunk] = []
    vecs: list[np.ndarray] = []
    for chunk_id, section, heading, text, char_count, blob, embed_dim in rows:
        chunks.append(
            Chunk(
                chunk_id=chunk_id,
                section=section,
                heading=heading,
                text=text,
                char_count=char_count,
            )
        )
        vecs.append(np.frombuffer(blob, dtype=np.float32).reshape(embed_dim))

    return chunks, np.vstack(vecs)


def count_chunks(db_path: Path) -> int:
    init_db(db_path)
    with _connect(db_path) as c:
        return c.execute("SELECT COUNT(*) FROM appendix_chunks").fetchone()[0]
