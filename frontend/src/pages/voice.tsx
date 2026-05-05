import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import HandoffPanel from '../components/HandoffPanel';
import {
  type ConversationMessage,
  type HandoffRecord,
  createConversation,
  endConversation,
  streamTurn,
} from '../lib/api';
import {
  type SpeechRecognitionLike,
  cancelSpeech,
  createRecognition,
  isSpeechRecognitionAvailable,
  isSpeechSynthesisAvailable,
  loadVoices,
  pickVoice,
  speak,
} from '../lib/speech';

type Status =
  | 'idle'
  | 'starting'
  | 'listening'    // mic open, user can speak
  | 'thinking'    // got user utterance, waiting for agent reply
  | 'speaking'    // agent reply playing
  | 'scoring'    // /end pipeline running
  | 'ended'
  | 'error'
  | 'unsupported';

const LANG_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'hi-IN', label: 'Hindi' },
];

interface VoiceMessage extends ConversationMessage {
  pending?: boolean;
}

export default function VoicePage() {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lang, setLang] = useState<string>('en-IN');
  const [partialText, setPartialText] = useState('');
  const [handoff, setHandoff] = useState<HandoffRecord | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptScrollerRef = useRef<HTMLDivElement>(null);
  // Locking flag to drop SpeechRecognition results while the agent is talking
  // (prevents the agent's own voice being treated as user input via mic loopback).
  const isReplyingRef = useRef(false);

  // Capability check on mount.
  useEffect(() => {
    if (!isSpeechRecognitionAvailable() || !isSpeechSynthesisAvailable()) {
      setStatus('unsupported');
    }
    void loadVoices().then(setVoices);
  }, []);

  // Auto-scroll on new messages.
  useEffect(() => {
    transcriptScrollerRef.current?.scrollTo({
      top: transcriptScrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, partialText]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      cancelSpeech();
    };
  }, []);

  const stopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
  }, []);

  const startRecognition = useCallback(() => {
    const r = createRecognition(lang);
    if (!r) {
      setStatus('unsupported');
      setErrorMsg('SpeechRecognition is not available in this browser. Use Chrome or Edge.');
      return;
    }
    recognitionRef.current = r;

    let pendingFinal = '';
    r.onresult = (e) => {
      // If the agent is currently speaking, ignore mic results to stop the
      // mic from picking up the agent's own voice.
      if (isReplyingRef.current) return;

      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const alt = result[0];
        if (result.isFinal) {
          final += alt.transcript;
        } else {
          interim += alt.transcript;
        }
      }
      setPartialText(interim);
      pendingFinal += final;
      // When we get a final segment AND a meaningful chunk of text, dispatch.
      if (final.trim() && pendingFinal.trim().length > 1) {
        const utterance = pendingFinal.trim();
        pendingFinal = '';
        setPartialText('');
        void onUserUtterance(utterance);
      }
    };
    r.onerror = (e) => {
      // 'no-speech' fires after silence — not actually an error.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('SpeechRecognition error:', e.error, e.message);
    };
    r.onend = () => {
      // Auto-restart if the call is still live (browser tends to stop after ~60s of silence).
      if (statusRef.current === 'listening' || statusRef.current === 'speaking') {
        try {
          r.start();
        } catch {
          // already running
        }
      }
    };
    try {
      r.start();
    } catch (e) {
      console.warn('failed to start recognition:', e);
    }
  }, [lang]);

  // Status mirror for callbacks (avoid stale closures inside SpeechRecognition handlers).
  const statusRef = useRef<Status>('idle');
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  async function startCall() {
    setStatus('starting');
    setErrorMsg(null);
    setMessages([]);
    setHandoff(null);
    try {
      const r = await createConversation();
      setConvId(r.conv_id);
      setStatus('listening');
      startRecognition();
    } catch (e) {
      setStatus('error');
      setErrorMsg((e as Error).message);
    }
  }

  async function endCall() {
    if (!convId) return;
    stopRecognition();
    cancelSpeech();
    setStatus('scoring');
    try {
      const r = await endConversation(convId, 'lead');
      setStatus('ended');
      if (r.handoff) setHandoff(r.handoff);
    } catch (e) {
      setStatus('error');
      setErrorMsg((e as Error).message);
    }
  }

  async function onUserUtterance(text: string) {
    if (!convId) return;
    setStatus('thinking');
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
          setErrorMsg(msg);
        },
      });
    } catch (e) {
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
      // Speak the full reply.
      if (accumulated.trim()) {
        isReplyingRef.current = true;
        setStatus('speaking');
        const voice = pickVoice(voices, lang);
        const u = speak(accumulated, lang, voice);
        if (u) {
          u.onend = () => {
            isReplyingRef.current = false;
            if (statusRef.current !== 'ended' && statusRef.current !== 'scoring') {
              setStatus('listening');
            }
          };
          u.onerror = () => {
            isReplyingRef.current = false;
            if (statusRef.current !== 'ended' && statusRef.current !== 'scoring') {
              setStatus('listening');
            }
          };
        } else {
          // If TTS not available, just go back to listening.
          isReplyingRef.current = false;
          setStatus('listening');
        }
      } else if (statusRef.current !== 'ended' && statusRef.current !== 'scoring') {
        setStatus('listening');
      }
    }
  }

  if (status === 'unsupported') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="text-xs uppercase tracking-widest text-rupeezy-warm mb-2">Phase 6</div>
          <h1 className="text-2xl font-semibold mb-3">Voice not supported</h1>
          <p className="text-slate-400 text-sm mb-3">
            This browser doesn't expose the Web Speech API. Voice mode requires Chrome, Edge, or Brave on
            desktop. The text-chat path works everywhere.
          </p>
          <div className="flex gap-3 justify-center mt-6">
            <Link to="/chat" className="text-rupeezy-accent hover:underline text-sm">
              → Use text chat instead
            </Link>
            <Link to="/" className="text-slate-400 hover:underline text-sm">
              ← back home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-rupeezy-surface">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm">
            ←
          </Link>
          <div className="w-9 h-9 rounded-lg bg-rupeezy-accent flex items-center justify-center font-bold text-white text-sm">
            🎙
          </div>
          <div className="flex-1">
            <div className="font-semibold leading-tight">Aria — Voice Call</div>
            <div className="text-xs text-slate-500 font-mono">
              {convId ? `conv ${convId}` : 'idle'}
            </div>
          </div>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={status === 'listening' || status === 'speaking' || status === 'thinking'}
            className="text-xs px-2 py-1.5 rounded-md border border-slate-700 bg-rupeezy-card text-slate-300 disabled:opacity-50"
          >
            {LANG_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <StatusBadge status={status} />
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 flex flex-col">
        {/* Big mic button */}
        <div className="flex flex-col items-center justify-center py-10 border-b border-slate-800">
          {status === 'idle' || status === 'ended' || status === 'error' ? (
            <button
              type="button"
              onClick={() => void startCall()}
              className="w-32 h-32 rounded-full bg-rupeezy-accent text-white text-4xl shadow-2xl hover:scale-105 transition-transform"
              aria-label="Start call"
            >
              🎙
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void endCall()}
              disabled={status === 'starting' || status === 'scoring'}
              className="w-32 h-32 rounded-full bg-rupeezy-hot text-white text-4xl shadow-2xl hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
              aria-label="End call"
            >
              ⏹
            </button>
          )}
          <div className="mt-4 text-sm text-slate-400">
            {status === 'idle' && 'Click to start the call'}
            {status === 'starting' && 'Starting…'}
            {status === 'listening' && (
              <span className="inline-flex items-center gap-2">
                <PulseDot color="bg-emerald-400" /> Listening — speak naturally
              </span>
            )}
            {status === 'thinking' && (
              <span className="inline-flex items-center gap-2">
                <PulseDot color="bg-rupeezy-accent" /> Aria is thinking…
              </span>
            )}
            {status === 'speaking' && (
              <span className="inline-flex items-center gap-2">
                <PulseDot color="bg-rupeezy-warm" /> Aria is speaking
              </span>
            )}
            {status === 'scoring' && 'Running post-call pipeline…'}
            {status === 'ended' && 'Call ended'}
            {status === 'error' && <span className="text-rupeezy-hot">{errorMsg}</span>}
          </div>
          {partialText && (
            <div className="mt-3 px-4 py-2 rounded-lg bg-rupeezy-card border border-slate-800 text-sm text-slate-400 italic max-w-md text-center">
              "{partialText}"
            </div>
          )}
        </div>

        {/* Transcript */}
        <div ref={transcriptScrollerRef} className="flex-1 overflow-y-auto px-6 py-6 max-h-[40vh]">
          <div className="max-w-3xl mx-auto space-y-3">
            {messages.length === 0 && status === 'listening' && (
              <div className="text-center text-slate-500 text-xs py-4">
                Try saying: "Hi, who is this?" or "Hello, kaun bol raha hai?"
              </div>
            )}
            {messages.map((m, i) => (
              <Bubble key={i} message={m} />
            ))}
          </div>
        </div>
      </main>

      {/* Handoff panel after end */}
      {handoff && status === 'ended' && (
        <HandoffPanel handoff={handoff} onClose={() => setHandoff(null)} />
      )}
    </div>
  );
}

