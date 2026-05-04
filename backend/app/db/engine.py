"""DB engine + session lifecycle.

Single shared engine per process. SQLite gets `check_same_thread=False` so
FastAPI's threadpool-executor handlers can share it. Postgres ignores the flag.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _resolve_sqlite_path(url: str) -> str:
    """Convert relative SQLite URL to absolute, anchored at repo root.

    Otherwise the path resolves differently when uvicorn is launched from
    backend/ vs the repo root.
    """
    if not url.startswith("sqlite:///"):
        return url
    # The portion after sqlite:/// is the path. Could be ":memory:" or a file.
    raw = url[len("sqlite:///") :]
    if raw == ":memory:":
        return url
    p = Path(raw)
    if not p.is_absolute():
        # Anchor to the repo root (one level up from backend/).
        repo_root = Path(__file__).resolve().parents[3]
        p = (repo_root / raw).resolve()
        p.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{p.as_posix()}"


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = _resolve_sqlite_path(get_settings().database_url)
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, future=True, connect_args=connect_args)
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
