import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mic, Square, Send } from 'lucide-react';
import HandoffPanel from '../components/HandoffPanel';
import { Brand } from '../components/Brand';
import {
  type ConversationMessage,
  type HandoffRecord,
  createConversation,
  endConversation,
  streamTurn,
} from '../lib/api';
import { BrowserTtsSpeaker } from '../lib/browserTts';
import { EdgeTtsSpeaker } from '../lib/edgeTtsSpeaker';
import {
  type SpeechRecognitionLike,
  createRecognition,
  isSpeechRecognitionAvailable,
  isSpeechSynthesisAvailable,
  cancelSpeech,
} from '../lib/speech';

/** Speaker interface — both EdgeTtsSpeaker and BrowserTtsSpeaker satisfy it. */
interface Speaker {
  feed(chunk: string): void;
  finish(): void;
  cancel(): void;
}

type Status =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'scoring'
  | 'ended'
  | 'error'
  | 'unsupported';

const LANG_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'bn-IN', label: 'Bengali' },
];

interface VoiceMessage extends ConversationMessage {
  pending?: boolean;
}

const log = (...args: unknown[]) => console.log('[voice]', ...args);

export default function VoicePage() {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lang, setLang] = useState<string>('en-IN');
  const [partialText, setPartialText] = useState('');
  const [handoff, setHandoff] = useState<HandoffRecord | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptScrollerRef = useRef<HTMLDivElement>(null);
  const isReplyingRef = useRef(false);
  const convIdRef = useRef<string | null>(null);
  const statusRef = useRef<Status>('idle');
  const langRef = useRef<string>('en-IN');
  const speakerRef = useRef<Speaker | null>(null);
  // Once we know edge-tts is reachable, cache the verdict so we don't probe
  // it on every turn.
  const edgeTtsOkRef = useRef<boolean | null>(null);

  useEffect(() => {
    convIdRef.current = convId;
  }, [convId]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  useEffect(() => {
    const recOk = isSpeechRecognitionAvailable();
    const synthOk = isSpeechSynthesisAvailable();
    log('capability check:', { recognition: recOk, synthesis: synthOk });
    if (!recOk || !synthOk) {
      setStatus('unsupported');
    }
  }, []);

  useEffect(() => {
    transcriptScrollerRef.current?.scrollTo({
      top: transcriptScrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, partialText]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      speakerRef.current?.cancel();
      speakerRef.current = null;
      cancelSpeech();
    };
  }, []);

  const dispatchUtterance = useCallback(async (text: string) => {
    const cid = convIdRef.current;
    log('dispatchUtterance:', { text, conv_id: cid });
    if (!cid) {
      log('no conv_id — aborting');
      return;
    }
    setStatus('thinking');
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

    // Cancel anything still being spoken from a previous reply, then build a
    // fresh sentence-streaming speaker for this turn.
    speakerRef.current?.cancel();
    let firstSentenceSpoken = false;

    const lang = langRef.current;
    const callbacks = {
      onFirstSentence: () => {
        firstSentenceSpoken = true;
        isReplyingRef.current = true;
        setStatus('speaking');
      },
      onSpoken: (cumulative: string) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') {
            next[next.length - 1] = { ...last, text: cumulative };
          }
          return next;
        });
      },
      onAllDone: () => {
        log('TTS done, returning to listening');
        isReplyingRef.current = false;
        if (statusRef.current !== 'ended' && statusRef.current !== 'scoring') {
          setStatus('listening');
          try {
            recognitionRef.current?.start();
            log('recognition: kicked from onAllDone');
          } catch {
            /* already running */
          }
        }
      },
      onError: (m: string) => log('tts error:', m),
    };

    // Prefer Edge-TTS (neural voices for any judge regardless of OS).
    // Fall back to Web Speech API if the route isn't reachable.
    let speaker: Speaker;
    if (edgeTtsOkRef.current === false) {
      const isEnglish = lang.startsWith('en-');
      speaker = new BrowserTtsSpeaker({
        lang,
        rate: isEnglish ? 1.15 : 0.98,
        pitch: 1.06,
        ...callbacks,
      });
    } else {
      // Edge-TTS rate: small bump for English, natural cadence for IN langs.
      const isEnglish = lang.startsWith('en-');
      speaker = new EdgeTtsSpeaker({
        lang,
        rate: isEnglish ? '+8%' : '+0%',
        pitch: '+0Hz',
        ...callbacks,
        onError: (m: string) => {
          // First failure flips the cache so subsequent turns skip the probe.
          log('edge-tts error, will fall back to web speech:', m);
          edgeTtsOkRef.current = false;
          callbacks.onError(m);
        },
      });
    }
    speakerRef.current = speaker;

    let accumulated = '';

    try {
      await streamTurn(cid, text, {
        onToken: (chunk) => {
          accumulated += chunk;
          // Don't write tokens into the bubble — let the speaker drive the
          // visible text via onSpoken so audio + text stay in sync.
          speaker.feed(chunk);
        },
        onError: (msg) => {
          log('streamTurn onError:', msg);
          setErrorMsg(msg);
        },
      });
      log('streamTurn done, accumulated chars:', accumulated.length);
    } catch (e) {
      log('streamTurn threw:', e);
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
      // Tell the speaker the stream is over — it will flush trailing text and
      // call onAllDone once the queue drains.
      speaker.finish();
      if (!firstSentenceSpoken && statusRef.current !== 'ended' && statusRef.current !== 'scoring') {
        setStatus('listening');
      }
    }
  }, []);

  const stopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const startRecognition = useCallback(() => {
    const r = createRecognition(langRef.current);
    if (!r) {
      log('createRecognition returned null');
      setStatus('unsupported');
      setErrorMsg(
        'SpeechRecognition is not available in this browser. Use Chrome or Edge.',
      );
      return;
    }
    recognitionRef.current = r;
    log('SpeechRecognition created, lang:', langRef.current);

    let pendingFinal = '';

    r.onstart = () => log('recognition: onstart');
    r.onspeechstart = () => log('recognition: speech detected');
    r.onspeechend = () => log('recognition: speech ended');

    r.onresult = (e) => {
      if (isReplyingRef.current) {
        log('result ignored (reply in progress)');
        return;
      }

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
      if (final) {
        pendingFinal += final;
      }

      if (final.trim() && pendingFinal.trim().length >= 2) {
        const utterance = pendingFinal.trim();
        pendingFinal = '';
        setPartialText('');
        void dispatchUtterance(utterance);
      }
    };

    r.onerror = (e) => {
      log('recognition: error', e.error, e.message ?? '');
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed') {
        setErrorMsg(
          'Microphone permission denied. Allow mic access and try again.',
        );
        setStatus('error');
      } else if (e.error === 'audio-capture') {
        setErrorMsg('No microphone found.');
        setStatus('error');
      }
    };

    r.onend = () => {
      log('recognition: onend, current status:', statusRef.current);
      // Restart whenever the call is still active. Includes 'thinking' and
      // 'speaking' — the recognizer often ends mid-reply, but we want it
      // back up the moment Aria finishes so the user's next utterance is
      // captured immediately.
      const stillActive =
        statusRef.current === 'listening' ||
        statusRef.current === 'speaking' ||
        statusRef.current === 'thinking';
      if (stillActive) {
        try {
          r.start();
          log('recognition: auto-restarted');
        } catch (err) {
          // Most common: 'start' called while engine still busy. Retry once
          // after a short tick — by then the engine is idle.
          log('recognition: restart failed, will retry', err);
          setTimeout(() => {
            if (
              statusRef.current === 'listening' ||
              statusRef.current === 'speaking' ||
              statusRef.current === 'thinking'
            ) {
              try {
                r.start();
                log('recognition: retry-restarted');
              } catch (err2) {
                log('recognition: retry failed', err2);
              }
            }
          }, 250);
        }
      }
    };

    try {
      r.start();
      log('recognition: started');
    } catch (e) {
      log('recognition: start threw', e);
    }
  }, [dispatchUtterance]);

  async function startCall() {
    setStatus('starting');
    setErrorMsg(null);
    setMessages([]);
    setHandoff(null);
    // Probe Edge-TTS once per call. If reachable we'll use it for all turns.
    if (edgeTtsOkRef.current === null) {
      const ok = await EdgeTtsSpeaker.isAvailable();
      edgeTtsOkRef.current = ok;
      log('edge-tts availability:', ok);
    }
    // Some browsers (Safari) require a user-gesture before SpeechSynthesis is
    // allowed to speak. Speak an empty utterance here to "warm up" the engine.
    try {
      const u = new SpeechSynthesisUtterance('');
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
    try {
      const r = await createConversation();
      log('conversation created:', r.conv_id);
      setConvId(r.conv_id);
      convIdRef.current = r.conv_id;
      setStatus('listening');
      statusRef.current = 'listening';
      startRecognition();
    } catch (e) {
      log('startCall error:', e);
      setStatus('error');
      setErrorMsg((e as Error).message);
    }
  }

  async function endCall() {
    if (!convId) return;
    log('ending call:', convId);
    stopRecognition();
    speakerRef.current?.cancel();
    speakerRef.current = null;
    cancelSpeech();
    isReplyingRef.current = false;
    setStatus('scoring');
    statusRef.current = 'scoring';
    try {
      const r = await endConversation(convId, 'lead');
      setStatus('ended');
      statusRef.current = 'ended';
      if (r.handoff) setHandoff(r.handoff);
    } catch (e) {
      setStatus('error');
      setErrorMsg((e as Error).message);
    }
  }

  const [manualText, setManualText] = useState('');
  const sendManual = () => {
    const t = manualText.trim();
    if (!t) return;
    setManualText('');
    void dispatchUtterance(t);
  };

  if (status === 'unsupported') {
    return (
      <div className="min-h-screen bg-rupeezy-ink flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="eyebrow mb-3">Voice mode</div>
          <h1 className="font-serif text-3xl text-rupeezy-fg mb-4">
            Voice not supported here
          </h1>
          <p className="text-rupeezy-fg-muted text-sm leading-relaxed mb-6">
            This browser doesn't expose the Web Speech API. Voice mode requires
            Chrome, Edge, or Brave on desktop. The text-chat path works
            everywhere.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              to="/chat"
              className="text-xs px-4 py-2 rounded-md bg-rupeezy-accent text-white hover:opacity-90 transition-opacity"
            >
              Use text chat instead
            </Link>
            <Link
              to="/"
              className="text-xs px-4 py-2 rounded-md border border-rupeezy-border text-rupeezy-fg-muted hover:border-rupeezy-fg-faint hover:text-rupeezy-fg transition-colors"
            >
              Back home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isLive =
    status === 'listening' || status === 'speaking' || status === 'thinking';

  return (
    <div className="min-h-screen bg-rupeezy-ink flex flex-col">
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
              Aria · Voice call
            </div>
            <div className="text-[10px] text-rupeezy-fg-faint font-mono mt-0.5">
              {convId ? `conv ${convId}` : 'idle'}
            </div>
          </div>
          <select
            aria-label="Conversation language"
            title="Conversation language"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={isLive}
            className="text-xs px-2.5 py-1.5 rounded-md bg-rupeezy-card border border-rupeezy-border text-rupeezy-fg-muted hover:border-rupeezy-fg-faint focus:outline-none focus:border-rupeezy-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {LANG_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <StatusPill status={status} />
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 flex flex-col">
        {/* Mic stage */}
        <section className="flex flex-col items-center justify-center py-12 px-6 border-b border-rupeezy-border-subtle">
          {status === 'idle' || status === 'ended' || status === 'error' ? (
            <button
              type="button"
              onClick={() => void startCall()}
              className="group relative w-32 h-32 rounded-full bg-rupeezy-accent text-white shadow-lifted hover:scale-[1.03] active:scale-95 transition-transform flex items-center justify-center"
              aria-label="Start call"
            >
              <span className="absolute inset-0 rounded-full bg-rupeezy-accent/30 blur-2xl group-hover:bg-rupeezy-accent/50 transition-colors" />
              <Mic size={42} strokeWidth={1.6} className="relative" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void endCall()}
              disabled={status === 'starting' || status === 'scoring'}
              className="group relative w-32 h-32 rounded-full bg-rupeezy-hot text-white shadow-lifted hover:scale-[1.03] active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center"
              aria-label="End call"
            >
              <span className="absolute inset-0 rounded-full bg-rupeezy-hot/30 blur-2xl" />
              <Square size={36} strokeWidth={1.6} className="relative" />
            </button>
          )}

          <div className="mt-6 text-sm text-rupeezy-fg-muted min-h-[24px]">
            {status === 'idle' && (
              <span>Click the mic to start the call</span>
            )}
            {status === 'starting' && <span>Starting…</span>}
            {status === 'listening' && (
              <span className="inline-flex items-center gap-2.5">
                <PulseDot color="bg-rupeezy-ok" />
                <span>Listening — speak naturally</span>
              </span>
            )}
            {status === 'thinking' && (
              <span className="inline-flex items-center gap-2.5">
                <PulseDot color="bg-rupeezy-accent" />
                <span>Aria is thinking…</span>
              </span>
            )}
            {status === 'speaking' && (
              <span className="inline-flex items-center gap-2.5">
                <PulseDot color="bg-rupeezy-warm" />
                <span>Aria is speaking</span>
              </span>
            )}
            {status === 'scoring' && (
              <span>Running post-call pipeline…</span>
            )}
            {status === 'ended' && <span>Call ended</span>}
            {status === 'error' && (
              <span className="text-rupeezy-hot">{errorMsg}</span>
            )}
          </div>

          {partialText && (
            <div className="mt-4 px-4 py-2.5 rounded-lg glass border border-rupeezy-border-subtle text-xs text-rupeezy-fg-muted italic max-w-md text-center">
              "{partialText}"
            </div>
          )}

          {/* Manual fallback */}
          {(status === 'listening' ||
            status === 'thinking' ||
            status === 'speaking') && (
            <div className="mt-6 flex gap-2 max-w-md w-full">
              <input
                type="text"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendManual();
                }}
                placeholder="Or type if mic is flaky…"
                className="flex-1 text-xs rounded-md bg-rupeezy-card border border-rupeezy-border px-3 py-2 placeholder:text-rupeezy-fg-faint focus:outline-none focus:border-rupeezy-accent transition-colors"
              />
              <button
                type="button"
                onClick={sendManual}
                disabled={!manualText.trim() || status !== 'listening'}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-rupeezy-accent text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
              >
                <Send size={12} />
                Send
              </button>
            </div>
          )}
        </section>

        {/* Transcript */}
        <div
          ref={transcriptScrollerRef}
          className="flex-1 overflow-y-auto px-6 py-8 max-h-[40vh]"
        >
          <div className="max-w-3xl mx-auto space-y-3">
            {messages.length === 0 && status === 'listening' && (
              <div className="text-center text-rupeezy-fg-faint text-xs py-6">
                Try saying:{' '}
                <span className="font-mono text-rupeezy-fg-muted">
                  "Hi, who is this?"
                </span>{' '}
                or{' '}
                <span className="font-mono text-rupeezy-fg-muted">
                  "Hello, kaun bol raha hai?"
                </span>
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

function PulseDot({ color }: { color: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${color} animate-pulse`}
    />
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
    listening: {
      label: 'listening',
      cls: 'bg-rupeezy-ok-faint text-rupeezy-ok border-rupeezy-ok/30',
    },
    thinking: {
      label: 'thinking',
      cls: 'bg-rupeezy-accent-faint text-rupeezy-accent border-rupeezy-accent/30',
    },
    speaking: {
      label: 'speaking',
      cls: 'bg-rupeezy-warm-faint text-rupeezy-warm border-rupeezy-warm/30',
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
    unsupported: {
      label: 'n/a',
      cls: 'bg-rupeezy-card text-rupeezy-fg-faint border-rupeezy-border',
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
