import {db,type Message} from '../../src/db';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {webApi} from '../../src/lib/web-api';
import {sendRoleChatReply,type ChatRequest} from '../../src/lib/chat/send-service';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {fakeCharacter} from './world-harness';
import {chatQualityReport} from '../../src/lib/chat-quality-metrics';
declare const LATENCY_PROXY:string;
declare const LATENCY_TOKEN:string;
const nativeFetch=window.fetch.bind(window);
let firstChunk:number|undefined;
window.fetch=async(url,init)=>{
  if(!String(url).includes('/chat/completions'))throw Error('Unexpected live-test network');
  const result=await nativeFetch(LATENCY_PROXY,{...init,headers:{'Content-Type':'application/json',Authorization:'Bearer '+LATENCY_TOKEN}});
  if(!result.body)return result;
  const reader=result.body.getReader();
  return new Response(new ReadableStream({async pull(controller){
    const chunk=await reader.read();if(chunk.done){controller.close();return;}
    firstChunk??=performance.now();controller.enqueue(chunk.value);
  },cancel(reason){return reader.cancel(reason);}}),{status:result.status,headers:result.headers});
};
webApi.context.summarize=async()=>({error:'server:error'});
webApi.context.settle=async()=>({error:'server:error'});
webApi.memory.extract=async()=>({memories:[]});
Object.assign(window,{latencyLive:async()=>{
  await db.delete();await db.open();
  const owner='isolated-latency-owner';useAuthStore.getState().login(owner,'隔离速度测试',LATENCY_TOKEN,'');
  useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false,defaultModel:{provider:'deepseek',model:'deepseek-flash'}});
  const character=fakeCharacter('latency-role','林舟',owner,{systemPrompt:'你是林舟，成年朋友，说话自然直率，观点独立，回答短一些。\n对话样本：对方说今天下雨，你说：鞋没湿吧？我这边刚停。',tags:['直率'],greeting:'今天怎么样？'});
  await db.characters.put(character);
  await db.sessions.put({id:'latency-session',userId:owner,characterId:character.id,title:character.name,createdAt:Date.now(),updatedAt:Date.now(),modelAsked:true,model:{provider:'deepseek',model:'deepseek-flash'}});
  await db.memories.bulkPut(Array.from({length:12},(_,index)=>({id:'latency-fact-'+index,userId:owner,characterId:character.id,content:['陈若喜欢无糖茶','陈若喜欢散步','陈若周末喜欢看电影'][index%3]+'，记录编号'+index,type:'manual',status:'active',pinned:true,createdAt:Date.now()-index*1000})) as any);
  useChatStore.setState({characters:[character],currentSessionId:'latency-session',selectedCharacterId:character.id,messages:[],hasMoreMessages:false});
  const input='我是陈若，今天终于把报告写完了，想出去走走。';
  const source:Message={id:crypto.randomUUID(),sessionId:'latency-session',role:'user',content:input,createdAt:Date.now(),isProactive:false};
  await db.messages.put(source);useChatStore.getState().addMessage(source);
  let firstVisible:number|undefined;const started=performance.now();firstChunk=undefined;
  const stream=new ChatReplyStream(source.sessionId,()=>{firstVisible??=performance.now();});
  const request:ChatRequest={userId:owner,controller:new AbortController(),stream,completed:false,stopped:false};
  try{await sendRoleChatReply(character,source,request,{userId:owner,text:input});}finally{stream.dispose();}
  const saved=await db.messages.where('sessionId').equals(source.sessionId).sortBy('createdAt');
  const replies=saved.filter(row=>row.replyToUserMessageId===source.id&&row.role==='assistant');
  return {input,replies:replies.map(row=>row.content),failed:!!(await db.messages.get(source.id))?.failed,totalMs:performance.now()-started,firstNetworkChunkMs:firstChunk===undefined?null:firstChunk-started,firstVisibleMs:firstVisible===undefined?null:firstVisible-started,quality:chatQualityReport().events.at(-1)};
}});
