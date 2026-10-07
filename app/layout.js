export class GameLayout {
  constructor(canvas,toast,preferences=()=> ({controlMode:'auto',controlSize:100})) {
    this.canvas=canvas;
    this.toast=toast;
    this.preferences=preferences;
    this.root=document.documentElement;
    this.app=document.getElementById('app');
    this.window=document.getElementById('game-window');
    this.immersive=false;
    this.pending=false;
    const schedule=()=>this.schedule();
    window.addEventListener('resize',schedule);
    window.addEventListener('orientationchange',schedule);
    window.visualViewport?.addEventListener('resize',schedule);
    document.addEventListener('fullscreenchange',()=>this.fullscreenChanged());
    document.addEventListener('webkitfullscreenchange',()=>this.fullscreenChanged());
    if(window.ResizeObserver)new ResizeObserver(schedule).observe(this.window);
    navigator.devicePosture?.addEventListener('change',schedule);
    this.resize();
  }
  schedule() {
    if (this.pending) return;
    this.pending=true;
    requestAnimationFrame(()=>{this.pending=false;this.resize();});
  }
  resize() {
    this.root.style.setProperty('--app-height',Math.round(window.visualViewport?.height || window.innerHeight)+'px');
    const autoTouch=matchMedia('(pointer:coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints>0 && !matchMedia('(pointer:fine)').matches);
    const mode=this.preferences().controlMode;
    this.root.dataset.touch=(mode==='touch' || (mode==='auto' && autoTouch))?'true':'false';
    let segments;
    try { segments=window.viewport?.segments || window.getWindowSegments?.(); } catch { segments=null; }
    this.root.dataset.fold='none';
    if (segments?.length===2) {
      let [first,second]=segments;
      if (first.y===second.y && first.x!==second.x) {
        if(first.x>second.x) [first,second]=[second,first];
        this.root.dataset.fold='horizontal';
        this.root.style.setProperty('--fold-first-width',Math.max(0,first.width-8)+'px');
        this.root.style.setProperty('--fold-second-width',Math.max(0,second.width-8)+'px');
        this.root.style.setProperty('--fold-gap',Math.max(0,second.x-first.x-first.width)+'px');
      } else if(first.x===second.x && first.y!==second.y) {
        if(first.y>second.y) [first,second]=[second,first];
        this.root.dataset.fold='vertical';
        const header=document.querySelector('.topbar').getBoundingClientRect().bottom;
        const gap=parseFloat(getComputedStyle(this.app).rowGap)||0;
        this.root.style.setProperty('--fold-first-height',Math.max(80,first.height-header-gap)+'px');
        this.root.style.setProperty('--fold-gap',Math.max(0,second.y-first.y-first.height)+'px');
      }
    }
    let controlScale=this.preferences().controlSize/100;
    if(this.root.dataset.touch==='true' && this.root.dataset.fold==='none' && !(innerWidth>innerHeight && innerHeight<=550)) {
      const controls=document.getElementById('touch-controls');
      const style=getComputedStyle(controls);
      const cell=(controls.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-12)/2;
      const small=innerWidth<=370;
      const scaleLimit=Math.min(cell/(small?132:138),(cell-(small?8:innerWidth<=700?12:16))/(small?120:132));
      controlScale=Math.max(1,Math.min(controlScale,scaleLimit));
    }
    this.root.style.setProperty('--control-scale',controlScale);
    const width=this.window.clientWidth,height=this.window.clientHeight;
    this.window.parentElement.dataset.compact=width<650?'true':'false';
    this.window.parentElement.dataset.tiny=width<360?'true':'false';
    const scale=Math.max(.1,Math.min(width/256,height/240));
    const canvasWidth=Math.floor(256*scale),canvasHeight=Math.floor(240*scale);
    this.canvas.style.width=canvasWidth+'px';
    this.canvas.style.height=canvasHeight+'px';
    this.window.style.setProperty('--menu-top',((height-canvasHeight)/2+canvasHeight*.65)+'px');
    this.window.style.setProperty('--menu-width',Math.min(360,canvasWidth*.9)+'px');
  }
  nativeElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
  updateButtons() {
    const active=!!this.nativeElement() || this.immersive;
    document.querySelectorAll('.fullscreen-control').forEach(button=>{
      button.textContent=active?'退出全屏':'全屏';
      button.setAttribute('aria-label',active?'退出全屏':'进入全屏');
    });
  }
  fullscreenChanged() {
    if (this.nativeElement()) { this.immersive=false; this.root.dataset.immersive='false'; }
    this.updateButtons();this.schedule();
  }
  async fullscreen() {
    if (this.nativeElement()) {
      const exit=document.exitFullscreen || document.webkitExitFullscreen;
      if(exit) await exit.call(document);
    } else if(this.immersive) {
      this.immersive=false;this.root.dataset.immersive='false';
    } else {
      const target=document.documentElement;
      const enter=target.requestFullscreen || target.webkitRequestFullscreen;
      try {
        if(!enter || document.fullscreenEnabled===false) throw new Error('Fullscreen unavailable');
        await enter.call(target,{navigationUI:'hide'});
      } catch {
        this.immersive=true;this.root.dataset.immersive='true';this.toast('已进入沉浸模式，可随时退出。');
      }
    }
    this.updateButtons();this.schedule();
  }
}
