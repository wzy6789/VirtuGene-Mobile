import { db, type Message } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { fakeCharacter } from './world-harness';
import { webApi } from '../../src/lib/web-api';
import { sendRoleChatReply, type ChatRequest } from '../../src/lib/chat/send-service';
import { ChatReplyStream } from '../../src/lib/chat-stream';
import { withChatSessionLock } from '../../src/lib/chat/request-coordinator';
import {PRESET_CHARACTERS} from '../../src/lib/seed-init';
import {reviseOriginalPresetVoice,reviseOriginalPresetCard} from '../../src/lib/original-preset-voice';
import {getDialogueTrajectory} from '../../src/lib/chat-evaluation-trajectories';
import {reviseGuYueNaPresetPrompt} from '../../src/lib/gu-yue-na-personality';
import {withDouluoRelations} from '../../src/lib/douluo-relations';

declare const LIVE_PROXY:string;
declare const LIVE_TOKEN:string;
declare const LIVE_RESPONSES:Array<{input:string;raw:string;characterName?:string}>;
declare const LIVE_VOICE_EARLIER:boolean;
declare const LIVE_GENERATION_MODE:string;
declare const LIVE_EMOTION_COMPACT:boolean;
declare const LIVE_DEFER_DELIVERY:boolean;
declare const LIVE_MINIMAL_TURN_GUIDANCE:boolean;
const owner='isolated-live-expression-owner',sessionId='isolated-live-session';
const nativeFetch=window.fetch.bind(window);
// Explicit diagnostic only: exercise an unpublished draft's existing quality
// retry. Ordinary live tests retain the real streaming publication behavior.
if(typeof LIVE_DEFER_DELIVERY!=='undefined'&&LIVE_DEFER_DELIVERY) {
  const nativeSend=webApi.chat.send;
  webApi.chat.send=params=>nativeSend({...params,onDelta:undefined});
}
const observations:Array<unknown>=[];
let replayCharacterName='';
window.fetch=async(url,init)=>{
  if(!String(url).includes('/chat/completions'))throw Error('Unexpected network in isolated expression evaluation');
  const payload=JSON.parse(String(init?.body));
  // Evaluation-only ablation. Keep the authored persona, final voice card,
  // shared messaging policy and source-bearing frames; remove conversational
  // coaching to measure whether it introduces analysis rather than reaction.
  if(typeof LIVE_MINIMAL_TURN_GUIDANCE!=='undefined'&&LIVE_MINIMAL_TURN_GUIDANCE) {
    const system=payload.messages?.[0]?.content;
    if(typeof system!=='string'||(system.match(/\[本轮交流的隐藏节奏\]/gu)??[]).length!==1)throw Error('Minimal turn ablation requires one owned guidance block');
    payload.messages[0].content=system.replace(/\[本轮交流的隐藏节奏\][\s\S]*?(?=\[人物声音卡\])/u,block=>{
      const sources=block.match(/\[(本轮事实回查|本轮经历核对|正在讨论的假设)\][\s\S]*?\[\/\1\]/gu)??[];
      return sources.length?sources.join('\n')+'\n':'';
    });
  }
  // Evaluation-only ablation: preserve user requests, persisted preferences,
  // authored voice and transport contract; remove the duplicated mood hint.
  if(typeof LIVE_EMOTION_COMPACT!=='undefined'&&LIVE_EMOTION_COMPACT) {
    const system=payload.messages?.[0]?.content;
    if(typeof system!=='string')throw Error('Emotion ablation requires a system prompt');
    payload.messages[0].content=system.split('\n').filter((line:string)=>!line.startsWith('表达线索仅作参考，原话与用户当前要求优先：')).join('\n');
  }
  if(typeof LIVE_GENERATION_MODE!=='undefined'&&LIVE_GENERATION_MODE==='direct') {
    payload.thinking={type:'disabled'};
    delete payload.reasoning_effort;
    payload.temperature=.8;
  }
  // Controlled ordering ablation only. All production guidance remains intact.
  if(typeof LIVE_VOICE_EARLIER!=='undefined'&&LIVE_VOICE_EARLIER) {
    const system=payload.messages?.[0]?.content;
    const cards=typeof system==='string'?system.match(/\[人物声音卡\][\s\S]*?\[\/人物声音卡\]/gu):undefined;
    if(cards?.length!==1)throw Error('Voice-order ablation requires exactly one card');
    const remaining=system.replace(cards[0],'');
    const at=remaining.indexOf('[本轮交流的隐藏节奏]');
    if(at<0)throw Error('Missing current-turn guidance in voice-order ablation');
    payload.messages[0].content=remaining.slice(0,at)+cards[0]+'\n'+remaining.slice(at);
  }
  const replay=LIVE_RESPONSES.filter(row=>!row.characterName||row.characterName===replayCharacterName)[observations.length];
  if(replay&&payload.messages.at(-1)?.content!==replay.input)throw Error('Replay source does not match the current user message');
  const response=replay?new Response(JSON.stringify({choices:[{message:{content:replay.raw},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})
    :await nativeFetch(LIVE_PROXY,{...init,body:JSON.stringify(payload),headers:{'Content-Type':'application/json',Authorization:'Bearer '+LIVE_TOKEN}});
  const copy=response.clone();
  try{const data=await copy.json();observations.push({model:payload.model,generation:{thinking:payload.thinking,reasoningEffort:payload.reasoning_effort,temperature:payload.temperature},historyMessages:payload.messages?.length,inputChars:JSON.stringify(payload.messages).length,messages:payload.messages,replayed:!!replay,usage:data.usage,finish:data.choices?.[0]?.finish_reason,raw:data.choices?.[0]?.message?.content});}catch{/* Transport failure is observed by the production pipeline. */}
  return response;
};
// No paid settlement/extraction calls: this run tests expression and local DB
// retrieval, not the server's summaries or memory extraction quality.
webApi.context.summarize=async()=>({error:'server:error'});
webApi.context.settle=async()=>({error:'server:error'});
webApi.memory.extract=async()=>({memories:[]});

async function setup(persona:{name:string;tags:string[];systemPrompt:string;greeting:string;signature:string},proactivity=.5) {
  await db.delete();await db.open();observations.length=0;
  replayCharacterName=persona.name;
  useAuthStore.getState().login(owner,'隔离测试',LIVE_TOKEN,'');
  useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false,defaultModel:{provider:'deepseek',model:'deepseek-flash'}});
  const character=fakeCharacter('isolated-live-role',persona.name,owner,{...persona,proactivity});
  await db.characters.add(character);
  await db.sessions.add({id:sessionId,userId:owner,characterId:character.id,title:character.name,createdAt:Date.now(),updatedAt:Date.now(),modelAsked:true,model:{provider:'deepseek',model:'deepseek-flash'}});
  useChatStore.setState({characters:[character],currentSessionId:sessionId,selectedCharacterId:character.id,messages:[],hasMoreMessages:false});
  return character;
}
async function turn(text:string) {
  const character=(await db.characters.get('isolated-live-role'))!;
  const source:Message={id:crypto.randomUUID(),sessionId,role:'user',content:text,createdAt:Date.now(),isProactive:false};
  await db.messages.add(source);useChatStore.getState().addMessage(source);
  const stream=new ChatReplyStream(sessionId,()=>undefined);
  const request:ChatRequest={userId:owner,controller:new AbortController(),stream,completed:false,stopped:false};
  const before=observations.length,started=performance.now();
  try{await withChatSessionLock(sessionId,()=>sendRoleChatReply(character,source,request,{userId:owner,text}));}
  finally{stream.dispose();}
  const saved=await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
  const replies=saved.filter(m=>m.role==='assistant'&&m.replyToUserMessageId===source.id);
  const session=await db.sessions.get(sessionId);
  return {input:text,replies:replies.map(m=>m.content),durationMs:Math.round(performance.now()-started),calls:observations.slice(before),failed:!!(await db.messages.get(source.id))?.failed,conversation:session?.conversation,cost:session?.cost};
}
function presets(revised=true) {
  return PRESET_CHARACTERS.filter(c=>['preset-linshuang','preset-aili','preset-socrates','preset-guqinghan','preset-xiawanxing','preset-guyuena','preset-luxueqi'].includes(c.id)).map(c=>({name:c.name,tags:c.tags,sourcePresetId:c.id,...(c.id==='preset-luxueqi'?{proactivity:c.proactivity}:{}),...(revised?reviseOriginalPresetCard(c,c.id):{signature:c.signature,greeting:c.greeting}),isPreset:true,isCustom:false,systemPrompt:revised?(c.id==='preset-guyuena'?withDouluoRelations(reviseGuYueNaPresetPrompt(c.systemPrompt),c.id):reviseOriginalPresetVoice(c.systemPrompt,c.id)):c.systemPrompt}));
}
(window as any).liveExpression={setup,turn,presets,trajectoryInputs:(id:string)=>getDialogueTrajectory(id).turns.map(turn=>turn.input)};
