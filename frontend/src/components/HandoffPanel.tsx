import type {
  Bucket,
  HandoffRecord,
  NextActionType,
  ObjectionRaised,
  SignalBreakdown,
} from '../lib/api';

const BUCKET_STYLE: Record<
  Bucket,
  { label: string; bg: string; border: string; text: string; dot: string }
> = {
  hot: {
    label: 'HOT',
    bg: 'bg-rupeezy-hot-faint',
    border: 'border-rupeezy-hot/30',
    text: 'text-rupeezy-hot',
    dot: 'bg-rupeezy-hot',
  },
  warm: {
    label: 'WARM',
    bg: 'bg-rupeezy-warm-faint',
    border: 'border-rupeezy-warm/30',
    text: 'text-rupeezy-warm',
    dot: 'bg-rupeezy-warm',
  },
  cold: {
    label: 'COLD',
    bg: 'bg-rupeezy-cold-faint',
    border: 'border-rupeezy-cold/30',
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
  existing_broker: 'Existing broker',
  not_enough_contacts: 'Not enough contacts',
  client_support: 'Client support concerns',
  trustworthiness: 'Trust / legitimacy',
  think_about_it: 'Defer / think about it',
  security_deposit: 'Security deposit',
  nism_required: 'NISM required',
  other: 'Other',
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
  const {
    classification,
    discovery,
    summary_short,
    objections_raised,
    unresolved_questions,
    next_action,
    call,
  } = handoff;
  const bs = BUCKET_STYLE[classification.bucket];

  return (
    <aside className="fixed inset-y-0 right-0 w-full sm:w-[480px] glass-elevated overflow-y-auto z-40">
      <div className="px-7 py-5 border-b border-rupeezy-border-subtle flex items-center justify-between sticky top-0 bg-rupeezy-elevated/95 backdrop-blur-xl z-10">
        <div>
          <div className="eyebrow mb-0.5">Post-call handoff</div>
          <div className="text-xs font-mono text-rupeezy-fg-faint">
            conv {handoff.lead_id}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-rupeezy-fg-muted hover:text-rupeezy-fg text-xl leading-none px-2 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>

      <div className="px-7 py-6 space-y-7">
        {/* Bucket card with confidence + rationale */}
        <div className={`rounded-xl ${bs.bg} ${bs.border} border p-5`}>
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${bs.dot}`} />
            <span
              className={`text-base font-medium tracking-[0.18em] ${bs.text}`}
            >
              {bs.label}
            </span>
            <span className="text-xs text-rupeezy-fg-faint font-mono ml-auto tabular-nums">
              {(classification.confidence * 100).toFixed(0)}% confidence
            </span>
          </div>
          <div className="mt-3 text-sm text-rupeezy-fg leading-relaxed">
            {classification.rationale}
          </div>
        </div>

        {/* Summary */}
        <Section title="Summary">
          <div className="text-sm text-rupeezy-fg leading-relaxed">
            {summary_short}
          </div>
        </Section>

        {/* Next action */}
        <Section title="Next action">
          <div className="rounded-lg bg-rupeezy-card border border-rupeezy-border px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm text-rupeezy-fg">
                {NEXT_ACTION_LABEL[next_action.type]}
              </div>
              {next_action.scheduled_for && (
                <div className="text-[11px] text-rupeezy-fg-faint mt-0.5">
                  scheduled {new Date(next_action.scheduled_for).toLocaleString()}
                </div>
              )}
            </div>
            <span className="text-[10px] uppercase tracking-[0.16em] px-2.5 py-1 rounded-full bg-rupeezy-accent-faint text-rupeezy-accent border border-rupeezy-accent/30 font-mono">
              {next_action.type}
            </span>
          </div>
        </Section>

        {/* Discovery grid */}
        <Section title="Discovery">
          <div className="grid grid-cols-2 gap-px bg-rupeezy-border rounded-lg overflow-hidden">
            <Field k="Role" v={discovery.current_role} />
            <Field k="Current broker" v={discovery.current_broker ?? '—'} />
            <Field
              k="Est. clients"
              v={discovery.estimated_clients?.toString() ?? '—'}
            />
            <Field
              k="Est. AUM"
              v={
                discovery.estimated_aum_inr
                  ? `₹${discovery.estimated_aum_inr.toLocaleString('en-IN')}`
                  : '—'
              }
            />
            <Field
              k="NISM Series VII"
              v={
                discovery.has_nism_series_vii === null ||
                discovery.has_nism_series_vii === undefined
                  ? '—'
                  : discovery.has_nism_series_vii
                    ? 'yes'
                    : 'no'
              }
            />
            <Field k="Language" v={handoff.contact.language_used} />
          </div>
        </Section>

        {/* Signal breakdown */}
        <Section title="Signal breakdown">
          <div className="space-y-3.5">
            {(
              Object.keys(classification.signal_breakdown) as Array<
                keyof SignalBreakdown
              >
            ).map((k) => (
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
        <Section title={`Objections raised — ${objections_raised.length}`}>
          {objections_raised.length === 0 ? (
            <div className="text-sm text-rupeezy-fg-faint">
              None — lead engaged without resistance.
            </div>
          ) : (
            <div className="space-y-2">
              {objections_raised.map((o, i) => (
                <ObjectionRow key={i} obj={o} />
              ))}
            </div>
          )}
        </Section>

        {/* Unresolved questions */}
        <Section
          title={`Unresolved questions — ${unresolved_questions.length}`}
        >
          {unresolved_questions.length === 0 ? (
            <div className="text-sm text-rupeezy-fg-faint">None.</div>
          ) : (
            <ul className="space-y-2">
              {unresolved_questions.map((q, i) => (
                <li key={i} className="text-sm text-rupeezy-fg flex gap-2.5">
                  <span className="text-rupeezy-warm mt-1">·</span>
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Call meta */}
        <Section title="Call">
          <div className="grid grid-cols-3 gap-px bg-rupeezy-border rounded-lg overflow-hidden">
            <Field k="Duration" v={`${call.duration_sec}s`} />
            <Field k="Turns" v={call.turn_count.toString()} />
            <Field k="Ended by" v={call.ended_by} />
          </div>
        </Section>
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>
      {children}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-rupeezy-card px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-rupeezy-fg-faint mb-1">
        {k}
      </div>
      <div className="text-sm text-rupeezy-fg truncate font-mono">{v}</div>
    </div>
  );
}

function SignalBar({
  label,
  value,
  negative,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  const pct = Math.round(value * 100);
  const isGood = negative ? value < 0.5 : value >= 0.5;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-rupeezy-fg-muted">{label}</span>
        <span className="font-mono text-rupeezy-fg-faint tabular-nums">
          {pct}
        </span>
      </div>
      <div className="h-[3px] bg-rupeezy-border-subtle rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${isGood ? 'bg-rupeezy-ok' : 'bg-rupeezy-hot'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ObjectionRow({ obj }: { obj: ObjectionRaised }) {
  const resColor =
    obj.resolved === 'true'
      ? 'text-rupeezy-ok border-rupeezy-ok/30 bg-rupeezy-ok-faint'
      : obj.resolved === 'partial'
        ? 'text-rupeezy-warm border-rupeezy-warm/30 bg-rupeezy-warm-faint'
        : 'text-rupeezy-hot border-rupeezy-hot/30 bg-rupeezy-hot-faint';
  return (
    <div className="rounded-lg bg-rupeezy-card border border-rupeezy-border p-3.5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-rupeezy-fg">
          {OBJECTION_LABEL[obj.id] ?? obj.id}
        </div>
        <span
          className={`text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-full border font-mono ${resColor}`}
        >
          {obj.resolved}
        </span>
      </div>
      <div className="text-[10px] text-rupeezy-fg-faint font-mono mt-0.5">
        turn {obj.raised_at_turn}
      </div>
      {obj.notes && (
        <div className="text-xs text-rupeezy-fg-muted mt-2 leading-relaxed">
          {obj.notes}
        </div>
      )}
    </div>
  );
}
