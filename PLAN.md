# Rupeezy AI Voice Agent — Build Plan (Zero → Production-Grade Demo)

> **Goal.** Ship a Round-2 prototype that demonstrates a real, two-way, contextual voice (or text+voice) sales conversation with a Rupeezy partner lead, grounded in Appendix A, multilingual (English/Hindi/Hinglish), with H/W/C qualification, post-call summary, RM dashboard, and WhatsApp handoff. Plus the 5-min walkthrough video and a clean public repo.
>
> **Time budget assumption.** ~2 days of focused work for one builder, less if a teammate parallelizes the frontend. Each phase below has a hard time cap. If we blow the cap, we cut scope, not quality.
>
> **Working principle.** Each phase ends with something *demoable*. We never spend a day in code with nothing to show. The video can be re-recorded after any phase from Phase 4 onward — earlier phases just keep raising the ceiling.
>
> **Auto mode.** When a phase has a low-risk default (model choice, file structure, port number, schema field name), I take the default and proceed. Course-correct any time.

---

## Guiding constraints (do not violate)

1. **Free tiers only.** Gemini API key (already have), LiveKit Cloud free, Supabase free, Vercel free, GitHub free. No paid services without explicit ok.
2. **All code written during the hackathon.** No pre-built solutions. Open-source libraries are fine.
3. **Appendix A is the single source of truth** for every fact the agent states. RAG every turn that touches a fact.
4. **Honesty over slickness.** Better to demo a tighter scope that works than a wider scope that fakes. Mocked components (WhatsApp send, batch dialer) are clearly labeled as mocks in the demo.
5. **Compliance per Appendix §8.** Bot disclosure, no investment advice, no "completely free" framing, DND on hard rejection.

---

## Phase index

| # | Phase | Time cap | Demo proof at end of phase |
|---|---|---|---|
| 0 | Repo & toolchain bootstrap | 30 min | `git clone && npm/uv install` works; CI green |
| 1 | Knowledge base + RAG | 90 min | CLI: ask a question, agent retrieves correct Appendix chunk |
| 2 | Text-chat agent (the brain) | 2 hrs | Browser: full text conversation, 5 objections handled, language switching works |
| 3 | Post-call pipeline | 90 min | After any chat: H/W/C verdict + 3-sentence summary + handoff payload printed |
| 4 | Persistence (Supabase) | 60 min | Conversation, transcript, summary, score persisted; reload page = nothing lost |
| 5 | RM dashboard | 2.5 hrs | React page: funnel + leads list + per-lead drilldown with transcript + handoff |
| 6 | Voice loop (Gemini Live + LiveKit) | 3 hrs | Browser: speak to agent in English/Hindi, get spoken response, transcript captured |
| 7 | Multilingual hardening | 60 min | Hindi-only and Hinglish flows tested end-to-end with real audio |
| 8 | WhatsApp handoff (mocked) | 45 min | Hot lead triggers a "WhatsApp send" — payload + link visible in dashboard |
| 9 | Batch lead upload | 45 min | CSV upload → leads queued → agent dials each (visually) in sequence |
| 10 | Multi-turn cross-call memory | 60 min | Second call to same lead opens with "last time you said X" |
| 11 | Polish, README, deploy | 90 min | Public Vercel URL + GitHub repo with full README + architecture diagram |
| 12 | Video walkthrough | 90 min | 5-min MP4 covering all judging dimensions |

**Total nominal time:** ~17 hours of focused work. Realistic with breaks: 2.5 days.

**Hard cuts available** (in order, if we run short): Phase 9 (batch — fake with a 3-row CSV), Phase 10 (cross-call memory — show as "designed but not wired"), Phase 7 regional languages beyond Hindi.

**Never cut:** Phases 1, 2, 3, 5, 6, 11, 12.

---

## Phase 0 — Repo & toolchain bootstrap (30 min)

**Goal.** A clean repo where every subsequent phase can land code without thrash.

