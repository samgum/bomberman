export function protectPageInteractions() {
  const block=event=>{event.preventDefault();event.stopPropagation();};
  document.addEventListener('contextmenu',block,{capture:true});
  document.addEventListener('selectstart',block,{capture:true});
  document.addEventListener('dragstart',block,{capture:true});
  document.addEventListener('touchstart',event=>{
    const target=event.target instanceof Element?event.target:event.target.parentElement;
    // Keep real controls and dialog scrolling usable; blank content has no
    // default touch action, image callout, selection, or browser gesture.
    if(!target?.closest('button,a,input,select,textarea,dialog'))event.preventDefault();
  },{capture:true,passive:false});
  document.querySelectorAll('img,canvas').forEach(element=>element.setAttribute('draggable','false'));
}
