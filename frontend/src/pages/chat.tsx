import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Square, Send } from 'lucide-react';
import HandoffPanel from '../components/HandoffPanel';
import { Brand } from '../components/Brand';
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

type Status =
  | 'idle'
  | 'starting'
  | 'live'
  | 'streaming'
  | 'ended'
  | 'error'
  | 'scoring';

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

  useEffect(() => {
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        // ignore — fresh start
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
      {
        role: 'assistant',
        text: '',
        created_at: new Date().toISOString(),
        pending: true,
      },
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
    <div className="min-h-screen flex flex-col bg-rupeezy-ink">
      {/* Header */}
      <header className="border-b border-rupeezy-border-subtle bg-rupeezy-surface/80 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
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
          <div className="flex-1 min-w-0 ml-1">
            <div className="font-serif text-base text-rupeezy-fg leading-tight">
              Aria · Text chat
            </div>
            <div className="text-[10px] text-rupeezy-fg-faint font-mono mt-0.5">
              {convId ? `conv ${convId}` : 'starting…'}
            </div>
          </div>
          <StatusPill status={status} />
          {(status === 'live' || status === 'streaming') && (
            <button
              type="button"
              onClick={endCall}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-rupeezy-border text-rupeezy-fg-muted hover:border-rupeezy-hot/40 hover:text-rupeezy-hot transition-colors"
            >
              <Square size={12} />
              End call
            </button>
          )}
          <button
            type="button"
            onClick={() => void reset()}
            title="Reset (Ctrl+L)"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-rupeezy-border text-rupeezy-fg-muted hover:border-rupeezy-fg-faint hover:text-rupeezy-fg transition-colors"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-6 py-10">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && status !== 'starting' && (
            <div className="text-center py-16">
              <div className="font-serif text-2xl text-rupeezy-fg mb-2">
                Start the call
              </div>
              <div className="text-sm text-rupeezy-fg-faint">
                Try{' '}
                <span className="font-mono text-rupeezy-fg-muted">
                  Hi, who is this?
                </span>{' '}
                or{' '}
                <span className="font-mono text-rupeezy-fg-muted">
                  Hello, kaun bol raha hai?
                </span>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} message={m} />
          ))}
        </div>
      </div>

      {/* Scoring overlay */}
      {status === 'scoring' && (
        <div className="fixed inset-0 z-40 bg-rupeezy-ink/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="glass-elevated rounded-xl px-6 py-5 flex items-center gap-4">
            <span className="inline-flex gap-1 items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-accent animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-accent animate-pulse [animation-delay:200ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-accent animate-pulse [animation-delay:400ms]" />
            </span>
            <div className="text-sm text-rupeezy-fg">
              Running post-call pipeline — classifying, summarising, building
              handoff…
            </div>
          </div>
        </div>
      )}

      {handoff && status === 'ended' && (
        <HandoffPanel handoff={handoff} onClose={() => setHandoff(null)} />
      )}

      {handoffError && status === 'ended' && !handoff && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 max-w-md text-xs px-4 py-3 rounded-lg bg-rupeezy-warm-faint border border-rupeezy-warm/30 text-rupeezy-warm">
          Handoff scoring failed: {handoffError}. The conversation is saved.
        </div>
      )}

      {/* Composer */}
      <footer className="border-t border-rupeezy-border-subtle bg-rupeezy-surface/80 backdrop-blur-xl">
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
              className="flex-1 resize-none rounded-lg bg-rupeezy-card border border-rupeezy-border px-4 py-3 text-sm placeholder:text-rupeezy-fg-faint focus:outline-none focus:border-rupeezy-accent transition-colors disabled:opacity-50"
              rows={2}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-rupeezy-accent text-white font-medium text-sm hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
            >
              <Send size={14} />
              {status === 'streaming' ? 'Sending…' : 'Send'}
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
            : 'bg-rupeezy-card text-rupeezy-fg rounded-bl-sm border border-rupeezy-border'
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
      <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-fg-faint animate-pulse" />
      <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-fg-faint animate-pulse [animation-delay:200ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-fg-faint animate-pulse [animation-delay:400ms]" />
    </span>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    idle: {
      label: 'idle',
      cls: 'bg-rupeezy-card text-rupeezy-fg-faint border-rupeezy-border',
    },
    starting: {
      label: 'starting',
      cls: 'bg-rupeezy-card text-rupeezy-fg-muted border-rupeezy-border',
    },
    live: {
      label: 'live',
      cls: 'bg-rupeezy-ok-faint text-rupeezy-ok border-rupeezy-ok/30',
    },
    streaming: {
      label: 'streaming',
      cls: 'bg-rupeezy-accent-faint text-rupeezy-accent border-rupeezy-accent/30',
    },
    scoring: {
      label: 'scoring',
      cls: 'bg-rupeezy-warm-faint text-rupeezy-warm border-rupeezy-warm/30',
    },
    ended: {
      label: 'ended',
      cls: 'bg-rupeezy-card text-rupeezy-fg-faint border-rupeezy-border',
    },
    error: {
      label: 'error',
      cls: 'bg-rupeezy-hot-faint text-rupeezy-hot border-rupeezy-hot/30',
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`text-[10px] px-2.5 py-1 rounded-full font-mono uppercase tracking-[0.16em] border ${cls}`}
    >
      {label}
    </span>
  );
}
