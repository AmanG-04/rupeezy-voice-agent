"""Gemini embeddings client with on-disk cache.

Why a cache: re-running ingestion on an unchanged Appendix A should not re-spend
quota. We hash the input text and persist the embedding next to the SQLite DB.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import google.generativeai as genai
import numpy as np
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings

log = logging.getLogger("rupeezy.rag.embeddings")

_CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "embeddings_cache"
_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# gemini-embedding-001 returns 3072-dim by default. (text-embedding-004 was 768
# but is retired on current API keys.)
_EMBED_DIM = 3072


def _cache_key(model: str, text: str, task_type: str) -> str:
    h = hashlib.sha256()
    h.update(model.encode("utf-8"))
    h.update(b"\x00")
    h.update(task_type.encode("utf-8"))
    h.update(b"\x00")
    h.update(text.encode("utf-8"))
    return h.hexdigest()


def _cache_path(key: str) -> Path:
    return _CACHE_DIR / f"{key}.json"


def _read_cache(key: str) -> list[float] | None:
    p = _cache_path(key)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        log.warning("Corrupt embedding cache file %s — ignoring.", p)
        return None


def _write_cache(key: str, vec: list[float]) -> None:
    _cache_path(key).write_text(json.dumps(vec), encoding="utf-8")


_genai_configured = False


def _ensure_configured() -> None:
    global _genai_configured
    if _genai_configured:
        return
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError(
            "GEMINI_API_KEY not set. Add it to .env (project root or backend/.env)."
        )
    genai.configure(api_key=settings.gemini_api_key)
    _genai_configured = True


@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=1, min=1, max=10))
def _embed_one(text: str, *, task_type: str, model: str) -> list[float]:
    res = genai.embed_content(model=model, content=text, task_type=task_type)
    vec = res["embedding"]
    if len(vec) != _EMBED_DIM:
        raise RuntimeError(
            f"Unexpected embedding dim {len(vec)} (expected {_EMBED_DIM}). "
            f"If the API model changed, update _EMBED_DIM."
        )
    return vec


def embed_texts(
    texts: list[str],
    *,
    task_type: str = "RETRIEVAL_DOCUMENT",
    model: str | None = None,
) -> np.ndarray:
    """Embed a batch. Uses cache where possible; calls API for cache misses.

    Returns a (N, 768) float32 numpy array, L2-normalized rows.
    """
    if not texts:
        return np.zeros((0, _EMBED_DIM), dtype=np.float32)

    _ensure_configured()
    model = model or get_settings().gemini_embedding_model
    if not model.startswith("models/"):
        model_path = f"models/{model}"
    else:
        model_path = model

    out: list[list[float]] = []
    cache_hits = 0
    api_calls = 0
    for text in texts:
        key = _cache_key(model_path, text, task_type)
        cached = _read_cache(key)
        if cached is not None:
            out.append(cached)
            cache_hits += 1
            continue
        vec = _embed_one(text, task_type=task_type, model=model_path)
        _write_cache(key, vec)
        out.append(vec)
        api_calls += 1

    log.info(
        "embed_texts: %d total, %d cache hits, %d API calls",
        len(texts),
        cache_hits,
        api_calls,
    )

    arr = np.asarray(out, dtype=np.float32)
    # L2 normalise so cosine similarity is just a dot product.
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return arr / norms


def embed_query(text: str, *, model: str | None = None) -> np.ndarray:
    """Embed a single query string. Returns shape (768,)."""
    return embed_texts([text], task_type="RETRIEVAL_QUERY", model=model)[0]
