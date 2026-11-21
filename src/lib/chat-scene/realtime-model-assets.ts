type Entry={refs:number;controller:AbortController;promise:Promise<ArrayBuffer>;retired:boolean;bytes:number};
const entries=new Map<string,Entry>();
const cancelled=()=>new DOMException('Scene model consumer cancelled','AbortError');
/** One pending fetch may serve multiple hosts; a preview only releases its own lease. */
export function acquireSceneModel(url:string,bytes:number,signal:AbortSignal):Promise<{buffer:ArrayBuffer;release:()=>void}>{
  if(signal.aborted)return Promise.reject(cancelled());
  let entry=entries.get(url);
  if(!entry){const controller=new AbortController();const fresh:Entry={refs:0,controller,promise:Promise.resolve(new ArrayBuffer(0)),retired:false,bytes};
    const timeout=setTimeout(()=>controller.abort(),8000);
    fresh.promise=fetch(url,{signal:controller.signal,credentials:'omit',cache:'force-cache'}).then(response=>{if(!response.ok)throw Error('scene:model-fetch');return response.arrayBuffer();}).then(value=>{if(fresh.retired)throw cancelled();return value;}).finally(()=>clearTimeout(timeout));
    void fresh.promise.catch(()=>{});entries.set(url,fresh);entry=fresh;
  }
  const owned=entry;owned.refs++;let released=false;
  const release=()=>{if(released)return;released=true;if(--owned.refs===0){owned.retired=true;owned.controller.abort();if(entries.get(url)===owned)entries.delete(url);}};
  return new Promise((resolve,reject)=>{let settled=false;const abort=()=>{if(settled)return;settled=true;release();reject(cancelled());};signal.addEventListener('abort',abort,{once:true});
    owned.promise.then(buffer=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);if(signal.aborted){release();reject(cancelled());return;}resolve({buffer,release});},error=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);release();reject(error);});
  });
}
export function inspectRealtimeModelResources(){return {modelEntries:entries.size,modelReferences:[...entries.values()].reduce((sum,e)=>sum+e.refs,0),modelReservedBytes:[...entries.values()].reduce((sum,e)=>sum+e.bytes,0)};}
