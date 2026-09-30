/* Downsample the device stream to 16 kHz signed little-endian PCM. */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0;
    this.count = 0;
    this.phase = 0;
    this.frame = [];
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.sum += sample;
      this.count += 1;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.frame.push(Math.round(value * (value < 0 ? 32768 : 32767)));
        this.sum = 0;
        this.count = 0;
        if (this.frame.length === 1600) {
          const buffer = new ArrayBuffer(3200);
          const view = new DataView(buffer);
          this.frame.forEach((value, index) => view.setInt16(index * 2, value, true));
          this.port.postMessage(buffer, [buffer]);
          this.frame = [];
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
