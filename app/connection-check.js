import { protectPageInteractions } from './interaction.js';
const build=typeof __BUILD_VERSION__==='undefined'?'development':__BUILD_VERSION__;
const entryHash=typeof __ENTRY_HASH__==='undefined'?'':__ENTRY_HASH__;
const targets=[['正式域名','https://bomberman.shangganmieya.com'],['Pages 直连','https://bomberman-4bs.pages.dev']];
const element=id=>document.getElementById(id);
protectPageInteractions();
let report=null;
const installer=/android\.package|\.apk\b|x-msdownload/i;
const safePath=value=>{try{const url=new URL(value);return url.origin+url.pathname;}catch{return '';}};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
async function boundedBody(response,limit){
  const reader=response.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('返回内容过大，已停止读取。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function probe(origin,method){
  const result={method};const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(origin+'/',{method,redirect:'manual',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
    result.status=response.status;result.responseType=response.type;
    if(response.type==='opaqueredirect'){result.kind='redirect';result.description='收到跳转响应，已停止跟随。';return result;}
    result.mime=(response.headers.get('Content-Type') || '').slice(0,100);
    if(installer.test(result.mime)){await response.body?.cancel();result.kind='installer';result.description='入口返回安装包类型，已停止读取。';return result;}
    if(!response.ok){await response.body?.cancel();result.kind='http-error';result.description='服务器响应异常：'+response.status;return result;}
    if(!/text\/html/i.test(result.mime)){await response.body?.cancel();result.kind='unexpected-type';result.description='入口没有返回网页。';return result;}
    result.kind='ok';result.description='入口返回正常网页类型。';
    if(method==='GET'){
      const bytes=await boundedBody(response,65536),html=new TextDecoder().decode(bytes);
      if(!crypto.subtle){result.kind='unsupported';result.description='入口可连接，但浏览器不支持内容校验。';return result;}
      result.sha256=await digest(bytes);result.publishedBuild=html.match(/data-build="([a-f0-9]+)"/)?.[1] || '';
      result.matchesThisRelease=!!entryHash && result.sha256===entryHash;
      result.mayUseServiceWorker=origin===location.origin && !!navigator.serviceWorker?.controller;
      if(!result.matchesThisRelease){result.kind=result.publishedBuild && result.publishedBuild!==build?'version-changed':'content-mismatch';result.description=result.kind==='version-changed'?'返回版本与本检查页不同，请刷新后重测。':'返回网页与当前发布内容不一致。';}
      else result.description='返回内容与当前发布版本一致。';
    } else await response.body?.cancel();
  } catch(error){result.kind='connection-error';result.description=error.name==='AbortError'?'连接超时。':'浏览器未能读取响应，可能是网络、证书或跨域限制。';}
  finally {clearTimeout(timeout);}
  return result;
}
async function cachedEntry(){
  if(!('caches' in window))return {supported:false};
  const names=(await caches.keys()).filter(name=>name.startsWith('bomberman-package-') && !name.endsWith('-staging'));
  const entries=[];
  for(const name of names){
    const cache=await caches.open(name),response=await cache.match(location.origin+'/');
    if(!response)continue;
    const mime=(response.headers.get('Content-Type') || '').slice(0,100);
    const item={cache:name,mime,redirected:response.redirected};
    if(installer.test(mime)){item.problem='installer-type';entries.push(item);continue;}
    const bytes=await boundedBody(response,65536);item.sha256=await digest(bytes);item.matchesThisRelease=item.sha256===entryHash;entries.push(item);
  }
  return {supported:true,scope:location.origin,entries};
}
function renderResult(name,data){
  const row=document.createElement('article');row.className='result-row';row.dataset.problem=data.some(item=>item.kind!=='ok')?'true':'false';
  const heading=document.createElement('h2');heading.textContent=name;row.append(heading);
  for(const item of data){const line=document.createElement('p');const label=document.createElement('strong');label.textContent=item.method+' · ';line.append(label,document.createTextNode(item.description));row.append(line);}
  element('results').append(row);
}
element('run-check').addEventListener('click',async()=>{
  element('run-check').disabled=true;element('status').textContent='正在检查两条入口，跳转响应不会继续打开。';element('results').replaceChildren();element('results').hidden=false;element('report-section').hidden=true;
  const agent=navigator.userAgent.replace(/MMWEBID\/\d+/g,'MMWEBID/[已隐藏]').slice(0,400);
  report={schema:1,checkedAt:new Date().toISOString(),checkBuild:build,page:safePath(location.href),network:element('network-kind').value,userAgent:agent,serviceWorker:safePath(navigator.serviceWorker?.controller?.scriptURL || ''),targets:[]};
  try {
    for(const [name,origin] of targets){const results=await Promise.all([probe(origin,'HEAD'),probe(origin,'GET')]);report.targets.push({name,origin,results});renderResult(name,results);}
    try {report.localOfflineEntry=await cachedEntry();}catch{report.localOfflineEntry={unavailable:true};}
    const bad=report.targets.some(target=>target.results.some(result=>['redirect','installer','content-mismatch'].includes(result.kind)));
    element('status').textContent=bad?'检测到异常返回，请复制结果继续定位。':'检查完成。连接失败或版本变化需要结合另一种网络比较。';
    element('report').textContent=JSON.stringify(report,null,2);element('report-section').hidden=false;
  } finally {element('run-check').disabled=false;}
});
element('copy-report').addEventListener('click',async()=>{
  if(!report)return;const value=JSON.stringify(report,null,2);
  try {await navigator.clipboard.writeText(value);element('status').textContent='检测结果已复制，可发到当前聊天。';}
  catch {
    const field=document.createElement('textarea');field.value=value;field.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(field);field.select();
    let copied=false;try{copied=document.execCommand('copy');}catch{}field.remove();element('status').textContent=copied?'检测结果已复制。':'此浏览器不支持复制，可以截图保存检测结果。';
  }
});
