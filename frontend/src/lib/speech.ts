/**
 * Browser SpeechRecognition + SpeechSynthesis helpers.
 *
 * Web Speech API has been in Chromium since 2014 but the types aren't in
 * lib.dom.d.ts. We declare the minimum surface we use here.
 *
 * Browser support (May 2026):
 *   - Chrome / Edge / Brave: full support
 *   - Safari: SpeechSynthesis only on macOS; recognition limited
 *   - Firefox: behind a flag
 * For the demo we target Chrome/Edge.
 */

// ---- TypeScript shims for Web Speech API ----

export interface SpeechRecognitionResultDTO {
  transcript: string;
  isFinal: boolean;
  confidence: number;
}

export interface SpeechRecognitionEventDTO extends Event {
  resultIndex: number;
  results: {
    length: number;
    item(idx: number): {
      length: number;
      isFinal: boolean;
      item(j: number): { transcript: string; confidence: number };
      [j: number]: { transcript: string; confidence: number };
    };
    [idx: number]: {
      length: number;
      isFinal: boolean;
      item(j: number): { transcript: string; confidence: number };
      [j: number]: { transcript: string; confidence: number };
    };
  };
}

export interface SpeechRecognitionErrorEventDTO extends Event {
  error: string;
  message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventDTO) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventDTO) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

export function isSpeechRecognitionAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as WindowWithSpeech;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createRecognition(lang: string): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithSpeech;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

// ---- Speech synthesis (text -> spoken audio) ----

export function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let _voicesCache: SpeechSynthesisVoice[] | null = null;

export async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!isSpeechSynthesisAvailable()) return [];
  if (_voicesCache && _voicesCache.length > 0) return _voicesCache;

  // Voice list often loads asynchronously after the page mounts.
  return new Promise((resolve) => {
    const tryLoad = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) {
        _voicesCache = v;
        resolve(v);
        return true;
      }
      return false;
    };
    if (tryLoad()) return;
    window.speechSynthesis.onvoiceschanged = () => {
      tryLoad();
    };
    // Failsafe: resolve with whatever we have after 1s.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
}

export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  // Prefer exact lang match, then prefix match (en-IN matches en-*), then default.
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;
  const prefix = lang.split('-')[0];
  const partial = voices.find((v) => v.lang.startsWith(`${prefix}-`));
  if (partial) return partial;
  return voices.find((v) => v.default) ?? voices[0];
}

/**
 * Speak a text chunk. Cancels anything currently speaking — call once per
 * complete reply, not per token chunk (the synth would queue and get out of
 * sync with the visible transcript).
 */
export function speak(text: string, lang: string, voice?: SpeechSynthesisVoice | null): SpeechSynthesisUtterance | null {
  if (!isSpeechSynthesisAvailable()) return null;
  if (!text.trim()) return null;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  if (voice) u.voice = voice;
  u.rate = 1.0;
  u.pitch = 1.0;
  synth.speak(u);
  return u;
}

export function cancelSpeech(): void {
  if (isSpeechSynthesisAvailable()) {
    window.speechSynthesis.cancel();
  }
}
