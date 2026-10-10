export async function fetchGameResource(path,options={}) {
  const url=new URL(path,location.href);
  if(url.origin!==location.origin || !['http:','https:'].includes(url.protocol))throw new Error('游戏资源地址异常。');
  const response=await fetch(url,{...options,redirect:'error'});
  if(!response.ok)throw new Error('游戏资源暂时无法连接。');
  if(/android\.package|octet-stream.*apk/i.test(response.headers.get('Content-Type') || '')){
    await response.body?.cancel();throw new Error('已阻止异常安装包响应。');
  }
  return response;
}
export function allowedGameLink(href,base=location.href) {
  try {
    const url=new URL(href,base),entry=new URL(base);
    if(!['http:','https:'].includes(url.protocol) || url.username || url.password)return false;
    if(url.origin===entry.origin)return ['/', '/index.html','/connection-check','/connection-check.html'].includes(url.pathname);
    return url.protocol==='https:' && (url.origin==='https://github.com' && /^\/samgum\/bomberman\/?$/.test(url.pathname) || url.origin==='https://bomberman-4bs.pages.dev' && url.pathname==='/connection-check');
  } catch {return false;}
}
