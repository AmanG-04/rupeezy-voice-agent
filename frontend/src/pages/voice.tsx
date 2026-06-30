import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mic, Square, Send, AlertCircle } from 'lucide-react';
import HandoffPanel from '../components/HandoffPanel';
import { Brand } from '../components/Brand';
import {
  type ConversationMessage,
  type HandoffRecord,
  createConversation,
  endConversation,
  endConversationBeacon,
  startConversationOpener,
  streamTurn,
} from '../lib/api';
import { EdgeTtsSpeaker } from '../lib/edgeTtsSpeaker';
import {
  type SpeechRecognitionLike,
  createRecognition,
  isSpeechRecognitionAvailable,
  isSpeechSynthesisAvailable,
  cancelSpeech,
} from '../lib/speech';
import {
  type DetectedObjection,
  detectObjection,
} from '../lib/objectionDetect';
import { shouldAutoEndAfterAssistantReply } from '../lib/callEnding';

/** Minimal speaker interface — EdgeTtsSpeaker is the only impl now. */
interface Speaker {
  feed(chunk: string): void;
  finish(): void;
  cancel(): void;
  setLang?(lang: string): void;
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
  objection?: DetectedObjection;
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
  // AbortController for in-flight streamTurn fetches. Aborted on unmount so
  // a navigation mid-reply doesn't leak a Response stream.
  const turnAbortRef = useRef<AbortController | null>(null);
  // Cached verdict from one start-of-call probe of /api/tts/voices.
  // ONLY used to log a one-time warning if the backend is unreachable —
  // the actual per-sentence retry + fallback lives inside EdgeTtsSpeaker.
  // Never gates which speaker class is used (always EdgeTtsSpeaker).
  const edgeTtsOkRef = useRef<boolean | null>(null);
  // Ref to the latest startRecognition() so dispatchUtterance can call it
  // from inside an empty-deps useCallback without going stale. Populated
  // by an effect once startRecognition is defined further down the file.
  const startRecognitionRef = useRef<(() => void) | null>(null);
  const autoEndAfterSpeechRef = useRef(false);
  // Set to false on unmount so any pending setTimeout callbacks (auto-
  // restart, retry-restart) bail out instead of resurrecting recognition
  // after the user clicked back. Without this, Chrome's mic indicator
  // stays lit after navigation and re-entering /voice doesn't get a fresh
  // permission grant until the page is hard-refreshed.
  const mountedRef = useRef(true);

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
    // Re-mounting after a previous unmount (e.g. user clicks back, then
    // re-enters /voice) needs the flag flipped back on. Without this the
    // freshly-mounted instance treats itself as already-cancelled and
    // skips every async restart path.
    mountedRef.current = true;
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

