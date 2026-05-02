import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';

interface Health {
  status: string;
}

interface Version {
  version: string;
  chat_model: string;
  reasoning_model: string;
  embedding_model: string;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [version, setVersion] = useState<Version | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/health').then((r) => r.json() as Promise<Health>),
      fetch('/api/version').then((r) => r.json() as Promise<Version>),
    ])
      .then(([h, v]) => {
        setHealth(h);
        setVersion(v);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-rupeezy-accent flex items-center justify-center font-bold text-white">
            R
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Rupeezy AI Voice Agent</h1>
        </div>
        <p className="text-slate-400 mb-8">
          Multilingual partner-program lead conversion. Built for the PanIIT AI for Bharat hackathon — Theme 7.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <Link
            to="/chat"
            className="rounded-xl bg-rupeezy-card border border-slate-800 p-5 hover:border-rupeezy-accent transition-colors"
          >
            <div className="text-sm text-slate-400 mb-1">Phase 2 →</div>
            <div className="font-semibold">Text chat</div>
            <div className="text-xs text-slate-500 mt-1">Conversation engine demo</div>
          </Link>
          <Link
            to="/voice"
            className="rounded-xl bg-rupeezy-card border border-slate-800 p-5 hover:border-rupeezy-accent transition-colors"
          >
            <div className="text-sm text-slate-400 mb-1">Phase 6 →</div>
            <div className="font-semibold">Voice call</div>
            <div className="text-xs text-slate-500 mt-1">LiveKit + Gemini Live</div>
          </Link>
          <Link
            to="/dashboard"
            className="rounded-xl bg-rupeezy-card border border-slate-800 p-5 hover:border-rupeezy-accent transition-colors"
          >
            <div className="text-sm text-slate-400 mb-1">Phase 5 →</div>
            <div className="font-semibold">RM dashboard</div>
            <div className="text-xs text-slate-500 mt-1">Funnel · transcripts · handoff</div>
          </Link>
        </div>

        <div className="rounded-xl bg-rupeezy-card border border-slate-800 p-5">
          <div className="text-sm font-semibold text-slate-300 mb-3">Backend status</div>
          {error && <div className="text-rupeezy-hot text-sm">Cannot reach backend: {error}</div>}
          {health && version && (
            <div className="space-y-1.5 text-sm">
              <Row k="health" v={health.status} ok />
              <Row k="version" v={version.version} />
              <Row k="chat model" v={version.chat_model} />
              <Row k="reasoning model" v={version.reasoning_model} />
              <Row k="embedding model" v={version.embedding_model} />
            </div>
          )}
          {!health && !error && <div className="text-slate-500 text-sm">Connecting…</div>}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between font-mono text-xs">
      <span className="text-slate-500">{k}</span>
      <span className={ok ? 'text-emerald-400' : 'text-slate-300'}>{v}</span>
    </div>
  );
}
