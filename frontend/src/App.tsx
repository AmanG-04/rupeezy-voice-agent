import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  MessageSquare,
  Mic,
  LayoutDashboard,
  CircleCheck,
  CircleAlert,
  Upload,
  ChevronRight,
} from 'lucide-react';
import { Brand } from './components/Brand';
import PipelineDiagram from './components/PipelineDiagram';
import UploadLeadsModal from './components/UploadLeadsModal';
import { fetchWithRetry } from './lib/api';
import { api } from './lib/apiBase';

interface Health {
  status: string;
}

interface Version {
  version: string;
  chat_model: string;
  chat_model_chain?: string[];
  reasoning_model: string;
  embedding_model: string;
  tts_engine?: string;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [version, setVersion] = useState<Version | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchWithRetry(api('/health')).then((r) => r.json() as Promise<Health>),
      fetchWithRetry(api('/api/version')).then((r) => r.json() as Promise<Version>),
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
            <div className="mt-6 inline-flex items-start gap-2.5 rounded-md border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100 max-w-2xl">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                Backend is hosted on Render and may take up to 60 seconds to wake up
                after idle.
              </span>
            </div>

            {/* Primary CTA — opens the same upload-leads modal the dashboard
                uses. Judges drop a CSV (or download the rotating template),
                hit "Process queue", funnel populates live. */}
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-rupeezy-accent text-white font-medium text-sm hover:opacity-90 transition-opacity shadow-lifted"
              >
                <Upload size={15} />
                Upload leads
              </button>
              <Link
                to="/voice"
                className="inline-flex items-center gap-1.5 text-sm text-rupeezy-fg-muted hover:text-rupeezy-fg transition-colors"
              >
                Or talk to Aria yourself
                <ArrowUpRight size={13} />
              </Link>
            </div>
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

        {/* Pipeline architecture — judges' 5-second tour of the data path */}
        <section className="max-w-6xl w-full mx-auto px-8 pb-12">
          <PipelineDiagram />
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

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-rupeezy-border rounded-lg overflow-hidden mb-px">
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
                label="TTS engine"
                value={version?.tts_engine ?? 'edge-tts (neural)'}
                truncate
              />
              <StatRow
                label="Reasoning model"
                value={version?.reasoning_model ?? '—'}
                truncate
              />
              <StatRow
                label="Embedding model"
                value={version?.embedding_model ?? '—'}
                truncate
              />
              <StatRow
                label="Chat model"
                value={version?.chat_model ?? '—'}
                truncate
              />
            </div>

            {/* Chat-model fallback chain — full row spanning all columns.
                On 429 the engine walks down this list so the demo never
                goes dark mid-call when one model's daily quota exhausts. */}
            <div className="mt-px">
              <ModelChainRow chain={version?.chat_model_chain} />
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-rupeezy-border-subtle">
        <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between text-xs text-rupeezy-fg-faint">
          <span>Built during the PanIIT AI for Bharat hackathon, 2026.</span>
          <span className="font-mono">{deployTag()}</span>
        </div>
      </footer>

      {/* Upload-leads modal — same component the dashboard uses, so judges
          can drop a CSV without leaving the landing page. onAfterDial is
          a no-op here; the dashboard is where the funnel actually lives,
          but processing in the background still produces handoffs. */}
      {uploadOpen && (
        <UploadLeadsModal
          onClose={() => setUploadOpen(false)}
          onAfterDial={() => {
            /* no-op — landing page doesn't render the funnel */
          }}
        />
      )}
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

/**
 * Footer tag — auto-detects environment.
 *  - vite dev server                     → "localhost · dev"
 *  - any prod build hosted anywhere     → "<hostname> · prod"
 *  - local preview build (vite preview) → "<hostname> · prod"
 */
function deployTag(): string {
  const host =
    typeof window !== 'undefined' ? window.location.hostname : 'unknown';
  const isDev = import.meta.env.DEV;
  return `${host} · ${isDev ? 'dev' : 'prod'}`;
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

function ModelChainRow({ chain }: { chain?: string[] }) {
  if (!chain || chain.length === 0) return null;
  return (
    <div className="bg-rupeezy-card rounded-lg px-4 py-3.5 border border-rupeezy-border">
      <div className="flex items-baseline gap-3 mb-2">
        <div className="text-[10px] uppercase tracking-[0.14em] text-rupeezy-fg-faint">
          Chat-model fallback chain
        </div>
        <div className="text-[10px] text-rupeezy-fg-faint font-mono">
          tries each in order on quota-exhausted (429)
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {chain.map((m, i) => (
          <div key={m} className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] border ${
                i === 0
                  ? 'bg-rupeezy-accent-faint text-rupeezy-accent border-rupeezy-accent/30'
                  : 'bg-rupeezy-card text-rupeezy-fg-muted border-rupeezy-border'
              }`}
              title={i === 0 ? 'Primary model' : `Fallback ${i}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  i === 0 ? 'bg-rupeezy-accent' : 'bg-rupeezy-fg-faint'
                }`}
              />
              {m}
            </span>
            {i < chain.length - 1 && (
              <ChevronRight size={12} className="text-rupeezy-fg-faint" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
