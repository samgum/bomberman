const VERSION='__BUILD_VERSION__';
const ASSET_PINS=/*__ASSET_PINS__*/null;
const PREFIX='bomberman-package-';
const PACKAGE=PREFIX+VERSION;
const STAGING=PACKAGE+'-staging';
const CONTROL='bomberman-offline-control';
const BASE=self.registration.scope;
const PREF=new URL('__offline_preference__',BASE).href;
const META=new URL('build-meta.json',BASE).href;
let queue=Promise.resolve();
let progress={busy:false,completed:0,total:0};
function enqueue(action){const task=queue.catch(()=>{}).then(action);queue=task;return task;}
async function enabled(){const cached=await (await caches.open(CONTROL)).match(PREF);return !cached || (await cached.json()).enabled!==false;}
async function setEnabled(value){await (await caches.open(CONTROL)).put(PREF,new Response(JSON.stringify({enabled:value}),{headers:{'Content-Type':'application/json'}}));}
async function status(){
  if(!await caches.has(PACKAGE))return {ready:false,version:VERSION,bytes:0,...progress};
  const cache=await caches.open(PACKAGE);
  const metaResponse=await cache.match(META);
  if(!metaResponse)return {ready:false,version:VERSION,bytes:0,...progress};
  const meta=await metaResponse.json();
  const urls=meta.files.filter(file=>file.path!=='_headers').map(file=>new URL(file.path,BASE).href);
  const present=await Promise.all(urls.map(url=>cache.match(url)));
  return {ready:present.every(Boolean),version:VERSION,bytes:meta.files.reduce((sum,file)=>sum+file.bytes,0),...progress};
}
async function notify(extra={}){const data={type:'OFFLINE_STATUS',state:{...(await status()),...extra}};for(const client of await self.clients.matchAll({includeUncontrolled:true,type:'window'}))client.postMessage(data);}
async function digest(data){const value=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function checkedFetch(url,options={}){
  const response=await fetch(url,{...options,redirect:'error'});
  if(!response.ok)throw new Error('游戏连接暂时不可用，请稍后重试。');
  if(/android\.package/i.test(response.headers.get('Content-Type') || '')){
    await response.body?.cancel();throw new Error('已阻止异常安装包响应。');
  }
  return response;
}
async function cachedFile(cache,key,path){
  const response=await cache.match(key);
  const expected=ASSET_PINS?.[path];
  if(!response || !expected)return null;
  if(await digest(await response.clone().arrayBuffer())!==expected.sha256){await cache.delete(key);return null;}
  return response;
}
function storedResponse(data,response){
  const headers=new Headers(response.headers);
  // Fetch has already decoded these bytes. Constructing a fresh response also
  // removes the redirected flag from Pages' /index.html -> / navigation.
  for(const name of ['content-encoding','content-length','transfer-encoding'])headers.delete(name);
  return new Response(data,{status:response.status,statusText:response.statusText,headers});
}
async function download(){
  await setEnabled(true);
  progress={busy:true,completed:0,total:0};
  await notify();
  try {
    const response=await checkedFetch(META,{cache:'reload'});
    const manifestBytes=await response.arrayBuffer();
    const metadata=storedResponse(manifestBytes,response);
    const meta=JSON.parse(new TextDecoder().decode(manifestBytes));
    if(meta.version!==VERSION || meta.owner!=='samgum/bomberman-classic')throw new Error('资源版本正在更新，请稍后重新下载。');
    const files=meta.files.filter(file=>file.path!=='_headers');
    if(files.some(file=>!file.path || file.path.includes('..') || new URL(file.path,BASE).origin!==self.location.origin))throw new Error('离线资源清单校验失败。');
    const pinned=files.filter(file=>file.path!=='sw.js');
    if(!ASSET_PINS || pinned.length!==Object.keys(ASSET_PINS).length || pinned.some(file=>ASSET_PINS[file.path]?.sha256!==file.sha256 || ASSET_PINS[file.path]?.bytes!==file.bytes))throw new Error('资源清单与当前游戏版本不一致。');
    progress.total=files.length;
    await caches.delete(STAGING);
    const staging=await caches.open(STAGING);
    let cursor=0;
    async function worker(){
      while(cursor<files.length){
        const file=files[cursor++],url=new URL(file.path,BASE).href;
        const target=file.path==='index.html'?BASE:file.path.endsWith('.html')?new URL(file.path.slice(0,-5),BASE).href:url;
        const response=await checkedFetch(target,{cache:'reload'});
        const bytes=await response.arrayBuffer();
        if(await digest(bytes)!==file.sha256)throw new Error('离线资源校验失败，请重新下载。');
        await staging.put(url,storedResponse(bytes,response));
        progress.completed++;await notify();
      }
    }
    const results=await Promise.allSettled([worker(),worker(),worker()]);
    const failed=results.find(result=>result.status==='rejected');
    if(failed)throw failed.reason;
    await staging.put(META,metadata);
    const primary=await caches.open(PACKAGE);
    for(const request of await staging.keys())await primary.put(request,await staging.match(request));
    await primary.put(BASE,await primary.match(new URL('index.html',BASE).href));
    for(const name of await caches.keys())if(name.startsWith(PREFIX) && name!==PACKAGE)await caches.delete(name);
    progress={busy:false,completed:files.length,total:files.length};
    await notify();return status();
  } catch(error){
    await caches.delete(STAGING);
    progress={busy:false,completed:0,total:0};
    await notify({error:error.message});throw error;
  }
}
async function remove(){
  await setEnabled(false);
  for(const name of await caches.keys())if(name.startsWith(PREFIX))await caches.delete(name);
  progress={busy:false,completed:0,total:0};await notify();return status();
}
self.addEventListener('install',event=>{
  event.waitUntil(enqueue(async()=>{
    if(await enabled()){
      try {await download();}
      catch(error){
        // Keep an existing complete package active if an update was interrupted.
        if((await caches.keys()).some(name=>name.startsWith(PREFIX) && name!==STAGING))throw error;
      }
    }
    await self.skipWaiting();
  }));
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await self.clients.claim();
  await notify({updated:true,error:'游戏已更新，重新加载页面后生效。'});
})()));
self.addEventListener('message',event=>{
  const type=event.data?.type;
  if(!['GET_OFFLINE_STATUS','DOWNLOAD_OFFLINE','DELETE_OFFLINE'].includes(type))return;
  const task=type==='GET_OFFLINE_STATUS'?status():enqueue(type==='DELETE_OFFLINE'?remove:download);
  event.waitUntil(task.then(state=>event.ports[0]?.postMessage({state})).catch(error=>event.ports[0]?.postMessage({error:error.message})));
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(!['http:','https:'].includes(url.protocol) || request.method!=='GET' || url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    // Only this release's verified entry can be returned by this worker.
    // Registration updates install a new set of pins for a later release.
    const entry=request.mode==='navigate' && [new URL(BASE).pathname,new URL('index.html',BASE).pathname].includes(url.pathname);
    if(entry){
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
      try {
        const target=new URL(BASE);target.search=url.search;
        const response=await checkedFetch(target.href,{cache:'no-cache',signal:controller.signal});
        if(!/text\/html/i.test(response.headers.get('Content-Type') || ''))throw new Error('游戏入口响应异常。');
        if(await digest(await response.clone().arrayBuffer())!==ASSET_PINS?.['index.html']?.sha256)throw new Error('游戏入口未通过当前版本校验。');
        return response;
      } catch {
        if(await caches.has(PACKAGE)){
          const cache=await caches.open(PACKAGE);
          const safe=await cachedFile(cache,BASE,'index.html');
          if(safe)return safe;
        }
        // A user who deleted the offline package still needs an update check
        // when an old controller encounters a newly deployed entry.
        try {event.waitUntil(self.registration.update().catch(()=>{}));}catch { /* Keep the error page local. */ }
        return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>连接暂时不可用</title><body style="background:#0b151c;color:#f7ecd2;font:18px/1.8 system-ui;padding:32px;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none"><h1>已停止异常跳转</h1><p>游戏入口未通过校验，可能是版本正在更新或当前连接异常。请稍等几秒后重试。游戏存档仍保留在当前浏览器。</p><p><a style="color:#ffdb8c" href="./">重新打开游戏</a></p><a style="color:#ffdb8c" href="https://bomberman-4bs.pages.dev/connection-check">检查连接</a></body></html>',{status:503,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"}});
      } finally {clearTimeout(timeout);}
    }
    if(url.pathname===new URL(META).pathname){
      try {return await checkedFetch(request,{cache:'no-cache'});}
      catch { /* Read the previously verified manifest while offline. */ }
    }
    const relative=decodeURIComponent(url.pathname.slice(new URL(BASE).pathname.length));
    const path=relative==='connection-check'?'connection-check.html':relative;
    const target=path==='connection-check.html'?new URL('connection-check',BASE).href:request;
    if(!await caches.has(PACKAGE))return checkedFetch(target);
    const cache=await caches.open(PACKAGE);
    const key=new URL(path,BASE).href;
    const cached=path==='build-meta.json'?await cache.match(key):await cachedFile(cache,key,path);
    if(cached)return cached;
    return checkedFetch(target);
  })());
});
