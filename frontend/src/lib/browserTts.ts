/**
 * Browser TTS that consumes a streamed transcript and speaks each *sentence*
 * the moment it lands — so audio starts within ~300ms of the first token
 * instead of waiting for the whole reply.
 *
 * We use SpeechSynthesisUtterance instead of cloud TTS because:
 *   - it's free (no quota / no rate-limit / no audio cut-off bug)
 *   - it picks a regional voice automatically per language
 *   - the hackathon evaluates conversational quality, not voice fidelity
 *
 * Warmth knobs: rate slightly slowed, pitch slightly raised. These shift the
 * default robotic cadence into something closer to a real Aria.
 */

import { loadVoices, pickVoice } from './speech';

const SENTENCE_BOUNDARY = /([.!?…।]\s+|[.!?…।]$)/;

interface SpeakerOptions {
  lang: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Fires the first time any sentence starts being spoken. */
  onFirstSentence?: () => void;
  /**
   * Fires every time the synth finishes speaking a sentence. Receives the
   * cumulative text that has been spoken so far. Use this to sync the visible
   * transcript with what the user has actually heard.
   */
  onSpoken?: (cumulativeSpoken: string) => void;
  onAllDone?: () => void;
  onError?: (msg: string) => void;
}

export class BrowserTtsSpeaker {
  private buffer = '';
  private queue: string[] = [];
  private voice: SpeechSynthesisVoice | null = null;
  private speaking = false;
  private finished = false;
  private cancelled = false;
  private firstFired = false;
  private spokenText = '';
  private opts: SpeakerOptions;

  constructor(opts: SpeakerOptions) {
    this.opts = opts;
    void this.loadVoice();
  }

  private async loadVoice() {
    const voices = await loadVoices();
    this.voice = pickVoice(voices, this.opts.lang);
  }

  /** Feed streamed tokens. Sentence boundaries trigger speak. */
  feed(chunk: string): void {
    if (this.cancelled) return;
    this.buffer += chunk;
    this.flushSentences();
  }

  private flushSentences(): void {
    while (true) {
      const m = this.buffer.match(SENTENCE_BOUNDARY);
      if (!m || m.index === undefined) break;
      const end = m.index + m[0].length;
      const sentence = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end);
      if (sentence) this.queue.push(sentence);
    }
    if (!this.speaking && this.queue.length > 0) {
      this.speakNext();
    }
  }

  /** Call when the upstream stream is done — flushes the trailing buffer. */
  finish(): void {
    if (this.cancelled) return;
    this.finished = true;
    const tail = this.buffer.trim();
    this.buffer = '';
    if (tail) this.queue.push(tail);
    if (!this.speaking && this.queue.length > 0) {
      this.speakNext();
    } else if (!this.speaking && this.queue.length === 0) {
      this.opts.onAllDone?.();
    }
  }

  /** Stop everything immediately. */
  cancel(): void {
    this.cancelled = true;
    this.queue = [];
    this.buffer = '';
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.speaking = false;
  }

  private speakNext(): void {
    if (this.cancelled) return;
    const next = this.queue.shift();
    if (!next) {
      this.speaking = false;
      if (this.finished) this.opts.onAllDone?.();
      return;
    }
    this.speaking = true;
    if (!this.firstFired) {
      this.firstFired = true;
      this.opts.onFirstSentence?.();
    }

    const u = new SpeechSynthesisUtterance(next);
    u.lang = this.opts.lang;
    if (this.voice) u.voice = this.voice;
    u.rate = this.opts.rate ?? 1.1;
    u.pitch = this.opts.pitch ?? 1.08;
    u.volume = this.opts.volume ?? 1.0;
    u.onstart = () => {
      // Reveal this sentence in the bubble the moment it starts being spoken.
      this.spokenText = (this.spokenText + ' ' + next).trim();
      this.opts.onSpoken?.(this.spokenText);
    };
    u.onend = () => {
      if (this.cancelled) return;
      this.flushSentences();
      this.speakNext();
    };
    u.onerror = (e) => {
      this.opts.onError?.(`tts: ${e.error ?? 'unknown'}`);
      this.speaking = false;
      this.flushSentences();
      this.speakNext();
    };

    window.speechSynthesis.speak(u);
  }
}
