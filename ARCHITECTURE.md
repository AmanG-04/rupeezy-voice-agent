# Architecture — Rupeezy AI Voice Agent

> Complete graphical reference for the system. Every phase (0–10) shipped, plus
> Phase 6 voice (partial-deferred). All diagrams are GitHub-rendered Mermaid.
>
> Read this end-to-end after `README.md` and before `PLAN.md`. It's the single
> map between *"what does the codebase do"* and *"where does the bytes flow"*.

---

## 1. System overview — the boxes and the wires

```mermaid
flowchart LR
    subgraph Client[" Browser (Chrome / Edge) "]
        ChatPg[/chat<br/>page/]
        VoicePg[/voice<br/>page/]
        DashPg[/dashboard<br/>page/]
        AudioPlayer["AudioQueuePlayer<br/>Web Audio API"]
        SpeechRec["SpeechRecognition<br/>Web Speech API"]
    end

    subgraph Frontend["Frontend (Vite + React + TypeScript)<br/>:5173"]
        ApiTs["lib/api.ts<br/>typed fetch + SSE parser"]
        Components["components/<br/>FunnelHeader, LeadsTable,<br/>LeadDrawer, HandoffPanel,<br/>UploadLeadsModal"]
    end

    subgraph Backend["Backend (FastAPI + uvicorn)<br/>:8000"]
        Router["routers<br/>agent · dashboard · meta"]
        AgentEng["app/agent<br/>conversation engine<br/>system_prompt builder<br/>lead_memory<br/>dialer"]
        Scoring["app/scoring<br/>classifier · handoff"]
        RAG["app/rag<br/>retriever · embeddings"]
        TTS["app/tts<br/>gemini_tts (Aoede)"]
        WApp["app/whatsapp<br/>MockSender + templates"]
        DB["app/db<br/>SQLAlchemy ORM + repo"]
    end

    subgraph External[" External services "]
        Gemini["Google Gemini API<br/>– flash-lite-latest (chat)<br/>– flash-lite (classifier)<br/>– embedding-001 (RAG)<br/>– flash-preview-tts (Aoede)"]
        SQLite[("SQLite<br/>backend/data/rupeezy.db")]
        AppendixMD[/"APPENDIX_A.md<br/>(source of truth)"/]
    end

    Client -->|HTTP / SSE| Frontend
    ChatPg -.HMR.-> ApiTs
    VoicePg -.HMR.-> ApiTs
    DashPg -.HMR.-> ApiTs
    SpeechRec -->|user utterance text| VoicePg
    AudioPlayer <-->|WAV chunks| VoicePg

    Frontend -->|/api proxy| Backend
    Router --> AgentEng
    Router --> Scoring
    Router --> WApp
    Router --> DB

    AgentEng --> RAG
    AgentEng --> TTS
    AgentEng --> Gemini
    Scoring --> Gemini
    RAG --> Gemini
    TTS --> Gemini

    AgentEng --> DB
    Scoring --> DB
    WApp --> DB
    DB --> SQLite

    RAG -.ingest at startup.-> AppendixMD

    style Client fill:#1E293B,stroke:#6366F1,color:#fff
    style Frontend fill:#0F172A,stroke:#6366F1,color:#fff
    style Backend fill:#0B1220,stroke:#6366F1,color:#fff
    style External fill:#1E293B,stroke:#F59E0B,color:#fff
```

**Two boundaries that matter:**

1. **Frontend ↔ Backend** — browser uses Vite's `/api` proxy in dev. Frontend
   never speaks to Gemini directly; the API key never leaves the server.
2. **Backend ↔ Gemini** — the only outbound network. Everything else is local
   (SQLite, Appendix-A markdown, in-process agent state).

---

## 2. Layer map — what lives where

