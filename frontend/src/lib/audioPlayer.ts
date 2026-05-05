/**
 * Sequential WAV audio player backed by the Web Audio API.
 *
 * Receives WAV blobs from the backend (one per sentence) and plays them
 * back-to-back. Decoding happens in parallel with playback — by the time
 * sentence N finishes playing, sentences N+1..N+K are already decoded
 * and queued.
 *
 * Why Web Audio API and not <audio>:
 *   - <audio> on multiple sequential blobs has 50–200ms gaps per element load
 *   - Web Audio gives sample-accurate scheduling: gapless playback
 *   - We can read currentTime on the AudioContext clock for tight timing
 */

interface QueuedClip {
  buffer: AudioBuffer;
  // Resolved when this clip *finishes* playing.
  finishedPromise: Promise<void>;
  finishedResolve: () => void;
}

export class AudioQueuePlayer {
  private ctx: AudioContext | null = null;
  private clips: QueuedClip[] = [];
  // Time on the AudioContext clock at which the next clip should start.
  private nextStartTime = 0;
  private isStopped = false;
  // Notify when the entire queue (current + future before stop) drains.
  private allDoneResolvers: Array<() => void> = [];
  private clipsScheduled = 0;
  private clipsFinished = 0;
  private waitingForMore = false;

  private getCtx(): AudioContext {
    if (!this.ctx) {
      // Browsers may suspend the context until a user gesture. We assume the
      // caller invokes start() in response to a click, so the context will be
      // running. We also call resume() defensively below.
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        throw new Error('Web Audio API not supported in this browser');
      }
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  /** Decode a base64 WAV string into an AudioBuffer. */
  private async decode(wavBase64: string): Promise<AudioBuffer> {
    const ctx = this.getCtx();
    const bytes = atob(wavBase64);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    // decodeAudioData accepts a copy of the underlying ArrayBuffer.
    return await ctx.decodeAudioData(buf.buffer.slice(0));
  }

  /**
   * Enqueue a WAV blob (base64). Decodes asynchronously; schedules playback
   * gaplessly after any already-queued clips.
   */
  async enqueue(wavBase64: string): Promise<void> {
    if (this.isStopped) return;
    let buffer: AudioBuffer;
    try {
      buffer = await this.decode(wavBase64);
    } catch (e) {
      console.warn('[audio] decode failed', e);
      return;
    }
    if (this.isStopped) return;

    const ctx = this.getCtx();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Browser will throw if no user gesture has occurred. Caller must
        // ensure the first enqueue is downstream of a click.
      }
    }

    let resolveFinished: () => void = () => undefined;
    const finishedPromise = new Promise<void>((r) => {
      resolveFinished = r;
    });
    const clip: QueuedClip = { buffer, finishedPromise, finishedResolve: resolveFinished };
    this.clips.push(clip);
    this.clipsScheduled++;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    // If nothing is playing right now, start immediately. Otherwise schedule
    // back-to-back.
    const startAt = Math.max(now, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    source.onended = () => {
      this.clipsFinished++;
      resolveFinished();
      // Drop the head of the queue.
      const idx = this.clips.indexOf(clip);
      if (idx >= 0) this.clips.splice(idx, 1);
      if (
        this.waitingForMore &&
        this.clipsFinished >= this.clipsScheduled &&
        this.allDoneResolvers.length > 0
      ) {
        for (const r of this.allDoneResolvers) r();
        this.allDoneResolvers = [];
        this.waitingForMore = false;
      }
    };
  }

  /** Returns when ALL currently-enqueued clips have finished playing.
   *  If new clips are enqueued before this resolves, it waits for them too. */
  async drained(): Promise<void> {
    if (this.clipsScheduled === 0 || this.clipsFinished >= this.clipsScheduled) return;
    this.waitingForMore = true;
    return new Promise((resolve) => {
      this.allDoneResolvers.push(resolve);
    });
  }

  /** Hard-stop everything. Drops queued audio, closes the context. */
  stop(): void {
    this.isStopped = true;
    this.clips = [];
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        this.ctx.close();
      } catch {
        // ignore
      }
    }
    this.ctx = null;
    this.nextStartTime = 0;
    this.clipsScheduled = 0;
    this.clipsFinished = 0;
    for (const r of this.allDoneResolvers) r();
    this.allDoneResolvers = [];
  }

  /** Reset for a new turn without closing the context. */
  reset(): void {
    this.clips = [];
    this.nextStartTime = 0;
    this.clipsScheduled = 0;
    this.clipsFinished = 0;
  }

  /** Number of clips not yet finished playing. */
  get pendingCount(): number {
    return Math.max(0, this.clipsScheduled - this.clipsFinished);
  }
}
