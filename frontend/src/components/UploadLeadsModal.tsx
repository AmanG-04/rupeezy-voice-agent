import { useEffect, useRef, useState } from 'react';
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
  const [uploadResult, setUploadResult] = useState<BatchUploadResponse | null>(null);
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
      // Non-fatal — keep last good state.
      console.warn('queue refresh failed', e);
    }
  };

  // Initial fetch + 4s poll while modal is open.
  useEffect(() => {
    void refreshQueue();
    const t = setInterval(() => void refreshQueue(), 4000);
    return () => clearInterval(t);
  }, []);

  // Close on Esc.
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

    // Poll dial-next every 4s until the queue is idle (or the user stops).
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
      // Pace the next call. 4s is comfortably above Gemini's free-tier RPM
      // ceiling for the 3-turn scripted scenario the dialer runs.
      await new Promise((r) => setTimeout(r, 4000));
    }

    setProcessing(false);
    stopRef.current = false;
  };

  const queuedCount = queue.filter((q) => q.status === 'queued').length;
  const completedCount = queue.filter((q) => q.status === 'completed').length;

  return (
    <div
      className="fixed inset-0 z-50 bg-rupeezy-ink/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-rupeezy-surface border border-slate-800 rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">
              Batch upload
            </div>
            <div className="text-sm font-semibold text-slate-200 mt-0.5">
              Upload leads
            </div>
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

        {/* Body */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* Upload zone */}
          <div className="rounded-xl border border-dashed border-slate-700 bg-rupeezy-card/40 p-5">
            <div className="text-sm text-slate-300 mb-1">
              Drop or select a CSV file.
            </div>
            <div className="text-xs text-slate-500 mb-4 font-mono">
              Format: name, phone, language_pref, source
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="text-xs px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 transition-colors"
              >
                Download template
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  // Reset so the same file name can be re-selected.
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-xs px-3 py-1.5 rounded-md bg-rupeezy-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {uploading ? 'Uploading…' : 'Choose file'}
              </button>
            </div>
          </div>

          {/* Upload result */}
          {uploadError && (
            <div className="rounded-lg border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-200">
              {uploadError}
            </div>
          )}
          {uploadResult && (
            <div className="rounded-lg border border-slate-800 bg-rupeezy-card px-4 py-3 text-sm text-slate-200">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  <span className="text-emerald-400">✓ inserted:</span>{' '}
                  <span className="font-mono">{uploadResult.inserted}</span>
                </span>
                <span>
                  <span className="text-amber-400">⚠ skipped:</span>{' '}
                  <span className="font-mono">{uploadResult.skipped_duplicates}</span>
                </span>
                {uploadResult.errors.length > 0 && (
                  <span>
                    <span className="text-rose-400">errors:</span>{' '}
                    <span className="font-mono">{uploadResult.errors.length}</span>
                  </span>
                )}
              </div>
              {uploadResult.errors.length > 0 && (
                <ul className="mt-2 text-xs text-rose-300 font-mono space-y-0.5 max-h-24 overflow-y-auto">
                  {uploadResult.errors.map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Process queue control */}
          <div className="flex flex-wrap items-center gap-3">
            {!processing ? (
              <button
                type="button"
                onClick={() => void startProcessing()}
                disabled={queuedCount === 0}
                className="text-xs px-3 py-1.5 rounded-md bg-rupeezy-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                title={queuedCount === 0 ? 'No queued leads' : 'Run dial-next every 4s until idle'}
              >
                Process queue ▷
              </button>
            ) : (
              <button
                type="button"
                onClick={stopProcessing}
                className="text-xs px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 transition-colors"
              >
                ■ Stop
              </button>
            )}
            <div className="text-xs text-slate-500 font-mono">
              {queuedCount} queued · {completedCount} done · {queue.length} total
            </div>
            {processError && (
              <span className="text-xs text-rose-300 font-mono">{processError}</span>
            )}
          </div>

          {/* Live queue */}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">
              Live queue
            </div>
            {queue.length === 0 ? (
              <div className="text-xs text-slate-600 italic px-1 py-3">
                No leads queued. Upload a CSV to begin.
              </div>
            ) : (
              <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg bg-rupeezy-card/40 max-h-64 overflow-y-auto">
                {queue.map((q) => (
                  <li
                    key={q.lead_id}
                    className="px-3 py-2 flex items-center gap-3 text-xs"
                  >
                    <StatusBadge status={q.status} />
                    <div className="flex-1 truncate text-slate-200">{q.name}</div>
                    <div className="text-slate-500 font-mono truncate">{q.phone}</div>
                    <div className="text-slate-600 font-mono w-16 truncate">
                      {q.language_pref}
                    </div>
                    {q.bucket && (
                      <BucketTag bucket={q.bucket} />
                    )}
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

function StatusBadge({ status }: { status: QueuedLead['status'] }) {
  const map = {
    queued: { label: 'queued', cls: 'bg-slate-700/40 text-slate-300 border-slate-700' },
    contacting: {
      label: 'contacting',
      cls: 'bg-rupeezy-accent/20 text-rupeezy-accent border-rupeezy-accent/40 animate-pulse',
    },
    completed: { label: 'done', cls: 'bg-emerald-700/30 text-emerald-300 border-emerald-700/40' },
    failed: { label: 'failed', cls: 'bg-rose-900/40 text-rose-300 border-rose-800/50' },
  } as const;
  const s = map[status];
  return (
    <span
      className={`inline-block min-w-[68px] text-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${s.cls}`}
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
    <span className={`text-[10px] font-bold uppercase tracking-wider ${map[bucket]}`}>
      {bucket}
    </span>
  );
}
