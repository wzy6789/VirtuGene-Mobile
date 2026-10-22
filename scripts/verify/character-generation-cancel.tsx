import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreateGeneTab } from '../../src/components/character/CreateGeneTab';
import { CharacterAddModal } from '../../src/components/character/CharacterAddModal';
import { webApi } from '../../src/lib/web-api';
import { ipc } from '../../src/lib/ipc-client';
import { useAuthStore } from '../../src/store/auth-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useChatStore } from '../../src/store/chat-store';
import { setGatewayAccessToken } from '../../src/lib/ai/gateway';

useAuthStore.setState({ userId:'cancel-ui-user',apiKey:'fake-cancellation-fixture-key' });
useSettingsStore.setState({ defaultModel:{provider:'deepseek',model:'deepseek-v4-flash'} });
useChatStore.setState({characters:[]});
const productionGenerate=webApi.character.generate.bind(webApi.character);
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function until(test:()=>boolean){for(let i=0;i<200;i++){if(test())return;await tick();}throw Error('fixture timeout');}
const candidate=(name:string)=>({tags:['简洁'],signature:name,greeting:'先坐会儿。',systemPrompt:'你是独立的角色，用简短的话表达自己的判断。'});

Object.assign(window,{cancelTest:{
  calls:[] as any[],
  async transport(){
    const checks:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
    const original=window.fetch;let requests:any[]=[];
    window.fetch=((url:any,init:RequestInit={})=>new Promise<Response>((resolve,reject)=>{
      const request:any={url:String(url),signal:init.signal,body:String(init.body??''),done:false};
      request.resolve=()=>{if(request.done)return;request.done=true;resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(candidate('传输夹具候选'))}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200,headers:{'Content-Type':'application/json'}}));};
      request.reject=()=>{if(request.done)return;request.done=true;reject(Error('fixture network failure'));};
      const abort=()=>{if(request.done)return;request.done=true;request.aborted=true;reject(new DOMException('Cancelled','AbortError'));};
      if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
      requests.push(request);
    })) as typeof fetch;
    const params={apiKey:'fake-cancellation-fixture-key',characterName:'取消验收角色',fields:{description:'习惯用短句表达自己的判断。'},enableWebSearch:false,count:3};
    try{
      const pre=new AbortController();pre.abort();const cancelled=await productionGenerate(params,undefined,{signal:pre.signal});
      check(cancelled.cancelled&&requests.length===0,'pre-cancel sends no search or model request');
      const group=new AbortController();const pending=productionGenerate(params,undefined,{signal:group.signal});await until(()=>requests.length===3);group.abort();
      check((await pending).cancelled&&requests.every(r=>r.aborted),'cancel reaches all three actual model fetch signals');
      requests=[];const search=new AbortController();const searching=productionGenerate({...params,enableWebSearch:true},undefined,{signal:search.signal});await until(()=>requests.length===2);search.abort();
      check((await searching).cancelled&&requests.every(r=>r.aborted&&r.url.includes('duckduckgo')),'search cancellation aborts both searches and never starts models');
      requests=[];const failing=productionGenerate(params);await until(()=>requests.length===3);requests[0].reject();
      check(!!(await failing).error&&requests.slice(1).every(r=>r.aborted),'one candidate failure aborts pending siblings');
      requests=[];const fallback=productionGenerate({...params,enableWebSearch:true});await until(()=>requests.length===2);requests.forEach(r=>r.reject());await until(()=>requests.length===5);requests.slice(2).forEach(r=>r.resolve());
      check((await fallback).candidates?.length===3,'ordinary search failure still permits existing no-search generation fallback');
      requests=[];const ordinary=productionGenerate({...params,count:1});await until(()=>requests.length===1);const firstBody=requests[0].body;requests[0].resolve();check((await ordinary).candidates?.length===1,'legacy caller without options remains compatible');
      requests=[];const signalled=productionGenerate({...params,count:1},undefined,{signal:new AbortController().signal});await until(()=>requests.length===1);const secondBody=requests[0].body;requests[0].resolve();await signalled;
      check(firstBody===secondBody,'adding cancellation does not change model request body or selected context');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(firstBody)))).map(x=>x.toString(16).padStart(2,'0')).join('');
      requests=[];useAuthStore.setState({apiKey:null});setGatewayAccessToken('fake-gateway-session');
      const gateway=new AbortController();const viaGateway=productionGenerate({...params,apiKey:''},undefined,{signal:gateway.signal});await until(()=>requests.length===3);
      check(requests.every(r=>r.url.endsWith('/v1/chat')),'gateway-backed character generation uses actual gateway task path');gateway.abort();
      check((await viaGateway).cancelled&&requests.every(r=>r.aborted),'cancellation reaches all gateway fetch signals too');
      return {checks,inputHash:hash,actualModelCalls:0,transport:'actual generation/search/task-client/llm; fetch fully mocked'};
    }finally{window.fetch=original;setGatewayAccessToken(null);useAuthStore.setState({apiKey:'fake-cancellation-fixture-key'});}
  },
  mount(){
    const test=(window as any).cancelTest;test.calls=[];
    ipc.character.generate=(_params,onProgress,options)=>new Promise((resolve,reject)=>test.calls.push({onProgress,signal:options?.signal,resolve,reject}));
    const root=createRoot(document.getElementById('root')!);test.unmount=()=>root.unmount();
    test.owner=(userId:string)=>useAuthStore.setState({userId});
    function Host(){const[active,setActive]=React.useState(true);test.active=setActive;return <div hidden={!active}><CreateGeneTab active={active} onClose={()=>{throw Error('Generation must not save or close editor');}}/></div>;}
    root.render(<Host/>);
  },
  candidate,
  mountModal(){
    useAuthStore.setState({userId:'modal-ui-user'});
    const root=createRoot(document.getElementById('root')!);(window as any).cancelTest.unmount=()=>root.unmount();
    root.render(<CharacterAddModal open onClose={()=>{throw Error('Cancel generation must not close modal');}}/>);
  },
  installPreviewFetch(){
    const test=(window as any).cancelTest;test.previewCalls=[];
    // Deliberately ignores abort until resolved, to exercise late response
    // guards independently of the real fetch-signal propagation tests above.
    window.fetch=((_url:any,init:RequestInit={})=>new Promise<Response>(resolve=>test.previewCalls.push({signal:init.signal,resolve:(text:string)=>resolve(new Response(JSON.stringify({choices:[{message:{content:text}}]}),{status:200,headers:{'Content-Type':'application/json'}}))}))) as typeof fetch;
  },
}});
