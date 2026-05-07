# Supabase persistence — 5-minute setup

> Use this when you want lead/conversation/handoff data to **survive Render redeploys**. SQLite (the default) wipes on each push; Supabase Postgres doesn't.

By default the backend uses SQLite (zero ops, perfect for local dev). Setting `DATABASE_URL` to a Supabase Postgres connection string flips the same SQLAlchemy code over to Postgres — same models, same migrations, no code change.

---

## 1. Create the Supabase project (~2 min)

1. Go to <https://supabase.com> → sign up / log in (free tier, no card).
2. Click **New project**.
3. Fill in:
   - **Name**: `rupeezy-voice-agent` (or anything)
   - **Database Password**: generate a strong one — **copy it now**, you'll need it in step 2
   - **Region**: pick the one closest to your Render region (Singapore for India)
   - **Plan**: Free
4. Click **Create new project**. Wait ~1 min for it to provision.

## 2. Get the connection string (~30 sec)

1. In your project, sidebar → **Project Settings** (gear icon at the bottom-left)
2. → **Database** tab
3. Scroll to **Connection string** section
4. Click the **URI** tab (not "PSQL", not "Golang")
5. Pick **Transaction** mode (the pooler) — this is what Render free-tier worker should use.
6. The string looks like:

   ```
   postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
   ```

7. Replace `[YOUR-PASSWORD]` with the password you saved in step 1. **Copy the full string.**

> Notes:
> - The "Transaction" pooler (port 6543) is the right one for short-lived web requests.
> - The "Session" pooler (port 5432) works too but is meant for long-lived connections.
> - The "Direct connection" string also works but burns more of your free-tier connection budget.

## 3. Paste into Render (~30 sec)

1. <https://dashboard.render.com> → your `rupeezy-voice-agent` service
2. Sidebar → **Environment**
3. Find `DATABASE_URL` (already declared in `render.yaml` but unset)
4. Click **Edit** → paste the full connection string from step 2 → **Save Changes**

Render auto-redeploys in ~2 min. Once "Deploy live", every conversation, lead, handoff, and WhatsApp log persists across pushes.

## 4. Verify (~30 sec)

Open `https://rupeezy-voice-agent-wciq.onrender.com/health` — should return `{"status":"ok"}`.

In Render's deploy log, you should see one line like:

```
db engine init: dialect=postgresql+psycopg host=aws-0-ap-south-1.pooler.supabase.com:6543/postgres
```

If you see `dialect=sqlite` instead, the env var didn't take — re-check the value, hit Save Changes, wait for the redeploy.

To prove persistence: open the dashboard, run a few leads through Process queue, then push any tiny code change to `main`. After the redeploy, the dashboard still shows those leads.

---

## Failure modes & fixes

| Symptom in Render logs | Cause | Fix |
| --- | --- | --- |
| `password authentication failed` | Connection string still has `[YOUR-PASSWORD]` literal | Replace it with your real password |
| `Network is unreachable` / `connection refused` | Wrong region / pooler URL | Use the URI from your project's Settings → Database, not from somewhere else |
| `relation "conversations" does not exist` on first request | Tables not yet created | Backend auto-runs `Base.metadata.create_all` on startup. If you see this *during* a request, it means startup hadn't finished — wait 10s, retry. |
| `too many connections` | Too many Render workers + Supabase free-tier limit | Use the Transaction pooler URI (port 6543), not the direct connection (port 5432) |

## What persists, what doesn't (revised)

| Thing | Persists across Render redeploys? |
| --- | --- |
| Conversations, transcripts, handoffs, WhatsApp logs | ✅ **Yes** (now in Supabase Postgres) |
| Embedding cache (`backend/data/embed_cache.json`) | ❌ Still ephemeral — rebuilds on first RAG call after redeploy. Costs ~30 embedding API calls, free quota covers it easily. |
| In-memory dialer queue (the `Process queue` button's progress) | ❌ Resets — but you're not redeploying mid-batch in the demo, so this doesn't matter |

---

## Going back to SQLite

Just unset `DATABASE_URL` on Render and redeploy. The engine falls back to the SQLite default. Your Supabase data stays in Supabase — you can switch back any time.
