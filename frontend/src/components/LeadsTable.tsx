import { Trash2 } from 'lucide-react';
import type { Bucket, LeadRow, NextActionType } from '../lib/api';

const BUCKET_BADGE: Record<Bucket, { label: string; cls: string }> = {
  hot: {
    label: 'HOT',
    cls: 'bg-rupeezy-hot-faint text-rupeezy-hot border-rupeezy-hot/30',
  },
  warm: {
    label: 'WARM',
    cls: 'bg-rupeezy-warm-faint text-rupeezy-warm border-rupeezy-warm/30',
  },
  cold: {
    label: 'COLD',
    cls: 'bg-rupeezy-cold-faint text-rupeezy-cold border-rupeezy-cold/30',
  },
};

const NEXT_ACTION_LABEL: Record<NextActionType, string> = {
  warm_transfer: 'Transfer to RM',
  rm_callback: 'RM callback',
  whatsapp_link_sent: 'WhatsApp sent',
  nurture_sequence: 'Nurture',
  dnd: 'DND',
};

export default function LeadsTable({
  leads,
  onSelect,
  selectedConvId,
  loading,
  onDelete,
}: {
  leads: LeadRow[];
  onSelect: (convId: string) => void;
  selectedConvId: string | null;
  loading?: boolean;
  onDelete?: (convId: string) => void;
}) {
  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-16 text-center text-rupeezy-fg-faint text-sm">
        Loading leads…
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-16 text-center">
        <div className="font-serif text-lg text-rupeezy-fg mb-2">
          No leads yet
        </div>
        <div className="text-rupeezy-fg-faint text-xs leading-relaxed max-w-sm mx-auto">
          Start a chat or upload a batch CSV — qualified leads appear here once
          the agent has scored them.
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="text-left">
            <Th>Bucket</Th>
            <Th>Summary</Th>
            <Th>Lang</Th>
            <Th align="right">Dur</Th>
            <Th>Next action</Th>
            <Th>When</Th>
            {onDelete && <Th align="right">{''}</Th>}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const isSelected = lead.conv_id === selectedConvId;
            const badge = BUCKET_BADGE[lead.bucket];
            return (
              <tr
                key={lead.conv_id}
                onClick={() => onSelect(lead.conv_id)}
                className={`group border-t border-rupeezy-border-subtle cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-rupeezy-accent-faint'
                    : 'hover:bg-white/[0.02]'
                }`}
              >
                <td className="px-5 py-4 align-top">
                  <span
                    className={`inline-block text-[10px] font-medium tracking-[0.16em] px-2 py-1 rounded-md border ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  <div className="text-[10px] text-rupeezy-fg-faint font-mono mt-1.5 tabular-nums">
                    {Math.round(lead.confidence * 100)}%
                  </div>
                </td>
                <td className="px-5 py-4 align-top max-w-md">
                  <div className="text-sm text-rupeezy-fg leading-snug line-clamp-2">
                    {lead.summary_short}
                  </div>
                  <div className="text-[10px] text-rupeezy-fg-faint font-mono mt-1.5">
                    {lead.conv_id}
                  </div>
                </td>
                <td className="px-5 py-4 align-top text-rupeezy-fg-muted text-xs lowercase">
                  {lead.language_used}
                </td>
                <td className="px-5 py-4 align-top text-rupeezy-fg-muted text-xs font-mono whitespace-nowrap text-right tabular-nums">
                  {lead.duration_sec}s
                </td>
                <td className="px-5 py-4 align-top">
                  <span className="text-xs text-rupeezy-fg whitespace-nowrap">
                    {NEXT_ACTION_LABEL[lead.next_action]}
                  </span>
                </td>
                <td className="px-5 py-4 align-top text-rupeezy-fg-faint text-xs whitespace-nowrap">
                  {formatRelative(lead.started_at)}
                </td>
                {onDelete && (
                  <td className="px-3 py-4 align-top text-right">
                    <button
                      type="button"
                      title="Delete this lead"
                      aria-label="Delete this lead"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `Delete this ${lead.bucket.toUpperCase()} lead? This removes the conversation, transcript, handoff, and any WhatsApp logs.`,
                          )
                        ) {
                          onDelete(lead.conv_id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-rupeezy-fg-faint hover:text-rupeezy-hot hover:bg-rupeezy-hot-faint"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`px-5 py-3.5 text-[10px] uppercase tracking-[0.16em] font-medium text-rupeezy-fg-faint bg-rupeezy-surface ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
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
