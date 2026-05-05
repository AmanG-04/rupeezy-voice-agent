import { useEffect, useState } from 'react';
import {
  type LeadDetail,
  type WhatsappLog,
  getLeadDetail,
  getWhatsappLogs,
} from '../lib/api';
import HandoffPanel from './HandoffPanel';

/**
 * Slide-in drawer showing the full handoff + transcript for one lead.
 * Renders three CTA buttons (Call now / Send WhatsApp / Schedule callback)
 * — wired in Phase 8 (WhatsApp). For now they're visible and click-disabled
 * with a tooltip.
 */
export default function LeadDrawer({
  convId,
  onClose,
}: {
  convId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsappLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setWhatsappLogs([]);
    setError(null);
    getLeadDetail(convId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    // WhatsApp logs are non-fatal — render the drawer even if this 404s.
    getWhatsappLogs(convId)
      .then((logs) => {
        if (!cancelled) setWhatsappLogs(logs);
      })
      .catch(() => {
        /* swallow — empty list is the right default */
      });
    return () => {
      cancelled = true;
    };
  }, [convId]);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (error) {
    return (
      <Backdrop onClose={onClose}>
        <div className="px-6 py-12 text-center text-rupeezy-hot text-sm">
          Failed to load lead: {error}
        </div>
      </Backdrop>
    );
  }

  if (!detail) {
    return (
      <Backdrop onClose={onClose}>
        <div className="px-6 py-12 text-center text-slate-500 text-sm">Loading lead…</div>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onClose}>
      {/* CTA bar */}
      <div className="px-6 py-3 border-b border-slate-800 bg-rupeezy-card/80 backdrop-blur sticky top-[70px] z-10">
        <div className="flex flex-wrap gap-2">
          <CtaButton
            label="📞 Call now"
            disabled
            tooltip="Wired in Phase 6 (voice loop)"
          />
          <CtaButton
            label="💬 Send WhatsApp"
            disabled
            tooltip="Wired in Phase 8 (WhatsApp)"
          />
          <CtaButton
            label="📅 Schedule callback"
            disabled
            tooltip="Out of demo scope; would create a CRM task"
          />
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="ml-auto text-xs text-slate-300 hover:text-slate-100 px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-500 transition-colors"
          >
            {showTranscript ? 'Hide transcript' : `Show transcript (${detail.transcript.length})`}
          </button>
        </div>
      </div>

      {/* Transcript (collapsible) */}
      {showTranscript && (
        <div className="px-6 py-4 border-b border-slate-800 bg-rupeezy-ink/40 max-h-[40vh] overflow-y-auto">
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-3">Full transcript</div>
          <div className="space-y-3">
            {detail.transcript.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-rupeezy-accent/30 text-slate-100 rounded-br-sm'
                      : 'bg-rupeezy-card text-slate-200 rounded-bl-sm border border-slate-800'
                  }`}
                >
                  <div className="text-[10px] text-slate-500 font-mono mb-1">
                    {m.role} · turn {i}
                  </div>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reuse the same panel from chat — looks identical so judges see the
          dashboard surfaces the EXACT handoff payload, no remix. */}
      <div className="relative">
        {/* HandoffPanel uses fixed positioning by default; render it as a
            normal inline block by overriding via a wrapper. */}
        <InlineHandoff handoff={detail.handoff} />
      </div>

      {/* Phase 8 — WhatsApp follow-ups. Sits between the handoff payload
          and the bottom of the drawer; spec asks for a section between
          Next action and Discovery, but those live inside HandoffPanel
          (untouchable per Phase 8 constraints), so we surface it here
          where it's still impossible to miss. */}
      <WhatsappSection logs={whatsappLogs} />
    </Backdrop>
  );
}

const TEMPLATE_BADGE: Record<
  string,
  { label: string; cls: string }
> = {
  hot: {
    label: 'HOT',
    cls: 'bg-rupeezy-hot/10 text-rupeezy-hot border-rupeezy-hot/40',
  },
  warm: {
    label: 'WARM',
    cls: 'bg-rupeezy-warm/10 text-rupeezy-warm border-rupeezy-warm/40',
  },
  cold_nurture: {
    label: 'COLD',
    cls: 'bg-rupeezy-cold/10 text-rupeezy-cold border-rupeezy-cold/40',
  },
};

const STATUS_BADGE: Record<string, string> = {
  sent_mock: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/50',
  sent_cloud_api: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/50',
  failed: 'bg-red-900/30 text-rupeezy-hot border-red-700/50',
  skipped: 'bg-slate-800/40 text-slate-400 border-slate-700',
};

function WhatsappSection({ logs }: { logs: WhatsappLog[] }) {
  return (
    <div className="px-6 pb-6">
      <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">
        📱 WhatsApp
      </div>
      {logs.length === 0 ? (
        <div className="text-sm text-slate-500">
          No WhatsApp messages dispatched for this lead.
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const tpl =
              TEMPLATE_BADGE[log.template_id] ?? {
                label: log.template_id.toUpperCase(),
                cls: 'bg-slate-800/40 text-slate-300 border-slate-700',
              };
            const statusCls =
              STATUS_BADGE[log.status] ??
              'bg-slate-800/40 text-slate-300 border-slate-700';
            return (
              <div
                key={log.id}
                className="bg-rupeezy-card border border-slate-800 rounded-md p-3 space-y-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-mono ${tpl.cls}`}
                  >
                    {tpl.label}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-mono ${statusCls}`}
                  >
                    {log.status}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono ml-auto">
                    {formatRelative(log.sent_at)}
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-xs text-slate-300 leading-relaxed">
                  {log.body}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/** Backdrop that contains a slide-in right drawer + click-outside-to-close. */
function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-rupeezy-ink/70 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full sm:w-[600px] bg-rupeezy-surface border-l border-slate-800 overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-rupeezy-surface z-20">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">Lead drilldown</div>
            <div className="text-sm font-semibold text-slate-200 mt-0.5">RM context view</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CtaButton({
  label,
  disabled,
  tooltip,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  tooltip?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className="text-xs px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:border-rupeezy-accent hover:text-rupeezy-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-700 disabled:hover:text-slate-300 transition-colors"
    >
      {label}
    </button>
  );
}

/**
 * Inline-rendered version of HandoffPanel — same visual content,
 * but flows in document order instead of fixed-positioning.
 */
function InlineHandoff({ handoff }: { handoff: LeadDetail['handoff'] }) {
  // The original HandoffPanel uses position:fixed. To avoid duplicating its
  // 200 lines of layout, we render it inside a wrapper that neutralises
  // fixed positioning + the close button.
  return (
    <div className="[&>aside]:!relative [&>aside]:!inset-auto [&>aside]:!w-full [&>aside]:!shadow-none [&>aside]:!border-l-0 [&>aside]:!z-auto [&_.sticky]:!relative">
      <HandoffPanel handoff={handoff} />
    </div>
  );
}
