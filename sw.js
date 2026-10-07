const VERSION='__BUILD_VERSION__';
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
async function download(){
  await setEnabled(true);
  progress={busy:true,completed:0,total:0};
  await notify();
  try {
    const response=await fetch(META,{cache:'reload'});
    if(!response.ok)throw new Error('无法下载离线资源清单。');
    const metadata=response.clone();
    const meta=await response.json();
    if(meta.version!==VERSION || meta.owner!=='samgum/bomberman-classic')throw new Error('资源版本正在更新，请稍后重新下载。');
    const files=meta.files.filter(file=>file.path!=='_headers');
    if(files.some(file=>!file.path || file.path.includes('..') || new URL(file.path,BASE).origin!==self.location.origin))throw new Error('离线资源清单校验失败。');
    progress.total=files.length;
    await caches.delete(STAGING);
    const staging=await caches.open(STAGING);
    let cursor=0;
    async function worker(){
      while(cursor<files.length){
        const file=files[cursor++],url=new URL(file.path,BASE).href;
        const response=await fetch(url,{cache:'reload'});
        if(!response.ok)throw new Error('资源下载失败，请检查网络后重试。');
        if(await digest(await response.clone().arrayBuffer())!==file.sha256)throw new Error('离线资源校验失败，请重新下载。');
        await staging.put(url,response);
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
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
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
    if(!await caches.has(PACKAGE))return fetch(request);
    const cache=await caches.open(PACKAGE);
    const key=request.mode==='navigate'?BASE:new URL(url.pathname,BASE).href;
    const cached=await cache.match(key);
    if(cached)return cached;
    return fetch(request);
  })());
});
