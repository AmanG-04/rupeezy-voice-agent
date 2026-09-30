# Portfolio demo upgrade

## Scope

This is a public demonstration of English/Hinglish lead qualification. Rupeezy is the sample business. Visitors can configure an agent for a fictional business without changing other visitors' conversation settings. Custom knowledge is direct prompt context; the sample uses the existing RAG index.

The author built the project. The original hackathon brief listed a two-person team; personal contribution claims should reflect the actual work.

## What changed

- Supported google.genai async streaming and structured generation replace the retired Gemini SDK.
- Blocking retrieval runs off the event loop. Conversation writes and post-call writes use thread offloading.
- New conversations are persisted immediately and restored with messages/settings after a restart.
- Real lead identity is separate from conversation identity. Legacy payloads still work.
- Repeated call-end requests reuse the persisted handoff. Single-process per-conversation locks serialize turn/end requests.
- Explicit English/Hinglish opt-outs persist suppression independently of model summaries. Hesitation alone is not DND.
- Uploaded leads attach to conversations. Queued simulations persist in Postgres; interrupted work becomes visibly failed instead of silently being repeated.
- `/sample` is an authored, interactive example with no API calls. It works while Render sleeps or API quota is exhausted.
- `/configure` saves per-tab business settings for new live conversations.
- Handoffs show exact transcript evidence and label model certainty as uncalibrated. Human corrections and notes preserve the original AI classification.
- Voice interruption cancels pending requests, stops playback, and resumes listening. TTS cancellation releases AudioContext resources.
- Dashboard table scrolls on mobile; keyboard selection, dialog focus management, clearer captions, and reduced-motion support improve accessibility.
- Ordinary pytest is offline by default; external tests require `--live`.
- GitHub Actions runs backend checks and the frontend build without API credentials.
- The evaluation workbench scores recorded predictions; its 24 authored development cases have no claimed benchmark results.

## Deploy configuration

Keep the existing Vercel and Render services. No additional services are required.

Render variables:

```text
DATABASE_URL=<existing Supabase PostgreSQL connection string>
GEMINI_API_KEY=<existing AI Studio key>
BACKEND_CORS_ORIGINS=https://rupeezy-voice-agent.vercel.app
GEMINI_CHAT_MODEL=gemini-3.1-flash-lite-preview
GEMINI_FALLBACKS_ENABLED=false
GEMINI_RPM_LIMIT=12
GEMINI_DAILY_REQUEST_LIMIT=450
WHATSAPP_MODE=mock
```

Use the exact API model ID your AI Studio project supports; a display name in the quota table is not an API identifier. The local environment's gemini-3.1-flash-lite ID passed the approved live checks below. The application fallback default is retained for compatibility; set GEMINI_CHAT_MODEL explicitly to the verified ID on Render.

The new demo_sessions and demo_jobs tables are additive and created by the existing startup schema initializer. Existing tables are not dropped. The PostgreSQL user needs CREATE TABLE permission. Back up your demo database before deployment.

Vercel retains its existing VITE_API_BASE setting. Deploy only after local checks pass. This upgrade has not been committed, pushed, or deployed automatically.

## Free-tier behavior and limits

The default primary-model request guard uses 12 RPM and 450 requests/day, below the supplied 15 RPM and 500 RPD. Conversation and classification share it. It resets on process restart and does not meter tokens; Google remains the quota authority. Fallbacks are disabled by default because their quotas differ. Keep API project billing disabled if zero paid usage is required. A Google AI subscription is separate from API billing.

Render sleeping is expected. No always-on worker, scheduled callback, real phone call, or WhatsApp delivery is promised. Closing a tab persists the dropped conversation without running classification. Explicitly ending a call runs the analysis. The public dashboard is shared demo data, not an authenticated CRM; use fictional inputs only. This is not tenant-isolated storage.

## Verification and remaining work

230 offline tests passed; 13 external-service tests were skipped. Ruff and the production frontend build passed. Tests cover persistence recovery, repeated call closes, queue recovery, cancelled-stream persistence, exact evidence, opt-outs, human review, provider overload retries, and evaluation metrics.

An automated headless Edge check passed at 1440px and 390px: sample turn progression, evidence dialog, Escape dismissal, configuration labels, and horizontal overflow. Re-run after building with:

```powershell
backend/.venv311/Scripts/python.exe scripts/browser_smoke.py --browser "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

The browser script blocks API and Google-font requests. A screenshot was captured locally, but this agent session cannot inspect image inputs. Microphone, actual speech playback, and visual design still require interactive verification. Approved live Gemini checks are documented below.

### Approved live verification (September 30, 2026)

The configured API model reported by the local environment was gemini-3.1-flash-lite. A live smoke check passed for custom-business English answers, a mid-conversation Hinglish switch, correct refusal of job guarantees, Hot/Warm/Cold classification, AI disclosure, and the sample's fee disclosure. Four successful streaming turns had first-token times of 3.14–4.01 seconds on this machine; this is a tiny local sample, not a p50/p95 benchmark or audio-latency measurement.

Initial runs encountered provider 503 overload errors. Bounded exponential-backoff retries now handle transient 5xx errors, spending a guarded request per attempt. Streaming retries only occur before any user-visible text; partial responses never restart silently. Custom-business instructions were tightened after a live reply was too long.

The existing 12-query retrieval development check scored 11/12 top-1 matches (92%). The competitor-switch query retrieved its expected section second. No held-out accuracy or conversion improvement is claimed. These checks used an isolated local SQLite application database and did not mutate the deployed Supabase demo.

Future work that is not included in this demo pass: authenticated private workspaces, database migrations for existing-column changes, provider token-budget metering, cross-worker durable processing claims, automatic retry policies, generated OpenAPI client types, calibrated confidence, a held-out 60–100-case human-reviewed benchmark, hybrid retrieval comparisons, recorded latency benchmarks, microphone-based echo-aware barge-in, and a recorded walkthrough video.

See evaluation/README.md for the evaluation procedure. Do not claim improved real-world conversion, accuracy, or latency until measured.
