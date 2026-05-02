# Frontend — Rupeezy Voice Agent

React + Vite + TypeScript + Tailwind. Three pages:

| Route | Phase | Purpose |
|-------|-------|---------|
| `/` | 0 | Landing — links to the three demo surfaces, shows backend health |
| `/chat` | 2 | Text-chat conversation demo |
| `/voice` | 6 | Browser voice call (LiveKit) |
| `/dashboard` | 5 | RM dashboard — funnel, leads, transcripts, handoff |

## Quick start

```powershell
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

`/api/*` and `/health` are proxied to `http://localhost:8000` in dev (see `vite.config.ts`).

## Build

```powershell
npm run build
npm run preview
```
