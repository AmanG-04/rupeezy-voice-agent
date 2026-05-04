import type { Funnel } from '../lib/api';

/**
 * Conversion funnel: Contacted → Engaged → Qualified
 * with H/W/C breakdown chips below.
 */
export default function FunnelHeader({ funnel }: { funnel: Funnel }) {
  const stages = [
    { key: 'contacted', label: 'Contacted', value: funnel.contacted },
    { key: 'engaged', label: 'Engaged (>30s)', value: funnel.engaged },
    { key: 'qualified', label: 'Qualified (H+W)', value: funnel.qualified },
  ];

  const max = Math.max(funnel.contacted, 1);

  return (
    <div className="rounded-2xl border border-slate-800 bg-rupeezy-card p-6">
      <div className="text-xs uppercase tracking-widest text-slate-500 mb-4">
        Conversion funnel
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        {stages.map((s, idx) => {
          const pct = (s.value / max) * 100;
          const dropoffPct = idx > 0
            ? Math.round((s.value / Math.max(stages[idx - 1].value, 1)) * 100)
            : 100;
          return (
            <div key={s.key}>
              <div className="text-xs text-slate-400 mb-1">{s.label}</div>
              <div className="text-3xl font-bold text-slate-100">{s.value}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-1">
                {idx > 0 && `${dropoffPct}% of prev`}
              </div>
              <div className="h-1.5 mt-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-rupeezy-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <BucketChip kind="hot" count={funnel.hot} />
        <BucketChip kind="warm" count={funnel.warm} />
        <BucketChip kind="cold" count={funnel.cold} />
      </div>
    </div>
  );
}

function BucketChip({ kind, count }: { kind: 'hot' | 'warm' | 'cold'; count: number }) {
  const map = {
    hot: { label: 'HOT', dot: 'bg-rupeezy-hot', text: 'text-rupeezy-hot', border: 'border-rupeezy-hot/30', bg: 'bg-rupeezy-hot/5' },
    warm: { label: 'WARM', dot: 'bg-rupeezy-warm', text: 'text-rupeezy-warm', border: 'border-rupeezy-warm/30', bg: 'bg-rupeezy-warm/5' },
    cold: { label: 'COLD', dot: 'bg-rupeezy-cold', text: 'text-rupeezy-cold', border: 'border-rupeezy-cold/30', bg: 'bg-rupeezy-cold/5' },
  } as const;
  const s = map[kind];
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${s.border} ${s.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span className={`text-xs font-bold tracking-wider ${s.text}`}>{s.label}</span>
      <span className="text-xs text-slate-300 font-mono">{count}</span>
    </div>
  );
}
