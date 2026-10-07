const {chromium,webkit}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.BOMBERMAN_BASE_URL || 'http://127.0.0.1:50828';
const report={base,checks:[]};
const activeBrowsers=new Set();
const tabletUA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Version/18.6 Safari/605.1.15';
(async()=>{
  for(const [name,driver,fallback] of [['chromium-native',chromium,false],['webkit-immersive',webkit,true]]){
    const browser=await driver.launch({headless:true});activeBrowsers.add(browser);
    for(const [width,height] of [[1024,768],[1366,1024],[844,390]]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:false,userAgent:tabletUA});
      const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(fallback=>{
        Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});
        if(fallback){Object.defineProperty(document,'fullscreenEnabled',{value:false});Object.defineProperty(document,'webkitFullscreenEnabled',{value:false});}
      },fallback);
      await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu');
      const protection=await page.evaluate(()=>{
        const failures=[];
        for(const element of document.querySelectorAll('body,body *')){
          const style=getComputedStyle(element);
          if(style.userSelect!=='none' && style.webkitUserSelect!=='none')failures.push(element.tagName);
          if(style.webkitTouchCallout && style.webkitTouchCallout!=='none')failures.push(element.tagName+' callout');
        }
        const blank=document.getElementById('game-window');
        return {failures,canceled:['contextmenu','selectstart','dragstart','touchstart'].map(type=>!blank.dispatchEvent(new Event(type,{bubbles:true,cancelable:true})))};
      });
      assert.deepEqual(protection.failures,[]);assert.deepEqual(protection.canceled,[true,true,true,true]);
      await page.locator('#menu-save-info').dblclick();assert.equal(await page.evaluate(()=>getSelection().toString()),'');
      await page.locator('#start-button').click();await page.waitForTimeout(3800);
      assert.equal(await page.locator('html').getAttribute('data-touch'),'true');
      const initial=await page.locator('#game').boundingBox();
      if(height>550)assert.ok(initial.width>500,'tablet canvas expands beyond original 256px');
      else assert.ok(initial.height>height*.52,'short landscape screen allocates the available height to game');
      await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>document.documentElement.dataset.expanded==='true');await page.waitForTimeout(180);
      if(!fallback)assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true,'native Fullscreen API entered');
      else assert.equal(await page.locator('#fullscreen-button').textContent(),'退出沉浸');
      const sizes=await page.evaluate(()=>{
        const ids=['game','dpad','touch-a','touch-b','touch-start','touch-select','fullscreen-button','pause-button'];
        return Object.fromEntries(ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}];}));
      });
      assert.ok(sizes.game.height>initial.height+15,'fullscreen enlarges gameplay');
      assert.ok(sizes.game.height>height*.85,'fullscreen game fills most of the viewport height');
      for(const [id,r] of Object.entries(sizes)){assert.ok(r.x>=-.8 && r.y>=-.8 && r.right<=width+.8 && r.bottom<=height+.8,id+' stays in viewport');}
      assert.ok(sizes.dpad.right<=sizes.game.x+.8,'left controls do not cover game');
      assert.ok(sizes['touch-a'].x>=sizes.game.right-.8,'action controls do not cover game');
      await page.screenshot({path:path.resolve('verification/tablet-'+name+'-'+width+'.png')});
      await page.locator('#pause-button').click();await page.locator('#pause-fullscreen').click();
      await page.waitForFunction(()=>document.documentElement.dataset.expanded==='false');await page.locator('#resume-button').click();
      await page.setViewportSize({width:height,height:width});await page.waitForTimeout(150);
      const portrait=await page.locator('#game').boundingBox();assert.ok(portrait.width>height*.8);
      assert.deepEqual(errors,[]);report.checks.push({name,width,height,initial,expanded:sizes.game,protected:true});
      console.log('PASS '+name+' '+width+'x'+height);
      await context.close();
    }
    await browser.close();activeBrowsers.delete(browser);
  }
  await fs.writeFile('verification/tablet-report.json',JSON.stringify(report,null,2));
})().catch(async error=>{console.error(error);await Promise.all(Array.from(activeBrowsers,browser=>browser.close()));process.exitCode=1;});