```mermaid
flowchart TB
    subgraph L1[" Layer 1 — Client surfaces (3 demo pages) "]
        direction LR
        L1A["/chat<br/>SSE text stream"]
        L1B["/voice<br/>STT + Gemini Aoede TTS<br/>(deferred polish)"]
        L1C["/dashboard<br/>funnel · leads · drilldown"]
    end

    subgraph L2[" Layer 2 — Voice & Media (Phase 6) "]
        direction LR
        L2A["browser SpeechRecognition<br/>(STT, free)"]
        L2B["Web Audio API queue<br/>(gapless WAV playback)"]
        L2C["Gemini flash-preview-tts<br/>Aoede voice<br/>(per-sentence streaming)"]
    end

    subgraph L3[" Layer 3 — Conversation engine (Phases 2 + 10) "]
        direction LR
        L3A["stream_user_turn()<br/>Gemini chat with history<br/>+ system prompt + RAG hits"]
        L3B["build_prompt_parts()<br/>4 layers:<br/>persona / prior-call /<br/>base / retrieved"]
        L3C["lead_memory<br/>(cross-call context)"]
    end

    subgraph L4[" Layer 4 — Knowledge & Memory (Phase 1 + 4) "]
        direction LR
        L4A["RAG store<br/>31 chunks · 3072-dim<br/>cosine top-k"]
        L4B["Lead profile DB<br/>conversations · messages<br/>handoff_records · whatsapp_log"]
        L4C["APPENDIX_A.md<br/>(re-ingestable)"]
    end

    subgraph L5[" Layer 5 — Post-call pipeline (Phase 3 + 8) "]
        direction LR
        L5A["classify_conversation()<br/>Gemini structured output<br/>H/W/C + signals"]
        L5B["build_handoff()<br/>HandoffRecord (Appendix §7)"]
        L5C["choose_next_action()<br/>warm_transfer / WhatsApp /<br/>nurture / DND"]
        L5D["WhatsApp MockSender<br/>renders §9 template<br/>+ logs to DB"]
    end

    subgraph L6[" Layer 6 — Analytics & Dashboard (Phase 5 + 9) "]
        direction LR
        L6A["funnel_counts()<br/>contacted/engaged/qualified"]
        L6B["LeadDrawer<br/>handoff + transcript + WhatsApp"]
        L6C["UploadLeadsModal<br/>+ dialer worker"]
    end

    L1 --> L2
    L1 --> L3
    L2 --> L3
    L3 --> L4
    L3 --> L5
    L5 --> L4
    L4 --> L6
    L5 --> L6

    style L1 fill:#0F172A,stroke:#6366F1,color:#fff
    style L2 fill:#1E293B,stroke:#6366F1,color:#fff
    style L3 fill:#0F172A,stroke:#10B981,color:#fff
    style L4 fill:#1E293B,stroke:#F59E0B,color:#fff
    style L5 fill:#0F172A,stroke:#EF4444,color:#fff
    style L6 fill:#1E293B,stroke:#6366F1,color:#fff
```

The hackathon brief asked for these six layers. We shipped all of them.

---

## 3. End-to-end request flow — single chat turn

What actually happens when the user types `"I'm with Zerodha why switch?"`:

```mermaid
sequenceDiagram
    autonumber
    participant U as User<br/>(browser)
    participant F as ChatPage<br/>(React)
    participant B as FastAPI<br/>(routes.py)
    participant E as Conversation<br/>engine
    participant R as Retriever<br/>(RAG)
    participant G as Gemini API
    participant DB as SQLite

    U->>F: types message
    F->>B: POST /api/conversations/{id}/turn<br/>{ text }
    B->>E: stream_user_turn(conv_id, text, k=2)
    E->>E: _should_retrieve(text) ? yes
    E->>R: retrieve(text, k=2)
    R->>G: POST /v1beta/.../embedContent<br/>(gemini-embedding-001)
    G-->>R: embedding (3072 floats)
    R-->>E: top-2 hits<br/>[§4.1, §3.1]
    E->>E: build_prompt_parts()<br/>– persona + base + retrieved<br/>– dedup retrieved vs base
    E->>G: POST /v1beta/.../streamGenerateContent<br/>(gemini-flash-lite-latest)
    G-->>E: SSE chunks (token stream)
    E-->>B: yield text pieces
    B-->>F: SSE event: token<br/>(CRLF-delimited)
    F-->>U: bubble updates live
    G-->>E: stream complete
    E->>DB: persist_conversation()<br/>messages + state
    B-->>F: SSE event: done
```

**Key facts:**

