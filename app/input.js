const keys = { ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',KeyZ:'a',Space:'a',KeyX:'b',ShiftLeft:'select',ShiftRight:'select' };
export class GameInput {
  constructor(engine, callbacks) {
    this.engine = engine;
    this.callbacks = callbacks;
    this.active = false;
    this.sources = new Map();
    this.pointers = new Map();
    this.pending = new Map();
    this.pressedAt = new Map();
    this.tickCount = 0;
    this.padPrevious = new Map();
    this.dpad = document.getElementById('dpad');
    document.addEventListener('keydown',event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select')) return;
      const openDialog = document.querySelector('dialog[open]');
      if(openDialog?.id==='pause-dialog' && event.code==='KeyP') {
        if(!event.repeat)callbacks.pause('keyboard');
        event.preventDefault();return;
      }
      if (openDialog) return;
      if (event.code === 'KeyP' || event.code === 'Escape') {
        if (!event.repeat) callbacks.pause('keyboard');
        event.preventDefault();
      } else if (event.code === 'Enter') {
        if (event.target.closest('button,a')) return;
        if (!event.repeat) callbacks.start();
        event.preventDefault();
      } else if (keys[event.code] && this.active && !event.target.closest('button')) {
        if (!event.repeat) this.press(keys[event.code],'keyboard:'+event.code);
        event.preventDefault();
      }
    });
    document.addEventListener('keyup',event => { if (keys[event.code]) this.release(keys[event.code],'keyboard:'+event.code); });
    this.bindSurface(this.dpad,'dpad');
    this.bindSurface(document.getElementById('touch-a'),'a');
    this.bindSurface(document.getElementById('touch-b'),'b');
    document.getElementById('touch-select').addEventListener('click',() => this.pulse('select'));
    document.getElementById('touch-start').addEventListener('click',() => callbacks.start());
    document.addEventListener('dblclick',event => event.preventDefault());
    ['gesturestart','gesturechange','gestureend'].forEach(name => document.addEventListener(name,event => event.preventDefault(),{ passive:false }));
    window.addEventListener('blur',() => this.clear());
    window.addEventListener('gamepaddisconnected',event => {
      const source='pad:'+event.gamepad.index;
      this.sources.forEach((sources,button) => { if (sources.has(source)) this.release(button,source); });
      this.padPrevious.delete(event.gamepad.index);
    });
  }
  press(button,source) {
    if (!this.active) return;
    let held=this.sources.get(button);
    if (!held) {
      held=new Set(); this.sources.set(button,held);
      this.engine.down(button);
      this.pressedAt.set(button,this.tickCount);
      if (button==='a' && source.startsWith('pointer:')) this.callbacks.haptic();
    }
    held.add(source);
    this.pending.delete(button);
    this.highlight(button,true);
  }
  release(button,source) {
    const held=this.sources.get(button);
    if (!held) return;
    held.delete(source);
    if (held.size) return;
    this.sources.delete(button);
    this.pending.set(button,Math.max(this.tickCount,(this.pressedAt.get(button)||0)+2));
    this.highlight(button,false);
  }
  pulse(button) {
    if (!this.active) return;
    this.press(button,'pulse');
    this.release(button,'pulse');
  }
  tick() {
    this.tickCount++;
    this.pending.forEach((deadline,button) => {
      if (this.tickCount >= deadline && !this.sources.has(button)) { this.engine.up(button); this.pending.delete(button); }
    });
  }
  highlight(button,pressed) {
    document.querySelectorAll('[data-button="'+button+'"]').forEach(element => element.classList.toggle('is-pressed',pressed));
  }
  clear() {
    this.engine.releaseAll();
    this.sources.clear(); this.pending.clear(); this.pointers.clear();
    document.querySelectorAll('.is-pressed').forEach(element => element.classList.remove('is-pressed'));
  }
  setActive(active) { if (!active) this.clear(); this.active=active; }
  direction(x,y) {
    const box=this.dpad.getBoundingClientRect();
    const dx=x-(box.left+box.width/2),dy=y-(box.top+box.height/2);
    if (Math.hypot(dx,dy)<box.width*.1) return null;
    return Math.abs(dx)>Math.abs(dy) ? (dx>0?'right':'left') : (dy>0?'down':'up');
  }
  pointerDown(id,x,y,type) {
    if (!this.active) return;
    const button=type==='dpad'?this.direction(x,y):type;
    this.pointers.set(id,{button,type});
    if (button) this.press(button,'pointer:'+id);
  }
  pointerMove(id,x,y) {
    const pointer=this.pointers.get(id);
    if (!pointer || pointer.type!=='dpad') return;
    const next=this.direction(x,y);
    if (next===pointer.button) return;
    if (pointer.button) this.release(pointer.button,'pointer:'+id);
    pointer.button=next;
    if (next) this.press(next,'pointer:'+id);
  }
  pointerUp(id) {
    const pointer=this.pointers.get(id);
    if (pointer?.button) this.release(pointer.button,'pointer:'+id);
    this.pointers.delete(id);
  }
  bindSurface(surface,type) {
    surface.addEventListener('contextmenu',event => event.preventDefault());
    // A canceled PointerEvent does not cancel WKWebView's native long-press
    // recognizer. Fingers use Touch Events even on browsers with PointerEvent.
    const touchPrimary='ontouchstart' in window;
    surface.addEventListener('touchstart',event => {
      event.preventDefault();
      if (!this.active) return;
      Array.from(event.changedTouches).filter(touch=>surface.contains(touch.target)).forEach(touch => this.pointerDown('touch:'+touch.identifier,touch.clientX,touch.clientY,type));
    },{passive:false});
    document.addEventListener('touchmove',event => {
      const changed=Array.from(event.changedTouches).filter(touch=>this.pointers.has('touch:'+touch.identifier));
      if(!changed.length)return;
      event.preventDefault();
      changed.forEach(touch => this.pointerMove('touch:'+touch.identifier,touch.clientX,touch.clientY));
    },{passive:false});
    ['touchend','touchcancel'].forEach(name => document.addEventListener(name,event => {
      if(name==='touchcancel' && !event.changedTouches.length){
        for(const id of Array.from(this.pointers.keys()))if(typeof id==='string' && id.startsWith('touch:'))this.pointerUp(id);
        return;
      }
      const changed=Array.from(event.changedTouches).filter(touch=>this.pointers.has('touch:'+touch.identifier));
      if(!changed.length)return;
      event.preventDefault();
      changed.forEach(touch => this.pointerUp('touch:'+touch.identifier));
    },{passive:false}));
    if ('PointerEvent' in window) {
      surface.addEventListener('pointerdown',event => {
        if(event.pointerType==='touch' && touchPrimary)return;
        if (!this.active || (event.pointerType==='mouse' && event.button!==0)) return;
        event.preventDefault();
        surface.setPointerCapture(event.pointerId);
        this.pointerDown(event.pointerId,event.clientX,event.clientY,type);
      });
      surface.addEventListener('pointermove',event => { if (this.pointers.has(event.pointerId)) { event.preventDefault(); this.pointerMove(event.pointerId,event.clientX,event.clientY); } });
      ['pointerup','pointercancel','lostpointercapture'].forEach(name => surface.addEventListener(name,event => this.pointerUp(event.pointerId)));
    }
  }
  pollGamepads() {
    const pads=navigator.getGamepads?.() || [];
    for (const pad of pads) {
      if (!pad?.connected || pad.mapping!=='standard') continue;
      const source='pad:'+pad.index;
      const axisX=pad.axes[0]||0,axisY=pad.axes[1]||0;
      const horizontal=Math.abs(axisX)>=Math.abs(axisY) && Math.abs(axisX)>.3;
      const vertical=Math.abs(axisY)>Math.abs(axisX) && Math.abs(axisY)>.3;
      const state={ left:pad.buttons[14]?.pressed || (horizontal && axisX<0),right:pad.buttons[15]?.pressed || (horizontal && axisX>0),up:pad.buttons[12]?.pressed || (vertical && axisY<0),down:pad.buttons[13]?.pressed || (vertical && axisY>0),a:pad.buttons[0]?.pressed,b:pad.buttons[1]?.pressed,select:pad.buttons[8]?.pressed };
      Object.entries(state).forEach(([button,pressed]) => pressed?this.press(button,source):this.release(button,source));
      const start=pad.buttons[9]?.pressed;
      if (start && !this.padPrevious.get(pad.index)) this.callbacks.pause('gamepad');
      this.padPrevious.set(pad.index,start);
    }
  }
}
