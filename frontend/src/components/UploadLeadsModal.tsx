import { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Download,
  Play,
  Square,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
} from 'lucide-react';
import {
  type BatchUploadResponse,
  type QueuedLead,
  dialNextLead,
  getLeadsQueue,
  uploadLeadsCsv,
} from '../lib/api';

const TEMPLATE_CSV =
  'name,phone,language_pref,source\n' +
  'Aman Sharma,+919876543210,english,referral\n' +
  'Priya Iyer,+919812345678,hindi,website\n';

/**
 * Upload-leads modal. Three concerns in one panel:
 *   1. CSV upload (drop or pick) -> batch endpoint -> show counts
 *   2. Live queue table (polled every 4s while open OR while processing)
 *   3. "Process queue" button — kicks dial-next every 4s until {idle:true}.
 *      After every dial-next response we also call onAfterDial() so the parent
 *      can refresh the funnel + leads table.
 */
export default function UploadLeadsModal({
  onClose,
  onAfterDial,
}: {
  onClose: () => void;
  onAfterDial: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<BatchUploadResponse | null>(
    null,
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedLead[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stopRef = useRef(false);

  const refreshQueue = async () => {
    try {
      const q = await getLeadsQueue();
      setQueue(q.queued);
    } catch (e) {
      console.warn('queue refresh failed', e);
    }
  };

  useEffect(() => {
    void refreshQueue();
    const t = setInterval(() => void refreshQueue(), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const res = await uploadLeadsCsv(file);
      setUploadResult(res);
      await refreshQueue();
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = () => {
    const url = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rupeezy_leads_template.csv';
    a.click();
  };

  const stopProcessing = () => {
    stopRef.current = true;
    setProcessing(false);
  };

  const startProcessing = async () => {
    if (processing) return;
    stopRef.current = false;
    setProcessing(true);
    setProcessError(null);

    while (!stopRef.current) {
      try {
        const res = await dialNextLead();
        await refreshQueue();
        onAfterDial();
        if (res.idle) break;
      } catch (e) {
        setProcessError((e as Error).message);
        break;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }

    setProcessing(false);
    stopRef.current = false;
  };

  const queuedCount = queue.filter((q) => q.status === 'queued').length;
  const completedCount = queue.filter((q) => q.status === 'completed').length;

  return (
    <div
      className="fixed inset-0 z-50 bg-rupeezy-ink/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl glass-elevated rounded-2xl shadow-lifted max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-7 py-5 border-b border-rupeezy-border-subtle flex items-center justify-between">
          <div>
            <div className="eyebrow mb-0.5">Batch upload</div>
            <div className="font-serif text-lg text-rupeezy-fg leading-tight">
              Upload leads
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

        {/* Body */}
        <div className="px-7 py-6 space-y-6 overflow-y-auto">
          {/* Upload zone */}
          <div className="rounded-xl border border-dashed border-rupeezy-border bg-rupeezy-card/40 p-5">
            <div className="flex items-start gap-3 mb-4">
              <Upload
                size={18}
                className="text-rupeezy-fg-faint mt-0.5 shrink-0"
              />
              <div>
                <div className="text-sm text-rupeezy-fg leading-snug">
                  Drop or select a CSV file
                </div>
                <div className="text-[11px] text-rupeezy-fg-faint mt-1 font-mono">
                  Format: name, phone, language_pref, source
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-rupeezy-border text-rupeezy-fg-muted hover:border-rupeezy-fg-faint hover:text-rupeezy-fg transition-colors"
              >
                <Download size={12} />
                Download template
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-rupeezy-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {uploading ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Upload size={12} />
                    Choose file
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Upload result */}
          {uploadError && (
            <div className="rounded-lg border border-rupeezy-hot/30 bg-rupeezy-hot-faint px-4 py-3 text-sm text-rupeezy-hot flex items-start gap-2.5">
              <XCircle size={14} className="mt-0.5 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
          {uploadResult && (
            <div className="rounded-lg border border-rupeezy-border bg-rupeezy-card px-4 py-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 items-center">
                <span className="inline-flex items-center gap-1.5 text-rupeezy-ok">
                  <CheckCircle2 size={13} />
                  <span className="text-rupeezy-fg-muted">
                    inserted{' '}
                    <span className="font-mono text-rupeezy-fg tabular-nums">
                      {uploadResult.inserted}
                    </span>
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-rupeezy-warm">
                  <AlertTriangle size={13} />
                  <span className="text-rupeezy-fg-muted">
                    skipped{' '}
                    <span className="font-mono text-rupeezy-fg tabular-nums">
                      {uploadResult.skipped_duplicates}
                    </span>
                  </span>
                </span>
                {uploadResult.errors.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-rupeezy-hot">
                    <XCircle size={13} />
                    <span className="text-rupeezy-fg-muted">
                      errors{' '}
                      <span className="font-mono text-rupeezy-fg tabular-nums">
                        {uploadResult.errors.length}
                      </span>
                    </span>
                  </span>
                )}
              </div>
              {uploadResult.errors.length > 0 && (
                <ul className="mt-3 text-[11px] text-rupeezy-hot font-mono space-y-0.5 max-h-24 overflow-y-auto pl-1">
                  {uploadResult.errors.map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Process queue control */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {!processing ? (
                <button
                  type="button"
                  onClick={() => void startProcessing()}
                  disabled={queuedCount === 0}
                  className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-md bg-rupeezy-accent text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                  title={
                    queuedCount === 0
                      ? 'No queued leads'
                      : 'Dial each queued lead through the real conversation engine, one at a time.'
                  }
                >
                  <Play size={12} />
                  Process queue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopProcessing}
                  className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-md border border-rupeezy-hot/40 text-rupeezy-hot hover:bg-rupeezy-hot-faint transition-colors"
                >
                  <Square size={12} />
                  Stop after current lead
                </button>
              )}
              <div className="text-xs text-rupeezy-fg-faint font-mono tabular-nums">
                {queuedCount} queued · {completedCount} done · {queue.length}{' '}
                total
              </div>
              {processError && (
                <span className="text-xs text-rupeezy-hot font-mono">
                  {processError}
                </span>
              )}
            </div>

            {processing ? (
              <div className="flex items-start gap-2.5 text-xs text-rupeezy-warm bg-rupeezy-warm-faint border border-rupeezy-warm/30 rounded-md px-3 py-2.5 leading-relaxed">
                <PulseDot />
                <span>
                  Dialing… each lead runs a real ~30s call through Gemini + RAG
                  + scoring. The dashboard updates as each one completes — you
                  don't need to watch this.
                </span>
              </div>
            ) : queuedCount > 0 ? (
              <div className="text-xs text-rupeezy-fg-faint leading-relaxed">
                Each queued lead becomes a real conversation through the agent
                ({queuedCount} × ~30s ≈{' '}
                <span className="text-rupeezy-fg-muted font-mono">
                  {Math.round(queuedCount * 0.5)}–{queuedCount} min
                </span>{' '}
                total). You can close this modal — processing continues in the
                background and the dashboard updates as leads complete.
              </div>
            ) : null}
          </div>

          {/* Live queue */}
          <div>
            <div className="eyebrow mb-3">Live queue</div>
            {queue.length === 0 ? (
              <div className="text-xs text-rupeezy-fg-faint italic px-1 py-3">
                No leads queued. Upload a CSV to begin.
              </div>
            ) : (
              <ul className="divide-y divide-rupeezy-border-subtle border border-rupeezy-border rounded-lg bg-rupeezy-card max-h-64 overflow-y-auto">
                {queue.map((q) => (
                  <li
                    key={q.lead_id}
                    className="px-3.5 py-2.5 flex items-center gap-3 text-xs"
                  >
                    <StatusBadge status={q.status} />
                    <div className="flex-1 truncate text-rupeezy-fg">
                      {q.name}
                    </div>
                    <div className="text-rupeezy-fg-muted font-mono truncate">
                      {q.phone}
                    </div>
                    <div className="text-rupeezy-fg-faint font-mono w-16 truncate text-right">
                      {q.language_pref}
                    </div>
                    {q.bucket && <BucketTag bucket={q.bucket} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PulseDot() {
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-rupeezy-warm animate-pulse shrink-0 mt-1" />
  );
}

function StatusBadge({ status }: { status: QueuedLead['status'] }) {
  const map = {
    queued: {
      label: 'queued',
      cls: 'bg-rupeezy-card text-rupeezy-fg-muted border-rupeezy-border',
    },
    contacting: {
      label: 'contacting',
      cls: 'bg-rupeezy-accent-faint text-rupeezy-accent border-rupeezy-accent/30 animate-pulse',
    },
    completed: {
      label: 'done',
      cls: 'bg-rupeezy-ok-faint text-rupeezy-ok border-rupeezy-ok/30',
    },
    failed: {
      label: 'failed',
      cls: 'bg-rupeezy-hot-faint text-rupeezy-hot border-rupeezy-hot/30',
    },
  } as const;
  const s = map[status];
  return (
    <span
      className={`inline-block min-w-[68px] text-center text-[10px] uppercase tracking-[0.16em] font-mono px-2 py-0.5 rounded-full border ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function BucketTag({ bucket }: { bucket: 'hot' | 'warm' | 'cold' }) {
  const map = {
    hot: 'text-rupeezy-hot',
    warm: 'text-rupeezy-warm',
    cold: 'text-rupeezy-cold',
  } as const;
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.16em] font-mono ${map[bucket]}`}
    >
      {bucket}
    </span>
  );
}