- Single turn = **2 outbound Gemini calls** (1 embed + 1 chat)
  - "hi" / one-word / no question marks → embedding skipped → just 1 call
- System prompt size is **~4.4–5K tokens** (post-Phase-7-optimization)
- First-token latency: **~1.0–1.5s** depending on retrieval cache hit
- Backend never blocks; all I/O is async

---

## 4. End-of-call pipeline — what `/end` does

```mermaid
sequenceDiagram
    autonumber
    participant F as ChatPage / VoicePage
    participant B as routes.py
    participant E as Engine
    participant CL as Classifier<br/>(scoring/classifier.py)
    participant H as Handoff<br/>(scoring/handoff.py)
    participant W as WhatsApp<br/>MockSender
    participant DB as SQLite
    participant G as Gemini API

    F->>B: POST /api/conversations/{id}/end<br/>{ ended_by }
    B->>E: store.end(conv_id, ended_by)
    B->>H: build_handoff(conversation)
    H->>CL: classify_conversation(messages)
    CL->>G: generateContent<br/>(flash-lite-latest, response_schema)<br/>– temp 0.2, JSON only
    G-->>CL: structured JSON<br/>{bucket, signals, summary,<br/>discovery, objections}
    CL-->>H: Classification + Discovery<br/>+ list[ObjectionRaised]
    H->>H: choose_next_action()<br/>– hard-rejection check<br/>– bucket → action mapping
    H-->>B: HandoffRecord<br/>(Appendix §7.1)
    B->>DB: persist_conversation()
    B->>DB: persist_handoff()<br/>– denorm cols + payload_json
    alt next_action ∈ {warm_transfer,<br/>whatsapp_link_sent,<br/>nurture_sequence}
        B->>W: get_sender().send(handoff)
        W->>W: select_template()<br/>HOT → §9.1<br/>WARM → §9.2<br/>COLD-nurture → §9.3<br/>DND → skipped
        opt not skipped
            W->>DB: persist_whatsapp_log<br/>status=sent_mock
        end
    end
    B-->>F: { conversation, handoff, handoff_error? }
    F->>F: setHandoff(record)<br/>HandoffPanel slides in
```

**Why the chain is best-effort:**

- `/end` always succeeds the conversation close (status update + DB persist)
- Classifier / WhatsApp can fail — we log + return `handoff_error`, frontend
  still shows transcript even with no scoring
- A 429 on Gemini Pro → automatic flash-lite fallback (we made this primary
  in the perf pass)

---

## 5. Voice loop — Phase 6 (partial-deferred)

```mermaid
sequenceDiagram
    autonumber
    participant U as User<br/>(speaks)
    participant SR as SpeechRecognition<br/>(browser)
    participant V as VoicePage
    participant B as Backend
    participant E as Engine + sentence buffer
    participant TTS as Gemini Aoede<br/>flash-preview-tts
    participant AP as AudioQueuePlayer<br/>(Web Audio API)

    U->>SR: spoken utterance
    SR-->>V: onresult (final transcript)
    V->>B: POST /turn/audio<br/>{ text, language }
    B->>E: stream_user_turn_with_audio(...)

    loop For each text chunk from Gemini chat
        E-->>B: yield ("text", chunk)
        B-->>V: SSE event: token
        V->>V: transcript bubble updates

        E->>E: append to sentence buffer
        alt sentence_break detected (.!?:; or 90 chars)
            E->>TTS: synthesize(sentence, voice=Aoede)
            TTS-->>E: 24kHz PCM bytes
            E->>E: wrap in WAV header
            E-->>B: yield ("audio", wav_bytes)
            B-->>V: SSE event: audio (base64)
            V->>AP: enqueue(wavB64)
            AP->>AP: decodeAudioData → schedule<br/>at currentTime (gapless)
            AP-->>U: speaker
        end
    end

    Note over E,TTS: First audio plays<br/>~5–7s after user speaks<br/>(TTS-bound, not LLM-bound)
```

**What's deferred to Phase 11 polish:** the latency floor on
`gemini-2.5-flash-preview-tts` is ~5s/sentence and free-tier daily quota is
tight. Two options on the table — hybrid Aoede + browser-TTS fallback, or
swap to ElevenLabs for the demo recording. Either way, the *architecture*
above is what stays — only the TTS provider behind `app/tts/` changes.

