import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import HandoffPanel from '../components/HandoffPanel';
import {
  type ConversationMessage,
  type HandoffRecord,
  createConversation,
  endConversation,
  streamTurn,
} from '../lib/api';

interface ChatMessage extends ConversationMessage {
  pending?: boolean;
}

type Status = 'idle' | 'starting' | 'live' | 'streaming' | 'ended' | 'error' | 'scoring';

export default function ChatPage() {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<HandoffRecord | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-create conversation on mount.
  useEffect(() => {
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages / token streaming.
  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  // Hot-key Ctrl+L to reset.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function start() {
    setStatus('starting');
    setErrorMsg(null);
    setMessages([]);
    setHandoff(null);
    setHandoffError(null);
    try {
      const r = await createConversation();
      setConvId(r.conv_id);
      setStatus('live');
      inputRef.current?.focus();
    } catch (e) {
      setStatus('error');
      setErrorMsg((e as Error).message);
    }
  }

  async function reset() {
    if (convId && status !== 'ended') {
      try {
        await endConversation(convId, 'lead');
      } catch {
        // ignore — we're starting fresh
      }
    }
    await start();
  }

  async function endCall() {
    if (!convId) return;
    setStatus('scoring');
    setErrorMsg(null);
    try {
      const r = await endConversation(convId, 'lead');
      setStatus('ended');
      if (r.handoff) setHandoff(r.handoff);
      if (r.handoff_error) setHandoffError(r.handoff_error);
    } catch (e) {
      setStatus('error');
      setErrorMsg((e as Error).message);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || !convId || status === 'streaming') return;

    setInput('');
    setStatus('streaming');
    setMessages((prev) => [
      ...prev,
      { role: 'user', text, created_at: new Date().toISOString() },
      { role: 'assistant', text: '', created_at: new Date().toISOString(), pending: true },
    ]);

    let accumulated = '';
    try {
      await streamTurn(convId, text, {
        onToken: (chunk) => {
          accumulated += chunk;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant' && last.pending) {
              next[next.length - 1] = { ...last, text: accumulated };
            }
            return next;
          });
        },
        onError: (msg) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant' && last.pending) {
              next[next.length - 1] = {
                ...last,
                text: accumulated || `[error: ${msg}]`,
                pending: false,
              };
            }
            return next;
          });
          setStatus('error');
          setErrorMsg(msg);
        },
      });
    } catch (e) {
      setStatus('error');
      setErrorMsg((e as Error).message);
    } finally {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && last.pending) {
          next[next.length - 1] = { ...last, pending: false };
        }
        return next;
      });
      if (status !== 'ended') setStatus('live');
      inputRef.current?.focus();
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const canSend = status === 'live' && input.trim().length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-rupeezy-surface">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm">
            ←
          </Link>
          <div className="w-9 h-9 rounded-lg bg-rupeezy-accent flex items-center justify-center font-bold text-white text-sm">
            A
          </div>
          <div className="flex-1">
            <div className="font-semibold leading-tight">Aria — Rupeezy AI Partner Agent</div>
            <div className="text-xs text-slate-500 font-mono">
              {convId ? `conv ${convId}` : 'starting…'}
            </div>
          </div>
          <StatusBadge status={status} />
          {status === 'live' || status === 'streaming' ? (
            <button
              type="button"
              onClick={endCall}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:border-rupeezy-hot hover:text-rupeezy-hot transition-colors"
            >
              End call
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void reset()}
            title="Reset (Ctrl+L)"
            className="text-xs px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 transition-colors"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && status !== 'starting' && (
            <div className="text-center text-slate-500 text-sm py-12">
              Start by greeting Aria — try “Hi, who is this?” or “Hello, kaun bol raha hai?”
            </div>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} message={m} />
          ))}
        </div>
      </div>

      {/* Scoring overlay */}
      {status === 'scoring' && (
        <div className="fixed inset-0 z-30 bg-rupeezy-ink/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="rounded-xl bg-rupeezy-card border border-slate-700 px-6 py-5 shadow-2xl flex items-center gap-4">
            <span className="inline-flex gap-1 items-center">
              <span className="w-2 h-2 rounded-full bg-rupeezy-accent animate-pulse" />
              <span className="w-2 h-2 rounded-full bg-rupeezy-accent animate-pulse [animation-delay:200ms]" />
              <span className="w-2 h-2 rounded-full bg-rupeezy-accent animate-pulse [animation-delay:400ms]" />
            </span>
            <div className="text-sm text-slate-200">
              Running post-call pipeline — classifying, summarising, building handoff…
            </div>
          </div>
        </div>
      )}

      {/* Handoff side panel */}
      {handoff && status === 'ended' && (
        <HandoffPanel handoff={handoff} onClose={() => setHandoff(null)} />
      )}

      {/* Handoff error banner */}
      {handoffError && status === 'ended' && !handoff && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 max-w-md text-xs px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-200">
          Handoff scoring failed: {handoffError}. The conversation is saved.
        </div>
      )}

      {/* Composer */}
      <footer className="border-t border-slate-800 bg-rupeezy-surface">
        <div className="max-w-3xl mx-auto px-6 py-4">
          {errorMsg && status === 'error' && (
            <div className="mb-2 text-xs text-rupeezy-hot">{errorMsg}</div>
          )}
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKey}
              disabled={status === 'ended' || status === 'starting'}
              placeholder={
                status === 'ended'
                  ? 'Conversation ended. Press Reset to start a new one.'
                  : 'Type a message — Enter to send, Shift+Enter for newline'
              }
              className="flex-1 resize-none rounded-lg bg-rupeezy-card border border-slate-700 px-4 py-3 text-sm placeholder:text-slate-600 focus:outline-none focus:border-rupeezy-accent transition-colors disabled:opacity-50"
              rows={2}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="px-5 py-3 rounded-lg bg-rupeezy-accent text-white font-medium text-sm hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
            >
              {status === 'streaming' ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-rupeezy-accent text-white rounded-br-sm'
            : 'bg-rupeezy-card text-slate-100 rounded-bl-sm border border-slate-800'
        }`}
      >
        {message.text || (message.pending ? <Pulse /> : '')}
      </div>
    </div>
  );
}

function Pulse() {
  return (
    <span className="inline-flex gap-1 items-center">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse [animation-delay:200ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse [animation-delay:400ms]" />
    </span>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; className: string }> = {
    idle: { label: 'idle', className: 'bg-slate-700 text-slate-300' },
    starting: { label: 'starting', className: 'bg-slate-700 text-slate-300' },
    live: { label: 'live', className: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50' },
    streaming: { label: 'streaming', className: 'bg-rupeezy-accent/20 text-indigo-300 border border-indigo-700/50' },
    scoring: { label: 'scoring', className: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
    ended: { label: 'ended', className: 'bg-slate-700 text-slate-400' },
    error: { label: 'error', className: 'bg-red-900/40 text-red-300 border border-red-700/50' },
  };
  const { label, className } = map[status];
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-mono ${className}`}>{label}</span>
  );
}
