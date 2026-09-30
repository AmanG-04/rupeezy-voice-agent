import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import {
  type LeadDetail,
  type WhatsappLog,
  getLeadDetail,
  getWhatsappLogs,
  reviewLead,
} from '../lib/api';
import HandoffPanel from './HandoffPanel';
import { useDialog } from '../lib/useDialog';

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
  const [highlightTurn, setHighlightTurn] = useState<number | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBucket, setReviewBucket] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setWhatsappLogs([]);
    setError(null);
    getLeadDetail(convId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setReviewBucket(d.handoff.review?.bucket || '');
          setReviewReason(d.handoff.review?.reason || '');
          setNotes(d.handoff.review?.notes || '');
          setSaveMessage('');
        }
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
      {/* Transcript controls */}
      <div className="px-7 py-3.5 border-b border-rupeezy-border-subtle bg-rupeezy-elevated/95 backdrop-blur-xl sticky top-[72px] z-10">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => {
            const blob = new Blob([JSON.stringify(detail, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `handoff-${convId}.json`;
            anchor.click();
            URL.revokeObjectURL(url);
          }} className="px-3 py-1.5 rounded-md border border-rupeezy-border text-xs">
            Export handoff JSON
          </button>
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
                id={`lead-turn-${i}`}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    highlightTurn === i ? 'bg-rupeezy-accent-faint border-2 border-rupeezy-accent' : m.role === 'user'
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
      <InlineHandoff handoff={detail.handoff} onEvidence={(turn) => {
        setShowTranscript(true);
        setHighlightTurn(turn);
        setTimeout(() => document.getElementById(`lead-turn-${turn}`)?.scrollIntoView({ block: 'center' }), 0);
      }} />

      <form className="px-7 py-5 space-y-3 border-t border-rupeezy-border" onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setSaveMessage('');
        try {
          const handoff = await reviewLead(convId, {
            bucket: (reviewBucket || null) as 'hot' | 'warm' | 'cold' | null,
            reason: reviewReason,
            notes,
          });
          setDetail((previous) => previous ? { ...previous, handoff } : previous);
          setSaveMessage('Review saved. The original AI classification is preserved.');
        } catch (error) {
          setSaveMessage((error as Error).message);
        } finally { setSaving(false); }
      }}>
        <h2 className="text-lg">
          Human review
        </h2>
        <label className="block text-sm space-y-2">
          <span>
            Qualification correction
          </span>
          <select value={reviewBucket} onChange={(event) => setReviewBucket(event.target.value)} className="w-full rounded-md bg-rupeezy-ink border border-rupeezy-border px-3 py-2">
            <option value="">
              Keep AI recommendation
            </option>
            <option value="hot">
              Hot
            </option>
            <option value="warm">
              Warm
            </option>
            <option value="cold">
              Cold
            </option>
          </select>
        </label>
        <label className="block text-sm space-y-2">
          <span>
            Reason for correction
          </span>
          <input required={!!reviewBucket} maxLength={500} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} className="w-full rounded-md bg-rupeezy-ink border border-rupeezy-border px-3 py-2" />
        </label>
        <label className="block text-sm space-y-2">
          <span>
            Review notes (demo data only)
          </span>
          <textarea maxLength={2000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full rounded-md bg-rupeezy-ink border border-rupeezy-border px-3 py-2" />
        </label>
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-md bg-rupeezy-accent text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save review'}
        </button>
        <p role="status" className="text-xs text-rupeezy-fg-muted">
          {saveMessage}
        </p>
      </form>

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
  const dialogRef = useDialog(onClose);
  return (
    <div
      className="fixed inset-0 z-40 bg-rupeezy-ink/80 backdrop-blur-sm flex justify-end"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Lead analysis and human review"
        tabIndex={-1}
        className="w-full sm:w-[640px] glass-elevated overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-7 py-5 border-b border-rupeezy-border-subtle flex items-center justify-between sticky top-0 bg-rupeezy-elevated/95 backdrop-blur-xl z-20">
          <div>
            <div className="eyebrow mb-0.5">Lead drilldown</div>
            <div className="text-sm text-rupeezy-fg">
              Conversation review
            </div>
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

/**
 * Render the shared HandoffPanel inline (it uses position:fixed by default,
 * which we override here so it flows in document order inside the drawer).
 */
function InlineHandoff({ handoff, onEvidence }: { handoff: LeadDetail['handoff']; onEvidence: (turn: number) => void }) {
  return (
    <div className="[&>aside]:!relative [&>aside]:!inset-auto [&>aside]:!w-full [&>aside]:!shadow-none [&>aside]:!border-0 [&>aside]:!z-auto [&>aside]:!bg-transparent [&>aside]:!backdrop-blur-none [&_.sticky]:!relative">
      <HandoffPanel handoff={handoff} onEvidence={onEvidence} />
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