---

## 6. Batch upload + dialer — Phase 9

```mermaid
sequenceDiagram
    autonumber
    participant RM as RM (you)
    participant M as UploadLeadsModal
    participant B as Backend
    participant Q as dialer._queue
    participant D as dial_next()
    participant E as Conversation engine
    participant H as Handoff pipeline
    participant W as WhatsApp
    participant DB as SQLite

    RM->>M: drag CSV / pick file
    M->>B: POST /api/dashboard/leads/batch<br/>multipart/form-data
    B->>B: parse CSV (utf-8-sig BOM-tolerant)<br/>normalise phone (+digits)
    loop Per row
        B->>DB: find_lead_by_phone(phone)
        alt phone unseen
            B->>DB: upsert_lead(...)
            B->>Q: enqueue(QueuedLead)
        else duplicate
            Note over B: skipped++
        end
    end
    B-->>M: { inserted, skipped, errors[] }

    RM->>M: click "Process queue ▷"
    loop While queue not empty (every 4s)
        M->>B: POST /leads/dial-next
        B->>D: dial_next()
        D->>Q: pop next queued lead
        D->>E: store.create() + run SCRIPT<br/>("Hi, I'm advisor with 15 clients..."<br/>→ "Send me the link...")
        E-->>D: conversation complete
        D->>H: build_handoff() (full pipeline)
        H-->>D: HandoffRecord
        D->>DB: persist_conversation + persist_handoff
        D->>W: get_sender().send(handoff)
        W->>DB: persist_whatsapp_log
        D-->>B: { conv_id, bucket, ... }
        B-->>M: dial result
        M->>M: refresh queue + funnel + leads
    end
    M-->>RM: live funnel populates<br/>HOT/WARM/COLD update
```

**Why one-lead-per-HTTP-call instead of a true background worker:** Gemini
free-tier RPM is tight. A serial worker loops ~25-40s per lead. Driving
from the frontend with a 4s poll lets the user pause / stop, see live
progress in the funnel, and keeps the call fan-out under control.

---

## 7. Database schema (SQLAlchemy ORM)

```mermaid
erDiagram
    LEADS ||--o{ CONVERSATIONS : "has many"
    CONVERSATIONS ||--o{ MESSAGES : "ordered turns"
    CONVERSATIONS ||--o| HANDOFF_RECORDS : "0 or 1"
    CONVERSATIONS ||--o{ WHATSAPP_LOG : "follow-ups"
    APPENDIX_CHUNKS {
        string chunk_id PK
        string section
        string heading
        text   text
        int    char_count
        blob   embedding "3072 floats"
        int    embed_dim
    }

    LEADS {
        string   id PK
        string   name
        string   phone
        string   language_pref
        datetime created_at
        bool     dnd
        datetime last_called_at
    }

    CONVERSATIONS {
        string   id PK
        string   lead_id FK "nullable"
        datetime started_at
        datetime ended_at "nullable"
        int      duration_sec
        string   language_used
        string   channel "text|voice|batch"
        string   ended_by "agent|lead|dropped"
    }

    MESSAGES {
        int      id PK
        string   conversation_id FK
        int      turn
        string   role "user|assistant"
        text     text
        string   audio_url "nullable"
        datetime created_at
    }

    HANDOFF_RECORDS {
        int      id PK
        string   conversation_id FK "unique"
        string   bucket "hot|warm|cold"
        float    confidence
        text     summary_short
        string   next_action
        text     payload_json "full HandoffRecord"
        datetime created_at
    }

    WHATSAPP_LOG {
        int      id PK
        string   conversation_id FK
        string   template_id "hot|warm|cold_nurture"
        text     body "rendered template"
        string   to_phone
        datetime sent_at
        string   status "sent_mock|sent_cloud_api|failed|skipped"
        text     response_payload "nullable"
    }
```

**Two stores, one DB file.**

- `appendix_chunks` is the RAG vector index (separate from app data so it
  re-ingests independently).
- The 5 app tables form a tight tree from `Lead → Conversation → {Message,
  HandoffRow, WhatsappLog}`.
