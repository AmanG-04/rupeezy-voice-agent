import { useEffect, useState } from 'react';
import { Phone, MessageSquare, Calendar, Send } from 'lucide-react';
import {
  type LeadDetail,
  type WhatsappLog,
  getLeadDetail,
  getWhatsappLogs,
} from '../lib/api';
import HandoffPanel from './HandoffPanel';

/**
 * Slide-in drawer showing the full handoff + transcript for one lead.
 * Top: CTA bar (Call / WhatsApp / Schedule — all disabled in demo).
 * Mid: collapsible transcript.
 * Inline handoff panel.
 * Bottom: WhatsApp dispatch log (Phase 8).
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
        <div className="px-7 py-16 text-center text-rupeezy-hot text-sm">
          Failed to load lead: {error}
        </div>
      </Backdrop>
    );
  }

  if (!detail) {
    return (
      <Backdrop onClose={onClose}>
        <div className="px-7 py-16 text-center text-rupeezy-fg-faint text-sm">
          Loading lead…
        </div>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onClose}>
      {/* CTA bar */}
      <div className="px-7 py-3.5 border-b border-rupeezy-border-subtle bg-rupeezy-elevated/95 backdrop-blur-xl sticky top-[72px] z-10">
        <div className="flex flex-wrap items-center gap-2">
          <CtaButton
            icon={<Phone size={13} />}
            label="Call now"
            disabled
            tooltip="Wired in Phase 6 — voice loop"
          />
          <CtaButton
            icon={<Send size={13} />}
            label="Send WhatsApp"
            disabled
            tooltip="Wired in Phase 8 — WhatsApp"
          />
          <CtaButton
            icon={<Calendar size={13} />}
            label="Schedule callback"
            disabled
            tooltip="Out of demo scope; would create a CRM task"
          />
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="ml-auto text-xs text-rupeezy-fg-muted hover:text-rupeezy-fg px-3 py-1.5 rounded-md border border-rupeezy-border hover:border-rupeezy-fg-faint transition-colors"
          >
            {showTranscript
              ? 'Hide transcript'
              : `Show transcript — ${detail.transcript.length}`}
          </button>
        </div>
      </div>

      {/* Transcript (collapsible) */}
      {showTranscript && (
        <div className="px-7 py-5 border-b border-rupeezy-border-subtle bg-rupeezy-ink/50 max-h-[40vh] overflow-y-auto">
          <div className="eyebrow mb-3">Full transcript</div>
          <div className="space-y-3">
            {detail.transcript.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-rupeezy-accent-faint text-rupeezy-fg rounded-br-sm border border-rupeezy-accent/20'
                      : 'bg-rupeezy-card text-rupeezy-fg-muted rounded-bl-sm border border-rupeezy-border'
                  }`}
                >
                  <div className="text-[10px] text-rupeezy-fg-faint font-mono mb-1.5 uppercase tracking-[0.14em]">
                    {m.role} · turn {i}
                  </div>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inline handoff payload — same component as the chat post-call panel */}
      <InlineHandoff handoff={detail.handoff} />

      {/* WhatsApp dispatch log */}
      <WhatsappSection logs={whatsappLogs} />
    </Backdrop>
  );
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-rupeezy-ink/80 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full sm:w-[640px] glass-elevated overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-7 py-5 border-b border-rupeezy-border-subtle flex items-center justify-between sticky top-0 bg-rupeezy-elevated/95 backdrop-blur-xl z-20">
          <div>
            <div className="eyebrow mb-0.5">Lead drilldown</div>
            <div className="text-sm text-rupeezy-fg">RM context view</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-rupeezy-fg-muted hover:text-rupeezy-fg text-xl leading-none px-2 transition-colors"
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
  icon,
  label,
  disabled,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
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
      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-rupeezy-border text-rupeezy-fg-muted hover:border-rupeezy-accent/40 hover:text-rupeezy-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-rupeezy-border disabled:hover:text-rupeezy-fg-muted transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Render the shared HandoffPanel inline (it uses position:fixed by default,
 * which we override here so it flows in document order inside the drawer).
 */
function InlineHandoff({ handoff }: { handoff: LeadDetail['handoff'] }) {
  return (
    <div className="[&>aside]:!relative [&>aside]:!inset-auto [&>aside]:!w-full [&>aside]:!shadow-none [&>aside]:!border-0 [&>aside]:!z-auto [&>aside]:!bg-transparent [&>aside]:!backdrop-blur-none [&_.sticky]:!relative">
      <HandoffPanel handoff={handoff} />
    </div>
  );
}

const TEMPLATE_BADGE: Record<string, { label: string; cls: string }> = {
  hot: {
    label: 'HOT',
    cls: 'bg-rupeezy-hot-faint text-rupeezy-hot border-rupeezy-hot/30',
  },
  warm: {
    label: 'WARM',
    cls: 'bg-rupeezy-warm-faint text-rupeezy-warm border-rupeezy-warm/30',
  },
  cold_nurture: {
    label: 'COLD',
    cls: 'bg-rupeezy-cold-faint text-rupeezy-cold border-rupeezy-cold/30',
  },
};

const STATUS_BADGE: Record<string, string> = {
  sent_mock: 'bg-rupeezy-ok-faint text-rupeezy-ok border-rupeezy-ok/30',
  sent_cloud_api: 'bg-rupeezy-ok-faint text-rupeezy-ok border-rupeezy-ok/30',
  failed: 'bg-rupeezy-hot-faint text-rupeezy-hot border-rupeezy-hot/30',
  skipped:
    'bg-rupeezy-card text-rupeezy-fg-faint border-rupeezy-border',
};

function WhatsappSection({ logs }: { logs: WhatsappLog[] }) {
  return (
    <div className="px-7 pb-7 pt-2">
      <div className="flex items-center gap-2.5 mb-3">
        <MessageSquare size={14} className="text-rupeezy-fg-faint" />
        <div className="eyebrow">WhatsApp</div>
      </div>
      {logs.length === 0 ? (
        <div className="text-sm text-rupeezy-fg-faint">
          No WhatsApp messages dispatched for this lead.
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const tpl =
              TEMPLATE_BADGE[log.template_id] ?? {
                label: log.template_id.toUpperCase(),
                cls: 'bg-rupeezy-card text-rupeezy-fg-muted border-rupeezy-border',
              };
            const statusCls =
              STATUS_BADGE[log.status] ??
              'bg-rupeezy-card text-rupeezy-fg-muted border-rupeezy-border';
            return (
              <div
                key={log.id}
                className="bg-rupeezy-card border border-rupeezy-border rounded-lg p-4"
              >
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <span
                    className={`text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border font-mono ${tpl.cls}`}
                  >
                    {tpl.label}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border font-mono ${statusCls}`}
                  >
                    {log.status}
                  </span>
                  <span className="text-[10px] text-rupeezy-fg-faint font-mono ml-auto">
                    {formatRelative(log.sent_at)}
                  </span>
                </div>
                <div className="text-xs text-rupeezy-fg-muted whitespace-pre-wrap leading-relaxed">
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
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
