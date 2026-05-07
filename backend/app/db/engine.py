"""DB engine + session lifecycle.

Single shared engine per process. Supports two URL families:

  sqlite:///path/to/file.db  — local-dev default. Resolved relative to the
                               repo root (so `uvicorn backend/...` and
                               `cd backend && uvicorn ...` both work).

  postgresql://...           — Supabase, Neon, any vanilla Postgres. Gets
                               URL-rewritten to use the psycopg3 driver,
                               `pool_pre_ping` to survive Render free-tier
                               idle drops, and SSL is required (Supabase
                               enforces it).

The legacy `postgres://` prefix Supabase shows in its UI is normalised to
`postgresql+psycopg://` so SQLAlchemy doesn't reject it.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

log = logging.getLogger("rupeezy.db.engine")

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _resolve_sqlite_path(url: str) -> str:
    """Convert relative SQLite URL to absolute, anchored at repo root."""
    if not url.startswith("sqlite:///"):
        return url
    raw = url[len("sqlite:///") :]
    if raw == ":memory:":
        return url
    p = Path(raw)
    if not p.is_absolute():
        repo_root = Path(__file__).resolve().parents[3]
        p = (repo_root / raw).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{p.as_posix()}"


def _normalise_postgres_url(url: str) -> str:
    """Rewrite Supabase-style `postgres://` to SQLAlchemy + psycopg3 form.

    Examples:
      postgres://u:p@host/db          -> postgresql+psycopg://u:p@host/db
      postgresql://u:p@host/db        -> postgresql+psycopg://u:p@host/db
      postgresql+psycopg://u:p@h/db   -> unchanged
    """
    if url.startswith("postgresql+"):
        return url
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    return url


def _build_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        return create_engine(
            url,
            future=True,
            connect_args={"check_same_thread": False},
        )
    # Postgres path. pool_pre_ping catches stale connections that Supabase's
    # connection pooler may have closed during a Render idle window.
    # pool_size + max_overflow tuned so dashboard burst polls (3 concurrent
    # requests every 4-5s) don't drain the pool while one slow query is
    # still holding a connection. Default (5+10) was hitting the limit
    # under realistic load and producing intermittent 500s.
    return create_engine(
        url,
        future=True,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=10,
        max_overflow=20,
        pool_timeout=10,  # fail fast if pool truly exhausted
    )


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        raw = get_settings().database_url
        url = _normalise_postgres_url(_resolve_sqlite_path(raw))
        # Don't log credentials. Just the dialect + host.
        safe = url.split("@")[-1] if "@" in url else url
        log.info("db engine init: dialect=%s host=%s", url.split("://")[0], safe)
        _engine = _build_engine(url)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _SessionLocal


@contextmanager
def session_scope() -> Iterator[Session]:
    """Context-managed session: commits on success, rolls back on exception."""
    factory = get_session_factory()
    s = factory()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()