- `payload_json` on HandoffRecord is the source of truth; the denormalised
  columns (bucket, confidence, summary, next_action) are for fast dashboard
  filtering without parsing JSON.

---

## 8. RAG ingestion + retrieval

```mermaid
flowchart LR
    subgraph Ingest["Ingest (one-shot, ~5s)"]
        MD[/"APPENDIX_A.md<br/>14 sections"/]
        Chunker["chunker.py<br/>– H2 split<br/>– H3 split for §4 / §10<br/>– content-hashed chunk_id"]
        EmbedClient["embeddings.py<br/>– gemini-embedding-001<br/>– on-disk cache by hash<br/>– retry w/ exponential backoff"]
        Store[(SQLite<br/>appendix_chunks<br/>+ embeddings_cache/)]
        MD --> Chunker
        Chunker -->|31 chunks| EmbedClient
        EmbedClient -->|3072-dim vec| Store
    end

    subgraph Retrieve["Retrieve (per-turn, ~150ms)"]
        Query["user text"]
        ShortCircuit{should_retrieve?<br/>– has '?' or trigger word<br/>– or len ≥ 80}
        QueryEmbed["embed_query()<br/>(cache hit ~95%<br/>after warmup)"]
        Cosine["matrix @ q<br/>(31 × 3072 dot product)"]
        TopK["top-2 hits<br/>filter dups vs base"]
        Query --> ShortCircuit
        ShortCircuit -->|skip| Done["no retrieval"]
        ShortCircuit -->|retrieve| QueryEmbed
        Store -.load matrix once.- QueryEmbed
        QueryEmbed --> Cosine
        Cosine --> TopK
    end

    style Ingest fill:#0F172A,stroke:#F59E0B,color:#fff
    style Retrieve fill:#1E293B,stroke:#10B981,color:#fff
```

**Why this scales fine for a hackathon:**

- 31 chunks × 3072 floats = ~380KB in memory — load once at first query
- Cosine similarity on 31 chunks = sub-millisecond after embedding
- Embedding cache means re-running ingest on an unchanged Appendix is free
- 92% top-1 retrieval accuracy verified live (12-query test, see Phase 1)

---

## 9. System prompt — what we send Gemini per turn

```mermaid
flowchart TB
    subgraph Built[" build_prompt_parts() output (~4.4–5K tokens) "]
        P1["LAYER 1 — Persona & Non-negotiables<br/>(2,720 chars, post-trim)<br/>– 8 compliance rules<br/>– style + language matching<br/>– output discipline"]
        P1b["LAYER 1b — Prior-call context (Phase 10)<br/>(only if lead_id has completed prior call)<br/>– last bucket / summary<br/>– unresolved Qs + objections<br/>– known discovery facts"]
        P2["LAYER 2 — Always-on Appendix<br/>(13,902 chars across §1, §2, §3,<br/>§3.1, §5, §6, §8)<br/>– openers, spine, hard facts,<br/>fee disclosure, qualification,<br/>CTAs, compliance"]
        P3["LAYER 3 — Retrieved context<br/>(top-2 RAG hits, deduped vs base)<br/>– objection rebuttal §4.x<br/>– edge case §10.x<br/>– or 0 chars if low-content turn"]
        P1 --> P1b
        P1b --> P2
        P2 --> P3
    end

    History["Conversation history<br/>(role-tagged messages,<br/>linear growth per turn)"]
    UserText["User's new message"]

    P3 -->|system_instruction| Gemini((Gemini<br/>flash-lite-latest))
    History -->|chat history| Gemini
    UserText -->|new message| Gemini

    Gemini -->|streamed tokens| Out["assistant response"]

    style Built fill:#0F172A,stroke:#6366F1,color:#fff
    style Gemini fill:#1E293B,stroke:#F59E0B,color:#fff
```

**Phase 7 token-optimization stats** (per turn input):

| Scenario | Before | After | Cut |
|---|---|---|---|
| `"hi"` (no RAG) | 6,963 tok | **4,421 tok** | 36% |
| `"why switch from Zerodha?"` (k=2 RAG) | 9,924 tok | **5,035 tok** | 49% |
| `"what does it cost?"` (k=2 RAG, dedup) | 9,924 tok | **4,421 tok** | 55% |

