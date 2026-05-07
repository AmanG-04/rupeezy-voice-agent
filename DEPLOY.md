# Deploy

> Goal: a single public URL judges can click. Backend on **Render** (free), frontend on **Vercel** (free). Total time end-to-end ≈ 15 minutes once you have accounts.

## Prerequisites

- A GitHub account with this repo pushed (✅ done)
- A Render account → <https://render.com>
- A Vercel account → <https://vercel.com>
- Your Gemini API key

---

## 1. Backend — Render

1. **New → Web Service** → connect your GitHub → pick this repo.
2. Render will auto-detect `render.yaml` at the repo root and pre-fill most fields. Confirm:
   - **Name**: `rupeezy-voice-agent` (or anything — gives you `<name>.onrender.com`)
   - **Region**: pick the one closest to where judges will sit (Singapore for India)
   - **Branch**: `main`
   - **Plan**: Free
3. **Environment variables** — click "Advanced" and add:

   | Key | Value |
   | --- | --- |
   | `GEMINI_API_KEY` | your real key from <https://aistudio.google.com/app/apikey> |
   | `BACKEND_CORS_ORIGINS` | leave empty for now — you'll fill this in step 3 once you have the Vercel URL |

4. Click **Create Web Service**. First build takes ~3–5 minutes (installs `edge-tts`, `google-generativeai`, `numpy`, etc.).

5. When the log says `Application startup complete`, hit `https://<your-render-name>.onrender.com/health` in a browser — should return `{"status":"ok"}`. **Copy this URL.**

> **Free-tier note**: the service spins down after ~15 min idle and cold-starts on the next request (~30s wake). Tell judges "the first request takes a moment" or warm it before the demo.

---

## 2. Frontend — Vercel

1. **Add New → Project** → import this same GitHub repo.
2. Vercel reads `vercel.json` from the repo root and pre-fills:
   - **Framework Preset**: Other (the JSON overrides this)
   - **Build Command**: `cd frontend && npm install && npm run build`
   - **Output Directory**: `frontend/dist`
3. **Environment variables** — add one:

   | Key | Value |
   | --- | --- |
   | `VITE_API_BASE` | the Render URL from step 1 (e.g. `https://rupeezy-voice-agent.onrender.com`) |

4. Click **Deploy**. First build takes ~30s.

5. When done, Vercel gives you a URL like `https://rupeezy-voice-agent.vercel.app`. **Copy it.**

---

## 3. Wire CORS

Back in **Render → your service → Environment**:

- Edit `BACKEND_CORS_ORIGINS`. Set to your Vercel URL — comma-separated if you have multiple (e.g. preview + prod):

  ```
  https://rupeezy-voice-agent.vercel.app
  ```

- Hit **Save Changes**. Render redeploys automatically (~2 min).

---

## 4. Smoke-test

Open your Vercel URL. You should see the landing page. Three quick checks:

- [ ] Click **Run live demo** — funnel populates with HOT/WARM/COLD/DND. (Backend + RAG + classifier all working.)
- [ ] Click **Voice call**, hit the mic, say "Hello" — Aria replies with a neural voice. (Edge-TTS + STT working.)
- [ ] Open the browser console: should see no CORS errors.

If voice fails but text chat works, it's almost always CORS — re-check that the Vercel URL in `BACKEND_CORS_ORIGINS` matches exactly (no trailing slash, correct protocol).

---

## What persists, what doesn't

| Thing | Persists across redeploys? |
| --- | --- |
| Your GitHub source | Yes |
| Render env vars | Yes |
| Vercel env vars | Yes |
| Backend SQLite (`backend/data/rupeezy.db`) | **No** — Render free tier wipes the disk on each redeploy. The demo seed regenerates everything anyway. |
| Embedding cache (`backend/data/embed_cache.json`) | **No** — same reason. Costs ~30 embedding calls on first use after each redeploy (well within free quota). |

If you ever want persistent state, upgrade Render to a paid disk ($7/mo) and mount it at `/var/data`.

---

## Updating

Push to `main`. Both Vercel and Render auto-redeploy on push. No manual step.

---

## Costs

Both free tiers are sufficient for the hackathon. The only paid surface is Gemini, where:

- `flash-lite` chat completions: 30 RPM free
- `embedding-001`: cached after first use; free quota is 1500/day

A judge running the full demo (4 leads × ~2 turns + 1 classifier each + 1 embedding lookup per lead) costs roughly **12 LLM calls and 4 embedding calls** — under 1% of the daily free allowance.
