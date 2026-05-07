# Rupeezy AI Voice Agent

> Multilingual AI voice agent that pitches Rupeezy's Authorized Person partner program, qualifies leads as **Hot / Warm / Cold**, and hands them off to RMs with full conversation context — calls every lead in their language, within minutes, no after-hours gap.
>
> Built for **PanIIT AI for Bharat — Theme 7** (Apr–May 2026).

---

## 60-second tour for judges

Three URLs, in this order. Total time to see everything end-to-end: about a minute.

1. **`/`** — landing page. Click **"Run live demo"**. The system seeds 4 distinct leads (HOT advisor, WARM Hindi MFD, COLD busy influencer, DND hostile), routes you to the dashboard, and dials each one through the real conversation engine. Watch the funnel populate.
2. **`/voice`** — talk to Aria yourself. Pick a language (8 supported, including Tamil/Telugu/Marathi/Gujarati/Bengali). The mic button starts a real-time voice loop: browser STT → Gemini → neural TTS via Microsoft Edge's free public endpoint. Text on screen reveals word-by-word in lockstep with audio.
3. **`/dashboard`** — click any lead row. The drawer shows the full handoff payload: bucket + confidence, 7-signal score breakdown, objections raised + resolution status, unresolved questions, the WhatsApp template that fired, full transcript.

That's the demo. Everything below is for evaluators who want to see how it's wired.

---

## What the judging rubric asks for, and where to find it

| Rubric item | Where it lives |
| --- | --- |
| Real-time, two-way conversation | `/voice` page; backend at `app/agent/conversation.py` (SSE streaming) |
| Conversation quality | 4-layer system prompt in `app/agent/system_prompt.py` (persona + prior call + base appendix + retrieved chunks) |
| Multilingual handling | Persona rule "match the lead's language"; per-language voice picker in `app/tts/edge_tts_route.py` |
| Qualification logic | 7-signal classifier in `app/scoring/` — stated_intent / engagement / network_size / objection_pattern / affirmative_cues / deferrals + hangup |
| Handoff design | `frontend/src/components/HandoffPanel.tsx` — bucket card, signal bars, objection rows with resolution, unresolved questions, WhatsApp dispatch log |
| Batch upload + immediate calling | Dashboard → "Upload leads" → CSV → "Process queue". Real conversations through Gemini, not stubs. |
| Hot/Warm/Cold routing | `app/scoring/handoff.py:choose_next_action` — Hot→warm transfer, Warm→WhatsApp link, Cold→14-day nurture, DND→suppress |
| Funnel dashboard | `/dashboard` — Contacted → Engaged → Qualified counts, Hot/Warm/Cold split, transcripts, WhatsApp logs |

---

## Architecture

```
                       During the call
   ┌──────────┐   ┌──────────┐   ┌─────────────┐   ┌─────────────┐
   │ Web      │──▶│ Gemini   │──▶│ RAG over    │──▶│ Edge-TTS    │
   │ Speech   │   │ flash-   │   │ Appendix A  │   │ neural      │
   │ STT      │   │ lite     │   │ (embed-001) │   │ (Aria/      │
   │ (browser)│   │ + 4-     │   │ content-    │   │  Neerja/    │
   │          │   │ layer    │   │ hashed cache│   │  Swara/...) │
   └──────────┘   │ prompt   │   └─────────────┘   └─────────────┘
                  └────┬─────┘
                       │ on call end
                       ▼
                       After the call
   ┌──────────────┐   ┌──────────────────────────┐
   │ Classifier   │──▶│ Handoff                  │
   │ flash-lite   │   │ ├─ HOT  → warm transfer  │
   │ 7-signal     │   │ ├─ WARM → WhatsApp link  │
   │ score        │   │ ├─ COLD → 14-d nurture   │
   │              │   │ └─ DND  → suppress       │
   └──────────────┘   └──────────────────────────┘
```

