# Rupeezy AI Voice Agent — Project Context

This file is the single source of truth for **what's been built** (May 2026, post-deploy). Read this first in any new session.

For deploy mechanics see [DEPLOY.md](DEPLOY.md). For the agent's source-of-truth knowledge see [APPENDIX_A.md](APPENDIX_A.md).

---

## 1. The Hackathon

- **Theme 7:** AI Voice Agent for Partner Lead Conversion
- **Company:** Rupeezy (SEBI-registered stockbroker running an Authorized Person partner program)
- **Round 1:** Written PDF submitted (`AI_Voice_Agent_Round1_Solution.pdf`)
- **Round 2 deliverables (this repo):**
  - Working prototype/demo — **deployed live on Render + Vercel**
  - 5-minute video walkthrough
  - Public GitHub repo with full commit history
- **Team size:** 2

---

## 2. The Problem

Rupeezy's AP partner program (zero joining fee, 100% lifetime brokerage share, daily payouts via RISE Portal) converts **only 18% of leads**. The product is competitive — the failure is structural:

1. **Timing collapse** — leads arriving after-hours sit untouched; 5-min contact converts ~9× better than 30-min.
2. **Language ceiling** — RMs speak 1–2 languages; addressable market spans 20+ Indian languages.
3. **Queue overflow** — one RM = one call at a time; 200-lead surges create 3-day backlogs.

**Goal:** AI agent that calls every lead within minutes in their language, pitches the program, handles 5 core objections, qualifies as Hot / Warm / Cold, hands hot leads to a human RM with full context. Target: 18% → 40%+.

---

## 3. The 5 Core Objections (from Appendix A §4)

1. "I'm already with another broker"
2. "I don't have enough contacts"
3. "What if my clients face issues — who handles support?"
4. "Is Rupeezy trustworthy?"
5. "I'll think about it / call me later"

Agent adapts rebuttals contextually using a 3-variant rebuttal playbook (English / Hindi / Hinglish) — never sounds scripted.

---

## 4. What's Actually Built

| Capability | Status | Where |
| --- | --- | --- |
| Multilingual STT | ✅ 8 languages (Web Speech API) | browser-native, no API key |
| Multilingual neural TTS | ✅ 11 voices (Microsoft Aria, Neerja, Swara, Pallavi…) | `app/tts/edge_tts_route.py` |
| Real-time, two-way conversation | ✅ SSE streaming, sentence-buffered TTS, word-level text reveal | `app/agent/conversation.py` + `frontend/src/lib/edgeTtsSpeaker.ts` |
| Contextual objection handling | ✅ 4-layer prompt (persona + prior call + base appendix + retrieved chunks) | `app/agent/system_prompt.py` |
| RAG over Appendix A | ✅ Markdown chunker (H2-split), gemini-embedding-2, content-hashed disk cache | `app/rag/` |
| Lead qualification (H/W/C) | ✅ 7-signal classifier with confidence + rationale | `app/scoring/classifier.py` |
| Post-call handoff payload | ✅ Bucket card, signal bars, objection rows w/ resolution, unresolved questions | `frontend/src/components/HandoffPanel.tsx` |
| Multi-turn cross-call memory | ✅ Lead profile DB, prior-call summary injected into prompt layer 1b | `app/agent/lead_memory.py` |
| RM dashboard with funnel | ✅ Contacted → Engaged → Qualified, H/W/C split, transcripts, WhatsApp logs | `frontend/src/pages/dashboard.tsx` |
| Hot → RM warm transfer | ✅ Wired (mock CTA in demo) | `next_action: warm_transfer` |
| Warm → WhatsApp link | ✅ Mock sender persists rendered Appendix §9 templates | `app/whatsapp/sender.py` |
| Cold → 14-day nurture | ✅ Single nurture-touch template at day 3 | `next_action: nurture_sequence` |
| DND respect | ✅ Hostile lead path → suppress, no WhatsApp | `next_action: dnd` |
| Batch upload + immediate calling | ✅ CSV upload → queue → real conversations through Gemini | `app/agent/dialer.py` |
| Mid-call objection chips | ✅ Client-side keyword detector renders chips below user bubbles | `frontend/src/lib/objectionDetect.ts` |
| Pipeline architecture diagram | ✅ Landing-page card showing the data path end-to-end | `frontend/src/components/PipelineDiagram.tsx` |
| Demo seed button | ✅ Landing-page CTA seeds 4 personas + auto-dials | `POST /api/dashboard/leads/seed-demo` |

---

