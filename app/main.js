import { GameEngine } from './engine.js';
import { GameAudio } from './audio.js';
import { GameInput } from './input.js';
import { FrameClock } from './clock.js';
import { GameSaves, Preferences } from './storage.js';
import { GameLayout } from './layout.js';

const root=document.documentElement;
const element=id=>document.getElementById(id);
const text=(id,value)=>{if(element(id).textContent!==value)element(id).textContent=value;};
const began=performance.now();
const wechat=/MicroMessenger/i.test(navigator.userAgent);
root.dataset.wechat=wechat?'true':'false';
let phase='loading';
let savedMeta=null;
let saveRequest=0;
let lastPaint=0;
let toastTimeout;
let lastSaveFrame=0;
let starting=false;
const audio=new GameAudio();
const engine=new GameEngine(element('game'),audio);
const saves=new GameSaves();
const preferences=new Preferences();
function toast(message) {
  text('toast',message);element('toast').hidden=false;
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>element('toast').hidden=true,3000);
}
const layout=new GameLayout(element('game'),toast,()=>preferences.value);
const input=new GameInput(engine,{
  pause:source=>phase==='menu'?(source==='gamepad'?activate():undefined):phase==='paused'?resume():pause(),
  start:()=>{
    if(phase==='menu')activate();
    else if(phase==='paused')resume();
    else if(phase==='playing' && engine.info().active)pause();
    else if(phase==='playing')input.pulse('start');
  },
  haptic:()=>{if(preferences.value.haptics && navigator.vibrate)navigator.vibrate(12);}
});
function setPhase(next) {
  phase=next;root.dataset.phase=next;
  const menu=next==='menu';
  text('pause-button',menu?'设置':'暂停');
  element('pause-button').setAttribute('aria-label',menu?'打开设置':'暂停游戏');
  element('pause-button').disabled=next==='loading';
}
function updateMenu() {
  root.dataset.save=savedMeta?'true':'false';
  element('continue-button').hidden=!savedMeta;
  element('start-button').querySelector('span').textContent=savedMeta?'开始新游戏':'开始游戏';
  text('menu-save-label',savedMeta?'本地进度已保存':'经典单人模式');
  text('menu-save-title',savedMeta?'第 '+String(savedMeta.stage).padStart(2,'0')+' 关':'准备开始');
  text('menu-save-info',savedMeta?'继续当时的位置、道具和剩余计时。':'消灭敌人，找到出口，进入下一关。');
}
function progress(value) {
  element('boot-bar').style.width=value+'%';
  element('boot-bar').parentNode.setAttribute('aria-valuenow',value);
}
async function checkpoint(manual=false) {
  const info=engine.info();
  if(!['playing','paused'].includes(phase))return false;
  if(info.stage<1 || info.stage>50 || info.menu) {
    text('pause-save-status','进入关卡后会自动保存进度。');
    text('save-status','进入关卡后自动保存');
    return false;
  }
  const request=++saveRequest;
  const payload=saves.capture(engine.snapshot(),info.stage);
  text('save-status','正在保存…');text('pause-save-status','正在保存当前进度…');
  const result=await saves.save(payload);
  if(request!==saveRequest || result.superseded) return false;
  if(result.ok) {
    savedMeta={stage:info.stage,savedAt:Date.now()};
    text('save-status','进度已保存');text('pause-save-status','地图、位置与计时已保存。');
    if(manual)toast('进度已保存。');
    return true;
  }
  text('save-status','此浏览器无法保存');text('pause-save-status','当前浏览器无法保存，请留在此页面继续游玩。');
  if(manual)toast('当前浏览器无法保存进度。');
  return false;
}
function pause(reason='准备好后继续游戏。') {
  if(phase!=='playing') return;
  setPhase('paused');input.setActive(false);audio.suspend();
  text('pause-reason',reason);
  if(!element('pause-dialog').open)element('pause-dialog').showModal();
  checkpoint();
}
function resume() {
  if(phase!=='paused' || document.hidden || element('settings-dialog').open || element('help-dialog').open) return;
  element('pause-dialog').close();
  setPhase('playing');input.setActive(true);audio.activate();
  element('game').focus({preventScroll:true});
}
function activate() {if(savedMeta)startGame(true);else requestNewGame();}
function requestNewGame() {
  if(phase!=='menu' || starting)return;
  if(savedMeta)element('new-game-dialog').showModal();
  else startGame(false);
}
async function startGame(continuing) {
  if(starting || phase!=='menu')return;
  starting=true;
  // Create/unlock audio during the original user gesture, before async storage.
  audio.activate();
  element('start-button').disabled=element('continue-button').disabled=true;
  try {
    if(continuing) {
      const save=await saves.load();
      if(!save)throw new Error('存档无法读取，请开始新游戏。');
      engine.restore(save.state);
    } else {
      await saves.clear();
      savedMeta=null;engine.reset();
    }
    element('menu').hidden=true;
    setPhase('playing');input.setActive(true);
    lastSaveFrame=engine.frameCount;
    if(!continuing)input.pulse('start');
    element('game').focus({preventScroll:true});
  } catch(error) {toast(error.message);audio.suspend();}
  finally {starting=false;element('start-button').disabled=element('continue-button').disabled=false;}
}
async function returnMenu() {
  element('menu-button').disabled=true;
  await checkpoint();
  element('menu-button').disabled=false;
  element('pause-dialog').close();
  input.setActive(false);audio.suspend();engine.reset();
  setPhase('menu');element('menu').hidden=false;
  updateMenu();engine.draw();
  (savedMeta?element('continue-button'):element('start-button')).focus({preventScroll:true});
}
function openSettings() {
  if(phase==='playing')pause();
  element('settings-dialog').showModal();
}
function openHelp() {
  if(phase==='playing')pause('看完操作说明后继续游戏。');
  if(!element('help-dialog').open)element('help-dialog').showModal();
}
function applyPreferences() {
  const prefs=preferences.value;
  audio.volume=prefs.volume/100;
  root.style.setProperty('--control-scale',prefs.controlSize/100);
  element('volume').value=prefs.volume; text('volume-value',prefs.volume+'%');
  element('control-size').value=prefs.controlSize;text('control-size-value',prefs.controlSize+'%');
  element('control-layout').value=prefs.controlMode;
  element('haptics').checked=prefs.haptics;element('high-refresh').checked=prefs.highRefresh;
  element('haptics').disabled=!navigator.vibrate;
  layout.schedule();
}
element('start-button').addEventListener('click',requestNewGame);
element('continue-button').addEventListener('click',()=>startGame(true));
element('pause-button').addEventListener('click',()=>phase==='menu'?openSettings():pause());
element('resume-button').addEventListener('click',resume);
element('save-button').addEventListener('click',()=>checkpoint(true));
element('menu-button').addEventListener('click',returnMenu);
element('settings-button').addEventListener('click',openSettings);
element('help-button').addEventListener('click',openHelp);
element('home-help-button').addEventListener('click',openHelp);
element('retry').addEventListener('click',()=>location.reload());
element('fullscreen-button').addEventListener('click',()=>layout.fullscreen().catch(()=>toast('暂时无法切换全屏。')));
element('pause-fullscreen').addEventListener('click',async()=>{
  // A native full-screen element needs to contain the visible dialog.
  element('pause-dialog').close();
  await layout.fullscreen();
  if(phase==='paused')element('pause-dialog').showModal();
});
element('pause-dialog').addEventListener('cancel',event=>{event.preventDefault();resume();});
element('new-game-confirm').addEventListener('click',()=>{element('new-game-dialog').close();startGame(false);});
element('new-game-cancel').addEventListener('click',()=>element('new-game-dialog').close());
[['settings-close','settings-dialog'],['settings-done','settings-dialog'],['help-close','help-dialog'],['help-done','help-dialog']].forEach(([button,dialog])=>element(button).addEventListener('click',()=>element(dialog).close()));
element('volume').addEventListener('input',event=>{preferences.value.volume=Number(event.target.value);applyPreferences();preferences.save();});
element('control-size').addEventListener('input',event=>{preferences.value.controlSize=Number(event.target.value);applyPreferences();preferences.save();});
element('control-layout').addEventListener('change',event=>{preferences.value.controlMode=event.target.value;applyPreferences();preferences.save();});
element('haptics').addEventListener('change',event=>{preferences.value.haptics=event.target.checked;preferences.save();});
element('high-refresh').addEventListener('change',event=>{preferences.value.highRefresh=event.target.checked;preferences.save();});
window.addEventListener('blur',()=>pause('离开游戏时已自动暂停。'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('切到后台时已自动暂停。');});
window.addEventListener('pagehide',()=>{if(phase==='playing')pause('离开页面时已自动暂停。');else if(phase==='paused')checkpoint();});
applyPreferences();
const clock=new FrameClock(()=>{
  if(phase!=='playing')return;
  try {
    engine.tick();input.tick();
    if(engine.frameCount-lastSaveFrame>=120) {lastSaveFrame=engine.frameCount;checkpoint();}
  } catch {pause('游戏遇到错误。当前进度已保留，可以返回菜单再继续。');}
},timestamp=>{
  input.pollGamepads();
  if(phase==='playing') {
    if(preferences.value.highRefresh || timestamp-lastPaint>=1000/60-.5) {engine.draw();lastPaint=timestamp;}
    if(engine.frameCount%30===0) {
      const info=engine.info();
      if(info.stage>=1 && info.stage<=50 && !info.menu)text('game-status','第 '+info.stage+' 关 / 50');
    }
  }
});

async function ready() {
  try {
    if(wechat)text('boot-note','微信内准备游戏，资源就绪后自动进入');
    text('boot-status','正在加载经典版…');progress(10);
    await Promise.all([engine.prepare(progress),saves.init(),document.fonts.load('12px PixelUI'),...Array.from(document.querySelectorAll('.home-artwork img')).map(image=>image.decode())]);
    const save=await saves.load();
    if(save)savedMeta={stage:save.stage,savedAt:save.savedAt};
    progress(100);text('boot-status','已准备好');
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,(wechat?3000:400)-(performance.now()-began))));
    element('boot').hidden=true;setPhase('menu');element('menu').hidden=false;
    updateMenu();layout.resize();engine.draw();clock.start();
    if(saves.problem)toast(saves.problem);
    if(!saves.available)text('save-status','此浏览器无法保存');
  } catch(error) {
    text('boot-status','游戏资源加载失败，请检查网络后重试。');
    element('retry').hidden=false;
  }
}
ready();
