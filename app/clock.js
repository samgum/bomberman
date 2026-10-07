export class FrameClock {
  constructor(update, render, options = {}) {
    this.update = update;
    this.render = render;
    this.request = options.request || (callback => requestAnimationFrame(callback));
    this.cancel = options.cancel || (handle => cancelAnimationFrame(handle));
    this.step = 1000 / 60;
    this.running = false;
    this.previous = null;
    this.accumulator = 0;
    this.handle = 0;
    this.frame = this.frame.bind(this);
  }
  frame(timestamp) {
    if (!this.running) return;
    if (this.previous === null) this.previous = timestamp;
    this.accumulator += Math.min(100, Math.max(0, timestamp - this.previous));
    this.previous = timestamp;
    while (this.running && this.accumulator + 1e-6 >= this.step) {
      this.update();
      this.accumulator = Math.max(0, this.accumulator - this.step);
    }
    this.render(timestamp);
    if (this.running) this.handle = this.request(this.frame);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.previous = null;
    this.accumulator = 0;
    this.handle = this.request(this.frame);
  }
  stop() {
    this.running = false;
    this.cancel(this.handle);
  }
}
