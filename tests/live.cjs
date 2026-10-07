const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {chromium}=require(process.env.BOMBERMAN_PLAYWRIGHT_PATH || 'playwright');
const base=process.argv[2];
const label=process.argv[3] || 'live';
if(!base || !/^https:\/\//.test(base))throw new Error('Pass the deployed HTTPS URL.');
async function request(url) {
  try {return await fetch(url,{cache:'no-store'});}
  catch(error) {
    // Keep TLS validation enabled; use the OS transport for local proxy stacks.
    const result=spawnSync(process.platform==='win32'?'curl.exe':'curl',['--silent','--show-error','--location','--max-time','30','--dump-header','-',url],{maxBuffer:8*1024*1024});
    if(result.status!==0)throw error;
    const data=result.stdout;
    let offset=0,status=0,headers={};
    while(data.subarray(offset,offset+5).toString()==='HTTP/') {
      const end=data.indexOf('\r\n\r\n',offset);
      if(end<0)throw new Error('Invalid HTTP response');
      const lines=data.subarray(offset,end).toString().split('\r\n');
      status=Number(lines.shift().split(' ')[1]);headers={};
      for(const line of lines){const separator=line.indexOf(':');if(separator>0)headers[line.slice(0,separator).toLowerCase()]=line.slice(separator+1).trim();}
      offset=end+4;
    }
    return new Response(data.subarray(offset),{status,headers});
  }
}
(async()=>{
  const local=JSON.parse(await fs.readFile('dist/build-meta.json','utf8'));
  const response=await request(base+'/build-meta.json');assert.equal(response.status,200);
  const remote=await response.json();assert.equal(remote.version,local.version);assert.equal(remote.owner,local.owner);
  const assets=await Promise.all(local.files.filter(file=>file.path!=='_headers').map(async file=>{
    const response=await request(base+'/'+file.path);
    assert.equal(response.status,200,file.path);
    const data=Buffer.from(await response.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'),file.sha256,file.path);
    return {path:file.path,status:response.status,bytes:data.length};
  }));
  const root=await request(base);assert.equal(root.status,200);assert.ok(root.headers.get('content-security-policy')?.includes("script-src 'self'"));
  const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},hasTouch:false});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    let library;
    Object.defineProperty(window,'jsnes',{configurable:true,get(){return library;},set(value){
      library={...value,NES:new Proxy(value.NES,{construct(target,args){const core=Reflect.construct(target,args);window.__testNes=core;return core;}})};
    }});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.documentElement.dataset.phase==='menu',null,{timeout:30000});
  await page.screenshot({path:path.resolve('verification/'+label+'-home.png')});
  await page.locator('#start-button').click();await page.waitForFunction(()=>window.__testNes.cpu.mem[0x93]>0,null,{timeout:15000});
  await page.keyboard.press('KeyZ');await page.waitForTimeout(80);
  assert.ok(await page.evaluate(()=>__testNes.cpu.mem.slice(0x3a0,0x3aa).some(Boolean)),'Z plants a bomb in the deployed game');
  await page.locator('#pause-button').click();await page.waitForFunction(()=>document.getElementById('pause-save-status').textContent.includes('已保存'));
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.resolve('verification/'+label+'-pause.png')});
  await context.close();await browser.close();
  const report={url:base,version:remote.version,assets,assetsMatch:true,gameplay:true,save:true,pageErrors:errors};
  await fs.writeFile(path.resolve('verification/'+label+'-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({url:base,version:remote.version,assets:assets.length,assetsMatch:true,gameplay:true,save:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
