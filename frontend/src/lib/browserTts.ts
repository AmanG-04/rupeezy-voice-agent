/**
 * Browser TTS that consumes a streamed transcript and speaks each sentence
 * as it lands — so audio starts within ~200ms of the first token.
 *
 * The visible bubble is filled WORD-BY-WORD via SpeechSynthesisUtterance's
 * `onboundary` event, which fires per-word during synthesis with the char
 * offset into the utterance. Result: text "types" in lockstep with the audio,
 * not a sentence at a time.
 *
 * Defaults are tuned for the MS Edge "Aria Online (Natural)" voice:
 *   rate 1.18  — energetic but not chipmunk-y on neural voices
 *   pitch 1.08 — warmer than monotone
 */

import { loadVoices, pickVoice } from './speech';

const SENTENCE_BOUNDARY = /([.!?…।]\s+|[.!?…।]$)/;

interface SpeakerOptions {
  lang: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Fires once, the first time any sentence starts being spoken. */
  onFirstSentence?: () => void;
  /**
   * Fires every time the synth advances — both on word boundaries (onboundary)
   * and on sentence completions (onend). Receives cumulative spoken text so
   * the visible bubble can be re-rendered in lockstep with audio.
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
  /** Text from sentences that have FULLY finished speaking. */
  private finishedSentencesText = '';
  private opts: SpeakerOptions;

  constructor(opts: SpeakerOptions) {
    this.opts = opts;
    void this.loadVoice();
  }

  private async loadVoice() {
    const voices = await loadVoices();
    this.voice = pickVoice(voices, this.opts.lang);
    if (this.voice) {
      console.log(
        `[tts] picked voice: "${this.voice.name}" (${this.voice.lang}) for lang ${this.opts.lang}`,
      );
      // Warn loudly if we had to pick a wrong-language voice — that's why
      // Hindi sounds garbled when only English voices are installed.
      const requestedPrefix = this.opts.lang.split('-')[0];
      const pickedPrefix = this.voice.lang.split('-')[0];
      if (requestedPrefix !== pickedPrefix) {
        console.warn(
          `[tts] LANGUAGE MISMATCH: requested "${this.opts.lang}", best available was "${this.voice.lang}". ` +
            'Output will sound wrong. Install the language pack in your OS, or switch the picker to a supported language.',
        );
      }
    } else {
      console.warn('[tts] no voice picked — using browser default');
    }
    // Dump the full available voice list once so the user can see what's
    // actually installed on their machine.
    if (voices.length > 0) {
      console.log(
        `[tts] available voices (${voices.length}):`,
        voices.map((v) => `${v.name} [${v.lang}]`).join(', '),
      );
    }
  }

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

  cancel(): void {
    this.cancelled = true;
    this.queue = [];
    this.buffer = '';
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.speaking = false;
  }

  private emit(currentSentencePartial: string): void {
    const cumulative = this.finishedSentencesText
      ? `${this.finishedSentencesText} ${currentSentencePartial}`.trim()
      : currentSentencePartial.trim();
    this.opts.onSpoken?.(cumulative);
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
    u.rate = this.opts.rate ?? 1.18;
    u.pitch = this.opts.pitch ?? 1.08;
    u.volume = this.opts.volume ?? 1.0;

    // Fire-and-forget word-level reveal. `onboundary` fires per word with
    // `charIndex` (sometimes also `charLength`). We slice the sentence up to
    // that point so the bubble grows word-by-word in sync with the audio.
    u.onstart = () => {
      // Show at least the first word immediately — onboundary may lag the
      // initial audio frame on some engines.
      const firstSpace = next.indexOf(' ');
      const opener = firstSpace > 0 ? next.slice(0, firstSpace) : next;
      this.emit(opener);
    };
    u.onboundary = (ev) => {
      if (this.cancelled) return;
      // We only care about word boundaries.
      // Some engines also emit 'sentence' boundaries — treat as word too.
      const idx = ev.charIndex ?? 0;
      const len = (ev as SpeechSynthesisEvent & { charLength?: number })
        .charLength;
      const upTo = typeof len === 'number' && len > 0 ? idx + len : idx;
      const partial = next.slice(0, Math.min(upTo, next.length));
      this.emit(partial);
    };
    u.onend = () => {
      if (this.cancelled) return;
      // Lock this sentence into the cumulative spoken text and reveal it
      // in full (in case the last word never got an onboundary event).
      this.finishedSentencesText = this.finishedSentencesText
        ? `${this.finishedSentencesText} ${next}`.trim()
        : next;
      this.opts.onSpoken?.(this.finishedSentencesText);
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
