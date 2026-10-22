import './chat-human-live';
import {db,type Message,type MemorySourceTombstone,type Diary} from '../../src/db';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {sendRoleChatReply,type ChatRequest} from '../../src/lib/chat/send-service';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {withChatSessionLock} from '../../src/lib/chat/request-coordinator';
const owner='isolated-live-expression-owner',sid='isolated-live-session',cid='isolated-live-role';
const clock=Date.UTC(2026,9,22,2),NativeDate=Date;
(window as any).Date=new Proxy(NativeDate,{construct:(target,args,newTarget)=>Reflect.construct(target,args.length?args:[clock],newTarget),get:(target,key)=>key==='now'?()=>clock:Reflect.get(target,key)});
const harness=(window as any).liveExpression;
const sha=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(n=>n.toString(16).padStart(2,'0')).join('');
let fixture:{sha256:string;sourceContentSha256:string;messages:number;tombstones:number;diaries:number;role:string};
const contentProjection=(rows:Array<Message|undefined>)=>rows.map(row=>row?[row.id,row.sessionId,row.role,row.content,row.createdAt,row.revision,row.isProactive]:null);
const tableCounts:Record<string,{calls:number;bodies:number;keys:number}>={};
function observeReads(){
  const restore:Array<()=>void>=[];
  for(const table of db.tables){
    const core=table.core,counts=tableCounts[table.name]={calls:0,bodies:0,keys:0};
    for(const operation of ['get','getMany','query','count','openCursor'] as const){
      const original=core[operation];
      (core as any)[operation]=function(request:any){
        counts.calls++;return (original as any).call(core,request).then((result:any)=>{
        if(operation==='get')counts.bodies+=result===undefined?0:1;
        else if(operation==='getMany')counts.bodies+=result.filter((value:unknown)=>value!==undefined).length;
        else if(operation==='query')counts[request.values?'bodies':'keys']+=result.result.length;
        else if(operation==='openCursor'&&result){
          let previous:string|undefined;const visit=()=>{const key=JSON.stringify(result.primaryKey);if(key!==previous){counts[request.values?'bodies':'keys']++;previous=key;}};
          visit();const start=result.start.bind(result);result.start=(callback:()=>void)=>start(()=>{visit();callback();});
        }
        return result;});
      };
      restore.push(()=>{(core as any)[operation]=original;});
    }
  }
  return ()=>restore.forEach(reset=>reset());
}
(window as any).prepareCoreStock=async(size:number,role:string)=>{
  await harness.setup(harness.presets().find((preset:any)=>preset.name===role));
  useSettingsStore.setState({chatThinkingEnabled:true,aiVoiceMode:false,ttsEnabled:false});
  const actor=(await db.characters.get(cid))!;
  for(let i=0;i<5;i++){
    await db.characters.add({...actor,id:'stock-role-'+i,name:'合成角色'+i,createdBy:i===4?'other-owner':owner});
    await db.sessions.add({id:'stock-session-'+i,characterId:'stock-role-'+i,userId:i===4?'other-owner':owner,title:'合成历史',type:'single',createdAt:clock-100000,updatedAt:clock-1000,unreadCount:0});
  }
  const messages:Message[]=Array.from({length:size},(_,i)=>({id:'stock-message-'+String(i).padStart(6,'0'),sessionId:i%2===0?sid:'stock-session-'+Math.floor(i/2)%5,
    role:Math.floor(i/2)%2?'assistant':'user',content:Math.floor(i/2)%2?'这段内容已说清楚。':'合成资料编号'+i+'，今天的话题是小说里的人物选择。',
    createdAt:clock-size*10+i*10,isProactive:false,revision:1}));
  const tombstones:MemorySourceTombstone[]=Array.from({length:8105},(_,i)=>({id:'stock-tomb-'+i,userId:i%7===0?'other-owner':owner,
    characterId:i<2?cid:'stock-role-'+i%5,sourceType:'message',sourceId:'withdrawn-source-'+i,sourceRevision:1,status:'deleted',updatedAt:clock-1000,suppressedMessageIds:['withdrawn-evidence-'+i]}));
  const diaries:Diary[]=Array.from({length:500},(_,i)=>({id:'stock-diary-'+i,userId:i%5===0?'other-owner':owner,date:'2026-10-20',title:'合成私密日记'+i,content:'不授权给当前角色的合成正文。',visibility:'private',mood:3,tags:[],createdAt:clock-2000,updatedAt:clock-2000}));
  const originalFixtureSha=await sha({role,messages:contentProjection(messages),tombstones,diaries});
  await db.messages.bulkAdd(messages);await db.memorySourceTombstones.bulkAdd(tombstones);await db.diaries.bulkAdd(diaries);
  fixture={sha256:originalFixtureSha,sourceContentSha256:await sha(contentProjection(messages)),messages:size,tombstones:tombstones.length,diaries:diaries.length,role};
  return fixture;
};
(window as any).runCoreStock=async(phase:'single'|'cold'|'warm'='single')=>{
  const actor=(await db.characters.get(cid))!,input=phase==='warm'?'今天我注意到云的边缘泛着一点金色。':fixture.role==='古月娜'?'古月，我是唐舞麟。今天的云挺好看，想和你说两句。':'雪琪，我是张小凡。今天的云挺好看，想和你说两句。';
  const user:Message={id:'stock-current-user'+(phase==='warm'?'-warm':''),sessionId:sid,role:'user',content:input,createdAt:clock+1+(phase==='warm'?100:0),isProactive:false,revision:1};
  await db.messages.add(user);useChatStore.setState({messages:[user]});
  const restore=observeReads();let requests=0,preparationMs:number|undefined,firstPublishMs:number|undefined,providerFinalMs:number|undefined,preRequestReads:unknown,body:any;
  const start=performance.now(),heapBefore=(performance as any).memory?.usedJSHeapSize;
  let stream:ChatReplyStream;stream=new ChatReplyStream(sid,()=>{if(stream?.getSnapshot().some(Boolean))firstPublishMs??=performance.now()-start;});
  window.fetch=async(url,init)=>{
    if(!String(url).includes('/chat/completions'))throw Error('External requests disabled');
    requests++;body=JSON.parse(String(init?.body));preparationMs??=performance.now()-start;preRequestReads??=structuredClone(tableCounts);
    const encoder=new TextEncoder();return new Response(new ReadableStream<Uint8Array>({start(controller){
      const emit=(part:unknown)=>controller.enqueue(encoder.encode('data: '+JSON.stringify(part)+'\n\n'));
      setTimeout(()=>emit({choices:[{delta:{content:phase==='warm'?'云的颜色总让人多看一会儿。':'这片云让你想到什么了？'},finish_reason:null}]}),40);
      setTimeout(()=>{providerFinalMs=performance.now()-start;emit({choices:[{delta:{content:(phase==='single'?'':'\n---\n')+(phase==='warm'?'说说你刚才觉得特别的那一点吧。':'你形容的样子，我也想听听。')},finish_reason:null}]});
        emit({choices:[{delta:{},finish_reason:'stop'}]});controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();},400);
    }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  const request:ChatRequest={userId:owner,controller:new AbortController(),stream,completed:false,stopped:false};
  let error:string|undefined;
  try{await withChatSessionLock(sid,()=>sendRoleChatReply(actor,user,request,{userId:owner,text:input}));}catch(cause){error=String(cause);}
  const wholeMs=performance.now()-start,heapAfter=(performance as any).memory?.usedJSHeapSize;
  restore();stream.dispose();
  const replies=await db.messages.where('replyToUserMessageId').equals(user.id).sortBy('createdAt');
  const {messages:wireMessages,...wireConfig}=body??{};
  const restoredOriginals=await db.messages.bulkGet(Array.from({length:fixture.messages},(_,i)=>'stock-message-'+String(i).padStart(6,'0')));
  const sourceBytesPreserved=await sha(contentProjection(restoredOriginals))===fixture.sourceContentSha256;
  return {fixture,phase,requests,completed:request.completed,error,preparationMs,firstPublishMs,providerFinalMs,wholeMs,preRequestReads,totalReads:structuredClone(tableCounts),heapBefore,heapAfter,
    fullModelInputSha256:await sha(wireMessages),wireConfig,answer:replies.map(row=>row.content).join(''),
    sourceBytesPreserved,apiCalls:0,measurement:'First publication callback, not a presented Android frame. Heap is Chrome usedJSHeapSize, not device peak RSS. Source content verification occurs outside the timed send.'};
};
