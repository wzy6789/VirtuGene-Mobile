import './chat-human-live';
import {db} from '../../src/db';
import {useChatStore} from '../../src/store/chat-store';
import {continuityFixtures,deferredOperations} from './chat-continuity-fixtures';

type WireMessage={role:string;content:string|Array<{type:string;text?:string}>};
const plain=(content:WireMessage['content'])=>typeof content==='string'?content:content.filter(p=>p.type==='text').map(p=>p.text??'').join('');
const traceGlobal=globalThis as any;
const harness=traceGlobal.liveExpression;
let calls:any[]=[];
let compile:any[]=[];
let historyStages:any[]=[];
traceGlobal.__continuityCompile=(value:any)=>compile.push(value);
traceGlobal.__continuityHistory=(value:any)=>historyStages.push(value);
// Stable synthetic IDs; this origin has no real account/session or secrets.
let fixtureId=0;
Object.defineProperty(crypto,'randomUUID',{value:()=>`00000000-0000-4000-8000-${(++fixtureId).toString().padStart(12,'0')}`});
// Replaces the diagnostic harness transport. No native fetch fallback exists.
window.fetch=async(url,init)=>{
  if(!String(url).includes('/chat/completions'))throw Error('Blocked non-synthetic transport');
  const body=JSON.parse(String(init?.body));
  calls.push({body,requestAt:performance.now(),endpoint:'synthetic-openai-compatible',attempt:calls.length+1});
  return new Response(JSON.stringify({model:'synthetic-no-model',choices:[{message:{content:'嗯。'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
};
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');

traceGlobal.runContinuityTrace=async()=>{
  const rows:any[]=[];
  for(const name of ['古月娜','陆雪琪']){
    const persona=harness.presets(true).find((p:any)=>p.name===name);
    if(!persona)throw Error('Missing real preset '+name);
    for(const fixture of continuityFixtures){
      await harness.setup(persona,.5);
      const turns:any[]=[];
      for(const input of fixture.users){
        calls=[];compile=[];historyStages=[];
        const priorAssistantIds=new Set((await db.messages.toArray()).filter(m=>m.role==='assistant').map(m=>m.id));
        const start=performance.now();let firstStoreVisible:number|null=null;
        const unsubscribe=useChatStore.subscribe(state=>{if(firstStoreVisible===null&&state.messages.some(m=>m.role==='assistant'&&!priorAssistantIds.has(m.id)))firstStoreVisible=performance.now();});
        let result:any;
        try{result=await harness.turn(input);}finally{unsubscribe();}
        const end=performance.now();
        if(result.failed||!calls.length)throw Error('Synthetic send failed '+fixture.id+' '+name+' '+turns.length);
        const sources=await db.messages.toArray();
        const source=sources.filter(m=>m.role==='user').at(-1)!;
        const attempts=[];
        for(const call of calls){
          const messages=call.body.messages as WireMessage[];
          const texts=messages.map(m=>plain(m.content));
          const wireCurrentCount=messages.filter((m,i)=>m.role==='user'&&texts[i]===input).length;
          if(wireCurrentCount!==1)throw Error('Current input missing or duplicated');
          const coverage=sources.filter(m=>m.id!==source.id&&m.replyToUserMessageId!==source.id).map(m=>{
            const matches=texts.flatMap((text,index)=>{
              const at=text.indexOf(m.content);
              if(at>=0&&m.content)return [{payloadIndex:index,start:0,end:m.content.length,kind:index===0?'system-literal':'history-literal'}];
              // Prefix truncation is reported as partial, never as full evidence.
              for(let size=Math.min(m.content.length-1,1200);size>=24;size--){
                if(text.includes(m.content.slice(0,size)))return [{payloadIndex:index,start:0,end:size,kind:'partial-prefix'}];
              }
              return [];
            });
            const selectedRanges=historyStages.filter(stage=>stage.stage==='transport-bound').flatMap(stage=>stage.result.flatMap((t:any)=>t.sourceCoverage??[]));
            const bridgeRanges=historyStages.filter(stage=>stage.stage==='bridge'&&stage.result.text&&texts[0].includes(stage.result.text)).flatMap(stage=>stage.result.coverage);
            const provenRanges=[...selectedRanges,...bridgeRanges].filter(r=>r.messageId===m.id&&r.revision===(m.revision??1)&&texts.some(text=>text.includes(m.content.slice(r.start,r.end))));
            const intervals=[...matches,...provenRanges].sort((a,b)=>a.start-b.start);
            let through=0;const gaps:any[]=[];
            for(const range of intervals){if(range.start>through)gaps.push({start:through,end:range.start,reason:'not-covered-by-observed-source-range'});through=Math.max(through,range.end);}
            if(through<m.content.length)gaps.push({start:through,end:m.content.length,reason:'not-found-in-final-payload; summary/paraphrase not proven'});
            return {messageId:m.id,revision:m.revision??1,role:m.role,length:m.content.length,matches,provenRanges,gaps};
          });
          attempts.push({messages,sha256:await digest(messages),alias:call.body.model,returnedModel:'synthetic-no-model',thinking:call.body.thinking,reasoningEffort:call.body.reasoning_effort,endpoint:call.endpoint,attempt:call.attempt,finishReason:'stop',usage:null,coverage,prepareMs:Math.round(call.requestAt-start),firstBodyMs:null,firstVisibleMs:null,firstStoreEmissionMs:firstStoreVisible===null?null:Math.round(firstStoreVisible-start),endMs:Math.round(end-start)});
        }
        const conversation=(await db.sessions.get(source.sessionId))?.conversation;
        turns.push({input,current:{messageId:source.id,revision:source.revision??1,start:0,end:input.length},conversation,databaseSources:sources.map(m=>({id:m.id,role:m.role,content:m.content,revision:m.revision??1,replyToUserMessageId:m.replyToUserMessageId,replyBatchId:m.replyBatchId,createdAt:m.createdAt})),attempts,historyStages,compiled:compile,savedReplies:result.replies});
      }
      rows.push({id:fixture.id,character:name,turns,deferredOperations:(deferredOperations as any)[fixture.id]??[]});
      traceGlobal.__continuityProgress={complete:rows.length,total:24};
    }
  }
  return {rows,scope:'synthetic real send-service with isolated IndexedDB and mocked transport; not language-quality acceptance',paidCalls:0,microphone:false,gatewayTested:false,coverageLimit:'Literal coverage cannot prove paraphrased summary coverage or identify provenance of duplicate text. DB membership does not prove each candidate was retrieved.',firstVisibleLimit:'Store emissions are diagnostic only, not decoded UI frames.'};
};
