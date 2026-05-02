# Rupeezy AI Voice Agent — Project Context

This file is the single source of truth for what we're building. Read this first in any new session.

---

## 1. The Hackathon

- **Theme 7:** AI Voice Agent for Partner Lead Conversion
- **Company:** Rupeezy (stockbroker running a partner program)
- **Round 1:** Written solution submitted (PDF at `C:\Users\anany\Downloads\AI_Voice_Agent_Round1_Solution.pdf`)
- **Round 2 deliverables:**
  - Working prototype/demo
  - 5-minute video walkthrough
  - Code repository (GitHub/GitLab) — all code written during hackathon, no pre-built solutions
- **Team size:** 2 members

---

## 2. The Problem (Short Version)

Rupeezy's partner program (zero joining fee, 100% brokerage share, daily payouts via RISE Portal) converts only **18% of leads**. The product is competitive — the failure is structural:

1. **Timing collapse** — leads arriving after-hours sit untouched; 5-min contact converts 9x better than 30-min.
2. **Language ceiling** — RMs speak 1–2 languages; addressable market is 20+ Indian languages.
3. **Queue overflow** — one RM = one call at a time; 200-lead surges create 3-day backlogs.

**Goal:** Build an AI voice agent that calls every lead within minutes in their language, pitches the program, handles 5 core objections, qualifies as Hot/Warm/Cold, and hands hot leads to a human RM with full context. Target: lift conversion 18% → 40%+.

---

## 3. The 5 Core Objections (from Appendix A)

1. "I'm already with another broker"
2. "I don't have enough contacts"
3. "What if my clients face issues — who handles support?"
4. "Is Rupeezy trustworthy?"
5. "I'll think about it / call me later"

Agent must adapt rebuttals contextually — never sound scripted.

---

## 4. Required Capabilities

- **Multilingual:** Hindi, English, Hinglish minimum. Regional (Tamil, Telugu, Marathi, Gujarati, Bengali) = bonus.
- **Objection handling:** Contextual, not if/else.
- **Lead qualification:** Score interest, readiness, network size → Hot / Warm / Cold.
- **Handoff:** Warm transfer simulation OR WhatsApp signup link. RM gets full conversation context.
- **Post-call summary:** Duration, topics, objections, score, next action.
- **Multi-turn memory:** Remember context across calls to the same lead.
- **Dashboard:** Conversion funnel (contacted → qualified → handed to RM), H/W/C breakdowns, transcripts.

---

## 5. Tech Stack (Final — Free Tier Only)

User has **Gemini Pro API key** + free tiers everywhere. No paid services.

| Layer | Tech | Why |
|---|---|---|
| Voice transport | **LiveKit Cloud** (free tier) | WebRTC rooms, browser + telephony path |
| Voice loop | **Gemini Live API** (native audio) | Speech-in → speech-out in one WebSocket. Replaces Deepgram + ElevenLabs. |
| Live conversation brain | **Gemini 2.5 Flash** | Low latency, multilingual, streaming |
| Heavy reasoning (post-call) | **Gemini 2.5 Pro** | Summary + H/W/C scoring |
| Objection classifier | **Gemini 2.0 Flash-Lite** | Cheap, fast, runs parallel to LLM |
| Embeddings (RAG) | **Gemini `text-embedding-004`** | Same API key |
| Backend | **FastAPI** (Python) + async workers | |
| Queue | **Redis Streams** or in-memory for hackathon | Decouple call-end from analytics |
| Database | **Supabase** free tier (Postgres + pgvector) | One store for structured + vector |
| Frontend | **React + Vite + Tailwind** | Deploy on Vercel free |
| WhatsApp | **Meta Cloud API sandbox** | Free test numbers |
| Repo | **GitHub** (public) | |

**Explicitly NOT using:** Deepgram, ElevenLabs, OpenAI, Anthropic — all replaced by Gemini.

---

## 6. Architecture (6 Layers)

```
CLIENT LAYER
  Browser Voice (WebRTC)  |  RM Dashboard  |  WhatsApp Cloud API
              ↓
VOICE / MEDIA LAYER
  LiveKit (WebRTC rooms) — telephony-ready via SIP adapter
              ↓
AGENT RUNTIME
  Gemini Live API (STT+LLM+TTS native)  |  Objection Classifier (Gemini Flash-Lite, parallel)
  Turn-level conversation manager — barge-in, silence detection, interrupts
              ↓
KNOWLEDGE & MEMORY
  Appendix A KB (pgvector)  |  Lead Profile DB  |  Call History DB
              ↓
POST-CALL PIPELINE (async queue)
  Transcription → Summarize → Qualify (H/W/C) → Route/Handoff
  Writes: Transcript DB · Summary · Score · Handoff payload
              ↓
ANALYTICS & DASHBOARD
  Funnel view · H/W/C breakdown · Transcripts · RM UI
```