**Deliverables**
- `c:/Users/anany/rupeezy-voice-agent/` initialized as `git` repo, first commit
- Top-level layout:
  ```
  rupeezy-voice-agent/
    APPENDIX_A.md             (already done)
    PROJECT_CONTEXT.md        (already done)
    PLAN.md                   (this file)
    README.md                 (stub for now)
    backend/                  Python 3.11 + FastAPI
      pyproject.toml
      app/
        main.py
        agent/                conversation engine
        rag/                  Appendix A ingestion + retrieval
        scoring/              H/W/C
        livekit/              voice room glue
        whatsapp/             mocked send
        models.py             SQLAlchemy / Supabase models
        config.py             env + secrets
      tests/
    frontend/                 React + Vite + Tailwind
      package.json
      src/
        pages/
          chat.tsx            text-chat demo (Phase 2)
          voice.tsx           voice demo (Phase 6)
          dashboard.tsx       RM dashboard (Phase 5)
        lib/
        components/
    scripts/
      ingest_appendix.py
      seed_demo_data.py
    .env.example
    .gitignore
  ```
- `.env.example` listing every required key (`GEMINI_API_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `SUPABASE_URL`, `SUPABASE_KEY`)
- `.gitignore` covering `.env`, `node_modules/`, `__pycache__/`, `dist/`, `.venv/`
- Dependency install verified: `uv sync` (backend) + `npm install` (frontend) both clean
- Backend smoke test: `uvicorn app.main:app --reload` returns 200 on `/health`
- Frontend smoke test: `npm run dev` serves on :5173

**Acceptance**
- `git log` shows a clean initial commit
- Both servers start without errors
- README has a "Quick start" section that actually works

**Auto-mode defaults**
- Backend: `uv` for Python deps (fast, modern), Python 3.11
- Frontend: Vite + React + TypeScript + Tailwind (zero config)
- Dev DB: SQLite locally for Phases 1–3, Supabase wired in Phase 4
- Single repo, two services (no monorepo tooling — keep it boring)

---

## Phase 1 — Knowledge base + RAG (90 min)

**Goal.** The agent's only source of truth is Appendix A. Build the retrieval layer first so every later answer is grounded.

**Deliverables**
- `scripts/ingest_appendix.py` — reads `APPENDIX_A.md`, splits by `##` headers, generates Gemini `text-embedding-004` embeddings, persists to local SQLite + (later) pgvector on Supabase
- `backend/app/rag/retriever.py` — `retrieve(query: str, k: int = 4) → List[Chunk]` with cosine similarity
- `backend/app/rag/chunks.py` — chunk schema: `{id, section, heading, text, embedding}`
- CLI smoke test: `python -m app.rag.cli "I'm already with another broker"` returns the §4.1 chunk as top hit
- Unit test: 5 hand-picked queries each retrieve the expected section

**Design decisions**
- Chunk by H2 (`##`) section, not by paragraph — keeps each rebuttal/fact-block whole
- Store both the section heading and a 200-char "summary lead" with each chunk to give the LLM context when injected
- Cache embeddings on disk so re-runs don't re-embed unchanged chunks (hash by chunk text)

**Acceptance**
- Top-1 retrieval accuracy ≥ 80% on 10 hand-written test queries spanning all 5 objections + 3 fee questions + 2 eligibility questions

---

## Phase 2 — Text-chat agent: the brain (2 hrs)

**Goal.** A working browser text chat where the agent runs a real Rupeezy partner-program sales conversation, grounded in Appendix A, in English/Hindi/Hinglish.

**Deliverables**
- `backend/app/agent/conversation.py` — turn loop:
  1. User message in
  2. RAG retrieves top-4 relevant Appendix chunks
  3. System prompt built with: Appendix §2 (spine) + §3 (hard facts) + §3.1 (fee disclosure) + retrieved chunks + conversation history + style rules from §11/§12
  4. Gemini 2.5 Flash streaming completion
  5. Detected language saved to lead state
- `backend/app/agent/system_prompt.py` — the master prompt template (versioned in code, not hardcoded into the request)
- `POST /api/chat` — SSE streaming endpoint
- `frontend/src/pages/chat.tsx` — minimal chat UI: messages list, input box, language indicator badge, "end call" button
- Hot-key: `Ctrl+L` to clear conversation (for fast iteration)

**Conversation quality bar (tested manually before phase ends)**
- Agent opens with the §1 hook in lead's apparent language
- Agent handles all 5 objections from §4 with adapted phrasing (not verbatim from Appendix)
- Agent never invents a number (e.g., asked for exact margin funding rate → defers to human callback)
- Agent stays in Hindi when user types Hindi, switches if user switches mid-conversation
- Agent never says "completely free" or guarantees earnings

**Demo proof at end of phase**
- A 3–5 minute typed conversation that exercises: opener → discovery → pitch → 2 objections → close. Recorded as text in `demo_transcripts/phase2.md`.

**Auto-mode defaults**
- Streaming via Server-Sent Events (simpler than WebSocket for text)
- Conversation state held in-process for now; persisted in Phase 4
- Language detection: ask Gemini in the system prompt, not a separate classifier — saves a call

---

## Phase 3 — Post-call pipeline: scoring + summary (90 min)

**Goal.** Every conversation produces the structured handoff payload from Appendix §7.1.

**Deliverables**
- `backend/app/scoring/classifier.py` — runs after `end_call` event:
  - Calls Gemini 2.5 Pro with the full transcript + scoring rubric from Appendix §5
  - Returns `{bucket: hot|warm|cold, confidence, signal_breakdown, summary_short, objections_raised, unresolved_questions, next_action}`
- `backend/app/agent/handoff.py` — assembles the full YAML/JSON handoff record per §7.1 schema
- `POST /api/conversation/{id}/end` — triggers the pipeline, returns the handoff record
- Frontend: chat page shows the handoff record in a side panel after "End call" is clicked

**Quality bar**
- Run the Phase-2 demo conversation 5 times with different objection patterns
- All 5 produce a defensible H/W/C verdict (manual judgment)
- Summary_short is always ≤ 3 sentences and references the actual conversation, not generic platitudes
- `unresolved_questions` correctly populated when the agent committed to a callback

**Auto-mode defaults**
- Run scoring synchronously for now (the call is over, latency doesn't matter for the demo). Move to async queue in Phase 11 if there's time.
- Use Gemini 2.5 Pro (not Flash) for scoring — quality matters more than latency here

---

## Phase 4 — Persistence (60 min)

**Goal.** Conversations, transcripts, summaries, and handoff records survive a server restart, and Phase 5's dashboard has real data to render.

**Deliverables**
- Supabase project created (free tier), `.env` populated, `pgvector` extension enabled
- Schema migration script `scripts/init_db.sql`:
  - `leads(id, name, phone, language_pref, created_at, dnd, last_called_at)`
  - `conversations(id, lead_id, started_at, ended_at, duration_sec, language_used, channel, ended_by)`
  - `messages(id, conversation_id, turn, role, text, audio_url, created_at)`
  - `handoff_records(id, conversation_id, bucket, confidence, signal_breakdown_json, summary_short, payload_json, created_at)`
  - `appendix_chunks(id, section, heading, text, embedding vector(768))`
- `backend/app/models.py` — SQLAlchemy models matching the above
- Backend writes during chat: each turn → `messages`; on end → `handoff_records`
- Re-ingest Appendix A into Supabase pgvector via the Phase-1 script (with a `--target=supabase` flag)

**Acceptance**
- Run Phase-2 chat, restart backend, hit `GET /api/conversations` → conversation is there with full transcript and handoff
- Re-running RAG queries against Supabase pgvector returns same top-1 results as local SQLite

**Auto-mode defaults**
- Use Supabase Python client directly for writes (simpler than SQLAlchemy + Supabase auth dance)
- Service-role key in backend `.env`, never exposed to frontend
- No row-level security for the demo — single-tenant

---

## Phase 5 — RM Dashboard (2.5 hrs)

**Goal.** The "wow" moment. Judges see the funnel, click into a Hot lead, see the full transcript and handoff payload, see exactly what the human RM would see.

**Deliverables**
- `frontend/src/pages/dashboard.tsx` with 4 zones:
  1. **Funnel header** — Contacted | Engaged | Qualified | Hot/Warm/Cold counts, with mini-bar visual
  2. **Leads table** — name, phone, language, score badge (color-coded), duration, time, "View" action
  3. **Lead drilldown drawer** (slide from right):
     - Lead profile (name, phone, language)
     - Handoff summary (the §7.2 short summary, large font)
     - H/W/C signal breakdown (bar chart of the 7 signals)
     - Objections raised + resolution status
     - Unresolved questions (highlighted — these are the human RM's prep notes)
     - Next action card with CTA buttons: "Call now", "Send WhatsApp", "Schedule callback"
     - Full transcript (collapsible, with turn-by-turn timestamps)
  4. **Filter bar** — language, bucket, date range, search by name/phone
- `GET /api/dashboard/funnel` — counts query
- `GET /api/dashboard/leads?bucket=&lang=&q=` — filtered leads list
- `GET /api/leads/{id}` — full drilldown payload

**Visual quality bar**
- Looks intentional, not bootstrap-default. Tailwind + headlessui or shadcn/ui.
- Score badges: 🔴 Hot (red, urgent), 🟡 Warm (amber), ⚪ Cold (gray). The agent should *not* use emojis in conversation, but the dashboard absolutely should — judges scan it visually.
- Mobile-responsive enough to demo on a laptop in any window size; not mobile-first

**Acceptance**
- Seed 8 demo leads (matching the brief's "50 leads → 8 Hot / 14 Warm / 28 Cold" sample scenario, scaled to 8/14/8 for visual density)
- Funnel numbers match seeded data
- Click any Hot lead → drawer opens in <300ms with full context
- Filter by `Hot + Hindi` → returns the right subset

**Auto-mode defaults**
- shadcn/ui for components (familiar, fast, looks good)
- Recharts for the funnel + signal breakdown chart (lightweight, plays well with React)
- No auth on the dashboard for the demo — note in README that prod would gate this

---

## Phase 6 — Voice loop: Gemini Live + LiveKit (3 hrs)

**Goal.** Speak to the agent in the browser, hear it speak back, transcript captured automatically. This is the highest-risk phase — budget the full 3 hrs.

**Deliverables**
- LiveKit Cloud project created, API keys in `.env`
- `backend/app/livekit/agent_worker.py` — LiveKit Agents Python worker that:
  1. Joins a room when a participant connects
  2. Bridges the room's audio to a Gemini Live API session
  3. Streams Gemini's audio response back into the room
  4. Captures every turn (user transcript + agent transcript + audio chunks) and persists per Phase-4 schema
- `frontend/src/pages/voice.tsx`:
  - "Start call" button → mints a LiveKit access token via backend → joins room
  - Live audio waveform indicator (so user knows they're being heard)
  - Live transcript as it streams in (both sides)
  - "End call" button → triggers Phase-3 pipeline, navigates to handoff view
- `POST /api/livekit/token` — issues short-lived access tokens
- `POST /api/livekit/start-agent` — dispatches the worker for a given room name

**Quality bar**
- First audio response within 1.5s of user finishing their utterance
- Barge-in works: user can interrupt the agent mid-sentence
- Transcript appears within 500ms of speech ending
- Hindi audio works (Gemini Live native Hindi)
- The conversation is the same brain as Phase 2 — same system prompt, same RAG, same scoring at the end

**Risk mitigations**
- If Gemini Live native audio quota is throttled on free tier: fall back to ElevenLabs-free / browser TTS for the demo voice path, still demo the text path as the "real" intelligence
- If LiveKit setup eats time: cut to browser Web Speech API (built-in mic + speech synthesis) as a Plan B — judges said "any creative interface" is acceptable

**Auto-mode defaults**
- LiveKit Agents SDK (Python) — purpose-built for this exact integration
- Single room per conversation, room name = conversation UUID
- Recording: capture each utterance audio chunk to local disk during the demo; S3 in prod (out of scope)

---

## Phase 7 — Multilingual hardening (60 min)

**Goal.** Hindi and Hinglish are not afterthoughts — they're tested end-to-end with real audio.

**Deliverables**
- 3 scripted demo flows recorded as transcripts:
  - English-only conversation (objection: "I'm with another broker")
  - Hindi-only conversation (objection: "Trust issue")
  - Hinglish conversation that switches to pure Hindi mid-call (objection: "Not enough contacts")
- System prompt updated with §1.4 adaptation rules made explicit: "If the user's last 3 utterances are >70% in language X, respond in language X without announcing the switch"
- Smoke-test the Hindi opener audio quality — if Gemini Live's Hindi TTS sounds unnatural, swap to English with Hindi script as a fallback (note in README)

**Acceptance**
- All 3 flows produce coherent transcripts with no language drift
- The agent never says "switching to Hindi now" — it just switches

**Stretch (skip if behind schedule)**
- Add Tamil or Marathi as a fourth language. Bonus per brief.

---

## Phase 8 — WhatsApp handoff (mocked) (45 min)

**Goal.** Hot leads trigger a "WhatsApp send" that the dashboard renders as a real outbound message — even though no actual WhatsApp Cloud API call goes out.

**Deliverables**
- `backend/app/whatsapp/sender.py` — interface with two implementations:
  - `MockSender` (default) — writes to `whatsapp_log` table with `status='sent_mock'`
  - `CloudApiSender` (stub for prod) — class skeleton with `// TODO: WhatsApp Cloud API integration` comment
- `whatsapp_log(id, lead_id, template, body, sent_at, status, response_payload)` table
- After Phase-3 pipeline classifies a lead as Hot or Warm, automatically queue the appropriate template from Appendix §9
- Dashboard drilldown shows: "📱 WhatsApp sent at 14:23 — [click to preview message]" with the rendered template

**Acceptance**
- End a chat that scores Hot → dashboard shows the WhatsApp event within 2s
- Preview shows the §9.1 template with `[Name]`, `[LINK]`, `[RM Name]` filled in
- Cold leads do not trigger WhatsApp (per §9.3, only soft-cold triggers the day-3 nurture, which is also out of scope for the live demo)

---

## Phase 9 — Batch lead upload (45 min)

**Goal.** Demo the "RM uploads 50 leads, agent contacts them in minutes" scenario from the brief.

**Deliverables**
- `frontend/src/pages/dashboard.tsx` gets an "Upload leads" button → CSV upload modal
- CSV format: `name,phone,language_pref,source` (template downloadable from the modal)
- `POST /api/leads/batch` — parses CSV, dedupes by phone, inserts into `leads` table with `status='queued'`
- `backend/app/agent/dialer.py` — naive worker that pops queued leads and "calls" them (creates a conversation row, runs a scripted simulated call OR opens a real voice call if you want to demo it live)
- Dashboard funnel updates live (poll every 3s) as leads transition `queued → contacting → completed`

**Demo strategy**
- For the video: upload a 5-row CSV. Watch all 5 leads get processed in ~30 seconds (mocked agent runs are fast). Funnel populates in real time.
- Don't try to demo 50 real voice calls — costs Gemini API quota and looks the same as 5 in the video

---

## Phase 10 — Multi-turn cross-call memory (60 min)

**Goal.** Second call to the same lead opens with acknowledgement of the prior call (per Appendix §5.3).

**Deliverables**
- New helper `backend/app/agent/lead_memory.py` — `get_lead_context(lead_id)` returns:
  - Last conversation's `summary_short`
  - Unresolved objections + questions
  - Last `bucket` classification
  - Time since last call (humanized: "3 days ago")
- System prompt builder injects this block when `conversations.count(lead_id) > 1`
- New conditional opener template: "Last time we spoke, you mentioned [X] — were you able to [Y]?"
- Re-scoring rule from §5.3: don't reset the bucket, evolve it

**Acceptance**
- Run a Warm-classified call. Immediately call the same lead again. Agent's first line references the prior call.

---

## Phase 11 — Polish, README, deploy (90 min)

**Goal.** Anyone (judge, mentor, teammate) can `git clone` and run the project in 10 minutes. Hosted demo URL works.

**Deliverables**
- `README.md` with:
  - 1-paragraph project pitch
  - Architecture diagram (PNG or mermaid)
  - "Quick start" — env setup, install, run, where the demo lives
  - "Tech stack & why" — table from PROJECT_CONTEXT §5
  - Demo credentials / sample data note
  - Known limitations (mocked WhatsApp, no real telephony, etc.) — judges respect honesty
  - Contribution by team member (judges sometimes ask)
- Deploy:
  - Frontend → Vercel (free tier, auto-deploys from `main`)
  - Backend → Railway / Render free tier OR run locally for the live demo if deploy times out
  - Supabase already hosted
- Final pass through `git log` to ensure commits look like real work, not 3 commits at midnight
- Add `LICENSE` (MIT) — judges sometimes filter on this
- One last security sweep: no `.env` files, no API keys committed, no Supabase service-role key in frontend bundle

**Acceptance**
- A teammate (or you on a fresh machine) can run setup from the README and reach the chat page in <10 min
- The Vercel URL loads the dashboard with seeded data

---

## Phase 12 — 5-minute video walkthrough (90 min)

**Goal.** A judge who watches only the video should be able to grade us on every dimension in the rubric.

**Structure (target: 4:30, hard cap 5:00)**
- 0:00–0:30 — **The problem.** RM-driven conversion is broken: timing, language, capacity. (One slide, narrated.)
- 0:30–1:00 — **The solution.** AI voice agent: instant, multilingual, scalable, with structured handoff. (One slide, narrated.)
- 1:00–2:30 — **Live demo of a call.** Browser voice page. Speak to the agent in English. Trigger an objection. Switch to Hindi mid-call. End the call. Show the handoff payload.
- 2:30–3:30 — **The dashboard.** Open dashboard. Show the funnel. Click into the Hot lead we just created. Walk through the drilldown — summary, signals, transcript, WhatsApp event.
- 3:30–4:15 — **Architecture & tech.** Quick diagram. Call out: Gemini Live, LiveKit, Supabase pgvector for RAG, Gemini Pro for scoring, all free tier.
- 4:15–4:45 — **What's mocked vs. real.** Honesty slide. WhatsApp = mocked, batch dialer = simulated, telephony = browser. Everything else is real.
- 4:45–5:00 — **Roadmap.** What we'd build next: real WhatsApp, telephony via SIP, regional language coverage, A/B testing the scoring model.

**Tools**
- OBS Studio (free, screen + mic record)
- Edit in DaVinci Resolve free OR just record in one take with rehearsal — saves 60 min
- Upload as unlisted YouTube + include link in repo README and submission

**Quality bar**
- Audio is clean (use a real mic, not laptop built-in)
- No dead air, no "umm let me find that"
- Every claim made on screen matches what the demo actually shows
- Captions burned in for the Hindi audio segment (judges may not all be Hindi-fluent)

---

## Definition of Done (whole project)

A judge clicking through our submission should be able to verify, in this order:

- [ ] Repo loads, README explains the project in 30 seconds
- [ ] Code is clean enough to scan: clear folder structure, no commented-out blocks, no `console.log`s
- [ ] `APPENDIX_A.md` is real, well-structured, and clearly the agent's source of truth
- [ ] Hosted demo URL works (or local-run instructions are 1-command clean)
- [ ] Voice OR text conversation runs end-to-end with no manual intervention
- [ ] All 5 objections handled, observably non-scripted (rephrase across attempts)
- [ ] Hindi + English + Hinglish all demonstrably work
- [ ] Hot/Warm/Cold classification visibly different across 3 sample calls
- [ ] Dashboard renders the funnel + drilldown + transcript
- [ ] WhatsApp event appears for Hot/Warm leads (mock visible)
- [ ] Post-call summary matches conversation content (not generic)
- [ ] 5-min video covers all of the above, narrated by a human

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gemini Live audio free-tier quota throttles during demo | Medium | High | Pre-record a backup demo video; have text-chat as Plan B in live judging |
| LiveKit room setup eats >3 hrs | Medium | High | Hard cut to browser Web Speech API at the 3-hr mark |
| Hindi TTS via Gemini Live sounds robotic | Medium | Medium | Acknowledge in README; show text-Hindi as primary, audio-Hindi as bonus |
| Supabase free-tier rate limits | Low | Medium | Stay on SQLite for dev, only push to Supabase for the deployed demo |
| Scoring model returns the same bucket for everyone | Low | High | Test with 5 deliberately different transcripts in Phase 3 before moving on |
| Dashboard looks bootstrap-default | Medium | Medium | Allocate 30 min of Phase 5 specifically to visual polish |
| Video is 7 minutes long | High | High | Rehearse twice. Cut ruthlessly. 5 min is non-negotiable. |
| Teammate availability collapses | Unknown | High | Plan above is single-builder safe. If teammate joins: they own Phase 5 (frontend) |

---

## Phase ownership (single builder default)

If solo: tackle phases sequentially in order.

If 2 builders:
- **Builder A (backend-leaning):** Phases 0, 1, 2, 3, 4, 6, 7, 8, 9, 10
- **Builder B (frontend-leaning):** Starts in parallel from Phase 0; owns Phases 5, 11 (deploy), assists with 12 (video)

---

## Status tracker

> Update this table as we complete phases. The agent doing the work should mark `🟢 done` with a 1-line outcome, `🟡 in progress`, or `🔴 blocked` with the reason.

| Phase | Status | Notes |
|---|---|---|
| 0 — Bootstrap | 🟢 done | Repo, backend (FastAPI + tests), frontend (Vite/React/Tailwind), README, LICENSE. `pytest` 3/3 green; `vite build` clean (168KB JS gzipped to 55KB). |
| 1 — RAG | 🟢 done | 31 chunks ingested into SQLite via `gemini-embedding-001` (3072-dim). Live retrieval test: **92% top-1 accuracy** (11/12) on paraphrased English/Hindi/Hinglish queries spanning all 5 objections + fees + eligibility + ops. CLI probe verified (e.g. `"I'm with Zerodha already"` → §4.1 @ 0.732). 9/9 tests green. |
| 2 — Text agent | 🟢 done | Full conversation engine + SSE-streaming `POST /api/conversations/{id}/turn` + chat UI page (live token streaming, language badge, end-call, Ctrl+L reset). System prompt is layered: persona+compliance / always-on Appendix sections / per-turn RAG. Defensive cleanup strips any model-emitted `(English)` annotations across stream chunks. Switched chat model from `gemini-2.5-flash` → `gemini-2.5-flash-lite` for free-tier RPM headroom. **Live demo:** all 4 turns of the English MFD scenario passed with bot disclosure, real numbers, proactive fee disclosure (§3.1), and zero compliance violations — see `demo_transcripts/phase2.md`. 11/11 tests green (9 non-agent + 2 live agent compliance tests). |
| 3 — Post-call pipeline | 🟢 done | H/W/C classifier (Gemini 2.5 Pro w/ structured `response_schema`, fallback chain through `gemini-flash-lite-latest` → `gemini-2.5-flash-lite` → `gemini-2.0-flash-lite` for quota resilience). Handoff assembler combines classification + discovery + objections + deterministic next-action chooser. `POST /api/conversations/{id}/end` runs the pipeline and returns the full HandoffRecord (Appendix §7.1 schema) in one call. Chat UI gets a slide-in side panel rendering bucket badge, signal bars, objection rows, unresolved questions, next-action card. **Live runs proved all 3 buckets:** HOT (95%, warm_transfer), WARM (90%, whatsapp_link_sent), COLD (100%, dnd) — see `demo_transcripts/phase3.md` + saved JSON artefacts. 14/14 unit tests green incl. 6 new routing tests. |
| 4 — Persistence | 🟢 done | SQLAlchemy 2.0 over SQLite (Phase 11 swaps to Supabase Postgres via `DATABASE_URL` env). 4 ORM models: Lead, Conversation, Message, HandoffRow (full payload as JSON + denormalised columns for fast filtering). Conversation engine writes through after every turn; `/end` persists conversation + handoff atomically. `GET /{id}` and `/{id}/handoff` fall back to DB on cache miss — survives restart. New dashboard surface: `GET /api/dashboard/funnel` (counts), `/leads?bucket=` (table), `/leads/{id}` (drilldown with full handoff + transcript). **Live verified:** ran a cold conversation, killed backend, brought it back fresh, all data still readable through the dashboard endpoints. 19/19 unit tests green incl. 5 new persistence roundtrip tests with isolated temp DBs. |
| 5 — Dashboard | 🟢 done | Full RM dashboard at `/dashboard` with 4 zones: (1) FunnelHeader — Contacted → Engaged → Qualified with drop-off % + Hot/Warm/Cold chips; (2) Filter bar — bucket pills + free-text search + count "X of Y"; (3) LeadsTable — color-coded bucket badges, summary, language, duration, next-action, relative time; (4) LeadDrawer — slide-in 600px panel with CTA bar (Call/WhatsApp/Schedule, disabled with tooltips for later phases), collapsible transcript, full HandoffPanel inline. Auto-refresh every 5s. ESC + click-backdrop close. Seed script `scripts/seed_demo_data.py --reset` populates 15 leads (4 hot, 6 warm, 5 cold across English/Hindi/Hinglish) using the real Phase 3 handoff JSONs as templates. **Live verified:** funnel returns `{contacted:15, hot:4, warm:6, cold:5}`, drilldown returns full handoff + 6-turn transcript through Vite proxy. Frontend builds cleanly (195 KB JS → 62 KB gzipped). |
| 6 — Voice loop | ⚪ not started | |
| 7 — Multilingual | ⚪ not started | |
| 8 — WhatsApp mock | ⚪ not started | |
| 9 — Batch upload | ⚪ not started | |
| 10 — Cross-call memory | ⚪ not started | |
| 11 — Polish + deploy | ⚪ not started | |
| 12 — Video | ⚪ not started | |

---

## Next action

Phase 0 — bootstrap the repo. Auto-mode is on; I'll proceed without further confirmation unless something high-risk appears.
