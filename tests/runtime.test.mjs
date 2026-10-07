import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {FrameClock} from '../app/clock.js';
import {crc32,ROM_HASH} from '../app/engine.js';
import {validSnapshot,checksum} from '../app/storage.js';

const rom=fs.readFileSync(new URL('../game/bomberman.nes',import.meta.url));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function classic() {
  const core=new globalThis.jsnes.NES({emulateSound:false});
  core.loadROM(rom);
  for(let i=0;i<80;i++)core.frame();
  core.buttonDown(1,globalThis.jsnes.Controller.BUTTON_START);
  core.frame();core.frame();
  core.buttonUp(1,globalThis.jsnes.Controller.BUTTON_START);
  for(let i=0;i<210;i++)core.frame();
  return core;
}
test('the rebuilt program and graphics match the original NES image',()=>{
  assert.equal(rom.length,24592);
  assert.equal(crc32(rom.subarray(16,16400)),0xa913a222);
  assert.equal(crc32(rom.subarray(16400)),0x1db14e97);
  assert.equal(hash(rom),ROM_HASH);
  const constants=fs.readFileSync(new URL('../vendor/bomberman-source/CONSTS.NAS',import.meta.url),'utf8');
  assert.match(constants,/MAP_LEVELS\s+50/);
});
for(const refresh of [60,90,120,144,240]) {
  test(`${refresh} Hz renders each refresh while emulating 60 frames per second`,()=>{
    let updates=0,renders=0,callback;
    const clock=new FrameClock(()=>updates++,()=>renders++,{request:next=>{callback=next;return 1;},cancel:()=>{}});
    clock.start();
    for(let frame=0;frame<=refresh*10;frame++)callback(frame*1000/refresh);
    clock.stop();
    assert.equal(updates,600);
    assert.equal(renders,refresh*10+1);
  });
}
test('pause drops the background gap rather than advancing game time',()=>{
  let updates=0,callback;
  const clock=new FrameClock(()=>updates++,()=>{},{request:next=>{callback=next;return 1;},cancel:()=>{}});
  clock.start();callback(0);callback(100);clock.stop();
  const before=updates;
  clock.start();callback(60000);callback(60000+1000/60);clock.stop();
  assert.equal(updates,before+1);
});
test('native keyboard actions move the original character and plant a bomb',()=>{
  const core=classic();
  assert.equal(core.cpu.mem[0x58],1);
  assert.ok(core.cpu.mem[0x93]>0);
  const x=core.cpu.mem[0x28]*16+core.cpu.mem[0x29];
  core.buttonDown(1,globalThis.jsnes.Controller.BUTTON_RIGHT);
  for(let i=0;i<12;i++)core.frame();
  core.buttonUp(1,globalThis.jsnes.Controller.BUTTON_RIGHT);
  assert.ok(core.cpu.mem[0x28]*16+core.cpu.mem[0x29]>x);
  core.buttonDown(1,globalThis.jsnes.Controller.BUTTON_A);
  core.frame();core.frame();
  core.buttonUp(1,globalThis.jsnes.Controller.BUTTON_A);
  assert.ok(core.cpu.mem.slice(0x3a0,0x3aa).some(Boolean));
});
test('a complete save restores memory and resumes the same bomb and timers',()=>{
  const first=classic();
  first.buttonDown(1,globalThis.jsnes.Controller.BUTTON_A);first.frame();first.frame();
  first.buttonUp(1,globalThis.jsnes.Controller.BUTTON_A);
  for(let i=0;i<20;i++)first.frame();
  const frozen=JSON.parse(JSON.stringify(first.toJSON()));
  const second=new globalThis.jsnes.NES({emulateSound:false});second.loadROM(rom);second.fromJSON(frozen);
  assert.deepEqual(second.cpu.mem.slice(0,2048),first.cpu.mem.slice(0,2048));
  assert.deepEqual(second.ppu.spriteMem,first.ppu.spriteMem);
  for(let i=0;i<40;i++){first.frame();second.frame();}
  assert.deepEqual(second.cpu.mem.slice(0,2048),first.cpu.mem.slice(0,2048));
  assert.deepEqual(second.ppu.buffer,first.ppu.buffer);
});
test('save validation rejects corruption and other ROM/runtime formats',()=>{
  const state=JSON.parse(JSON.stringify(classic().toJSON()));
  const data={version:1,rom:ROM_HASH,core:'2.1.0',savedAt:Date.now(),stage:1,state};
  assert.ok(validSnapshot(data));
  assert.equal(validSnapshot({...data,rom:'wrong'}),false);
  assert.equal(validSnapshot({...data,stage:51}),false);
  assert.equal(validSnapshot({...data,core:'0.0.0'}),false);
  const raw=JSON.stringify(data);
  assert.notEqual(checksum(raw),checksum(raw.slice(0,-1)));
});
