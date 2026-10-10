import { fetchGameResource } from './network.js';
export class OfflinePackage {
  constructor(render,toast){
    this.render=render;this.toast=toast;this.registration=null;
    this.state={supported:'serviceWorker' in navigator,ready:false,busy:false,version:'',bytes:0};
    navigator.serviceWorker?.addEventListener('message',event=>{
      if(event.data?.type==='OFFLINE_STATUS')this.sync(event.data.state);
    });
  }
  sync(next){
    if(next.updated && next.version===document.documentElement.dataset.build)next={...next,error:''};
    this.state={...this.state,...next};this.render(this.state);if(next.error)this.toast(next.error);
  }
  async message(type){
    const worker=this.registration?.active || navigator.serviceWorker?.controller;
    if(!worker)throw new Error('离线功能正在准备，请稍后重试。');
    return new Promise((resolve,reject)=>{
      const channel=new MessageChannel();
      const timeout=setTimeout(()=>{channel.port1.close();reject(new Error('离线操作暂未完成，请检查网络后重试。'));},120000);
      channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();event.data.error?reject(new Error(event.data.error)):resolve(event.data.state);};
      worker.postMessage({type},[channel.port2]);
    });
  }
  async init(){
    if(!this.state.supported){this.sync({supported:false});return;}
    try {
      // Source-mode development has no package manifest. The published build
      // owns the root-scope registration and integrity-checked cache.
      const response=await fetchGameResource('build-meta.json',{cache:'no-cache'});
      if(!response.ok){this.sync({ready:false,available:false});return;}
      this.sync({busy:true,available:true});
      this.registration=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});
      let timeout;
      try {
        this.registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('离线功能准备超时。')),30000);})]);
      } finally {clearTimeout(timeout);}
      this.sync(await this.message('GET_OFFLINE_STATUS'));
    } catch {
      try {
        this.registration=await navigator.serviceWorker.getRegistration();
        this.sync(await this.message('GET_OFFLINE_STATUS'));
      } catch {this.sync({ready:false,busy:false,error:'离线包暂未准备好，联网后可以重新下载。'});}
    }
  }
  async action(type){
    if(this.state.busy)return;
    try {
      if(!this.registration?.active)await this.init();
      this.sync({busy:true,error:''});
      this.sync(await this.message(type));
      this.toast(type==='DELETE_OFFLINE'?'离线包已删除，游戏存档保留。':'离线包已准备好，可以断网游玩。');
    } catch(error){this.sync({busy:false,error:error.message});}
  }
}
