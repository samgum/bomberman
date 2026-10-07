const {chromium,webkit}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const base=process.env.BOMBERMAN_BASE_URL || 'http://127.0.0.1:50828';
const report={base,checks:[]};
const activeBrowsers=new Set();
const testOrigins=new Set();
async function isolatedOrigin(){
  let online=true,corruptPath='';
  const root=path.resolve('dist');
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
  const server=http.createServer(async(request,response)=>{
    if(!online){request.socket.destroy();return;}
    try {
      const pathname=new URL(request.url,'http://localhost').pathname;
      if(pathname===corruptPath){response.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'}).end('<svg xmlns="http://www.w3.org/2000/svg"/>');return;}
      const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
      const data=await fs.readFile(file);response.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});response.end(data);
    } catch {response.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin={url:'http://127.0.0.1:'+server.address().port,setOnline:value=>{online=value;},corrupt:value=>{corruptPath=value;},close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
  testOrigins.add(origin);return origin;
}
async function waitMenu(page){await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu',null,{timeout:30000});}
async function savedRecord(page){return page.evaluate(()=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('bomberman-classic',1);
  open.onsuccess=()=>{const db=open.result,request=db.transaction('save').objectStore('save').get('current');request.onsuccess=()=>{resolve(JSON.stringify(request.result));db.close();};request.onerror=()=>reject(request.error);};
  open.onerror=()=>reject(open.error);
}));}
async function packageState(page){return page.evaluate(async()=>{
  const names=(await caches.keys()).filter(name=>name.startsWith('bomberman-package-'));
  return {names,files:names.length?((await (await caches.open(names[0])).keys()).map(request=>new URL(request.url).pathname)):[]};
});}
async function check(name,action){await action();report.checks.push(name);console.log('PASS '+name);}
(async()=>{
  await fs.mkdir('verification',{recursive:true});
  const drivers=process.env.BOMBERMAN_OFFLINE_BROWSER==='chromium'?[['Chromium',chromium]]:[['Chromium',chromium],['WebKit',webkit]];
  for(const [name,driver] of drivers){
    // Playwright's WebKit offline flag rejects cached SW responses before the
    // worker can answer (microsoft/playwright#42775). Cut the isolated origin
    // instead; a fresh no-worker context confirms that the network is unusable.
    const origin=name==='WebKit'?await isolatedOrigin():null;
    const url=origin?.url || base;
    const browser=await driver.launch({headless:true});activeBrowsers.add(browser);
    const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
    const setOffline=async value=>{if(origin)origin.setOnline(!value);else await context.setOffline(value);};
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      let library;
      Object.defineProperty(window,'jsnes',{get(){return library;},set(value){library={...value,NES:new Proxy(value.NES,{construct(target,args){const core=Reflect.construct(target,args);window.__testNes=core;return core;}})};}});
    });
    await check(name+' automatic complete offline package',async()=>{
      await page.goto(url,{waitUntil:'domcontentloaded'});await waitMenu(page);
      await page.waitForFunction(()=>document.getElementById('offline-badge').textContent==='已就绪',null,{timeout:60000});
      await page.waitForFunction(()=>navigator.serviceWorker.controller);
      const state=await packageState(page);assert.equal(state.names.length,1);assert.ok(state.files.includes('/game/bomberman.nes'));
      assert.ok(state.files.some(file=>/game-.*\.js$/.test(file)));
    });
    await page.locator('#start-button').click();await page.waitForFunction(()=>__testNes.cpu.mem[0x93]>0);
    await page.locator('#pause-button').click();await page.waitForFunction(()=>document.getElementById('pause-save-status').textContent.includes('已保存'));
    const save=await savedRecord(page);assert.ok(save && save!=='null');
    await check(name+' fresh offline reload and saved game',async()=>{
      await setOffline(true);
      if(origin){const control=await browser.newContext({serviceWorkers:'block'});const probe=await control.newPage();await assert.rejects(probe.goto(url,{timeout:8000}));await control.close();}
      await page.reload({waitUntil:'domcontentloaded'});await waitMenu(page);
      await page.locator('#continue-button').click();await page.waitForFunction(()=>__testNes.cpu.mem[0x93]>0);
      assert.equal(await page.evaluate(()=>__testNes.cpu.mem[0x58]),1);
      await page.locator('#pause-button').click();await page.waitForFunction(()=>document.getElementById('offline-badge').textContent==='已就绪');
      await page.screenshot({path:path.resolve('verification/offline-'+name.toLowerCase()+'.png')});
      await setOffline(false);
    });
    await check(name+' delete package preserves save and stays deleted after reload',async()=>{
      const before=await savedRecord(page);
      await page.locator('#offline-delete').click();await page.waitForFunction(()=>document.getElementById('offline-badge').textContent==='未下载');
      assert.equal((await packageState(page)).names.length,0);assert.equal(await savedRecord(page),before);
      await page.reload();await waitMenu(page);await page.waitForFunction(()=>document.getElementById('offline-badge').textContent==='未下载');
      assert.equal((await packageState(page)).names.length,0);
      await page.locator('#continue-button').click();await page.waitForFunction(()=>__testNes.cpu.mem[0x93]>0);
      await page.locator('#pause-button').click();
    });
    await check(name+' re-download restores offline launch',async()=>{
      await page.locator('#offline-refresh').click();await page.waitForFunction(()=>document.getElementById('offline-badge').textContent==='已就绪',null,{timeout:60000});
      assert.equal((await packageState(page)).names.length,1);
      await setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await waitMenu(page);assert.equal(await page.locator('#continue-button').isVisible(),true);await setOffline(false);
    });
    if(origin)await check(name+' invalid asset hash rejects update and preserves package',async()=>{
      await page.locator('#continue-button').click();await page.waitForFunction(()=>__testNes.cpu.mem[0x93]>0);await page.locator('#pause-button').click();
      const before=await packageState(page);origin.corrupt('/assets/bomb.svg');
      await page.locator('#offline-refresh').click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('校验失败'));
      await page.waitForFunction(()=>document.getElementById('offline-refresh').disabled===false);
      assert.deepEqual(await packageState(page),before);assert.equal(await page.locator('#offline-badge').textContent(),'已就绪');
      origin.corrupt('');await page.locator('#resume-button').click();await page.locator('#pause-button').click();await page.locator('#menu-button').click();await waitMenu(page);
    });
    await check(name+' interrupted re-download keeps complete package',async()=>{
      await page.locator('#continue-button').click();await page.waitForFunction(()=>__testNes.cpu.mem[0x93]>0);await page.locator('#pause-button').click();
      await setOffline(true);await page.locator('#offline-refresh').click();
      await page.waitForFunction(()=>document.getElementById('offline-refresh').disabled===false,null,{timeout:20000});
      assert.equal(await page.locator('#offline-badge').textContent(),'已就绪');
      assert.equal((await packageState(page)).names.length,1);
      await page.reload({waitUntil:'domcontentloaded'});await waitMenu(page);
      assert.deepEqual(errors,[]);
    });
    await context.close();await browser.close();activeBrowsers.delete(browser);
    if(origin){await origin.close();testOrigins.delete(origin);}
  }
  await fs.writeFile('verification/offline-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.checks.length,report:path.resolve('verification/offline-report.json')}));
})().catch(async error=>{console.error(error);await Promise.all(Array.from(activeBrowsers,browser=>browser.close()));await Promise.all(Array.from(testOrigins,origin=>origin.close()));process.exitCode=1;});
