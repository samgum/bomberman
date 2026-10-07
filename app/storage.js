import { ROM_HASH, CORE_VERSION } from './engine.js';

export function checksum(text) {
  let hash = 2166136261;
  for (let i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function validSnapshot(data) {
  return data?.version === 1 && data.rom === ROM_HASH && data.core === CORE_VERSION &&
    Number.isInteger(data.stage) && data.stage >= 1 && data.stage <= 50 &&
    Number.isFinite(data.savedAt) && Array.isArray(data.state?.cpu?.mem) && data.state.cpu.mem.length === 65536 &&
    Array.isArray(data.state?.ppu?.vramMem) && data.state.ppu.vramMem.length === 32768 &&
    Array.isArray(data.state?.ppu?.spriteMem) && data.state.ppu.spriteMem.length === 256 &&
    data.state.mmap && data.state.papu && data.state.ppu.ptTile?.length === 512;
}
async function pack(text) {
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return { format: 'gzip', data: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }
  return { format: 'json', data: new TextEncoder().encode(text) };
}
async function unpack(record) {
  if (record.format === 'json') return new TextDecoder().decode(record.data);
  if (record.format === 'gzip' && typeof DecompressionStream === 'function') {
    const stream = new Blob([record.data]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  throw new Error('当前浏览器无法读取此存档');
}
function encodeBase64(bytes) {
  let binary = '';
  for (let i=0;i<bytes.length;i+=16384) binary += String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}
function decodeBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
export class GameSaves {
  constructor() { this.db = null; this.generation = 0; this.available = true; this.problem = ''; }
  async init() {
    try {
      this.db = await new Promise((resolve,reject) => {
        const request = indexedDB.open('bomberman-classic',1);
        const timeout = setTimeout(() => reject(new Error('Storage timeout')),2000);
        request.onupgradeneeded = () => request.result.createObjectStore('save');
        request.onsuccess = () => { clearTimeout(timeout); resolve(request.result); };
        request.onerror = () => { clearTimeout(timeout); reject(request.error); };
        request.onblocked = () => { clearTimeout(timeout); reject(new Error('Storage unavailable')); };
      });
      this.db.onversionchange = () => this.db.close();
    } catch {
      try { localStorage.setItem('bomberman.storage-check','1'); localStorage.removeItem('bomberman.storage-check'); }
      catch { this.available = false; }
    }
  }
  async request(mode, operation) {
    return new Promise((resolve,reject) => {
      const transaction = this.db.transaction('save',mode);
      const request = operation(transaction.objectStore('save'));
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Storage failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Storage aborted'));
    });
  }
  async load() {
    try {
      if (!this.available) return null;
      let record;
      if (this.db) record = await this.request('readonly',store => store.get('current'));
      else {
        record = JSON.parse(localStorage.getItem('bomberman.current'));
        if (record) record.data = decodeBase64(record.data);
      }
      if (!record) return null;
      const text = await unpack(record);
      if (checksum(text) !== record.checksum) throw new Error('存档校验失败');
      const data = JSON.parse(text);
      if (!validSnapshot(data)) throw new Error('存档格式不兼容');
      return data;
    } catch { this.problem = '上次存档无法读取，可以重新开始游戏。'; return null; }
  }
  capture(state, stage) {
    return JSON.stringify({ version:1, rom:ROM_HASH, core:CORE_VERSION, savedAt:Date.now(), stage, state });
  }
  async save(text) {
    const generation = ++this.generation;
    if (!this.available) return { ok:false };
    try {
      const record = { ...(await pack(text)), checksum:checksum(text) };
      if (generation !== this.generation) return { superseded:true };
      if (this.db) await this.request('readwrite',store => store.put(record,'current'));
      else localStorage.setItem('bomberman.current',JSON.stringify({ ...record, data:encodeBase64(record.data) }));
      return { ok:true };
    } catch { return { ok:false }; }
  }
  async clear() {
    this.generation++;
    if (this.db) await this.request('readwrite',store => store.delete('current'));
    else if (this.available) localStorage.removeItem('bomberman.current');
  }
}
export class Preferences {
  constructor() {
    this.value = { volume:45, controlSize:100, controlMode:'auto', haptics:false, highRefresh:true };
    try {
      const saved = JSON.parse(localStorage.getItem('bomberman.preferences'));
      if (saved) {
        if (Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 100) this.value.volume = saved.volume;
        if (Number.isFinite(saved.controlSize) && saved.controlSize >= 100 && saved.controlSize <= 125) this.value.controlSize = saved.controlSize;
        if (['auto','touch','keyboard'].includes(saved.controlMode)) this.value.controlMode=saved.controlMode;
        this.value.haptics = saved.haptics === true;
        this.value.highRefresh = saved.highRefresh !== false;
      }
    } catch { /* Preferences are optional. */ }
  }
  save() { try { localStorage.setItem('bomberman.preferences',JSON.stringify(this.value)); } catch { /* Gameplay stays available. */ } }
}
