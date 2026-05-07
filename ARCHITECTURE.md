# Architecture — Rupeezy AI Voice Agent

> Complete graphical reference for the system as deployed (May 2026). All
> phases shipped, voice path uses Web Speech STT + Edge-TTS neural voices,
> chat models walk a fallback chain on 429. All diagrams are GitHub-rendered Mermaid.
>
> Read this end-to-end after `README.md` and before `PLAN.md`. It's the single
> map between *"what does the codebase do"* and *"where does the bytes flow"*.

---

## 1. System overview — the boxes and the wires

```mermaid
flowchart LR
    subgraph Client["Browser — Chrome or Edge"]
        ChatPg["/chat page"]
        VoicePg["/voice page"]
        DashPg["/dashboard page"]
        EdgeTtsSpk["EdgeTtsSpeaker<br/>fetch + AudioContext<br/>word-level reveal"]
        SpeechRec["SpeechRecognition<br/>Web Speech API"]
    end

    subgraph Frontend["Frontend — Vite + React + TS — Vercel"]
        ApiTs["lib/api.ts + apiBase.ts<br/>typed fetch + SSE parser"]
        Components["components<br/>FunnelHeader, LeadsTable,<br/>LeadDrawer, HandoffPanel,<br/>UploadLeadsModal,<br/>PipelineDiagram"]
    end

    subgraph Backend["Backend — FastAPI + uvicorn — Render"]
        Router["routers<br/>agent · dashboard · tts · meta"]
        AgentEng["app/agent<br/>conversation engine<br/>+ fallback chain<br/>system_prompt builder<br/>lead_memory · dialer"]
        Scoring["app/scoring<br/>classifier · handoff"]
        RAG["app/rag<br/>retriever · embeddings"]
        EdgeTts["app/tts<br/>edge_tts_route<br/>11 neural voices"]
        WApp["app/whatsapp<br/>MockSender + templates"]
        DB["app/db<br/>SQLAlchemy ORM + repo"]
    end

    subgraph External["External services"]
        Gemini["Google Gemini API<br/>3.1-flash-lite-preview (chat primary)<br/>3-flash-preview (chat fallback 1)<br/>2.5-flash-lite (chat fallback 2)<br/>embedding-2 — RAG"]
        EdgeTtsCloud["Microsoft Edge TTS<br/>public neural endpoint<br/>(no API key)"]
        SQLite[("SQLite<br/>backend/data/rupeezy.db")]
        AppendixMD["APPENDIX_A.md<br/>source of truth"]
    end

    Client -->|HTTPS / SSE| Frontend
    ChatPg -.HMR.-> ApiTs
    VoicePg -.HMR.-> ApiTs
    DashPg -.HMR.-> ApiTs
    SpeechRec -->|user utterance text| VoicePg
    EdgeTtsSpk <-->|MP3 stream| VoicePg

    Frontend -->|VITE_API_BASE| Backend
    Router --> AgentEng
    Router --> Scoring
    Router --> WApp
    Router --> EdgeTts
    Router --> DB

    AgentEng --> RAG
    AgentEng --> Gemini
    Scoring --> Gemini
    RAG --> Gemini
    EdgeTts --> EdgeTtsCloud

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

**Three boundaries that matter:**

1. **Frontend ↔ Backend** — browser uses Vite's `/api` proxy in dev, absolute `VITE_API_BASE` URL in prod (Vercel → Render). Frontend never speaks to Gemini directly; API keys never leave the server.
2. **Backend ↔ Gemini** — main outbound. Walks the model fallback chain on 429.
3. **Backend ↔ Microsoft Edge TTS** — public neural endpoint, no API key. Streamed back to the browser as MP3.

Everything else is local: SQLite, Appendix-A markdown, in-process agent state, embedding cache.

---

## 2. Layer map — what lives where

```mermaid
flowchart TB
    subgraph L1["Layer 1 — Client surfaces"]
        direction LR
        L1A["/chat<br/>SSE text stream<br/>+ objection chips"]
        L1B["/voice<br/>STT + Edge-TTS neural<br/>word-level text reveal"]
        L1C["/dashboard<br/>funnel · leads · drilldown<br/>+ batch upload"]
        L1D["/<br/>landing<br/>+ demo seed CTA<br/>+ pipeline diagram"]
    end

    subgraph L2["Layer 2 — Voice and Media"]
        direction LR
        L2A["browser SpeechRecognition<br/>STT, free, 8 langs"]
        L2B["AudioContext queue<br/>per-sentence MP3"]
        L2C["Edge-TTS proxy<br/>11 neural voices<br/>per-language picker"]
    end

    subgraph L3["Layer 3 — Conversation engine — Phases 2 and 10"]
        direction LR
        L3A["stream_user_turn<br/>Gemini chat with history<br/>+ system prompt + RAG hits"]
        L3B["build_prompt_parts<br/>4 layers — persona,<br/>prior-call, base, retrieved"]
        L3C["lead_memory<br/>cross-call context"]
    end

    subgraph L4["Layer 4 — Knowledge and Memory — Phases 1 and 4"]
        direction LR
        L4A["RAG store<br/>31 chunks · 3072-dim<br/>cosine top-k"]
        L4B["Lead profile DB<br/>conversations · messages<br/>handoff_records · whatsapp_log"]
        L4C["APPENDIX_A.md<br/>re-ingestable"]
    end

    subgraph L5["Layer 5 — Post-call pipeline — Phases 3 and 8"]
        direction LR
        L5A["classify_conversation<br/>Gemini structured output<br/>H W C + signals"]
        L5B["build_handoff<br/>HandoffRecord per Appendix 7"]
        L5C["choose_next_action<br/>warm_transfer / WhatsApp<br/>nurture / DND"]
        L5D["WhatsApp MockSender<br/>renders Appendix 9 template<br/>+ logs to DB"]
    end

    subgraph L6["Layer 6 — Analytics and Dashboard — Phases 5 and 9"]
        direction LR
        L6A["funnel_counts<br/>contacted/engaged/qualified"]
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
    participant U as User browser
    participant F as ChatPage React
    participant B as FastAPI routes
    participant E as Conversation engine
    participant R as Retriever RAG
    participant G as Gemini API
    participant DB as SQLite

    U->>F: types message
    F->>B: POST /api/conversations/{id}/turn body text
    B->>E: stream_user_turn conv_id, text, k=2
    E->>E: should_retrieve text — yes
    E->>R: retrieve text, k=2
    R->>G: POST embedContent — gemini-embedding-2
    G-->>R: embedding 3072 floats
    R-->>E: top-2 hits — sections 4.1 and 3.1
    E->>E: build_prompt_parts — persona + base + retrieved, dedup vs base
    E->>G: POST streamGenerateContent — gemini-3.1-flash-lite-preview (chain)
    G-->>E: SSE chunks token stream
    E-->>B: yield text pieces
    B-->>F: SSE event token — CRLF delimited
    F-->>U: bubble updates live
    G-->>E: stream complete
    E->>DB: persist_conversation messages + state
    B-->>F: SSE event done
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
    participant F as ChatPage or VoicePage
    participant B as routes.py
    participant E as Engine
    participant CL as Classifier scoring/classifier.py
    participant H as Handoff scoring/handoff.py
    participant W as WhatsApp MockSender
    participant DB as SQLite
    participant G as Gemini API

    F->>B: POST /end body ended_by
    B->>E: store.end conv_id, ended_by
    B->>H: build_handoff conversation
    H->>CL: classify_conversation messages
    CL->>G: generateContent — 3.1-flash-lite-preview (chain) with response_schema, temp 0.2, JSON only
    G-->>CL: structured JSON — bucket, signals, summary, discovery, objections
    CL-->>H: Classification + Discovery + ObjectionRaised list
    H->>H: choose_next_action — hard-rejection check then bucket-to-action
    H-->>B: HandoffRecord — Appendix §7.1
    B->>DB: persist_conversation
    B->>DB: persist_handoff — denorm cols + payload_json
    alt next_action is warm_transfer, whatsapp_link_sent or nurture_sequence
        B->>W: get_sender.send handoff
        W->>W: select_template — HOT 9.1, WARM 9.2, COLD-nurture 9.3, DND skipped
        opt not skipped
            W->>DB: persist_whatsapp_log status sent_mock
        end
    end
    B-->>F: response — conversation, handoff, optional handoff_error
    F->>F: setHandoff record — HandoffPanel slides in
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
    participant U as User speaks
    participant SR as SpeechRecognition browser
    participant V as VoicePage
    participant B as Backend
    participant E as Engine + sentence buffer
    participant TTS as Edge-TTS neural endpoint
    participant AP as EdgeTtsSpeaker AudioContext queue

    U->>SR: spoken utterance
    SR-->>V: onresult (final transcript)
    V->>B: POST /turn/audio<br/>{ text, language }
    B->>E: stream_user_turn_with_audio(...)

    loop For each text chunk from Gemini chat
        E-->>B: yield text chunk
        B-->>V: SSE event token
        V->>V: transcript bubble updates

        E->>E: append to sentence buffer
        alt sentence break detected — period bang or 90 chars
            E->>TTS: synthesize sentence — voice per language
            TTS-->>E: 24kHz PCM bytes
            E->>E: wrap in WAV header
            E-->>B: yield audio wav_bytes
            B-->>V: SSE event audio base64
            V->>AP: enqueue wavB64
            AP->>AP: decodeAudioData then schedule at currentTime gapless
            AP-->>U: speaker
        end
    end

    Note over E,TTS: First audio plays ~5-7s after user speaks. TTS-bound, not LLM-bound.
