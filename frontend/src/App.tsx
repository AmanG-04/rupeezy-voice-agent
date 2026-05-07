import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  MessageSquare,
  Mic,
  LayoutDashboard,
  CircleCheck,
  CircleAlert,
  PlayCircle,
  Loader2,
} from 'lucide-react';
import { Brand } from './components/Brand';
import PipelineDiagram from './components/PipelineDiagram';
import { dialNextLead, seedDemoLeads } from './lib/api';

interface Health {
  status: string;
}

interface Version {
  version: string;
  chat_model: string;
  reasoning_model: string;
  embedding_model: string;
  tts_engine?: string;
}

export default function App() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<Health | null>(null);
  const [version, setVersion] = useState<Version | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoState, setDemoState] = useState<
    'idle' | 'seeding' | 'dialing' | 'done' | 'error'
  >('idle');
  const [demoMessage, setDemoMessage] = useState<string>('');

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

  async function runDemo() {
    if (demoState === 'seeding' || demoState === 'dialing') return;
    setDemoState('seeding');
    setDemoMessage('Seeding 4 demo leads…');
    try {
      const r = await seedDemoLeads();
      setDemoMessage(
        `${r.enqueued} new lead${r.enqueued === 1 ? '' : 's'} queued. Opening dashboard…`,
      );
      // Hand off to the dashboard so the funnel is visible while we dial.
      navigate('/dashboard');
      setDemoState('dialing');
      // Drive dial-next in a loop until idle. Same cadence as the modal.
      // Spaced out so the dashboard's 5s auto-refresh actually shows the
      // funnel populating one bucket at a time.
      while (true) {
        const res = await dialNextLead();
        if (res.idle) break;
        await new Promise((s) => setTimeout(s, 4000));
      }
      setDemoState('done');
      setDemoMessage('All 4 demo leads processed.');
    } catch (e) {
      setDemoState('error');
      setDemoMessage((e as Error).message);
    }
  }

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

            {/* Demo CTA — one click seeds 4 personas, navigates to dashboard,
                drives dial-next until idle. The fastest path to "see it work". */}
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => void runDemo()}
                disabled={demoState === 'seeding' || demoState === 'dialing'}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-rupeezy-accent text-white font-medium text-sm hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity shadow-lifted"
              >
                {demoState === 'seeding' || demoState === 'dialing' ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <PlayCircle size={15} />
                )}
                {demoState === 'idle' && 'Run live demo'}
                {demoState === 'seeding' && 'Seeding leads…'}
                {demoState === 'dialing' && 'Dialing 4 leads…'}
                {demoState === 'done' && 'Run again'}
                {demoState === 'error' && 'Retry'}
              </button>
              <Link
                to="/voice"
                className="inline-flex items-center gap-1.5 text-sm text-rupeezy-fg-muted hover:text-rupeezy-fg transition-colors"
              >
                Or talk to Aria yourself
                <ArrowUpRight size={13} />
              </Link>
              {demoMessage && (
                <span
                  className={`text-xs font-mono ${
                    demoState === 'error'
                      ? 'text-rupeezy-hot'
                      : 'text-rupeezy-fg-faint'
                  }`}
                >
                  {demoMessage}
                </span>
              )}
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

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-rupeezy-border rounded-lg overflow-hidden">
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
                label="Chat model"
                value={version?.chat_model ?? '—'}
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
