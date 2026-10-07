export function protectPageInteractions() {
  const touches=new Map();
  let lastTap=null;
  const clearSelection=()=>{
    const selection=document.getSelection();
    if(selection?.rangeCount)selection.removeAllRanges();
  };
  const block=event=>{event.preventDefault();event.stopPropagation();clearSelection();};
  document.addEventListener('contextmenu',block,{capture:true});
  document.addEventListener('selectstart',block,{capture:true});
  document.addEventListener('dragstart',block,{capture:true});
  document.addEventListener('selectionchange',clearSelection);
  document.addEventListener('touchstart',event=>{
    clearSelection();
    let protectedTouch=false;
    for(const touch of Array.from(event.changedTouches || [])) {
      const target=touch.target instanceof Element?touch.target:touch.target.parentElement;
      // Native form widgets have no selectable page text. All other surfaces,
      // including buttons and links, must cancel the original iOS touch gesture.
      if(target?.closest('input,select,textarea'))continue;
      protectedTouch=true;
      const gameControl=target?.closest('#dpad,#touch-a,#touch-b');
      const control=gameControl?null:target?.closest('button,a,label');
      touches.set(touch.identifier,{control,dialog:target?.closest('dialog[open]'),x:touch.clientX,y:touch.clientY,scroll:target?.closest('dialog[open]')?.scrollTop || 0,moved:false,started:performance.now()});
    }
    if(protectedTouch || !event.changedTouches?.length)event.preventDefault();
  },{capture:true,passive:false});
  document.addEventListener('touchmove',event=>{
    let protectedTouch=false;
    for(const touch of Array.from(event.changedTouches || [])) {
      const gesture=touches.get(touch.identifier);
      if(!gesture)continue;
      protectedTouch=true;
      const dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y;
      if(Math.hypot(dx,dy)>10)gesture.moved=true;
      if(gesture.dialog && gesture.moved && Math.abs(dy)>Math.abs(dx))gesture.dialog.scrollTop=gesture.scroll-dy;
    }
    if(protectedTouch)event.preventDefault();
    clearSelection();
  },{capture:true,passive:false});
  document.addEventListener('touchend',event=>{
    let protectedTouch=false;
    for(const touch of Array.from(event.changedTouches || [])) {
      const gesture=touches.get(touch.identifier);
      if(!gesture)continue;
      protectedTouch=true;touches.delete(touch.identifier);
      const control=gesture.control;
      const hit=document.elementFromPoint(touch.clientX,touch.clientY)?.closest('button,a,label');
      if(!gesture.moved && performance.now()-gesture.started<650 && control?.isConnected && !control.disabled && hit===control){
        // Run in the trusted touchend task so audio and fullscreen retain user
        // activation even though the native compatibility click was canceled.
        lastTap={control,time:performance.now()};control.click();
      }
    }
    if(protectedTouch)event.preventDefault();
    clearSelection();
  },{capture:true,passive:false});
  document.addEventListener('touchcancel',event=>{
    for(const touch of Array.from(event.changedTouches || []))touches.delete(touch.identifier);
    clearSelection();
  },{capture:true,passive:false});
  document.addEventListener('click',event=>{
    if(event.isTrusted && event.detail>0 && lastTap && performance.now()-lastTap.time<750 && lastTap.control.contains(event.target)){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },{capture:true});
  document.querySelectorAll('img,canvas').forEach(element=>element.setAttribute('draggable','false'));
}
