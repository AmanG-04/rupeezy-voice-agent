import type {
  Bucket,
  HandoffRecord,
  NextActionType,
  ObjectionRaised,
  SignalBreakdown,
} from '../lib/api';

const BUCKET_STYLE: Record<Bucket, { label: string; bg: string; border: string; text: string; dot: string }> = {
  hot: {
    label: 'HOT',
    bg: 'bg-rupeezy-hot/10',
    border: 'border-rupeezy-hot/40',
    text: 'text-rupeezy-hot',
    dot: 'bg-rupeezy-hot',
  },
  warm: {
    label: 'WARM',
    bg: 'bg-rupeezy-warm/10',
    border: 'border-rupeezy-warm/40',
    text: 'text-rupeezy-warm',
    dot: 'bg-rupeezy-warm',
  },
  cold: {
    label: 'COLD',
    bg: 'bg-rupeezy-cold/10',
    border: 'border-rupeezy-cold/40',
    text: 'text-rupeezy-cold',
    dot: 'bg-rupeezy-cold',
  },
};

const NEXT_ACTION_LABEL: Record<NextActionType, string> = {
  warm_transfer: 'Warm transfer to RM',
  rm_callback: 'Schedule RM callback',
  whatsapp_link_sent: 'WhatsApp signup link sent',
  nurture_sequence: '14-day nurture sequence',
  dnd: 'Add to internal DND',
};

const OBJECTION_LABEL: Record<string, string> = {
  existing_broker: "Existing broker",
  not_enough_contacts: "Not enough contacts",
  client_support: "Client support concerns",
  trustworthiness: "Trust / legitimacy",
  think_about_it: "Defer / think about it",
  security_deposit: "Security deposit",
  nism_required: "NISM required",
  other: "Other",
};

const SIGNAL_LABEL: Record<keyof SignalBreakdown, string> = {
  stated_intent: 'Stated intent',
  engagement: 'Engagement',
  network_size: 'Network size',
  objection_pattern: 'Objection pattern',
  affirmative_cues: 'Affirmative cues',
  deferrals: 'Deferrals (lower is better)',
};

export default function HandoffPanel({
  handoff,
  onClose,
}: {
  handoff: HandoffRecord;
  onClose?: () => void;
}) {
  const { classification, discovery, summary_short, objections_raised, unresolved_questions, next_action, call } =
    handoff;
  const bs = BUCKET_STYLE[classification.bucket];

  return (
    <aside className="fixed inset-y-0 right-0 w-full sm:w-[440px] bg-rupeezy-surface border-l border-slate-800 overflow-y-auto z-40 shadow-2xl">
      <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-rupeezy-surface z-10">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Post-call handoff</div>
          <div className="text-sm font-mono text-slate-400 mt-0.5">conv {handoff.lead_id}</div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Bucket badge + confidence */}
        <div className={`rounded-2xl ${bs.bg} ${bs.border} border p-5`}>
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${bs.dot} animate-pulse`} />
            <span className={`text-2xl font-bold tracking-wider ${bs.text}`}>{bs.label}</span>
            <span className="text-xs text-slate-400 font-mono ml-auto">
              {(classification.confidence * 100).toFixed(0)}% conf
            </span>
          </div>
          <div className="mt-3 text-sm text-slate-300 leading-relaxed">
            {classification.rationale}
          </div>
        </div>

        {/* Summary */}
        <Section title="What happened">
          <div className="text-sm text-slate-200 leading-relaxed">{summary_short}</div>
        </Section>

        {/* Next action */}
        <Section title="Next action">
          <div className="rounded-xl bg-rupeezy-card border border-slate-800 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-100">
                {NEXT_ACTION_LABEL[next_action.type]}
              </div>
              {next_action.scheduled_for && (
                <div className="text-xs text-slate-500 mt-0.5">
                  scheduled {new Date(next_action.scheduled_for).toLocaleString()}
                </div>
              )}
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-rupeezy-accent/20 text-indigo-300 border border-indigo-700/50 font-mono">
              {next_action.type}
            </span>
          </div>
        </Section>

        {/* Discovery */}
        <Section title="Discovery">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Field k="Role" v={discovery.current_role} />
            <Field k="Current broker" v={discovery.current_broker ?? '—'} />
            <Field k="Est. clients" v={discovery.estimated_clients?.toString() ?? '—'} />
            <Field k="Est. AUM" v={discovery.estimated_aum_inr ? `₹${discovery.estimated_aum_inr.toLocaleString('en-IN')}` : '—'} />
            <Field
              k="NISM Series VII"
              v={discovery.has_nism_series_vii === null ? '—' : discovery.has_nism_series_vii ? 'yes' : 'no'}
            />
            <Field k="Language" v={handoff.contact.language_used} />
          </div>
        </Section>

        {/* Signals */}
        <Section title="Signal breakdown">
          <div className="space-y-2">
            {(Object.keys(classification.signal_breakdown) as Array<keyof SignalBreakdown>).map((k) => (
              <SignalBar
                key={k}
                label={SIGNAL_LABEL[k]}
                value={classification.signal_breakdown[k]}
                negative={k === 'deferrals'}
              />
            ))}
          </div>
        </Section>

        {/* Objections */}
        <Section title={`Objections raised (${objections_raised.length})`}>
          {objections_raised.length === 0 ? (
            <div className="text-sm text-slate-500">None — lead engaged without resistance.</div>
          ) : (
            <div className="space-y-2">
              {objections_raised.map((o, i) => (
                <ObjectionRow key={i} obj={o} />
              ))}
            </div>
          )}
        </Section>

        {/* Unresolved questions */}
        <Section title={`Unresolved questions (${unresolved_questions.length})`}>
          {unresolved_questions.length === 0 ? (
            <div className="text-sm text-slate-500">None.</div>
          ) : (
            <ul className="space-y-1.5">
              {unresolved_questions.map((q, i) => (
                <li key={i} className="text-sm text-slate-200 flex gap-2">
                  <span className="text-rupeezy-warm">•</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Call meta */}
        <Section title="Call">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Field k="Duration" v={`${call.duration_sec}s`} />
            <Field k="Turns" v={call.turn_count.toString()} />
            <Field k="Ended by" v={call.ended_by} />
          </div>
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">{title}</div>
      {children}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-rupeezy-card border border-slate-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
      <div className="text-sm text-slate-100 mt-0.5 truncate">{v}</div>
    </div>
  );
}

function SignalBar({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  const pct = Math.round(value * 100);
  const goodColor = 'bg-emerald-500';
  const badColor = 'bg-rupeezy-hot';
  const isGood = negative ? value < 0.5 : value >= 0.5;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-slate-400">{pct}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${isGood ? goodColor : badColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ObjectionRow({ obj }: { obj: ObjectionRaised }) {
  const resColor =
    obj.resolved === 'true'
      ? 'text-emerald-400 border-emerald-700/50 bg-emerald-900/30'
      : obj.resolved === 'partial'
      ? 'text-rupeezy-warm border-amber-700/50 bg-amber-900/30'
      : 'text-rupeezy-hot border-red-700/50 bg-red-900/30';
  return (
    <div className="rounded-lg bg-rupeezy-card border border-slate-800 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-100">{OBJECTION_LABEL[obj.id] ?? obj.id}</div>
        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-mono ${resColor}`}>
          {obj.resolved}
        </span>
      </div>
      <div className="text-[10px] text-slate-500 font-mono mt-0.5">turn {obj.raised_at_turn}</div>
      {obj.notes && <div className="text-xs text-slate-300 mt-2 leading-relaxed">{obj.notes}</div>}
    </div>
  );
}
