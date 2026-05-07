import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowUpRight, MessageSquare, Mic, LayoutDashboard, CircleCheck, CircleAlert } from 'lucide-react';
import { Brand } from './components/Brand';

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
    <div className="min-h-screen flex flex-col bg-rupeezy-ink relative overflow-hidden">
      {/* Ambient background — radial glow, slow gradient. Pure decoration. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-glow-accent opacity-60"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-rupeezy-accent/[0.06] blur-3xl"
      />

      <header className="relative z-10 border-b border-rupeezy-border-subtle">
        <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between">
          <Brand size="md" />
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/AmanG-04/rupeezy-voice-agent"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs text-rupeezy-fg-muted hover:text-rupeezy-fg transition-colors"
            >
              GitHub
              <ArrowUpRight size={12} />
            </a>
            <span className="text-xs text-rupeezy-fg-faint font-mono hidden md:inline">
              PanIIT · AI for Bharat · Theme 7
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col">
        {/* Hero */}
        <section className="max-w-6xl w-full mx-auto px-8 pt-24 pb-16">
          <div className="max-w-3xl">
            <div className="eyebrow mb-5">AI voice agent for partner lead conversion</div>
            <h1 className="font-serif text-5xl sm:text-6xl text-rupeezy-fg leading-[1.05] mb-7">
              An agent that calls every lead{' '}
              <span className="italic text-rupeezy-fg-muted">in their language</span>,
              within minutes.
            </h1>
            <p className="text-rupeezy-fg-muted text-lg leading-relaxed max-w-2xl">
              Rupeezy's Authorized Person program converts only 18% of leads — not because
              the product is weak, but because RM-driven calling can't keep up with timing,
              language, and queue capacity. This agent removes those bottlenecks.
            </p>
          </div>
        </section>

        {/* Navigation cards */}
        <section className="max-w-6xl w-full mx-auto px-8 pb-16">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NavCard
              to="/chat"
              icon={<MessageSquare size={18} />}
              kicker="Phase 2"
              title="Text chat"
              blurb="Real-time, contextual, multilingual. Same brain as the voice path."
            />
            <NavCard
              to="/voice"
              icon={<Mic size={18} />}
              kicker="Phase 6"
              title="Voice call"
              blurb="Browser STT into the agent, sentence-streamed audio back."
            />
            <NavCard
              to="/dashboard"
              icon={<LayoutDashboard size={18} />}
              kicker="Phase 5"
              title="RM dashboard"
              blurb="Conversion funnel, lead drilldown, full handoff context."
            />
          </div>
        </section>

        {/* System status — production-style status panel */}
        <section className="max-w-6xl w-full mx-auto px-8 pb-24">
          <div className="glass-card rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="eyebrow mb-1">System status</div>
                <div className="text-sm text-rupeezy-fg">
                  Backend services & model configuration
                </div>
              </div>
              <StatusPill state={error ? 'error' : health ? 'live' : 'connecting'} />
            </div>

            {error && (
              <div className="text-xs text-rupeezy-hot font-mono mb-4">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-rupeezy-border rounded-lg overflow-hidden">
              <StatRow
                label="API"
                value={health ? 'reachable' : '—'}
                ok={Boolean(health)}
              />
              <StatRow
                label="Backend version"
                value={version?.version ?? '—'}
              />
              <StatRow
                label="Chat model"
                value={version?.chat_model ?? '—'}
                truncate
              />
              <StatRow
                label="Embedding model"
                value={version?.embedding_model ?? '—'}
                truncate
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-rupeezy-border-subtle">
        <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between text-xs text-rupeezy-fg-faint">
          <span>Built during the PanIIT AI for Bharat hackathon, 2026.</span>
          <span className="font-mono">localhost · dev</span>
        </div>
      </footer>
    </div>
  );
}

function NavCard({
  to,
  icon,
  kicker,
  title,
  blurb,
}: {
  to: string;
  icon: React.ReactNode;
  kicker: string;
  title: string;
  blurb: string;
}) {
  return (
    <Link
      to={to}
      className="group relative glass-card rounded-xl p-6 transition-all hover:border-rupeezy-accent/40 hover:bg-rupeezy-card overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-glow-subtle opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div className="w-9 h-9 rounded-md bg-rupeezy-elevated border border-rupeezy-border flex items-center justify-center text-rupeezy-fg-muted group-hover:text-rupeezy-accent transition-colors">
            {icon}
          </div>
          <ArrowUpRight
            size={14}
            className="text-rupeezy-fg-faint group-hover:text-rupeezy-fg transition-colors"
          />
        </div>
        <div className="eyebrow mb-1.5">{kicker}</div>
        <div className="font-serif text-lg text-rupeezy-fg mb-2">{title}</div>
        <div className="text-xs text-rupeezy-fg-muted leading-relaxed">{blurb}</div>
      </div>
    </Link>
  );
}

function StatusPill({ state }: { state: 'live' | 'error' | 'connecting' }) {
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-rupeezy-hot-faint text-rupeezy-hot border border-rupeezy-hot/30">
        <CircleAlert size={12} />
        offline
      </span>
    );
  }
  if (state === 'connecting') {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-white/5 text-rupeezy-fg-muted border border-rupeezy-border">
        <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-fg-muted animate-pulse" />
        connecting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-rupeezy-ok-faint text-rupeezy-ok border border-rupeezy-ok/30">
      <CircleCheck size={12} />
      live
    </span>
  );
}

function StatRow({
  label,
  value,
  ok,
  truncate,
}: {
  label: string;
  value: string;
  ok?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="bg-rupeezy-card px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-rupeezy-fg-faint mb-1">
        {label}
      </div>
      <div
        className={`font-mono text-xs ${ok ? 'text-rupeezy-ok' : 'text-rupeezy-fg'} ${truncate ? 'truncate' : ''}`}
        title={truncate ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}