## 5. Tech Stack — What We Actually Use

| Layer | Tech | Why |
| --- | --- | --- |
| STT | **Web Speech API** (browser-native) | Free, 8 langs, no API key, 0 cold-start |
| TTS | **edge-tts** (Microsoft Edge's free public neural endpoint) | 11+ Indian neural voices for any visitor regardless of OS — no API key |
| Conversation brain | **Gemini 2.5/3.x flash-lite** (chain) | Streaming SSE; multilingual; multiple models for quota resilience |
| Post-call classifier | Same chain as the conversation engine | Structured-output JSON via `response_schema` |
| Embeddings | **gemini-embedding-2** | 3072-dim, GA, 8K context window |
| Backend | **FastAPI** + **Python 3.11** + **uvicorn** | Async, native SSE streaming |
| Frontend | **React + Vite + TypeScript + Tailwind** | Dark glass design system |
| Storage | **SQLite** + **SQLAlchemy 2.0** | One file, zero ops; ready to swap for Postgres |
| WhatsApp | Mock sender (logs to DB, renders Appendix §9 templates) | Cloud API stubbed but not invoked — explicitly per scope |
| Backend deploy | **Render** (free Python web service) | Persistent process, real SSE streaming, /health probe |
| Frontend deploy | **Vercel** (free static + edge) | Best DX for Vite, instant deploys, free SSL |
| Repo | **GitHub** (public) — `AmanG-04/rupeezy-voice-agent` | |

**Explicitly NOT using** (rejected during build):
- ~~LiveKit~~ — explicitly not required by Theme 7 brief; browser STT/TTS is enough
- ~~Gemini Live API~~ — single-stream audio loop loses RAG injection + classifier path
- ~~OpenAI / Anthropic / Deepgram / ElevenLabs~~ — replaced by Gemini + free browser APIs
- ~~Supabase / pgvector~~ — overkill for single-file SQLite at hackathon scale
- ~~text-embedding-004~~ — retired on current API keys

---

## 6. Model Fallback Chain (Resilience)

The conversation engine and classifier walk a configurable chain of Gemini chat models. When the primary's daily/RPM quota exhausts (429), the engine transparently switches to the next model so the demo never goes dark mid-call.

**Default chain (May 2026):**

1. `gemini-3.1-flash-lite-preview` — primary, ~500/day free quota
2. `gemini-3-flash-preview` — broader feature surface, separate quota pool
3. `gemini-2.5-flash-lite` — last-resort, smallest free quota

Override via `GEMINI_CHAT_MODEL` + `GEMINI_CHAT_MODEL_FALLBACKS` env vars on Render.

The full chain is exposed at `GET /api/version` and rendered as a chip row on the landing-page System Status panel — judges see the resilience without reading code.

---

## 7. Architecture (live system, end-to-end)

```
DURING THE CALL
  ┌──────────┐     ┌──────────────────┐     ┌─────────────┐     ┌─────────────┐
  │ Browser  │     │  Gemini chat     │     │  RAG over   │     │  Edge-TTS   │
  │ STT      │ ──▶ │  flash-lite (3.1)│ ──▶ │  Appendix A │ ──▶ │  neural     │
  │ 8 langs  │     │  + 4-layer       │     │  embedding-2│     │  Aria/      │
  │          │     │  prompt          │     │  cached     │     │  Neerja/    │
  └──────────┘     │  + fallback      │     └─────────────┘     │  Swara/...  │
                   │  chain on 429    │                          └─────────────┘
                   └────────┬─────────┘
                            │   on call end
                            ▼
AFTER THE CALL
  ┌────────────────┐    ┌──────────────────────────────┐
  │ Classifier     │    │  Handoff                     │
  │ (same chain,   │ ─▶ │  ├─ HOT  → warm transfer      │
  │  structured    │    │  │         + WhatsApp link    │
  │  JSON output,  │    │  ├─ WARM → comparison sheet   │
  │  7 signals)    │    │  │         + scheduled cb     │
  └────────────────┘    │  ├─ COLD → 14-day nurture     │
                        │  └─ DND  → suppress, no msg   │
                        └──────────────────────────────┘
```

`ARCHITECTURE.md` has the full Mermaid diagrams (request flows, DB schema, file map).

---

## 8. Lead Qualification — 7 Signals

The classifier scores each on `[0.0, 1.0]`:

| Signal | Weight | Positive cue |
| --- | --- | --- |
| Stated intent | High+ | "send the link", "sign me up", "kaise start karoon" |
| Engagement | Med+ | >90s, 30–60% talk ratio |
| Network size | Med+ | 20+ clients OR audience >2k |
| Objection pattern | High | Detailed objections = positive (real interest) |
| Affirmative cues | Med+ | "interesting", "tell me more", "achha" |
| Deferrals | Neg− | "call me later" with no specifics |
| Hang-up behaviour | Neg− | <30s cut, abrupt end, hostile tone |

Thresholds → bucket → `next_action`:
- **Hot:** explicit signup OR (high engagement + 20+ clients + no unresolved objections) → `warm_transfer`
- **Warm:** engaged through ≥2 objections, no signup → `whatsapp_link_sent`
- **Cold:** early disconnect, vague deferrals → `nurture_sequence`
- **DND-trigger:** "remove my number" → `dnd`

---

## 9. Demo Personas (4 scenario keys, dialer-driven)

| Key | Resulting bucket | Simulated lead behaviour |
| --- | --- | --- |
| `hot_advisor` | HOT | Engaged advisor with ~15 clients; explicit "send me the signup link" |
| `warm_mfd` | WARM | Hindi-speaking MFD; asks for comparison sheet on WhatsApp |
| `cold_busy` | COLD | Influencer who defers without a specific time |
| `dnd_hostile` | DND | "Remove my number" — internal DND, no WhatsApp |

CSV bundles for upload-testing live in [`demo_leads/`](demo_leads/). The downloadable template in the dashboard generates a fresh 2-HOT / 1-WARM / 1-COLD roster on each click.

---

## 10. Round 2 Checklist

- [x] GitHub repo public, README with judge tour + setup/run/architecture
- [x] Working prototype demonstrating real-time, two-way, contextual conversation
- [x] Appendix A ingested into RAG (gemini-embedding-2)
- [x] Multilingual: 8 langs (English/Hindi/Hinglish + Tamil/Telugu/Marathi/Gujarati/Bengali)
- [x] 5 core objections handled contextually
- [x] Hot/Warm/Cold classification with confidence + rationale
- [x] Post-call summary + handoff payload
- [x] RM dashboard with funnel + transcripts + drilldown drawer
- [x] WhatsApp auto-send for Hot/Warm/Cold (mocked, persists Appendix §9 templates)
- [x] Batch lead upload + queue processing through real LLM
- [x] Multi-turn cross-call memory (prior-call context in prompt)
- [x] Live deploy on Render (backend) + Vercel (frontend)
- [x] Model fallback chain so demo doesn't 429 mid-call
- [ ] 5-min video walkthrough recorded
- [x] All code committed during hackathon (clean commit history)

---

## 11. Key Files for New Sessions

| Path | What it is |
| --- | --- |
| [`README.md`](README.md) | 60-second judge tour, rubric mapping |
| [`APPENDIX_A.md`](APPENDIX_A.md) | Agent's KB — script, FAQ, hard facts, objection rebuttals, tax/GST, RISE Portal, partner economics |
| [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) | This file |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Mermaid diagrams of the full system |
| [`DEPLOY.md`](DEPLOY.md) | Render + Vercel deploy steps |
| [`PLAN.md`](PLAN.md) | 13-phase build plan with status tracker |
| [`demo_leads/README.md`](demo_leads/README.md) | The 3 ready-to-upload CSV bundles |

---

## 12. Constraints & Honest Disclosures

- **Appendix A** is drafted from publicly available Rupeezy sources. If organizers release an official Appendix A, it replaces this wholesale (retrieval index rebuilds from the file, no code change).
- **WhatsApp** is mocked — every "send" persists a `whatsapp_log` row with `status='sent_mock'` and the rendered template body. Real Cloud API wiring is stubbed.
- **No real telephony** — judges explicitly accept browser voice / text simulation. We use Web Speech API for STT and Edge-TTS for output. Dialer runs scripted scenarios through the real LLM + RAG + scoring pipeline so the demo is end-to-end real, not Wizard-of-Oz.
- **All code was written during the hackathon window**, per Theme 7 rules. See git history.
- **Free-tier-first** — only paid surface is Gemini, which the model fallback chain spreads across multiple quota pools.

---

## 13. User / Team

- Working on Windows 11, PowerShell shell
- Project root: `C:\Users\anany\rupeezy-voice-agent`
- GitHub: `AmanG-04/rupeezy-voice-agent` (public)
- Deploy URLs:
  - Backend: `https://rupeezy-voice-agent-wciq.onrender.com`
  - Frontend: `https://rupeezy-voice-agent.vercel.app`
