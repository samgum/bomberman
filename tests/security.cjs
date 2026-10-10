const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
(async()=>{
  let injected='',apkRequests=0;const servers=[];let browser;const checks=[];
  try {
    const apk=http.createServer((req,res)=>{apkRequests++;res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename=harmless-fixture.apk'});res.end('PK-test-data-only');});servers.push(apk);await new Promise(resolve=>apk.listen(0,'127.0.0.1',resolve));
    const apkUrl='http://127.0.0.1:'+apk.address().port+'/harmless-fixture.apk';
    const root=path.resolve('dist');const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
    const app=http.createServer(async(req,res)=>{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(injected==='redirect' && pathname==='/'){res.writeHead(302,{Location:apkUrl}).end();return;}
      if(injected==='html' && pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><meta http-equiv="refresh" content="0;url='+apkUrl+'">');return;}
      if(injected==='rom' && pathname==='/game/bomberman.nes'){res.writeHead(302,{Location:apkUrl}).end();return;}
      if(pathname==='/index.html'){res.writeHead(308,{Location:'/'}).end();return;}
      try {
        const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname==='/connection-check'?'/connection-check.html':pathname));if(!file.startsWith(root+path.sep))throw new Error('path');
        let data=await fs.readFile(file);
        if(injected==='manifest' && pathname==='/build-meta.json'){const meta=JSON.parse(data);meta.files.find(file=>file.path==='index.html').sha256='0'.repeat(64);data=Buffer.from(JSON.stringify(meta));}
        res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'"});res.end(data);
      } catch {res.writeHead(404).end();}
    });servers.push(app);await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.address().port;
    browser=await chromium.launch();const context=await browser.newContext({hasTouch:true,isMobile:true,acceptDownloads:false,viewport:{width:390,height:844},userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile MicroMessenger/8.0.60'});const page=await context.newPage(),downloads=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
    await page.goto(origin);await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu');await page.waitForFunction(()=>document.getElementById('offline-badge').textContent==='已就绪');await page.waitForFunction(()=>navigator.serviceWorker.controller);
    const readSave=()=>page.evaluate(async()=>{
      const record=await new Promise(resolve=>{const open=indexedDB.open('bomberman-classic',1);open.onsuccess=()=>{const db=open.result,request=db.transaction('save').objectStore('save').get('current');request.onsuccess=()=>{resolve(request.result);db.close();};};});
      const text=record.format==='gzip'?await new Response(new Response(record.data).body.pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(record.data);
      const {stage,rom,core,state}=JSON.parse(text);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(state)));
      return {stage,rom,core,stateHash:Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')};
    });
    await page.locator('#start-button').click();await page.waitForTimeout(3500);await page.locator('#pause-button').click();await page.waitForFunction(()=>document.getElementById('pause-save-status').textContent.includes('已保存'));const save=await readSave();
    for(const mode of ['redirect','html']){
      injected=mode;await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu');assert.deepEqual(await readSave(),save);assert.equal(apkRequests,0);assert.deepEqual(downloads,[]);assert.equal(await page.locator('#continue-button').isVisible(),true);checks.push(mode+' response blocked while verified entry and save survive');
    }
    injected='';await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu');
    await page.evaluate(apkUrl=>{const link=document.createElement('a');link.id='unexpected-link';link.href=apkUrl;link.textContent='test link';document.body.append(link);},apkUrl);await page.locator('#unexpected-link').dispatchEvent('click');assert.equal(apkRequests,0);assert.equal(page.url(),origin+'/');checks.push('unexpected installer link cannot navigate');
    await page.locator('#continue-button').click();await page.locator('#pause-button').click();await page.waitForFunction(()=>document.getElementById('offline-refresh').disabled===false);injected='manifest';await page.locator('#offline-refresh').click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('资源清单与当前游戏版本不一致'));assert.equal(apkRequests,0);checks.push('forged manifest rejected before fetching assets');
    const latestSave=await readSave();
    injected='redirect';await page.evaluate(async apkUrl=>{const name=(await caches.keys()).find(name=>name.startsWith('bomberman-package-')&&!name.endsWith('-staging'));await (await caches.open(name)).put(location.origin+'/',new Response('<meta http-equiv="refresh" content="0;url='+apkUrl+'">',{headers:{'Content-Type':'text/html'}}));},apkUrl);
    const response=await page.reload();assert.equal(response.status(),503);assert.ok(await page.locator('h1').textContent()==='已停止异常跳转');assert.equal(apkRequests,0);assert.deepEqual(downloads,[]);assert.deepEqual(await readSave(),latestSave);checks.push('poisoned cached entry is rejected without deleting save');
    injected='rom';const cold=await browser.newContext({hasTouch:true,isMobile:true,acceptDownloads:false,viewport:{width:390,height:844}});const coldPage=await cold.newPage();coldPage.on('download',download=>downloads.push(download.suggestedFilename()));await coldPage.goto(origin);await coldPage.locator('#retry').waitFor({state:'visible'});assert.equal(apkRequests,0);assert.deepEqual(downloads,[]);checks.push('ROM redirect rejected on first resource load');
    await fs.writeFile('verification/security-regression-report.json',JSON.stringify({checks,apkRequests,downloadEvents:downloads,savePreserved:true,actualMaliciousApkUsed:false},null,2));console.log(JSON.stringify({passed:checks.length,apkRequests,downloadEvents:downloads,savePreserved:true}));
    await cold.close();await context.close();
  } finally {if(browser)await browser.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
})().catch(error=>{console.error(error);process.exitCode=1;});