```

**TTS resolution (final):** we shipped `edge-tts` instead of Gemini's
`flash-preview-tts`. Microsoft Edge's public neural endpoint is free,
no API key, ~200ms first-byte, and has 11 Indian-language voices —
strictly better for the demo than the original Aoede plan. The frontend
falls back to Web Speech API if the Edge endpoint is unreachable. See
`app/tts/edge_tts_route.py` and `frontend/src/lib/edgeTtsSpeaker.ts`.

---

## 6. Batch upload + dialer — Phase 9

```mermaid
sequenceDiagram
    autonumber
    participant RM as RM the user
    participant M as UploadLeadsModal
    participant B as Backend
    participant Q as dialer queue
    participant D as dial_next
    participant E as Conversation engine
    participant H as Handoff pipeline
    participant W as WhatsApp
    participant DB as SQLite

    RM->>M: drag CSV or pick file
    M->>B: POST /api/dashboard/leads/batch — multipart/form-data
    B->>B: parse CSV utf-8-sig BOM-tolerant — normalise phone digits
    loop Per row
        B->>DB: find_lead_by_phone phone
        alt phone unseen
            B->>DB: upsert_lead
            B->>Q: enqueue QueuedLead
        else duplicate
            Note over B: skipped count plus 1
        end
    end
    B-->>M: response — inserted, skipped, errors

    RM->>M: click Process queue
    loop While queue not empty, every 4s
        M->>B: POST /leads/dial-next
        B->>D: dial_next
        D->>Q: pop next queued lead
        D->>E: store.create + run SCRIPT — Hi, advisor with 15 clients then Send me the link
        E-->>D: conversation complete
        D->>H: build_handoff — full pipeline
        H-->>D: HandoffRecord
        D->>DB: persist_conversation + persist_handoff
        D->>W: get_sender.send handoff
        W->>DB: persist_whatsapp_log
        D-->>B: result — conv_id, bucket, etc
        B-->>M: dial result
        M->>M: refresh queue + funnel + leads
    end
    M-->>RM: live funnel populates — HOT, WARM, COLD update
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
        string body_text
        int char_count
        blob embedding
        int embed_dim
    }

    LEADS {
        string id PK
        string name
        string phone
        string language_pref
        datetime created_at
        bool dnd
        datetime last_called_at
    }

    CONVERSATIONS {
        string id PK
        string lead_id FK
        datetime started_at
        datetime ended_at
        int duration_sec
        string language_used
        string channel
        string ended_by
    }

    MESSAGES {
        int id PK
        string conversation_id FK
        int turn
        string role
        string body_text
        string audio_url
        datetime created_at
    }

    HANDOFF_RECORDS {
        int id PK
        string conversation_id FK
        string bucket
        float confidence
        string summary_short
        string next_action
        string payload_json
        datetime created_at
    }

    WHATSAPP_LOG {
        int id PK
        string conversation_id FK
        string template_id
        string body
        string to_phone
        datetime sent_at
        string status
        string response_payload
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
    subgraph Ingest["Ingest — one-shot, about 5s"]
        MD["APPENDIX_A.md<br/>14 sections"]
        Chunker["chunker.py<br/>H2 split, H3 split for §4 and §10<br/>content-hashed chunk_id"]
        EmbedClient["embeddings.py<br/>gemini-embedding-2<br/>on-disk cache by hash<br/>retry w/ exponential backoff"]
        Store[("SQLite<br/>appendix_chunks<br/>+ embeddings_cache")]
        MD --> Chunker
        Chunker -->|31 chunks| EmbedClient
        EmbedClient -->|3072-dim vec| Store
    end

    subgraph Retrieve["Retrieve — per-turn, about 150ms"]
        Query["user text"]
        ShortCircuit{"should_retrieve?<br/>has question mark or trigger word<br/>or length 80+"}
        QueryEmbed["embed_query<br/>cache hit ~95% after warmup"]
        Cosine["matrix dot q<br/>31 by 3072 cosine"]
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
    subgraph Built["build_prompt_parts output — about 4.4 to 5K tokens"]
        P1["LAYER 1 — Persona and Non-negotiables<br/>2720 chars, post-trim<br/>8 compliance rules<br/>style + language matching<br/>output discipline"]
        P1b["LAYER 1b — Prior-call context — Phase 10<br/>only if lead_id has completed prior call<br/>last bucket and summary<br/>unresolved Qs + objections<br/>known discovery facts"]
        P2["LAYER 2 — Always-on Appendix<br/>13902 chars across sections<br/>1, 2, 3, 3.1, 5, 6, 8<br/>openers, spine, hard facts,<br/>fee disclosure, qualification,<br/>CTAs, compliance"]
        P3["LAYER 3 — Retrieved context<br/>top-2 RAG hits, deduped vs base<br/>objection rebuttal section 4.x<br/>edge case section 10.x<br/>or 0 chars if low-content turn"]
        P1 --> P1b
        P1b --> P2
        P2 --> P3
    end

    History["Conversation history<br/>role-tagged messages<br/>linear growth per turn"]
    UserText["User new message"]

    P3 -->|system_instruction| Gemini(("Gemini<br/>3.1-flash-lite-preview (chain)"))
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
│   │   │   └── edge_tts_route.py    ← Edge-TTS proxy, 11 neural voices
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
│       │   ├── chat.tsx             ← SSE text stream + objection chips
│       │   ├── voice.tsx            ← STT + Edge-TTS + word-level reveal
│       │   └── dashboard.tsx        ← funnel + upload modal + drilldown
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
    subgraph Done["DONE — merged on origin/main"]
        direction TB
        d0["P0 — Bootstrap"]
        d1["P1 — RAG, 92% top-1"]
        d2["P2 — Text agent, Appendix-grounded"]
        d3["P3 — H/W/C scoring + handoff"]
        d4["P4 — SQLite persistence"]
        d5["P5 — RM Dashboard"]
        d7["P7 — Multilingual hardened"]
        d71["P7.1 — Token optimization, minus 50 percent"]
        d8["P8 — WhatsApp mock"]
        d9["P9 — Batch upload + dialer"]
        d10["P10 — Cross-call memory"]
    end

    subgraph Partial["PARTIAL — deferred"]
        direction TB
        p6["P6 — Voice loop<br/>code complete<br/>latency/quota deferred"]
    end

    subgraph Pending["REMAINING"]
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
