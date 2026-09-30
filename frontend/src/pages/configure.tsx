import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { defaultSettings, rupeezySettings, loadAgentSettings, type AgentSettings } from '../lib/agentSettings';

export default function ConfigurePage() {
  const [settings, setSettings] = useState(loadAgentSettings);
  const navigate = useNavigate();
  const update = (key: keyof AgentSettings, value: string) => setSettings((s) => ({ ...s, [key]: value }));

  return (
    <main className="max-w-3xl mx-auto px-5 py-10 space-y-8">
      <header className="flex items-center justify-between">
        <Brand size="sm" />
        <Link to="/" className="text-sm text-rupeezy-accent">
          Home
        </Link>
      </header>
      <section>
        <div className="eyebrow mb-3">
          Your demo session
        </div>
        <h1 className="text-3xl mb-3">
          Give the agent your business context
        </h1>
        <p className="text-rupeezy-fg-muted">
          Settings apply to new conversations in this browser tab. Other visitors keep their own configuration. Use fictional business information for this public demo.
        </p>
      </section>
      <form className="glass-card rounded-xl p-6 space-y-5" onSubmit={(event) => {
        event.preventDefault();
        sessionStorage.setItem('agent-settings', JSON.stringify(settings));
        navigate('/voice');
      }}>
        {([
          ['business_name', 'Business name', 100],
          ['agent_name', 'Agent name', 50],
          ['program_name', 'Program or offer', 150],
        ] as const).map(([key, label, max]) => (
          <label key={key} className="block text-sm space-y-2">
            <span>
              {label}
            </span>
            <input required maxLength={max} value={settings[key]} onChange={(event) => update(key, event.target.value)} className="w-full rounded-md bg-rupeezy-ink border border-rupeezy-border px-3 py-2" />
          </label>
        ))}
        <label className="block text-sm space-y-2">
          <span>
            Conversation language
          </span>
          <select value={settings.language} onChange={(event) => update('language', event.target.value)} className="w-full rounded-md bg-rupeezy-ink border border-rupeezy-border px-3 py-2">
            <option value="en-IN">
              English
            </option>
            <option value="hinglish">
              Hinglish
            </option>
          </select>
        </label>
        <label className="block text-sm space-y-2">
          <span>
            Confirmed business knowledge
          </span>
          <textarea rows={8} maxLength={12000} value={settings.knowledge} onChange={(event) => update('knowledge', event.target.value)} placeholder="Describe your offer, prices, eligibility, FAQs, and what the agent should not promise." className="w-full rounded-md bg-rupeezy-ink border border-rupeezy-border px-3 py-2" />
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-md bg-rupeezy-accent text-white px-4 py-2">
            Save and try voice
          </button>
          <button type="button" onClick={() => setSettings({ ...defaultSettings })} className="rounded-md border border-rupeezy-border px-4 py-2">
            Use course example
          </button>
          <button type="button" onClick={() => setSettings({ ...rupeezySettings })} className="rounded-md border border-rupeezy-border px-4 py-2">
            Load Rupeezy example
          </button>
          <button type="button" onClick={() => {
            sessionStorage.setItem('agent-settings', JSON.stringify(settings));
            navigate('/chat');
          }} className="rounded-md border border-rupeezy-border px-4 py-2">
            Test in text chat
          </button>
        </div>
        <p className="text-xs text-rupeezy-fg-muted">
          Save your settings, then click Start Live conversation and allow microphone access. Your agent will speak first. Live responses use the server’s free API quota.
        </p>
      </form>
    </main>
  );
}
