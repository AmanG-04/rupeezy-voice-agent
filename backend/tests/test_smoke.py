"""Phase 0 smoke tests — backend boots and exposes meta endpoints."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_ok() -> None:
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["service"] == "rupeezy-voice-agent"


def test_health_ok() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_version_shape() -> None:
    r = client.get("/api/version")
    assert r.status_code == 200
    body = r.json()
    assert "version" in body
    assert "chat_model" in body
