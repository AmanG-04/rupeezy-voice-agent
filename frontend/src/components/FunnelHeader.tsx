import type { Funnel } from '../lib/api';

/**
 * Conversion funnel header — Contacted → Engaged → Qualified
 * with H/W/C bucket breakdown beneath. Refined for production: serif
 * display numbers, subtle drop-off labels, glass surface.
 */
export default function FunnelHeader({ funnel }: { funnel: Funnel }) {
  const stages = [
    { key: 'contacted', label: 'Contacted', value: funnel.contacted },
    { key: 'engaged', label: 'Engaged', sub: 'over 30s', value: funnel.engaged },
    { key: 'qualified', label: 'Qualified', sub: 'hot + warm', value: funnel.qualified },
  ];
  const max = Math.max(funnel.contacted, 1);

  return (
    <div className="glass-card rounded-2xl p-7">
      <div className="flex items-center justify-between mb-7">
        <div>
          <div className="eyebrow mb-1">Conversion funnel</div>
          <div className="text-sm text-rupeezy-fg-muted">
            Live counts across all calls in the dataset
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-rupeezy-border rounded-xl overflow-hidden mb-6">
        {stages.map((s, idx) => {
          const pct = (s.value / max) * 100;
          const dropoff =
            idx > 0
              ? Math.round((s.value / Math.max(stages[idx - 1].value, 1)) * 100)
              : null;
          return (
            <div key={s.key} className="bg-rupeezy-card p-5">
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div className="text-xs text-rupeezy-fg-muted">
                    {s.label}
                    {s.sub && (
                      <span className="text-rupeezy-fg-faint">
                        {' '}— {s.sub}
                      </span>
                    )}
                  </div>
                </div>
                {dropoff !== null && (
                  <span className="text-[10px] text-rupeezy-fg-faint font-mono uppercase tracking-wider">
                    {dropoff}% of prev
                  </span>
                )}
              </div>
              <div className="display-num">{s.value}</div>
              <div className="h-[2px] mt-3 rounded-full bg-rupeezy-border-subtle overflow-hidden">
                <div
                  className="h-full bg-rupeezy-accent transition-all duration-500"
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

function BucketChip({
  kind,
  count,
}: {
  kind: 'hot' | 'warm' | 'cold';
  count: number;
}) {
  const map = {
    hot: {
      label: 'HOT',
      dot: 'bg-rupeezy-hot',
      text: 'text-rupeezy-hot',
      ring: 'border-rupeezy-hot/30 bg-rupeezy-hot-faint',
    },
    warm: {
      label: 'WARM',
      dot: 'bg-rupeezy-warm',
      text: 'text-rupeezy-warm',
      ring: 'border-rupeezy-warm/30 bg-rupeezy-warm-faint',
    },
    cold: {
      label: 'COLD',
      dot: 'bg-rupeezy-cold',
      text: 'text-rupeezy-cold',
      ring: 'border-rupeezy-cold/30 bg-rupeezy-cold-faint',
    },
  } as const;
  const s = map[kind];
  return (
    <div
      className={`inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border ${s.ring}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span
        className={`text-[10px] font-medium uppercase tracking-[0.16em] ${s.text}`}
      >
        {s.label}
      </span>
      <span className="text-xs text-rupeezy-fg font-mono tabular-nums">
        {count}
      </span>
    </div>
  );
}