---

## 10. File map — what's in each directory

```
rupeezy-voice-agent/
├── APPENDIX_A.md                    ← agent's source of truth (compressed)
├── PROJECT_CONTEXT.md               ← hackathon brief
├── PLAN.md                          ← 13-phase build plan + status tracker
├── ARCHITECTURE.md                  ← this file
├── README.md                        ← quick-start + tech stack
├── docker-compose.yml               (deleted — IndicF5 attempt reverted)
│
├── backend/                         ← FastAPI service, port 8000
│   ├── pyproject.toml               ← Python deps
│   ├── app/
│   │   ├── main.py                  ← lifespan, CORS, router include
│   │   ├── config.py                ← pydantic-settings env loader
│   │   ├── agent/                   ← Phase 2, 9, 10
│   │   │   ├── conversation.py      ← turn engine + history mgmt
│   │   │   ├── system_prompt.py     ← 4-layer prompt builder
│   │   │   ├── lead_memory.py       ← Phase 10: cross-call context
│   │   │   ├── dialer.py            ← Phase 9: scripted call worker
│   │   │   └── routes.py            ← /api/conversations/* endpoints
│   │   ├── rag/                     ← Phase 1
│   │   │   ├── chunker.py           ← H2/H3 markdown splitter
│   │   │   ├── embeddings.py        ← Gemini embedding client + disk cache
│   │   │   ├── store.py             ← SQLite chunk store
│   │   │   ├── retriever.py         ← top-k cosine
│   │   │   └── cli.py               ← `python -m app.rag.cli "..."`
│   │   ├── scoring/                 ← Phase 3
│   │   │   ├── schemas.py           ← Pydantic for HandoffRecord
│   │   │   ├── classifier.py        ← Gemini structured output
│   │   │   └── handoff.py           ← assembler + next-action chooser
│   │   ├── tts/                     ← Phase 6
│   │   │   └── gemini_tts.py        ← Aoede TTS + WAV wrapper
│   │   ├── whatsapp/                ← Phase 8
│   │   │   ├── __init__.py          ← public re-exports
│   │   │   └── sender.py            ← Mock + CloudApi senders, templates
│   │   ├── db/                      ← Phase 4
│   │   │   ├── engine.py            ← SQLAlchemy engine + session_scope
│   │   │   ├── models.py            ← 5 ORM models
│   │   │   └── repo.py              ← typed read/write helpers
│   │   ├── dashboard/               ← Phase 5 + 9
│   │   │   └── routes.py            ← /api/dashboard/* (funnel, leads, batch)
│   │   └── livekit/                 ← Phase 6 (kept empty stub)
│   ├── tests/                       ← 41 passing
│   │   ├── test_smoke.py
│   │   ├── test_chunker.py
│   │   ├── test_retrieval.py        (skipped without GEMINI_API_KEY)
│   │   ├── test_persistence.py
│   │   ├── test_handoff.py
│   │   ├── test_agent.py            (skipped without GEMINI_API_KEY)
│   │   ├── test_lead_memory.py      ← Phase 10
│   │   ├── test_whatsapp.py         ← Phase 8
│   │   └── test_batch_upload.py     ← Phase 9
│   └── data/                        ← gitignored — SQLite + cache
│
├── frontend/                        ← Vite + React + Tailwind, port 5173
│   ├── package.json
│   ├── vite.config.ts               ← proxy /api + /health → :8000
│   ├── tailwind.config.js           ← rupeezy theme tokens
│   └── src/
│       ├── main.tsx                 ← Router setup
│       ├── App.tsx                  ← landing page
│       ├── pages/
│       │   ├── chat.tsx             ← Phase 2: SSE text stream
│       │   ├── voice.tsx            ← Phase 6: STT + Aoede playback
│       │   └── dashboard.tsx        ← Phase 5 + 9: funnel + upload modal
│       ├── components/
│       │   ├── FunnelHeader.tsx     ← stages + bucket chips
│       │   ├── LeadsTable.tsx       ← row per lead
│       │   ├── LeadDrawer.tsx       ← drilldown + WhatsApp section
│       │   ├── HandoffPanel.tsx     ← shared between drawer + chat
│       │   ├── UploadLeadsModal.tsx ← Phase 9 batch upload
│       │   └── Placeholder.tsx
│       └── lib/
│           ├── api.ts               ← typed client + SSE parser
│           ├── speech.ts            ← Web Speech API shims
│           └── audioPlayer.ts       ← Web Audio queue (gapless WAV)
│
├── scripts/
│   ├── ingest_appendix.py           ← chunk + embed + write
│   ├── seed_demo_data.py            ← 15 fake leads for empty-DB demos
│   ├── demo_chat.py                 ← scripted scenarios
│   └── demo_handoff.py              ← end-to-end pipeline demo
│
└── demo_transcripts/                ← captured live runs
    ├── phase2.md                    ← English MFD scenario
    ├── phase3.md                    ← all 3 buckets H/W/C
    ├── phase7.md                    ← multilingual + mid-call switch
    ├── handoff_hot.json
    ├── handoff_warm.json
    └── handoff_cold.json
```

