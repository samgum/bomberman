export class GameAudio {
  constructor() {
    this.left = new Float32Array(16384);
    this.right = new Float32Array(16384);
    this.read = 0;
    this.write = 0;
    this.volume = 0.45;
    this.context = null;
    this.node = null;
  }
  async activate() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      if (!this.context) {
        this.context = new Audio({ sampleRate: 48000, latencyHint: 'interactive' });
        this.node = this.context.createScriptProcessor(2048, 0, 2);
        this.node.onaudioprocess = event => {
          const left = event.outputBuffer.getChannelData(0);
          const right = event.outputBuffer.getChannelData(1);
          for (let i = 0; i < left.length; i++) {
            if (this.read !== this.write) {
              left[i] = this.left[this.read] * this.volume;
              right[i] = this.right[this.read] * this.volume;
              this.read = (this.read + 1) & 16383;
            } else { left[i] = 0; right[i] = 0; }
          }
        };
        this.node.connect(this.context.destination);
      }
      if (this.context.state !== 'running') await this.context.resume();
    } catch { /* Browsers without available audio still run the game. */ }
  }
  sample(left, right) {
    if (!this.context || this.context.state !== 'running') return;
    const next = (this.write + 1) & 16383;
    if (next === this.read) this.read = (this.read + 1) & 16383;
    this.left[this.write] = left;
    this.right[this.write] = right;
    this.write = next;
  }
  flush() { this.read = this.write = 0; }
  suspend() {
    this.flush();
    if (this.context?.state === 'running') this.context.suspend().catch(() => {});
  }
}