`ARCHITECTURE.md` has the full Mermaid diagrams (request flows, DB schema, file map).

---

## Tech stack — free-tier-first, no API key for TTS

| Layer | Choice | Notes |
| --- | --- | --- |
| STT | Web Speech API (browser-native) | Free, 8 languages tested, no API key |
| Conversation brain | Gemini 2.5 flash-lite | Streaming SSE, multilingual, low latency |
| Post-call classifier | Gemini 2.5 flash-lite | Same model — Pro fallback wired but not needed for current quality |
| Embeddings | `gemini-embedding-001` | Content-hashed disk cache so re-runs cost nothing |
| TTS | **edge-tts** (Microsoft Edge's public neural endpoint) | **Free, no API key** — works for every visitor regardless of OS. Falls back to Web Speech API if unreachable. |
| Backend | FastAPI + Python 3.11 | Async, SSE streaming |
| Frontend | React + Vite + Tailwind | Dark glass design system |
| Storage | SQLite (SQLAlchemy 2.0) | One file, zero ops; ready to swap for Postgres |
| WhatsApp | Mock sender (logs to DB, renders Appendix §9 templates) | Cloud API wiring stubbed but not invoked — explicitly per scope |

---

## Quick start

You'll need: Python 3.11+, Node 20+, a free Gemini API key from <https://aistudio.google.com/app/apikey>.

### 1. Configure

```powershell
copy .env.example .env
# edit .env and set GEMINI_API_KEY
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

The frontend proxies `/api/*`, `/health` to the backend (see `vite.config.ts`).

### 4. Run the demo

Open <http://localhost:5173>, click **"Run live demo"**. Done.

---

## Repository layout

| Path | Purpose |
| --- | --- |
| `APPENDIX_A.md` | Agent's source of truth — script, FAQ, hard facts, 5 core objection rebuttals, tax/GST, RISE Portal, worked partner economics |
| `ARCHITECTURE.md` | Mermaid diagrams (system, request flows, DB schema, file map) |
| `PLAN.md` | 13-phase build plan with status tracker |
| `PROJECT_CONTEXT.md` | Hackathon brief + tech-stack rationale |
| `backend/app/agent/` | Conversation loop, dialer, system-prompt builder |
| `backend/app/rag/` | Markdown chunker (H2-split), embedder with on-disk cache, retriever |
| `backend/app/scoring/` | 7-signal classifier, handoff payload builder |
| `backend/app/tts/edge_tts_route.py` | Edge-TTS proxy → neural voices for any visitor |
| `backend/app/whatsapp/` | Mock sender, Appendix §9 templates |
| `frontend/src/pages/` | Landing, chat, voice, dashboard |
| `frontend/src/lib/edgeTtsSpeaker.ts` | Sentence-streaming neural TTS with word-level text reveal |
| `frontend/src/lib/objectionDetect.ts` | Client-side keyword detector → live objection chips in transcript |
| `frontend/src/components/PipelineDiagram.tsx` | The architecture card on the landing page |

---

## Honest disclosures

- **Appendix A** is drafted from publicly available Rupeezy sources (rupeezy.in, support.rupeezy.in, RISE Portal). If the organizers release an official Appendix A, it replaces this file wholesale; the retrieval index rebuilds from the file, no code change needed.
- **WhatsApp** is mocked. Each "send" persists a `whatsapp_log` row with `status='sent_mock'` and the rendered template body — visible in the lead drawer. Cloud API wiring is stubbed.
- **No real telephony.** Judges explicitly accept browser voice / text simulation; we use Web Speech API for STT and Edge-TTS for output. The dialer in `app/agent/dialer.py` runs scripted scenarios through the real LLM + RAG + scoring pipeline so the demo is end-to-end real, not Wizard-of-Oz.
- **All code was written during the hackathon window**, per Theme 7 rules. See git history.

## License

MIT — see `LICENSE`.
