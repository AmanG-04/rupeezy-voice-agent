# Rupeezy AI Voice Agent

> AI voice agent that pitches Rupeezy's Authorized Person (AP) partner program to incoming leads in their language, handles the 5 core objections, qualifies them as Hot / Warm / Cold, and hands qualified leads to a human RM with full conversation context.
>
> Built for **PanIIT AI for Bharat — Theme 7** (PAN IIT Bangalore × Government of Karnataka, Apr–May 2026).

## The problem in one breath

Rupeezy's AP partner program converts only 18% of leads. The product is competitive (zero joining fee, 100% lifetime brokerage share, daily payouts via RISE Portal) — the failure is structural: leads arrive after-hours, RMs speak 1–2 languages while the addressable market spans 20+, and one RM = one call at a time. This agent removes those bottlenecks.

## What's in the repo

| File / dir | Purpose |
|---|---|
| `APPENDIX_A.md` | The agent's source of truth — script, FAQ, hard facts, objection rebuttals (verified against rupeezy.in) |
| `PROJECT_CONTEXT.md` | Hackathon brief + tech-stack rationale |
| `PLAN.md` | 13-phase build plan with time caps and acceptance criteria |
| `ARCHITECTURE.md` | **Diagrams** — system overview, request flows per phase, DB schema, file map |
| `backend/` | FastAPI + Gemini + RAG + scoring |
| `frontend/` | Vite + React + Tailwind. Three demo surfaces: text chat, voice, RM dashboard |
| `scripts/` | Appendix ingestion, demo seed data |
| `demo_transcripts/` | Captured live runs from each phase (English / Hindi / Hinglish / mid-call switch) |

## Quick start

You'll need: Python 3.11+, Node 20+, a free Gemini API key from https://aistudio.google.com/app/apikey.

### 1. Configure environment

```powershell
copy .env.example .env
# edit .env and set GEMINI_API_KEY (everything else can wait)
```

### 2. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload
# → http://localhost:8000/health
```

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

The frontend proxies `/api/*` and `/health` to the backend automatically (see `vite.config.ts`).

## Architecture (high level)

```
Browser ── voice (LiveKit WebRTC) / text (SSE) ──→ FastAPI
                                                     │
                                       ┌─────────────┼─────────────┐
                                       ↓             ↓             ↓
                                  Gemini Live   RAG (pgvector)  Gemini Pro
                                  (audio loop)  Appendix A      (post-call
                                                                 H/W/C + summary)
                                                     │
                                                     ↓
                                                 Supabase
                                                     │
                                       ┌─────────────┼─────────────┐
                                       ↓             ↓             ↓
                                   Dashboard    Transcripts    WhatsApp
                                   (funnel,    (per-call)     (Hot/Warm
                                   leads,                      handoff)
                                   handoff)
```

See `PLAN.md` for phase-by-phase build order and `PROJECT_CONTEXT.md §6` for the layered architecture in detail.

## Tech stack & why (free-tier first)

| Layer | Choice | Reason |
|---|---|---|
| Voice transport | LiveKit Cloud (free) | WebRTC rooms, telephony-ready via SIP |
| Voice loop | Gemini Live (native audio) | STT + LLM + TTS in one WebSocket — no Deepgram/ElevenLabs needed |
| Conversation brain | Gemini 2.5 Flash | Low latency, multilingual, streaming |
| Post-call reasoning | Gemini 2.5 Pro | Quality > latency for summary + scoring |
| Embeddings | Gemini `text-embedding-004` | Same API key as everything else |
| Backend | FastAPI (Python) | Async, fast iteration |
| Frontend | React + Vite + Tailwind | Cheap to deploy on Vercel |
| Storage | Supabase (Postgres + pgvector) | One DB for transactional + vector |
| WhatsApp | Meta Cloud API sandbox (mocked in demo) | Free test numbers |

## Hackathon scope

- **Round 1 (concept):** submitted (`AI_Voice_Agent_Round1_Solution.pdf`)
- **Round 2 (prototype):** this repo
  - [ ] Working prototype (text + voice)
  - [ ] 5-min walkthrough video
  - [ ] Public GitHub repo (this one)

Track progress in `PLAN.md` § Status tracker.

## Honest disclosures

- **Appendix A** is drafted from publicly available Rupeezy sources (rupeezy.in, support.rupeezy.in, RISE Portal). When the hackathon organizers release an official Appendix A, it replaces this one wholesale — see `APPENDIX_A.md` §13.
- **WhatsApp send** is mocked for the demo. Real Cloud API integration is a later step.
- **No real telephony** — judges explicitly accept browser voice / text simulation.
- **All code in this repo was written during the hackathon window**, per Theme 7 rules.

## License

MIT — see `LICENSE`.
