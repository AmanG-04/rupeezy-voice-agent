/**
 * Pipeline architecture diagram for the landing page.
 *
 * Goal: in 5 seconds a judge sees the full data path
 *   user voice  →  STT  →  LLM + RAG  →  Aria's reply  →  Edge-TTS  →  audio out
 *                                              ↓
 *                                        on call end
 *                                              ↓
 *                                     Classifier → Handoff
 *
 * Pure divs + tailwind. No mermaid, no extra deps. Stacks on mobile.
 */

import {
  Mic,
  Brain,
  Database,
  Volume2,
  ScanSearch,
  Send,
  ChevronRight,
} from 'lucide-react';

export default function PipelineDiagram() {
  return (
    <div className="glass-card rounded-xl p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow mb-1">How it works</div>
          <div className="text-sm text-rupeezy-fg">
            Real-time pipeline — every box is wired, no mocks
          </div>
        </div>
        <div className="hidden sm:block text-[10px] font-mono text-rupeezy-fg-faint uppercase tracking-[0.16em]">
          STT · LLM · RAG · TTS · Classifier · Handoff
        </div>
      </div>

      {/* Live call lane */}
      <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-rupeezy-fg-faint font-mono">
        During the call
      </div>
      <div className="flex flex-col md:flex-row md:items-stretch gap-2 md:gap-1">
        <Stage
          icon={<Mic size={16} />}
          title="Web Speech STT"
          tag="browser-native"
          detail="8 langs · interim + final · auto-restart"
          tone="ok"
        />
        <Connector />
        <Stage
          icon={<Brain size={16} />}
          title="Gemini flash-lite"
          tag="streaming SSE"
          detail="4-layer prompt: persona · prior call · base · retrieved"
          tone="accent"
        />
        <Connector />
        <Stage
          icon={<Database size={16} />}
          title="RAG · Appendix A"
          tag="content-hashed cache"
          detail="13 sections · gemini-embedding-001 · skip on small talk"
          tone="accent"
        />
        <Connector />
        <Stage
          icon={<Volume2 size={16} />}
          title="Edge-TTS neural"
          tag="free, no API key"
          detail="Aria · Neerja · Swara · Pallavi · per-language"
          tone="ok"
        />
      </div>

      {/* Vertical hand-off arrow */}
      <div className="flex justify-center my-5 md:my-6">
        <div className="flex flex-col items-center text-rupeezy-fg-faint">
          <div className="w-px h-6 bg-rupeezy-border" />
          <div className="text-[9px] font-mono uppercase tracking-[0.18em]">
            on call end
          </div>
          <div className="w-px h-6 bg-rupeezy-border" />
        </div>
      </div>

      {/* Post-call lane */}
      <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-rupeezy-fg-faint font-mono">
        After the call
      </div>
      <div className="flex flex-col md:flex-row md:items-stretch gap-2 md:gap-1">
        <Stage
          icon={<ScanSearch size={16} />}
          title="Classifier"
          tag="7-signal score"
          detail="intent · engagement · network · objections · cues · deferrals"
          tone="warm"
        />
        <Connector />
        <Stage
          icon={<Send size={16} />}
          title="Handoff"
          tag="hot · warm · cold"
          detail="RM transfer · WhatsApp template · 14-day nurture · DND"
          tone="warm"
        />
      </div>

      {/* Outcome chips */}
      <div className="mt-6 pt-5 border-t border-rupeezy-border-subtle flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-rupeezy-fg-faint font-mono mr-1">
          Outcomes
        </span>
        <Chip color="hot">HOT → warm transfer + signup link</Chip>
        <Chip color="warm">WARM → comparison sheet + callback</Chip>
        <Chip color="cold">COLD → 14-day nurture</Chip>
        <Chip color="muted">DND → suppress, no WhatsApp</Chip>
      </div>
    </div>
  );
}

function Stage({
  icon,
  title,
  tag,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  tag: string;
  detail: string;
  tone: 'ok' | 'accent' | 'warm';
}) {
  const toneCls: Record<typeof tone, string> = {
    ok: 'border-rupeezy-ok/25 bg-rupeezy-ok-faint text-rupeezy-ok',
    accent: 'border-rupeezy-accent/25 bg-rupeezy-accent-faint text-rupeezy-accent',
    warm: 'border-rupeezy-warm/25 bg-rupeezy-warm-faint text-rupeezy-warm',
  };
  return (
    <div className="flex-1 min-w-0 rounded-lg bg-rupeezy-card border border-rupeezy-border p-3.5 transition-colors hover:border-rupeezy-fg-faint/40">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 ${toneCls[tone]}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] text-rupeezy-fg font-medium truncate">
            {title}
          </div>
          <div className="text-[9px] text-rupeezy-fg-faint font-mono uppercase tracking-[0.14em] truncate">
            {tag}
          </div>
        </div>
      </div>
      <div className="text-[11px] text-rupeezy-fg-muted leading-snug">
        {detail}
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div className="flex items-center justify-center md:px-1">
      {/* Mobile: vertical caret. Desktop: horizontal chevron. */}
      <ChevronRight
        size={18}
        className="text-rupeezy-fg-faint hidden md:block"
      />
      <div className="md:hidden h-3 w-px bg-rupeezy-border" />
    </div>
  );
}

function Chip({
  color,
  children,
}: {
  color: 'hot' | 'warm' | 'cold' | 'muted';
  children: React.ReactNode;
}) {
  const map = {
    hot: 'bg-rupeezy-hot-faint text-rupeezy-hot border-rupeezy-hot/30',
    warm: 'bg-rupeezy-warm-faint text-rupeezy-warm border-rupeezy-warm/30',
    cold: 'bg-rupeezy-cold-faint text-rupeezy-cold border-rupeezy-cold/30',
    muted: 'bg-rupeezy-card text-rupeezy-fg-faint border-rupeezy-border',
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.14em] font-mono px-2.5 py-1 rounded-full border ${map[color]}`}
    >
      {children}
    </span>
  );
}
