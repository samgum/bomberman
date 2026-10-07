const {chromium,webkit}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.BOMBERMAN_BASE_URL || 'http://127.0.0.1:50827';
const output=path.resolve('verification');
const report={base,checks:[],failures:[]};
const wechatUA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.60';

async function instrument(page) {
  await page.addInitScript(()=>{
    let library;
    Object.defineProperty(window,'jsnes',{
      configurable:true,get(){return library;},
      set(value){library={...value,NES:new Proxy(value.NES,{
        construct(target,args){
          const core=Reflect.construct(target,args);
          window.__testNes=core;
          const restore=core.fromJSON.bind(core);
          core.fromJSON=state=>{
            restore(state);
            window.__restoredMemory=core.cpu.mem.slice(0,2048);
            window.__restoredSprites=Array.from(core.ppu.spriteMem);
          };
          return core;
        }
      })};}
    });
  });
}
async function ready(page) {
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu',null,{timeout:20000});
}
async function play(page) {
  await page.locator('#start-button').click();
  await page.waitForFunction(()=>window.__testNes.cpu.mem[0x93]>0,null,{timeout:15000});
  await page.waitForTimeout(120);
}
async function position(page) {
  return page.evaluate(()=>({x:__testNes.cpu.mem[0x28]*16+__testNes.cpu.mem[0x29],y:__testNes.cpu.mem[0x2a]*16+__testNes.cpu.mem[0x2b],stage:__testNes.cpu.mem[0x58],time:__testNes.cpu.mem[0x93],bombs:__testNes.cpu.mem.slice(0x3a0,0x3aa).filter(Boolean).length}));
}
async function center(page,selector) {
  const rect=await page.locator(selector).boundingBox();
  assert.ok(rect,selector+' visible');
  return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
}
async function bounds(page,selectors) {
  return page.evaluate(selectors=>{
    const issues=[];
    for(const selector of selectors) {
      const el=document.querySelector(selector),r=el.getBoundingClientRect();
      if(r.width<=0 || r.height<=0 || r.left<-.8 || r.top<-.8 || r.right>innerWidth+.8 || r.bottom>innerHeight+.8)issues.push({selector,rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight}});
    }
    if(document.documentElement.scrollWidth>innerWidth+1)issues.push({overflow:document.documentElement.scrollWidth,width:innerWidth});
    return issues;
  },selectors);
}
async function run(name,action) {
  if(process.argv[2] && !name.includes(process.argv[2]))return;
  try {await action();report.checks.push(name);console.log('PASS '+name);}
  catch(error){report.failures.push({name,message:error.message});console.log('FAIL '+name+': '+error.message);}
}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const profiles=[
    ['desktop-1920',1920,1080,false],['laptop-1366',1366,768,false],['desktop-small',800,600,false],
    ['phone-se',320,568,true],['phone-small',360,640,true],['phone-modern',390,844,true],
    ['phone-large',430,932,true],['phone-landscape',844,390,true],['phone-landscape-small',667,375,true],
    ['tablet-portrait',768,1024,true],['tablet-landscape',1024,768,true],['fold-open',717,1024,true]
  ];
  for(const [name,width,height,touch] of profiles)await run('responsive '+name,async()=>{
    const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:touch?3:1});
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await instrument(page);await ready(page);
    const selectors=['.topbar','#fullscreen-button','#game','#start-button','#keyboard-guide'];
    assert.deepEqual(await bounds(page,selectors),[]);
    assert.equal(await page.evaluate(()=>document.fonts.check('12px PixelUI')),true);
    await page.screenshot({path:path.join(output,name+'-menu.png')});
    if(['phone-se','phone-modern','phone-landscape-small','tablet-landscape'].includes(name)) {
      await play(page);assert.equal((await position(page)).stage,1);
      await page.screenshot({path:path.join(output,name+'-game.png')});
      await page.locator('#pause-button').click();
      await page.locator('#settings-button').click();
      await page.locator('#control-size').evaluate(input=>{input.value='125';input.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.locator('#settings-done').click();await page.locator('#resume-button').click();
      await page.waitForTimeout(120);
      assert.deepEqual(await bounds(page,['#dpad','#touch-a','#touch-b','#touch-start','#touch-select']),[]);
    }
    assert.deepEqual(errors,[]);await context.close();
  });
  await run('keyboard bombs, pause/resume and exact persistent state',async()=>{
    const context=await browser.newContext({viewport:{width:1366,height:900},hasTouch:false});
    const page=await context.newPage();await instrument(page);await ready(page);await play(page);
    const before=await position(page);
    await page.keyboard.down('KeyD');await page.waitForTimeout(180);await page.keyboard.up('KeyD');
    assert.ok((await position(page)).x>before.x,'WASD moves original player');
    await page.keyboard.press('Space');await page.waitForTimeout(80);
    assert.ok((await position(page)).bombs>0,'space plants a native bomb');
    await page.keyboard.press('KeyP');
    await page.waitForFunction(()=>document.getElementById('pause-save-status').textContent.includes('已保存'));
    const frozen=await page.evaluate(()=>({ram:__testNes.cpu.mem.slice(0,2048),sprites:Array.from(__testNes.ppu.spriteMem)}));
    const atPause=await position(page);await page.waitForTimeout(600);assert.deepEqual(await position(page),atPause);
    await page.screenshot({path:path.join(output,'pause-menu.png')});
    await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu');
    await page.locator('#continue-button').click();
    await page.waitForFunction(()=>window.__restoredMemory!==undefined);
    const restored=await page.evaluate(()=>({ram:__restoredMemory,sprites:__restoredSprites}));
    assert.deepEqual(restored,frozen,'memory and sprite state restored before advancing');
    await page.keyboard.press('KeyP');assert.equal(await page.locator('html').getAttribute('data-phase'),'paused');
    await page.keyboard.press('KeyP');assert.equal(await page.locator('html').getAttribute('data-phase'),'playing');
    await page.keyboard.press('KeyP');await page.waitForFunction(()=>document.getElementById('pause-save-status').textContent.includes('已保存'));
    await page.locator('#menu-button').click();await page.locator('#continue-button').waitFor({state:'visible'});
    await page.locator('#start-button').click();await page.locator('#new-game-dialog').waitFor({state:'visible'});
    await page.locator('#new-game-cancel').click();assert.equal(await page.locator('html').getAttribute('data-phase'),'menu');
    await context.close();
  });
  await run('simultaneous touch, slide turns, cancellation and double-tap no zoom',async()=>{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:3});
    const page=await context.newPage();await instrument(page);await ready(page);await play(page);
    const client=await context.newCDPSession(page);
    const right=await center(page,'.right'),bomb=await center(page,'#touch-a'),down=await center(page,'.down');
    const initial=await position(page);
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:right.x,y:right.y}]});
    await page.waitForTimeout(140);
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:right.x,y:right.y},{id:2,x:bomb.x,y:bomb.y}]});
    await page.waitForTimeout(70);
    assert.ok((await position(page)).x>initial.x);
    assert.ok((await position(page)).bombs>0);
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:down.x,y:down.y},{id:2,x:bomb.x,y:bomb.y}]});
    assert.ok(await page.locator('.down').evaluate(el=>el.classList.contains('is-pressed')));
    await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await page.waitForTimeout(60);const stopped=await position(page);await page.waitForTimeout(100);assert.deepEqual((await position(page)).x,stopped.x);
    assert.equal(await page.locator('.is-pressed').count(),0);
    const scale=await page.evaluate(()=>visualViewport.scale);
    await page.touchscreen.tap(bomb.x,bomb.y);await page.touchscreen.tap(bomb.x,bomb.y);await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>visualViewport.scale),scale);
    await page.screenshot({path:path.join(output,'touch-game.png')});
    await context.close();
  });
  await run('rotation preserves gameplay and loss of focus pauses',async()=>{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const page=await context.newPage();await instrument(page);await ready(page);await play(page);
    const previous=await position(page);await page.setViewportSize({width:844,height:390});await page.waitForTimeout(150);
    assert.equal((await position(page)).stage,previous.stage);
    assert.deepEqual(await bounds(page,['#game','#dpad','#touch-a','#fullscreen-button']),[]);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    assert.equal(await page.locator('html').getAttribute('data-phase'),'paused');
    const paused=await position(page);await page.waitForTimeout(200);assert.deepEqual(await position(page),paused);
    await context.close();
  });
  for(const [name,viewport,segments] of [
    ['horizontal',{width:740,height:720},[{x:0,y:0,width:360,height:720},{x:380,y:0,width:360,height:720}]],
    ['vertical',{width:720,height:740},[{x:0,y:0,width:720,height:360},{x:0,y:380,width:720,height:360}]]
  ])await run('foldable segments '+name,async()=>{
    const context=await browser.newContext({viewport,hasTouch:true,isMobile:true});const page=await context.newPage();
    await page.addInitScript(segments=>Object.defineProperty(window,'viewport',{configurable:true,value:{segments}}),segments);
    await ready(page);await page.waitForTimeout(100);
    assert.equal(await page.locator('html').getAttribute('data-fold'),name);
    assert.deepEqual(await bounds(page,['#game','.home-artwork','.home-actions']),[]);
    const panel=await page.locator('.display-panel').boundingBox();
    const art=await page.locator('.home-artwork').boundingBox();
    const actions=await page.locator('.home-actions').boundingBox();
    if(name==='horizontal'){assert.ok(art.x+art.width<=360.8);assert.ok(actions.x>=379.2);}else{assert.ok(art.y+art.height<=360.8);assert.ok(actions.y>=379.2);}
    await page.screenshot({path:path.join(output,'fold-'+name+'.png')});await context.close();
  });
  await run('desktop native fullscreen and persistent exit control',async()=>{
    const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:false});const page=await context.newPage();await instrument(page);await ready(page);await play(page);
    await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>document.getElementById('fullscreen-button').getAttribute('aria-pressed')==='true');
    assert.ok(await page.evaluate(()=>document.fullscreenElement || document.documentElement.dataset.immersive==='true'));
    assert.deepEqual(await bounds(page,['#fullscreen-button']),[]);
    await page.waitForFunction(()=>document.activeElement.id==='game');
    const before=await position(page);await page.keyboard.down('ArrowRight');await page.waitForTimeout(150);await page.keyboard.up('ArrowRight');
    assert.ok((await position(page)).x>before.x,'keyboard remains active after clicking fullscreen');
    await page.keyboard.press('KeyZ');await page.waitForTimeout(80);assert.ok((await position(page)).bombs>0,'Z plants a bomb while fullscreen');
    await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>document.getElementById('fullscreen-button').textContent==='全屏');await context.close();
  });
  await run('WeChat preparation waits for all resources and at least three seconds',async()=>{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:wechatUA});const page=await context.newPage();
    await page.route('**/game/bomberman.nes',async route=>{await new Promise(resolve=>setTimeout(resolve,4200));await route.continue();});
    const time=Date.now();await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1500);
    assert.equal(await page.locator('html').getAttribute('data-phase'),'loading');
    assert.equal(await page.locator('#boot').isVisible(),true);
    await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu',null,{timeout:15000});
    assert.ok(Date.now()-time>=4100);
    assert.deepEqual(await bounds(page,['#game','#start-button','#menu-save-info']),[]);await context.close();
  });
  await run('resource failure offers retry without entering game',async()=>{
    const context=await browser.newContext();const page=await context.newPage();await page.route('**/game/bomberman.nes',route=>route.abort());await page.goto(base);
    await page.locator('#retry').waitFor({state:'visible'});assert.equal(await page.locator('html').getAttribute('data-phase'),'loading');await context.close();
  });
  await run('blocked storage keeps the game playable',async()=>{
    const context=await browser.newContext();const page=await context.newPage();await instrument(page);
    await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{get(){throw new Error('Blocked');}});Storage.prototype.setItem=function(){throw new Error('Blocked');};});
    await ready(page);await play(page);assert.equal((await position(page)).stage,1);await context.close();
  });
  await browser.close();
  await run('WebKit WeChat gameplay, touch layout and immersive exit',async()=>{
    const safari=await webkit.launch({headless:true});
    const context=await safari.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:wechatUA});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await instrument(page);const began=Date.now();await ready(page);assert.ok(Date.now()-began>=2800);
    await page.screenshot({path:path.join(output,'wechat-webkit-menu.png')});await play(page);
    await page.locator('#pause-button').click();await page.waitForFunction(()=>document.getElementById('pause-save-status').textContent.includes('已保存'));
    await page.locator('#resume-button').click();
    await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>document.getElementById('fullscreen-button').getAttribute('aria-pressed')==='true');
    if(await page.locator('#pause-dialog').isVisible())await page.locator('#resume-button').click();
    assert.deepEqual(await bounds(page,['#fullscreen-button','#game','#touch-a']),[]);
    await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>document.getElementById('fullscreen-button').textContent==='全屏');
    assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,'wechat-webkit-game.png')});await context.close();await safari.close();
  });
  const reportName=process.argv[2]?'browser-filtered-report.json':'browser-report.json';
  await fs.writeFile(path.join(output,reportName),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.checks.length,failed:report.failures.length,report:path.join(output,reportName)}));
  if(report.failures.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
