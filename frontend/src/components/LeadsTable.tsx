import type { Bucket, LeadRow, NextActionType } from '../lib/api';

const BUCKET_BADGE: Record<Bucket, { label: string; className: string }> = {
  hot: { label: 'HOT', className: 'bg-rupeezy-hot/20 text-rupeezy-hot border-rupeezy-hot/40' },
  warm: { label: 'WARM', className: 'bg-rupeezy-warm/20 text-rupeezy-warm border-rupeezy-warm/40' },
  cold: { label: 'COLD', className: 'bg-rupeezy-cold/20 text-rupeezy-cold border-rupeezy-cold/40' },
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
}: {
  leads: LeadRow[];
  onSelect: (convId: string) => void;
  selectedConvId: string | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-rupeezy-card p-12 text-center text-slate-500 text-sm">
        Loading leads…
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-rupeezy-card p-12 text-center">
        <div className="text-slate-300 text-sm font-medium mb-1">No leads yet</div>
        <div className="text-slate-500 text-xs">
          Run a chat conversation and end it — the lead will appear here once scored.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-rupeezy-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-rupeezy-surface border-b border-slate-800">
          <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
            <th className="px-4 py-3 font-medium">Bucket</th>
            <th className="px-4 py-3 font-medium">Summary</th>
            <th className="px-4 py-3 font-medium">Lang</th>
            <th className="px-4 py-3 font-medium">Dur</th>
            <th className="px-4 py-3 font-medium">Next</th>
            <th className="px-4 py-3 font-medium">When</th>
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
                className={`border-b border-slate-800/60 last:border-b-0 cursor-pointer transition-colors ${
                  isSelected ? 'bg-rupeezy-accent/10' : 'hover:bg-rupeezy-surface/60'
                }`}
              >
                <td className="px-4 py-3 align-top">
                  <span
                    className={`text-[10px] font-bold tracking-wider px-2 py-1 rounded-md border ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    {Math.round(lead.confidence * 100)}%
                  </div>
                </td>
                <td className="px-4 py-3 align-top max-w-md">
                  <div className="text-slate-100 leading-snug line-clamp-2">{lead.summary_short}</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">{lead.conv_id}</div>
                </td>
                <td className="px-4 py-3 align-top text-slate-400 text-xs uppercase">
                  {lead.language_used}
                </td>
                <td className="px-4 py-3 align-top text-slate-400 text-xs font-mono whitespace-nowrap">
                  {lead.duration_sec}s
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="text-xs text-slate-300 whitespace-nowrap">
                    {NEXT_ACTION_LABEL[lead.next_action]}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-slate-500 text-xs whitespace-nowrap">
                  {formatRelative(lead.started_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
