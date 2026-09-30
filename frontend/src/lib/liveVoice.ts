import { api } from './apiBase';

export interface LiveEvent {
  type: 'ready' | 'audio' | 'transcript' | 'interrupted' | 'turn_complete' | 'error';
  role?: 'user' | 'assistant';
  text?: string;
  data?: string;
  message?: string;
}

export class LiveVoice {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private capture: AudioWorkletNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private stopped = false;
  private captureSource: MediaStreamAudioSourceNode | null = null;
  muted = false;

  constructor(private onEvent: (event: LiveEvent) => void, private onClose: () => void) {}

  async start(conversationId: string, model: string) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    if (this.stopped) { this.stream.getTracks().forEach((track) => track.stop()); return; }
    this.context = new AudioContext();
    await this.context.resume();
    await this.context.audioWorklet.addModule('/pcm-capture.js');
    if (this.stopped) return;
    const url = new URL(api(`/api/conversations/${conversationId}/live`), window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('model', model);
    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Connection timed out. Render may need 60 seconds to wake up.')), 65000);
      this.socket!.onerror = () => { clearTimeout(timer); reject(new Error('Could not connect to Live voice.')); };
      this.socket!.onclose = () => { clearTimeout(timer); reject(new Error('Live connection closed.')); this.onClose(); };
      this.socket!.onmessage = (message) => {
        if (this.stopped) return;
        const event = JSON.parse(message.data) as LiveEvent;
        if (event.type === 'ready') { clearTimeout(timer); resolve(); }
        if (event.type === 'error') { clearTimeout(timer); reject(new Error(event.message)); }
        if (event.type === 'audio' && event.data) this.play(event.data);
        if (event.type === 'interrupted') this.interrupt();
        this.onEvent(event);
      };
    });
    if (this.stopped || !this.context) return;
    const source = this.context.createMediaStreamSource(this.stream);
    this.captureSource = source;
    this.capture = new AudioWorkletNode(this.context, 'pcm-capture');
    const silence = this.context.createGain();
    silence.gain.value = 0;
    source.connect(this.capture);
    this.capture.connect(silence).connect(this.context.destination);
    this.capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.muted && this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount < 64000) {
        this.socket.send(event.data);
      }
    };
    this.socket.send(JSON.stringify({ type: 'greet' }));
  }

  sendText(text: string) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'text', text }));
  }

  private play(encoded: string) {
    if (this.stopped || !this.context) return;
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const audio = this.context.createBuffer(1, bytes.length / 2, 24000);
    const channel = audio.getChannelData(0);
    for (let index = 0; index < channel.length; index++) channel[index] = view.getInt16(index * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = audio;
    source.connect(this.context.destination);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    const start = Math.max(this.context.currentTime + 0.02, this.nextTime);
    source.start(start);
    this.nextTime = start + audio.duration;
  }

  interrupt() {
    this.sources.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
    this.sources.clear();
    this.nextTime = 0;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.interrupt();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'stop' }));
    const socket = this.socket;
    if (socket?.readyState === WebSocket.CONNECTING) socket.close();
    window.setTimeout(() => { if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(); }, 1500);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.capture?.disconnect();
    this.captureSource?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
  }
}
