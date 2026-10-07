const {chromium,webkit}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.BOMBERMAN_BASE_URL || 'http://127.0.0.1:50828';
const report={base,checks:[]};
const activeBrowsers=new Set();
const ua='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.60';
async function point(page,selector){const r=await page.locator(selector).boundingBox();assert.ok(r,selector);return {x:r.x+r.width/2,y:r.y+r.height/2};}
async function selection(page){return page.evaluate(()=>({text:getSelection().toString(),ranges:getSelection().rangeCount}));}
async function tap(page,selector){const p=await point(page,selector);await page.touchscreen.tap(p.x,p.y);}
async function touch(page,client,type,points){
  if(client){await client.send('Input.dispatchTouchEvent',{type,touchPoints:points});return;}
  // WebKit's desktop automation exposes taps but no held iOS gesture. Exercise
  // its Touch Event route explicitly; native iOS app menus need a device check.
  await page.evaluate(({type,points})=>{
    window.__heldTouches ||= new Map();
    const ended=['touchEnd','touchCancel'].includes(type);
    const active=ended?Array.from(__heldTouches.values()):points.map(p=>({identifier:p.id,clientX:p.x,clientY:p.y,target:__heldTouches.get(p.id)?.target || document.elementFromPoint(p.x,p.y)}));
    const changed=type==='touchStart'?active.filter(item=>!__heldTouches.has(item.identifier)):active;
    if(!ended)for(const item of active)__heldTouches.set(item.identifier,item);
    for(const target of new Set(changed.map(item=>item.target))){
      const event=new Event({touchStart:'touchstart',touchMove:'touchmove',touchEnd:'touchend',touchCancel:'touchcancel'}[type],{bubbles:true,cancelable:true});
      Object.defineProperties(event,{changedTouches:{value:changed.filter(item=>item.target===target)},touches:{value:ended?[]:active},targetTouches:{value:ended?[]:active.filter(item=>item.target===target)}});
      target.dispatchEvent(event);
    }
    if(ended)__heldTouches.clear();
  },{type,points});
}
(async()=>{
  for(const [name,driver] of [['Chromium',chromium],['WebKit',webkit]]){
    const browser=await driver.launch({headless:true});activeBrowsers.add(browser);
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:ua});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.__touchRecords=[];window.__clickCounts={};
      window.addEventListener('touchstart',event=>__touchRecords.push({target:event.target.id || event.target.className,prevented:event.defaultPrevented}));
      window.addEventListener('click',event=>{const id=event.target.closest('button,a')?.id;if(id)__clickCounts[id]=(__clickCounts[id]||0)+1;});
      let library;Object.defineProperty(window,'jsnes',{get(){return library;},set(value){library={...value,NES:new Proxy(value.NES,{construct(t,args){const core=Reflect.construct(t,args);window.__testNes=core;return core;}})};}});
    });
    await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu');
    const client=name==='Chromium'?await context.newCDPSession(page):null;
    for(const selector of ['.brand','#help-button','#menu-save-info','#start-button']){
      const p=await point(page,selector);await touch(page,client,'touchStart',[{id:1,...p}]);await page.waitForTimeout(900);await touch(page,client,'touchEnd',[]);
      assert.equal(await page.locator('html').getAttribute('data-phase'),'menu');assert.equal(await page.locator('dialog[open]').count(),0);
      assert.deepEqual(await selection(page),{text:'',ranges:0});
    }
    report.checks.push(name+' held brand, tool, text and start button cancel native touch defaults');
    await tap(page,'#start-button');await page.waitForFunction(()=>__testNes.cpu.mem[0x93]>0);
    assert.equal(await page.evaluate(()=>__clickCounts['start-button']),1,'tap activates exactly once');
    const before=await page.evaluate(()=>__testNes.cpu.mem[0x28]*16+__testNes.cpu.mem[0x29]);
    const right=await point(page,'.right'),bomb=await point(page,'#touch-a');
    await touch(page,client,'touchStart',[{id:1,...right}]);await page.waitForTimeout(700);
    assert.ok(await page.locator('.right').evaluate(el=>el.classList.contains('is-pressed')));
    assert.ok(await page.evaluate(()=>__testNes.cpu.mem[0x28]*16+__testNes.cpu.mem[0x29])>before,'held direction moves the player');
    await touch(page,client,'touchStart',[{id:1,...right},{id:2,...bomb}]);await page.waitForTimeout(90);
    assert.ok(await page.evaluate(()=>__testNes.cpu.mem.slice(0x3a0,0x3aa).some(Boolean)),'second finger plants a bomb');
    await touch(page,client,'touchCancel',[]);await page.waitForTimeout(90);
    assert.equal(await page.locator('.is-pressed').count(),0);assert.deepEqual(await selection(page),{text:'',ranges:0});
    assert.equal(await page.locator('.direction').allTextContents().then(values=>values.join('')),'','arrows have no hidden selectable text');
    const protectedTouches=await page.evaluate(()=>__touchRecords);assert.ok(protectedTouches.length>5);assert.ok(protectedTouches.every(event=>event.prevented),JSON.stringify(protectedTouches));
    report.checks.push(name+' direction hold, two-finger bomb and cancellation remain responsive');
    await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('.brand'));getSelection().addRange(range);document.dispatchEvent(new Event('selectionchange'));});
    assert.deepEqual(await selection(page),{text:'',ranges:0});report.checks.push(name+' forced text range is cleared');
    await tap(page,'#fullscreen-button');await page.waitForFunction(()=>document.documentElement.dataset.expanded==='true');await page.waitForTimeout(150);
    if(name==='Chromium')assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true,'touchend keeps native fullscreen user activation');
    await tap(page,'#fullscreen-button');await page.waitForFunction(()=>document.documentElement.dataset.expanded==='false');
    report.checks.push(name+' touch fullscreen enter and exit work');
    await tap(page,'#pause-button');await page.waitForFunction(()=>document.documentElement.dataset.phase==='paused');
    assert.equal(await page.evaluate(()=>__clickCounts['pause-button']),1);
    await tap(page,'#settings-button');await page.locator('#settings-dialog').waitFor({state:'visible'});
    const checked=await page.locator('#high-refresh').isChecked();await tap(page,'#high-refresh');assert.equal(await page.locator('#high-refresh').isChecked(),!checked);
    await tap(page,'#settings-done');await tap(page,'#resume-button');assert.equal(await page.locator('html').getAttribute('data-phase'),'playing');
    await tap(page,'#pause-button');await page.setViewportSize({width:844,height:390});await page.waitForTimeout(100);
    const dialog=await page.locator('#pause-dialog').boundingBox(),origin={id:1,x:dialog.x+18,y:dialog.y+dialog.height*.75};
    await touch(page,client,'touchStart',[origin]);await touch(page,client,'touchMove',[{...origin,y:origin.y-130}]);await touch(page,client,'touchEnd',[]);
    assert.ok(await page.locator('#pause-dialog').evaluate(el=>el.scrollTop)>60,'dialog swipe scrolls after native touch cancellation');
    await page.screenshot({path:path.resolve('verification/long-press-'+name.toLowerCase()+'.png')});
    report.checks.push(name+' native checkbox, pause/resume taps and dialog scrolling work');
    assert.deepEqual(errors,[]);console.log('PASS '+name+' long-press defenses and touch controls');
    await context.close();await browser.close();activeBrowsers.delete(browser);
  }
  await fs.writeFile('verification/interaction-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.checks.length,report:path.resolve('verification/interaction-report.json')}));
})().catch(async error=>{console.error(error);await Promise.all(Array.from(activeBrowsers,browser=>browser.close()));process.exitCode=1;});
