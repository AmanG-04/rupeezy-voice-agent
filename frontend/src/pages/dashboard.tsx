import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import FunnelHeader from '../components/FunnelHeader';
import LeadsTable from '../components/LeadsTable';
import LeadDrawer from '../components/LeadDrawer';
import { type Bucket, type Funnel, type LeadRow, getFunnel, listLeads } from '../lib/api';

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

  const filteredLeads = search
    ? leads.filter((l) => {
        const blob = `${l.summary_short} ${l.conv_id} ${l.language_used} ${l.next_action}`.toLowerCase();
        return blob.includes(search.toLowerCase());
      })
    : leads;

  return (
    <div className="min-h-screen bg-rupeezy-ink">
      {/* Header */}
      <header className="border-b border-slate-800 bg-rupeezy-surface sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm">
            ←
          </Link>
          <div className="w-9 h-9 rounded-lg bg-rupeezy-accent flex items-center justify-center font-bold text-white text-sm">
            R
          </div>
          <div className="flex-1">
            <div className="font-semibold leading-tight">RM Dashboard</div>
            <div className="text-xs text-slate-500">
              Conversion funnel · qualified leads · handoff context
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 transition-colors"
            title="Auto-refreshes every 5s"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Zone 1: Funnel header */}
        {funnel && <FunnelHeader funnel={funnel} />}

        {/* Zone 4: Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-slate-800 bg-rupeezy-card p-1">
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
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search summary, conv id, language, action…"
            className="flex-1 min-w-[220px] rounded-md bg-rupeezy-card border border-slate-700 px-3 py-1.5 text-sm placeholder:text-slate-600 focus:outline-none focus:border-rupeezy-accent"
          />
          <div className="text-xs text-slate-500 font-mono">
            {filteredLeads.length} of {leads.length}
          </div>
        </div>

        {/* Zone 2: Leads table */}
        <LeadsTable
          leads={filteredLeads}
          onSelect={setSelectedConvId}
          selectedConvId={selectedConvId}
          loading={loading && leads.length === 0}
        />
      </main>

      {/* Zone 3: Drilldown drawer */}
      {selectedConvId && (
        <LeadDrawer convId={selectedConvId} onClose={() => setSelectedConvId(null)} />
      )}
    </div>
  );
}
