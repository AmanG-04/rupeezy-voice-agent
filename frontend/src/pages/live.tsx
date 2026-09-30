import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Square, VolumeX } from 'lucide-react';
import { Brand } from '../components/Brand';
import HandoffPanel from '../components/HandoffPanel';
import { createConversation, endConversation, endConversationBeacon, type HandoffRecord } from '../lib/api';
import { LiveVoice, type LiveEvent } from '../lib/liveVoice';
import { loadAgentSettings } from '../lib/agentSettings';

export default function LivePage() {
  const [model, setModel] = useState('gemini-3.8-live');
  const [agentSettings] = useState(loadAgentSettings);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ending' | 'ended' | 'error'>('idle');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [muted, setMuted] = useState(false);
  const [handoff, setHandoff] = useState<HandoffRecord | null>(null);
  const controller = useRef<LiveVoice | null>(null);
  const conversationId = useRef<string | null>(null);
  const mounted = useRef(true);
  const ending = useRef(false);
  const complete = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const cleanup = () => {
      controller.current?.stop();
      if (conversationId.current && !complete.current && !ending.current) endConversationBeacon(conversationId.current);
    };
    window.addEventListener('pagehide', cleanup);
    return () => { mounted.current = false; cleanup(); window.removeEventListener('pagehide', cleanup); };
  }, []);

  function receive(event: LiveEvent) {
    if (!mounted.current) return;
    if (event.type === 'error') setError(event.message || 'Live session failed');
    if (event.type === 'transcript' && event.role && event.text) {
      setMessages((previous) => {
        const next = [...previous];
        const last = next[next.length - 1];
        if (last?.role === event.role) next[next.length - 1] = { ...last, text: last.text + event.text };
        else next.push({ role: event.role!, text: event.text! });
        return next;
      });
    }
  }

  async function start() {
    setStatus('connecting'); setError(''); setMessages([]); setHandoff(null);
    complete.current = false; ending.current = false;
    conversationId.current = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error'); setError('Microphone capture requires HTTPS or localhost.'); return;
    }
    try {
      const created = await createConversation();
      if (!mounted.current) { endConversationBeacon(created.conv_id); return; }
      conversationId.current = created.conv_id;
      const voice = new LiveVoice(receive, () => {
        if (mounted.current && !ending.current) {
          controller.current?.stop();
          setStatus('error');
          setError('Live connection ended. Finish the session to save its handoff, or try classic voice.');
        }
      });
      controller.current = voice;
      await voice.start(created.conv_id, model);
      if (!mounted.current) { voice.stop(); return; }
      setMuted(false); setStatus('live');
    } catch (failure) {
      controller.current?.stop();
      if (mounted.current) { setStatus('error'); setError((failure as Error).message); }
    }
  }

  async function finish() {
    if (!conversationId.current || ending.current) return;
    ending.current = true; setStatus('ending'); controller.current?.stop();
    try {
      // The backend releases the Live lock after flushing transcripts, then scores the call.
      const result = await endConversation(conversationId.current, 'lead');
      complete.current = true;
      if (mounted.current) { setHandoff(result.handoff); setError(result.handoff_error || ''); setStatus('ended'); }
    } catch (failure) {
      if (mounted.current) { setError((failure as Error).message); setStatus('error'); }
    } finally { ending.current = false; }
  }

  return (
    <main className="max-w-4xl mx-auto px-5 py-8 space-y-6">
      <header className="flex flex-wrap gap-4 items-center justify-between">
        <Brand size="sm" />
        <nav className="flex gap-4 text-sm text-rupeezy-accent">
          <Link to="/">
            Home
          </Link>
          <Link to="/voice/classic">
            Classic voice
          </Link>
          <Link to="/configure">
            Configure
          </Link>
        </nav>
      </header>
      <section className="glass-card rounded-2xl p-6 sm:p-8 space-y-5">
        <div className="eyebrow">
          {agentSettings.agent_name} · {agentSettings.business_name}
        </div>
        <h1 className="text-3xl sm:text-4xl">
          Talk naturally. Interrupt when you need to.
        </h1>
        <p className="text-sm text-rupeezy-fg-muted leading-relaxed">
          Start the call and {agentSettings.agent_name} will greet you out loud about {agentSettings.program_name}. Speak English or Hinglish, or type a question during the call. The agent replies with audio in either case.
        </p>
        <label className="block text-sm space-y-2">
          <span>
            Voice model
          </span>
          <select value={model} disabled={status === 'live' || status === 'connecting' || status === 'ending'} onChange={(event) => setModel(event.target.value)} className="w-full rounded-lg bg-rupeezy-ink border border-rupeezy-border px-3 py-2">
            <option value="gemini-3.8-live">
              Gemini 3.8 Live (recommended)
            </option>
            <option value="gemini-3.1-flash-live-preview">
              Gemini 3.1 Flash Live Preview (compare)
            </option>
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          {(status === 'idle' || status === 'ended' || (status === 'error' && !conversationId.current)) && (
            <button type="button" onClick={() => void start()} className="inline-flex items-center gap-2 rounded-lg px-5 py-3 bg-rupeezy-accent text-white">
              <Mic size={16} />
              Start Live conversation
            </button>
          )}
          {(status === 'live' || (status === 'error' && !!conversationId.current)) && (
            <button type="button" onClick={() => void finish()} className="inline-flex items-center gap-2 rounded-lg px-5 py-3 bg-rupeezy-hot text-white">
              <Square size={16} />
              End and analyze
            </button>
          )}
          {status === 'live' && (
            <>
              <button type="button" aria-pressed={muted} onClick={() => {
                const value = !muted; setMuted(value); if (controller.current) controller.current.muted = value;
              }} className="border border-rupeezy-border rounded-lg px-4 py-3">
                {muted ? 'Unmute microphone' : 'Mute microphone'}
              </button>
              <button type="button" onClick={() => controller.current?.interrupt()} className="inline-flex items-center gap-2 border border-rupeezy-border rounded-lg px-4 py-3">
                <VolumeX size={16} />
                Stop playback
              </button>
            </>
          )}
        </div>
        <p role="status" className="text-sm text-rupeezy-fg-muted">
          {status === 'connecting' ? 'Connecting and requesting microphone access…' : status === 'ending' ? 'Saving transcript and building handoff…' : status === 'live' ? 'Microphone active. Speak to begin; speak over the reply to interrupt.' : status === 'ended' ? 'Session saved.' : 'Ready when you are.'}
        </p>
        <p className="text-xs text-rupeezy-fg-faint">
          Render may take approximately 60 seconds to wake up. Sessions are limited to five minutes, with up to three simultaneous demo sessions. Headphones help prevent echo.
        </p>
        {error && (
          <p role="alert" className="text-sm text-rupeezy-hot">
            {error}
          </p>
        )}
      </section>
      {status === 'live' && (
        <form className="flex gap-3" onSubmit={(event) => { event.preventDefault(); if (text.trim()) { controller.current?.sendText(text.trim()); setText(''); } }}>
          <input aria-label="Send a text prompt to the Live model" value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} placeholder="Or type a question…" className="min-w-0 flex-1 border border-rupeezy-border rounded-lg bg-rupeezy-card px-4 py-3" />
          <button type="submit" disabled={!text.trim()} className="px-4 py-3 rounded-lg bg-rupeezy-accent text-white disabled:opacity-50">
            Send
          </button>
        </form>
      )}
      <section aria-label="Live transcript" aria-live="polite" className="space-y-3">
        {messages.map((message, index) => (
          <article key={index} className={`rounded-xl border p-4 ${message.role === 'user' ? 'ml-6 border-rupeezy-accent/30 bg-rupeezy-accent-faint' : 'mr-6 glass-card'}`}>
            <p className="eyebrow mb-2">
              {message.role === 'user' ? 'You' : 'Agent'}
            </p>
            <p className="text-sm whitespace-pre-wrap leading-relaxed">
              {message.text}
            </p>
          </article>
        ))}
      </section>
      {handoff && (
        <HandoffPanel handoff={handoff} onClose={() => setHandoff(null)} />
      )}
    </main>
  );
}
