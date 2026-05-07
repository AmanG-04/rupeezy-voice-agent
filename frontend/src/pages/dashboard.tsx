import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Upload, Search, Trash2 } from 'lucide-react';
import FunnelHeader from '../components/FunnelHeader';
import LeadsTable from '../components/LeadsTable';
import LeadDrawer from '../components/LeadDrawer';
import UploadLeadsModal from '../components/UploadLeadsModal';
import { Brand } from '../components/Brand';
import {
  type Bucket,
  type Funnel,
  type LeadRow,
  deleteBucket,
  deleteLead,
  getFunnel,
  listLeads,
} from '../lib/api';

const BUCKET_FILTERS: Array<{ key: 'all' | Bucket; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'hot', label: 'Hot' },
  { key: 'warm', label: 'Warm' },
  { key: 'cold', label: 'Cold' },
];

export default function DashboardPage() {
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [bucketFilter, setBucketFilter] = useState<'all' | Bucket>('all');
  const [search, setSearch] = useState('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [f, l] = await Promise.all([
        getFunnel(),
        listLeads(bucketFilter === 'all' ? {} : { bucket: bucketFilter }),
      ]);
      setFunnel(f);
      setLeads(l);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [bucketFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-refresh every 5s so newly-ended conversations appear without a manual click.
  useEffect(() => {
    const t = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleDelete = useCallback(
    async (convId: string) => {
      try {
        await deleteLead(convId);
        if (selectedConvId === convId) setSelectedConvId(null);
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refresh, selectedConvId],
  );

  const handleClearBucket = useCallback(async () => {
    if (bucketFilter === 'all') return;
    if (
      !window.confirm(
        `Clear ALL ${bucketFilter.toUpperCase()} leads? Removes their conversations, transcripts, handoffs, and WhatsApp logs. This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      const r = await deleteBucket(bucketFilter as Bucket);
      setSelectedConvId(null);
      await refresh();
      // small visual confirmation via the existing error slot is tacky;
      // the funnel + table will simply show the new (lower) counts.
      void r;
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bucketFilter, refresh]);

  const filteredLeads = search
    ? leads.filter((l) => {
        const blob =
          `${l.summary_short} ${l.conv_id} ${l.language_used} ${l.next_action}`.toLowerCase();
        return blob.includes(search.toLowerCase());
      })
    : leads;

  return (
    <div className="min-h-screen bg-rupeezy-ink">
      {/* Glass header */}
      <header className="border-b border-rupeezy-border-subtle bg-rupeezy-surface/80 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center gap-5">
          <Link
            to="/"
            className="text-rupeezy-fg-faint hover:text-rupeezy-fg transition-colors"
            aria-label="Back to home"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="hidden sm:block">
            <Brand size="sm" />
          </div>
          <div className="flex-1 min-w-0 ml-2">
            <div className="font-serif text-lg text-rupeezy-fg leading-tight">
              RM Dashboard
            </div>
            <div className="text-xs text-rupeezy-fg-faint mt-0.5">
              Conversion funnel · qualified leads · handoff context
            </div>
          </div>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 text-xs px-3.5 py-2 rounded-md bg-rupeezy-accent text-white hover:opacity-90 transition-opacity"
            title="Upload a CSV of leads and dial them via the agent"
          >
            <Upload size={13} />
            Upload leads
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-rupeezy-border text-rupeezy-fg-muted hover:border-rupeezy-fg-faint hover:text-rupeezy-fg transition-colors"
            title="Auto-refreshes every 5 seconds"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-6xl mx-auto px-8 py-8 space-y-7">
        {error && (
          <div className="rounded-xl border border-rupeezy-hot/30 bg-rupeezy-hot-faint px-4 py-3 text-sm text-rupeezy-hot">
            {error}
          </div>
        )}

        {/* Zone 1: Funnel header */}
        {funnel && <FunnelHeader funnel={funnel} />}

        {/* Zone 4: Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-rupeezy-border bg-rupeezy-card p-1">
            {BUCKET_FILTERS.map((f) => {
              const active = bucketFilter === f.key;
              return (
                <button
                  type="button"
                  key={f.key}
                  onClick={() => setBucketFilter(f.key)}
                  className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                    active
                      ? 'bg-rupeezy-accent text-white'
                      : 'text-rupeezy-fg-muted hover:text-rupeezy-fg'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="flex-1 min-w-[220px] relative">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-rupeezy-fg-faint pointer-events-none"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search summary, conv id, language, action…"
              className="w-full rounded-md bg-rupeezy-card border border-rupeezy-border pl-9 pr-3 py-2 text-sm placeholder:text-rupeezy-fg-faint focus:outline-none focus:border-rupeezy-accent transition-colors"
            />
          </div>
          <div className="text-xs text-rupeezy-fg-faint font-mono tabular-nums">
            {filteredLeads.length} of {leads.length}
          </div>
          {bucketFilter !== 'all' && leads.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearBucket()}
              title={`Delete all ${bucketFilter.toUpperCase()} leads`}
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-rupeezy-hot/40 text-rupeezy-hot hover:bg-rupeezy-hot-faint transition-colors"
            >
              <Trash2 size={11} />
              Clear all {bucketFilter.toUpperCase()}
            </button>
          )}
        </div>

        {/* Zone 2: Leads table */}
        <LeadsTable
          leads={filteredLeads}
          onSelect={setSelectedConvId}
          selectedConvId={selectedConvId}
          onDelete={(cid) => void handleDelete(cid)}
          loading={loading && leads.length === 0}
        />
      </main>

      {/* Zone 3: Drilldown drawer */}
      {selectedConvId && (
        <LeadDrawer
          convId={selectedConvId}
          onClose={() => setSelectedConvId(null)}
        />
      )}

      {/* Phase 9: batch upload modal */}
      {uploadOpen && (
        <UploadLeadsModal
          onClose={() => setUploadOpen(false)}
          onAfterDial={() => void refresh()}
        />
      )}
    </div>
  );
}
