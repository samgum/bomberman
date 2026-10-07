const {chromium}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    let library;
    Object.defineProperty(window,'jsnes',{
      configurable:true,
      get(){return library;},
      set(value){
        library={...value,NES:new Proxy(value.NES,{
          construct(target,args){
            const core=Reflect.construct(target,args);
            window.__testNes=core;
            return core;
          }
        })};
      }
    });
  });
  await page.goto('http://127.0.0.1:50827');
  await page.locator('#start-button').waitFor({state:'visible'});
  console.log(JSON.stringify({phase:'menu',errors,canvas:await page.locator('#game').boundingBox()}));
  console.log(JSON.stringify(await page.evaluate(()=>({touch:document.documentElement.dataset.touch,points:navigator.maxTouchPoints,coarse:matchMedia('(any-pointer:coarse)').matches,phase:document.documentElement.dataset.phase,boot:document.getElementById('boot-status').textContent}))));
  await page.screenshot({path:path.resolve('verification/classic-desktop-menu.png')});
  await page.locator('#start-button').click();
  await page.waitForFunction(()=>window.__testNes.cpu.mem[0x93]>0,{},{timeout:12000});
  await page.waitForTimeout(250);
  console.log(JSON.stringify(await page.evaluate(()=>({stage:__testNes.cpu.mem[0x58],started:__testNes.cpu.mem[0x60],menu:__testNes.cpu.mem[0x72],time:__testNes.cpu.mem[0x93]}))));
  await page.screenshot({path:path.resolve('verification/classic-desktop-game.png')});
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(1200);
  console.log(JSON.stringify({phase:await page.locator('html').getAttribute('data-phase'),save:await page.locator('#pause-save-status').innerText(),errors}));
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
