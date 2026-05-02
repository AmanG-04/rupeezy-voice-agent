# Backend — Rupeezy Voice Agent

FastAPI service hosting the conversation engine, RAG over Appendix A, post-call scoring, and the dashboard API.

## Quick start

```powershell
# from repo root
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy ..\.env.example .env       # then edit with your real keys
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Verify:

```powershell
curl http://localhost:8000/health
# → {"status":"ok"}
```

## Layout

```
backend/
  pyproject.toml
  app/
    main.py           FastAPI app + meta endpoints
    config.py         pydantic-settings, env loader
    agent/            conversation loop (Phase 2)
    rag/              Appendix A retrieval (Phase 1)
    scoring/          H/W/C classifier (Phase 3)
    livekit/          voice room bridge (Phase 6)
    whatsapp/         follow-up sender (Phase 8)
  tests/
    test_smoke.py
  data/               local SQLite (git-ignored)
```

## Tests

```powershell
pytest
```
