"""Phase 9 batch-upload + dialer-queue tests.

No live-Gemini calls — we exercise CSV parsing, dedupe, and the in-memory
queue mechanics. The full /dial-next path requires the real LLM and is
covered manually during the demo.
"""

from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# Reuse the isolated-DB fixture pattern from test_persistence.py so each test
# starts with a clean SQLite file and the dialer queue is wiped.
@pytest.fixture()
def isolated_db(monkeypatch: pytest.MonkeyPatch) -> Path:
    fd, raw = tempfile.mkstemp(suffix=".db", prefix="rupeezy_batch_test_")
    os.close(fd)
    p = Path(raw)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{p.as_posix()}")

    from app import config as cfg_mod
    from app.db import engine as engine_mod

    cfg_mod.get_settings.cache_clear()
    engine_mod._engine = None
    engine_mod._SessionLocal = None

    # Import here so the fixture can wipe the module-level queue cleanly.
    from app.agent import dialer

    dialer.reset_queue()

    try:
        yield p
    finally:
        dialer.reset_queue()
        if engine_mod._engine is not None:
            engine_mod._engine.dispose()
        engine_mod._engine = None
        engine_mod._SessionLocal = None
        cfg_mod.get_settings.cache_clear()
        p.unlink(missing_ok=True)


@pytest.fixture()
def client(isolated_db: Path) -> TestClient:
    from app.db.repo import init_db
    from app.main import app

    init_db()
    return TestClient(app)


_GOOD_CSV = (
    "name,phone,language_pref,source\n"
    "Aman Sharma,+919876543210,english,referral\n"
    "Priya Iyer,+919812345678,hindi,website\n"
    "Rahul Khanna,9811112222,hinglish,event\n"
)

_NO_PHONE_CSV = "name,language_pref,source\nAman,english,referral\n"


def _post_csv(client: TestClient, body: str) -> dict:
    files = {"file": ("leads.csv", io.BytesIO(body.encode("utf-8")), "text/csv")}
    r = client.post("/api/dashboard/leads/batch", files=files)
    assert r.status_code == 200, r.text
    return r.json()


def test_csv_upload_inserts_new_leads(client: TestClient) -> None:
    body = _post_csv(client, _GOOD_CSV)
    assert body["inserted"] == 3
    assert body["skipped_duplicates"] == 0
    assert body["errors"] == []

    # Queue should now contain those 3 leads, all 'queued'.
    q = client.get("/api/dashboard/leads/queue").json()
    assert len(q["queued"]) == 3
    assert {q_["status"] for q_ in q["queued"]} == {"queued"}
    names = sorted(q_["name"] for q_ in q["queued"])
    assert names == ["Aman Sharma", "Priya Iyer", "Rahul Khanna"]


def test_csv_upload_skips_duplicates(client: TestClient) -> None:
    first = _post_csv(client, _GOOD_CSV)
    assert first["inserted"] == 3

    second = _post_csv(client, _GOOD_CSV)
    assert second["inserted"] == 0
    assert second["skipped_duplicates"] == 3
    assert second["errors"] == []


def test_csv_upload_handles_missing_columns(client: TestClient) -> None:
    body = _post_csv(client, _NO_PHONE_CSV)
    assert body["inserted"] == 0
    assert body["skipped_duplicates"] == 0
    assert any("phone" in e.lower() for e in body["errors"])

    # Nothing should have hit the queue.
    q = client.get("/api/dashboard/leads/queue").json()
    assert q["queued"] == []


def test_csv_upload_handles_per_row_errors(client: TestClient) -> None:
    """Header is fine but individual rows have bad data — partial success."""
    csv_body = (
        "name,phone,language_pref,source\n"
        "Aman,+919876543210,english,ref\n"
        ",+919812345678,hindi,site\n"        # missing name
        "Rahul,,hinglish,event\n"             # missing phone
        "Sara,+919811112222,banglish,ref\n"   # invalid lang -> defaults to english
    )
    body = _post_csv(client, csv_body)
    assert body["inserted"] == 2
    assert body["skipped_duplicates"] == 0
    assert len(body["errors"]) == 2
    assert any("name" in e.lower() for e in body["errors"])
    assert any("phone" in e.lower() for e in body["errors"])

    q = client.get("/api/dashboard/leads/queue").json()
    langs = sorted(q_["language_pref"] for q_ in q["queued"])
    assert langs == ["english", "english"]  # invalid lang fell back


def test_dialer_queue_lifecycle(isolated_db: Path) -> None:
    """Plain enqueue -> get_queue, no HTTP layer."""
    from app.agent.dialer import QueuedLead, enqueue, get_queue, reset_queue

    reset_queue()
    enqueue(QueuedLead(lead_id="aaa111", name="Aman", phone="+91987"))
    enqueue(QueuedLead(lead_id="bbb222", name="Priya", phone="+91812"))

    q = get_queue()
    assert len(q) == 2
    assert all(item.status == "queued" for item in q)
    assert q[0].lead_id == "aaa111"
    assert q[1].lead_id == "bbb222"


def test_dial_next_idle_when_empty(client: TestClient) -> None:
    r = client.post("/api/dashboard/leads/dial-next")
    assert r.status_code == 200
    assert r.json() == {"idle": True}


def test_phone_normalization_dedupes(client: TestClient) -> None:
    """Same number written two ways should still dedupe on the second pass."""
    csv_a = "name,phone,language_pref,source\nAman,+91 98765-43210,english,ref\n"
    csv_b = "name,phone,language_pref,source\nAman2,+919876543210,english,ref\n"
    a = _post_csv(client, csv_a)
    assert a["inserted"] == 1
    b = _post_csv(client, csv_b)
    assert b["inserted"] == 0
    assert b["skipped_duplicates"] == 1


def test_find_lead_by_phone_helper(isolated_db: Path) -> None:
    from app.db.repo import find_lead_by_phone, init_db, upsert_lead

    init_db()
    assert find_lead_by_phone("+919999999999") is None
    upsert_lead(lead_id="lead_1", name="Test", phone="+919999999999", language_pref="english")
    found = find_lead_by_phone("+919999999999")
    assert found is not None
    assert found.id == "lead_1"
    assert found.name == "Test"
