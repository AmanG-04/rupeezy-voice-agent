import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import HandoffPanel from '../components/HandoffPanel';
import { sampleHandoff, sampleMessages } from '../lib/sampleDemo';

export default function SamplePage() {
  const [visible, setVisible] = useState(1);
  const [showHandoff, setShowHandoff] = useState(false);
  return (
    <main className="max-w-4xl mx-auto px-5 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <Brand size="sm" />
        <Link to="/" className="text-rupeezy-accent text-sm">
          Home
        </Link>
      </header>
      <section className="glass-card rounded-xl p-6 space-y-3">
        <div className="eyebrow">
          Interactive example · no API calls
        </div>
        <h1 className="text-3xl">
          From conversation to an explainable handoff
        </h1>
        <p className="text-rupeezy-fg-muted">
          This authored example demonstrates the English/Hinglish workflow. Its transcript, scores, and timing are sample data, not a live model result or benchmark.
        </p>
        <Link to="/configure" className="inline-block text-sm text-rupeezy-accent">
          Configure your business and try the live agent
        </Link>
      </section>
      <section aria-label="Sample transcript" aria-live="polite" className="space-y-4">
        {sampleMessages.slice(0, visible).map((message, index) => (
          <article key={index} id={`sample-turn-${index}`} className={`rounded-xl p-5 border ${message.role === 'user' ? 'ml-6 bg-rupeezy-accent-faint border-rupeezy-accent/30' : 'mr-6 glass-card'}`}>
            <div className="eyebrow mb-2">
              {message.role === 'user' ? 'Lead' : 'Aria'} · turn {index}
            </div>
            <p className="text-sm leading-relaxed">
              {message.text}
            </p>
          </article>
        ))}
      </section>
      <div className="flex flex-wrap gap-3">
        {visible < sampleMessages.length ? (
          <button type="button" onClick={() => setVisible((v) => v + 1)} className="bg-rupeezy-accent text-white rounded-md px-4 py-2">
            Next turn
          </button>
        ) : (
          <button type="button" onClick={() => setShowHandoff(true)} className="bg-rupeezy-accent text-white rounded-md px-4 py-2">
            Inspect sample handoff
          </button>
        )}
        <button type="button" onClick={() => { setVisible(1); setShowHandoff(false); }} className="border border-rupeezy-border rounded-md px-4 py-2">
          Restart example
        </button>
      </div>
      {showHandoff && (
        <HandoffPanel handoff={sampleHandoff} onClose={() => setShowHandoff(false)} />
      )}
    </main>
  );
}
