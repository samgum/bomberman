import * as runtimeModule from '../vendor/jsnes/jsnes.min.js';
import { fetchGameResource } from './network.js';
if(!globalThis.jsnes)globalThis.jsnes=runtimeModule.default || runtimeModule;

export const ROM_HASH = '4e57f08754a2ff7ec788245629fb70f99d4e003f66f86742566bca99c810a244';
export const CORE_VERSION = '2.1.0';
export const buttons = {
  a: jsnes.Controller.BUTTON_A, b: jsnes.Controller.BUTTON_B,
  up: jsnes.Controller.BUTTON_UP, down: jsnes.Controller.BUTTON_DOWN,
  left: jsnes.Controller.BUTTON_LEFT, right: jsnes.Controller.BUTTON_RIGHT,
  start: jsnes.Controller.BUTTON_START, select: jsnes.Controller.BUTTON_SELECT
};
export function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
export class GameEngine {
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.image = this.context.createImageData(256, 240);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.frameCount = 0;
    this.rom = null;
    this.nes = new jsnes.NES({
      sampleRate: 48000,
      onFrame: frame => {
        for (let i = 0; i < frame.length; i++) this.pixels[i] = 0xff000000 | frame[i];
      },
      onAudioSample: (left, right) => audio.sample(left, right)
    });
  }
  async prepare(progress) {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),20000);
    let response;
    try {
      response = await fetchGameResource('game/bomberman.nes', { cache:'no-cache', signal:controller.signal });
      this.rom = new Uint8Array(await response.arrayBuffer());
    }
    finally { clearTimeout(timeout); }
    if (this.rom.length !== 24592 || crc32(this.rom.subarray(16,16400)) !== 0xa913a222 || crc32(this.rom.subarray(16400)) !== 0x1db14e97) throw new Error('游戏资源校验失败');
    this.nes.loadROM(this.rom);
    for (let count=0; count<80; count++) {
      this.nes.frame();
      if (count % 10 === 0) { progress(30 + Math.round(count * 60 / 80)); await new Promise(requestAnimationFrame); }
    }
    this.draw();
  }
  reset() {
    this.nes.loadROM(this.rom);
    for (let i=0;i<80;i++) this.nes.frame();
    this.frameCount = 0;
    this.draw();
  }
  tick() { this.nes.frame(); this.frameCount++; }
  draw() { this.context.putImageData(this.image, 0, 0); }
  down(name) { this.nes.buttonDown(1, buttons[name]); }
  up(name) { this.nes.buttonUp(1, buttons[name]); }
  releaseAll() { Object.keys(buttons).forEach(name => this.up(name)); }
  info() {
    const memory = this.nes.cpu.mem;
    return { stage: memory[0x58], active: memory[0x60] !== 0, menu: memory[0x72] !== 0,
      time: memory[0x93], remote: memory[0x77] !== 0 };
  }
  snapshot() { return this.nes.toJSON(); }
  restore(state) {
    this.nes.fromJSON(state);
    this.releaseAll();
    const frame = this.nes.ppu.buffer;
    for (let i=0;i<frame.length;i++) this.pixels[i] = 0xff000000 | frame[i];
    this.draw();
  }
}