  // Hard cleanup on unmount — fired when the user clicks the back arrow,
  // the /chat link, the dashboard link, or anything else that navigates
  // away from /voice. Critical: the in-memory backend conversation must be
  // ended (even if the user never clicked "End call"), the recognizer must
  // stop holding the mic, the AudioContext must be torn down, and any
  // in-flight streamTurn fetch must be aborted.
  useEffect(() => {
    // Belt-and-braces: also fire endConversationBeacon on `pagehide` and
    // `visibilitychange` (tab close, hard refresh, mobile background).
    // Some browsers run pagehide BEFORE the React cleanup, which is when
    // sendBeacon is most reliably accepted. Both call paths are
    // idempotent on the backend (second /end is a no-op).
    const fireEnd = () => {
      const cid = convIdRef.current;
      if (
        cid &&
        statusRef.current !== 'ended' &&
        statusRef.current !== 'scoring'
      ) {
        endConversationBeacon(cid, 'dropped');
      }
    };
    const onPageHide = () => fireEnd();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('pagehide', onPageHide);

      // 0. Tell pending setTimeout callbacks (auto-restart, retry-restart,
      // any onend handler closures) to bail. This is what stops the mic
      // indicator from staying lit after the user clicks back — without
      // it, an in-flight recognition.onend timer can call r.start() AFTER
      // unmount, which Chrome then holds the mic active for.
      mountedRef.current = false;

      // 1. Kill the mic + STT.
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;

      // 2. Stop TTS playback + tear down AudioContext.
      speakerRef.current?.cancel();
      speakerRef.current = null;
      cancelSpeech();

      // 3. Abort any in-flight LLM streaming fetch.
      try {
        turnAbortRef.current?.abort();
      } catch {
        /* ignore */
      }
      turnAbortRef.current = null;

      // 4. Tell the backend to end the conversation via navigator.sendBeacon
      // (purpose-built for unmount/unload, queues on a background dispatcher
      // so it survives the React tree tearing down). Idempotent — if the
      // pagehide handler above already fired, this is a no-op on the
      // backend.
      fireEnd();

      isReplyingRef.current = false;
    };
  }, []);

  const finishCall = useCallback(async (endedBy: 'agent' | 'lead' = 'lead') => {
    const cid = convIdRef.current;
    if (!cid) return;
    log('ending call:', cid, 'ended_by:', endedBy);
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    speakerRef.current?.cancel();
    speakerRef.current = null;
    cancelSpeech();
    isReplyingRef.current = false;
    autoEndAfterSpeechRef.current = false;
    setStatus('scoring');
    statusRef.current = 'scoring';
    try {
      const r = await endConversation(cid, endedBy);
      setStatus('ended');
      statusRef.current = 'ended';
      if (r.handoff) setHandoff(r.handoff);
    } catch (e) {
      setStatus('error');
      statusRef.current = 'error';
      setErrorMsg((e as Error).message);
    }
  }, []);

  const dispatchUtterance = useCallback(async (text: string) => {
    const cid = convIdRef.current;
    log('dispatchUtterance:', { text, conv_id: cid });
    if (!cid) {
      log('no conv_id — aborting');
      return;
    }
    setStatus('thinking');
    // Hard-mute the mic the moment we dispatch — through thinking AND
    // speaking, until onAllDone restarts it. This stops:
    //   1. Aria hearing her own neural-TTS audio loop back through the
    //      user's mic and treating it as a new utterance
    //   2. The browser's mic LED staying lit during reply, which looks
    //      sketchy ("why is it still listening?")
    //   3. Stray background noise being captured during the ~2-3s
    //      thinking gap before audio starts
    isReplyingRef.current = true;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }

    const objection = detectObjection(text) ?? undefined;
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        text,
        created_at: new Date().toISOString(),
        objection,
      },
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
        if (autoEndAfterSpeechRef.current) {
          log('terminal close detected; ending after speech');
          void finishCall('agent');
          return;
        }
        // If the user clicked back mid-reply, we don't want to resurrect
        // the recognizer here — the unmount cleanup already aborted it
        // and any new .start() would re-grab the mic.
        if (!mountedRef.current) {
          log('recognition: skip resume from onAllDone (unmounted)');
          return;
        }
        if (statusRef.current !== 'ended' && statusRef.current !== 'scoring') {
          setStatus('listening');
          let resumed = false;
          try {
            recognitionRef.current?.start();
            resumed = true;
            log('recognition: resumed from onAllDone');
          } catch (err) {
            log('recognition: resume threw, will recreate', err);
          }
          if (!resumed) {
            try {
              recognitionRef.current?.abort();
            } catch {
              /* ignore */
            }
            recognitionRef.current = null;
            startRecognitionRef.current?.();
          }
        }
      },
      onError: (m: string) => log('tts error:', m),
    };

    // ALWAYS prefer Edge-TTS. If the route is genuinely unreachable
    // (network blocked, backend dead), the fallback happens INSIDE
    // EdgeTtsSpeaker on a per-sentence basis — it speaks via browser
    // Web Speech for that one sentence then tries Edge-TTS again for
    // the next. We deliberately don't latch a session-wide "fall back
    // forever" flag here, because that's what made Hindi sound
    // robotic after a single Tamil failure earlier.
    const isEnglish = lang.startsWith('en-');
    const speaker: Speaker = new EdgeTtsSpeaker({
      lang,
      rate: isEnglish ? '+8%' : '+0%',
      pitch: '+0Hz',
      ...callbacks,
    });
    speakerRef.current = speaker;

    let accumulated = '';

    // Fresh AbortController per turn so the unmount cleanup can kill an
    // in-flight stream. Old controller (if any) was for a previous turn
    // that already completed.
    turnAbortRef.current?.abort();
    const controller = new AbortController();
    turnAbortRef.current = controller;

    try {
      await streamTurn(
        cid,
        text,
        {
          onToken: (chunk) => {
            accumulated += chunk;
            // Don't write tokens into the bubble — let the speaker drive the
            // visible text via onSpoken so audio + text stay in sync.
            speaker.feed(chunk);
          },
          onLang: (detectedLang) => {
            // Backend detected the user spoke a different language than
            // the picker. Switch the TTS voice for this turn so the
            // reply sounds correct (Bengali user -> Bengali neural
            // voice, not English Neerja mangling Bengali script).
            log('lang event received:', detectedLang, '(picker was', langRef.current, ')');
            if (detectedLang && detectedLang !== langRef.current) {
              speaker.setLang?.(detectedLang);
              // Also flip the picker so future turns + the STT lang
              // pick up the change automatically.
              setLang(detectedLang);
              langRef.current = detectedLang;
            }
          },
          onConvReplaced: (newConvId) => {
            log('conv replaced (server restarted) — new id:', newConvId);
            setConvId(newConvId);
            convIdRef.current = newConvId;
          },
          onError: (msg) => {
            log('streamTurn onError:', msg);
            setErrorMsg(msg);
          },
        },
        controller.signal,
        { lang: langRef.current },
      );
      log('streamTurn done, accumulated chars:', accumulated.length);
    } catch (e) {
      log('streamTurn threw:', e);
      setErrorMsg((e as Error).message);
    } finally {
      autoEndAfterSpeechRef.current =
        statusRef.current !== 'error' &&
        shouldAutoEndAfterAssistantReply(accumulated);
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
      if (
        !firstSentenceSpoken &&
        !autoEndAfterSpeechRef.current &&
        statusRef.current !== 'ended' &&
        statusRef.current !== 'scoring'
      ) {
        setStatus('listening');
      }
    }
  }, [finishCall]);

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
      log('recognition: onend, status:', statusRef.current,
          'replying:', isReplyingRef.current);
      // CRITICAL: do NOT auto-restart while Aria is replying (thinking or
      // speaking). The user explicitly wants the mic muted during her
      // turn. The onAllDone callback in dispatchUtterance is responsible
      // for restarting recognition once she finishes — that's the only
      // path back to a hot mic.
      //
      // If onend fires while we're NOT in a reply (Web Speech engines
      // sometimes auto-stop after 60s of silence), we restart so the
      // user can keep talking without re-clicking the mic button.
      if (isReplyingRef.current) {
        log('recognition: skip auto-restart (Aria is replying)');
        return;
      }
      if (!mountedRef.current) {
        log('recognition: skip auto-restart (component unmounted)');
        return;
      }
      if (statusRef.current === 'listening') {
        try {
          r.start();
          log('recognition: auto-restarted (silence-recovery)');
        } catch (err) {
          log('recognition: restart failed, will retry', err);
          setTimeout(() => {
            // The component may have unmounted in the 250ms window.
            // If so, bail without restarting — otherwise we resurrect the
            // mic AFTER the user has navigated away and Chrome keeps the
            // indicator lit until the page is refreshed.
            if (!mountedRef.current) {
              log('recognition: skip retry-restart (component unmounted)');
              return;
            }
            if (
              statusRef.current === 'listening' &&
              !isReplyingRef.current
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

  // Keep the ref in sync so dispatchUtterance's onAllDone closure (which
  // is a stable empty-deps useCallback) always invokes the freshest
  // startRecognition. Avoids stale-closure bugs when langRef changes.
  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

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
      setStatus('speaking');
      statusRef.current = 'speaking';
      const opener = await startConversationOpener(r.conv_id, { lang: langRef.current });
      setMessages([{ ...opener }]);

      const speaker = new EdgeTtsSpeaker({
        lang: langRef.current,
        rate: langRef.current.startsWith('en-') ? '+8%' : '+0%',
        pitch: '+0Hz',
        onFirstSentence: () => {
          setStatus('speaking');
          statusRef.current = 'speaking';
        },
        onSpoken: (cumulative) => {
          setMessages([{ ...opener, text: cumulative }]);
        },
        onAllDone: () => {
          if (!mountedRef.current || statusRef.current === 'ended') return;
          setStatus('listening');
          statusRef.current = 'listening';
          startRecognition();
        },
        onError: (m) => log('opener tts error:', m),
      });
      speakerRef.current = speaker;
      speaker.feed(opener.text);
      speaker.finish();
    } catch (e) {
      log('startCall error:', e);
      setStatus('error');
      setErrorMsg((e as Error).message);
    }
  }

  async function endCall() {
    await finishCall('lead');
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
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-rupeezy-accent text-white rounded-br-sm'
            : 'bg-rupeezy-card text-rupeezy-fg rounded-bl-sm border border-rupeezy-border'
        }`}
      >
        {message.text || (message.pending ? <LoadingBubble copy="Aria is thinking" /> : '')}
      </div>
      {message.objection && (
        <div
          className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-[0.16em] bg-rupeezy-warm-faint text-rupeezy-warm border border-rupeezy-warm/30 animate-fade-in"
          title={`Detected objection — Aria is composing a rebuttal. Will be reflected in the post-call handoff as ${message.objection.id}.`}
        >
          <AlertCircle size={10} />
          objection · {message.objection.label}
        </div>
      )}
    </div>
  );
}

function LoadingBubble({ copy }: { copy: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-rupeezy-fg-muted min-w-36">
      <span className="inline-flex gap-1 items-center">
        <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-fg-faint animate-pulse" />
        <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-fg-faint animate-pulse [animation-delay:200ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-rupeezy-fg-faint animate-pulse [animation-delay:400ms]" />
      </span>
      <span className="text-xs tracking-[0.02em]">{copy}...</span>
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