**Key design choices:**
- Post-call pipeline is **async** — never blocks the call ending.
- Objection classifier runs **parallel** to main LLM — no added latency.
- Knowledge base is **vector-indexed** — Appendix A updates without redeploy.
- Lead profile DB is **separate** from call session — gives persistent memory across calls.

---

## 7. Lead Qualification Model

**Signals (vector, not single score):**
- Stated intent ("sign me up", "send link") — high weight
- Objection pattern (asked for details vs dismissed) — high weight
- Engagement duration (talk ratio, call length) — medium
- Network size (self-reported clients/AUM) — medium
- Affirmative cues ("interesting", "tell me more") — medium
- Deferrals ("call me later") — negative
- Hang-up behavior (early cut vs natural close) — negative

**Thresholds:**
- **Hot:** Explicit signup intent OR (high engagement + 20+ clients + no unresolved objections) → RM immediately
- **Warm:** Engaged through 2+ objections, no explicit yes/no → WhatsApp link + scheduled follow-up
- **Cold:** Early disconnect, hard rejection, <60s engagement → 14-day nurture sequence

---

## 8. Build Order (My Recommendation — Text-First)

The doc starts with voice loop. I recommend **text chat first** — faster iteration on conversation quality, voice is just delivery.

1. **Text chat prototype** — Gemini + system prompt with Rupeezy pitch + 5 objections hardcoded. Validate brain in 2 hours.
2. **Add voice layer** — Gemini Live API + LiveKit. English only.
3. **Ground in Appendix A** — pgvector + RAG. Prevents hallucination.
4. **Multilingual** — Hindi + Hinglish via Gemini Live native; prompt mirrors user language.
5. **Post-call pipeline** — async worker: transcript → summary → H/W/C score → DB write.
6. **RM dashboard** — React page: leads, scores, summaries, transcripts. The "wow" moment.
7. **Handoff + WhatsApp** — warm transfer sim + auto-send link for Warm leads.
8. **Persistent cross-call memory** — lead profile DB, second-call context.
9. **Batch upload + demo polish** — for the 5-min video.

**Cut if short on time:** cross-call memory, regional languages, real WhatsApp (mock it).
**Never cut:** RAG on Appendix A, post-call scoring, RM dashboard.

---

## 9. Key Risks + Mitigations

| Risk | Mitigation |
|---|---|
| Voice loop latency > 1.5s kills conversational feel | Stream everything, target <800ms first-audio, parallel classifier |
| Hallucinated facts (wrong brokerage %) | RAG every turn + hardcode critical facts in system prompt |
| "Is this a bot?" trust issue | Don't deny — say "Yes, AI from Rupeezy, want to talk to a human?" |
| Regional language quality drift | Ship Hindi/English/Hinglish first; gate regional behind 50-call human review |
| SEBI/TRAI compliance | Restrict to AP program pitch only, no investment advice, DND check before dial |
| RM busy when handoff triggered | Fall back to "RM will call back in 10 min" + WhatsApp link |
| Gemini Live session length limits (free tier) | Calls are 2–5 min — well under limit |

---

## 10. Round 2 Checklist

- [ ] GitHub repo public, README with setup/run/architecture
- [ ] Working voice or text prototype demonstrating real-time, two-way, contextual conversation
- [ ] Appendix A ingested into KB + RAG wired in
- [ ] Multilingual: Hindi + English + Hinglish working
- [ ] 5 objections handled contextually
- [ ] Hot/Warm/Cold classification working
- [ ] Post-call summary generated
- [ ] RM dashboard with funnel + transcripts + handoff view
- [ ] WhatsApp auto-send for Warm leads (or mocked)
- [ ] Batch lead upload feature
- [ ] 5-min video walkthrough recorded
- [ ] All code committed during hackathon (clean commit history)

---

## 11. User Context

- Email: ananya.verma.may22@gmail.com
- Working on Windows 11, PowerShell shell
- Has Gemini Pro API key + free tiers of LiveKit, Supabase, Vercel, etc.
- Round 1 PDF location: `C:\Users\anany\Downloads\AI_Voice_Agent_Round1_Solution.pdf`
- Project root: `C:\Users\anany\rupeezy-voice-agent`