---

## 11. Phase coverage matrix

```mermaid
flowchart LR
    subgraph Done[" 🟢 Done & merged on origin/main "]
        direction TB
        d0["P0 — Bootstrap"]
        d1["P1 — RAG (92% top-1)"]
        d2["P2 — Text agent (Appendix-grounded)"]
        d3["P3 — H/W/C scoring + handoff"]
        d4["P4 — SQLite persistence"]
        d5["P5 — RM Dashboard"]
        d7["P7 — Multilingual hardened"]
        d71["P7.1 — Token optimization (-50%)"]
        d8["P8 — WhatsApp mock"]
        d9["P9 — Batch upload + dialer"]
        d10["P10 — Cross-call memory"]
    end

    subgraph Partial[" 🟡 Partial / deferred "]
        direction TB
        p6["P6 — Voice loop<br/>code complete · latency/quota deferred"]
    end

    subgraph Pending[" ⚪ Remaining "]
        direction TB
        n11["P11 — Polish + README + deploy"]
        n12["P12 — 5-min video walkthrough"]
    end

    Done --> Partial
    Partial --> Pending

    style Done fill:#0F172A,stroke:#10B981,color:#fff
    style Partial fill:#1E293B,stroke:#F59E0B,color:#fff
    style Pending fill:#0B1220,stroke:#64748B,color:#fff
```

**Sustained tests:** 19 → 23 → 29 → 33 → **41 passing** (every phase added
its own coverage; no regressions).

---

## 12. What it costs to run a single demo end-to-end

For one full conversation: chat → end → handoff → WhatsApp:

| Step | API calls | Tokens (in) | Tokens (out) | Wall time |
|---|---|---|---|---|
| Open chat (no API hit) | 0 | – | – | <50ms |
| Turn 1 ("hi") | 1 chat | ~4.4k | ~80 | ~1.5s |
| Turn 2 (objection w/ ?) | 1 embed + 1 chat | ~5k | ~150 | ~2.5s |
| Turn 3 (cost question) | 1 embed + 1 chat | ~4.4k (dedup) | ~250 | ~2.5s |
| Turn 4 (close) | 1 embed + 1 chat | ~4.5k | ~80 | ~1.5s |
| End / classify | 1 chat (flash-lite) | ~3k | ~600 | ~5s |
| WhatsApp render | 0 (local) | – | – | <50ms |
| **Per conversation** | **~7 calls** | **~21k** | **~1.2k** | **~13s** |

For the dialer running 5 leads (queue processing): ~70s + 4s of poll
intervals = ~85s total wall time.

Free-tier daily quotas comfortably cover ~50 demo conversations / day on
this plan — well above what a hackathon recording session needs.

---

## 13. Mental model for the judges (3 sentences)

> The system is a **layered pipeline**, not a monolith: every turn passes
> through *retrieval → reasoning → persistence → optional notification*.
> The Appendix is the **single source of truth** — every fact-bearing claim
> retrieves a chunk before responding, and the chunks are content-hashed
> so swapping in an official Rupeezy script means rerunning one ingest
> command. The post-call **scoring stage is deliberately a separate model
> call** (different temperature, structured-output schema), so conversation
> quality and qualification quality optimize independently.