function Bubble({ message }: { message: VoiceMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-rupeezy-accent text-white rounded-br-sm'
            : 'bg-rupeezy-card text-slate-100 rounded-bl-sm border border-slate-800'
        }`}
      >
        {message.text || (message.pending ? '…' : '')}
      </div>
    </div>
  );
}

function PulseDot({ color }: { color: string }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${color} animate-pulse`} />;
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; className: string }> = {
    idle: { label: 'idle', className: 'bg-slate-700 text-slate-300' },
    starting: { label: 'starting', className: 'bg-slate-700 text-slate-300' },
    listening: {
      label: 'listening',
      className: 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
    },
    thinking: {
      label: 'thinking',
      className: 'bg-rupeezy-accent/20 text-indigo-300 border border-indigo-700/50',
    },
    speaking: {
      label: 'speaking',
      className: 'bg-rupeezy-warm/20 text-rupeezy-warm border border-amber-700/50',
    },
    scoring: { label: 'scoring', className: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
    ended: { label: 'ended', className: 'bg-slate-700 text-slate-400' },
    error: { label: 'error', className: 'bg-red-900/40 text-red-300 border border-red-700/50' },
    unsupported: { label: 'n/a', className: 'bg-slate-700 text-slate-400' },
  };
  const { label, className } = map[status];
  return <span className={`text-xs px-2.5 py-1 rounded-full font-mono ${className}`}>{label}</span>;
}
