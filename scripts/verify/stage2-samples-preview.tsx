/** Stage 2 samples: real MobileLayout/ChatPage, separate origin and synthetic rows.
 * Only transport is controlled; no actual model, microphone, playback or native calls.
 * The server injects the optional presentation prop at the preview call site only.
 */
import './chat-stream';
import { db, type Message } from '../../src/db';
import { webApi } from '../../src/lib/web-api';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useUIStore } from '../../src/store/ui-store';
import { fakeCharacter } from './world-harness';
import { worldRepo } from '../../src/db/world-repo';
import { emptySceneState } from '../../src/db/world-scene-repo';
import Dexie from 'dexie';

const w=window as any;
const actualSend=webApi.chat.send;
const owner='starfield-fixture:alpha',session='stage2-chat-sample';
const readingId='stage2-reading-record',sceneId='stage2-reading-scene';
let failReading=false;
let readingRelease:(()=>void)|undefined;
let readingHeld:Promise<void>|undefined;
const readMemory=db.sharedMemories.get.bind(db.sharedMemories);
db.sharedMemories.get=((...args:Parameters<typeof readMemory>)=>{
  if(args[0]===readingId&&failReading){failReading=false;return Promise.reject(Error('Controlled record read failure'));}
  if(args[0]===readingId&&readingHeld)return Dexie.waitFor(readingHeld).then(()=>readMemory(...args));
  return readMemory(...args);
}) as typeof db.sharedMemories.get;
async function openReading(){
  const world=await worldRepo.ensureDefaultWorld(owner),now=Date.now();
  const body=[
    '傍晚时分，我们路过那家旧书店。街道被落日染成柔和的金色，风从巷口拐进来，带着纸张与木头的气味。',
    '推开有些年头的木门，门铃轻轻响了一声。店里依旧安静，书架从地面延伸到高处。灯光落在书脊上，我们不约而同地放慢了脚步。',
    '你在一本散文集前停下，翻开扉页。那里有人留下了一小段话，字迹已经有些淡，却仍能看出落笔时的认真。',
    '我们坐在靠窗的位置，读了几页。聊到喜欢的句子，也聊到还没来得及说完的事情。窗外的光一点点暗下去，店主替我们亮起了一盏小灯。',
    '离开时，你把书轻轻放回原处，又回头看了一眼。我们约好，下一次经过这里，再来接着读。那句没说完的话，也可以慢慢说。',
  ].join('\n\n');
  await db.worldScenes.put({id:sceneId,userId:owner,worldId:world.id,title:'旧书店',place:'旧书店',timeLabel:'傍晚',mood:'平静',characterIds:[],status:'finished',state:emptySceneState(),startedAt:now-60000,createdAt:now-60000,updatedAt:now});
  await db.worldSceneEntries.bulkPut(Array.from({length:12},(_,index)=>({id:`${sceneId}:entry:${index}`,sceneId,index,act:0,kind:'narration' as const,content:`来源片段 ${index+1}：我们把读到的那句话，又轻轻念了一遍。`,createdAt:now-12000+index})));
  await db.sharedMemories.put({id:readingId,userId:owner,worldId:world.id,title:'旧书店里，那句没说完的话',summary:body,participants:['u:'+owner],characterIds:[],createdAt:now-86400000,updatedAt:now,sourceType:'scene',sourceId:sceneId,importance:.5,visibility:'world',relatedCharacters:[],relatedRelationships:[],tags:[]});
  useUIStore.setState({activeView:'memory',mobileTab:'world',chatFromList:false,chatFromCharacters:false});
}
async function openChat(empty=false){
  const character=fakeCharacter('stage2-chat-role','星遥',owner,{systemPrompt:'你有自己的说话方式。\n对话样本：用户说你好 → 你说来啦。',proactivity:0});
  await db.characters.put(character);
  const now=Date.now();
  await db.sessions.put({id:session,characterId:character.id,userId:owner,title:character.name,createdAt:now,updatedAt:now,modelAsked:true,model:{provider:'deepseek',model:'deepseek-v4-flash'}});
  await db.messages.where('sessionId').equals(session).delete();
  const messages:Message[]=empty?[]:[
    {id:'stage2-m1',sessionId:session,role:'user',content:'今天在旧书店找到一本喜欢的书。',createdAt:now-60000,isProactive:false},
    {id:'stage2-m2',sessionId:session,role:'assistant',content:'什么样的书？\n想听你说说，是封面先吸引了你，还是翻开时刚好读到的那一句？',createdAt:now-55000,isProactive:false},
    {id:'stage2-m3',sessionId:session,role:'user',content:'是扉页上有人留下的一小段话。',createdAt:now-50000,isProactive:false},
    {id:'stage2-m4',sessionId:session,role:'assistant',content:'那它大概已经等了很久，才等到一个愿意认真读完的人。',createdAt:now-45000,isProactive:false},
  ];
  await db.messages.bulkPut(messages);
  useAuthStore.setState({userId:owner,isLoggedIn:true,apiKey:'sk-isolated-fixture',gatewayAccessToken:null});
  useSettingsStore.setState({chatBackgroundEnabled:false,reduceMotion:true,ttsEnabled:false,aiVoiceMode:false,defaultModel:{provider:'deepseek',model:'deepseek-v4-flash'}});
  useChatStore.setState({characters:[character],currentSessionId:session,selectedCharacterId:character.id,messages,hasMoreMessages:false});
  useUIStore.setState({activeView:'chat',mobileTab:'chat',chatFromList:true,chatFromCharacters:false});
}
async function boot(){
  await import('./starfield-upgrade-preview');
  for(let n=0;!w.starfieldReady&&n<500;n++)await new Promise(r=>setTimeout(r,10));
  if(!w.starfieldReady)throw Error('Real mobile fixture did not start');
  // Restore the actual production adapter after installing the test network guard.
  // chat-stream owns a local ReadableStream transport; no request can leave this page.
  webApi.chat.send=actualSend;
  w.stage2Samples={openChat,openReading,readingPreferences:async(name:string,reduceMotion:boolean)=>{const character=useChatStore.getState().characters.find(c=>c.id==='stage2-chat-role')!;await db.characters.update(character.id,{name});useChatStore.setState({characters:[{...character,name}]});useSettingsStore.setState({reduceMotion});},holdReading:()=>{readingHeld=new Promise<void>(resolve=>{readingRelease=resolve;});},releaseReading:()=>{readingHeld=undefined;readingRelease?.();readingRelease=undefined;},failNextReading:()=>{failReading=true;},removeReadingSource:()=>db.worldScenes.delete(sceneId),revokeReading:()=>db.sharedMemories.update(readingId,{worldId:'another-world'}),snapshot:()=>({...w.starfieldPreview.snapshot(),requests:w.chatStreamTest.requests().length,extraNetwork:w.chatStreamTest.extraNetwork()}),records:()=>db.messages.where('sessionId').equals(session).sortBy('createdAt')};
  if(new URLSearchParams(location.search).get('sample')==='chat')await openChat();
  if(new URLSearchParams(location.search).get('sample')==='reading')await openReading();
  if(new URLSearchParams(location.search).get('open')==='record'){
    for(let n=0;n<500;n++){
      const trigger=document.querySelector<HTMLButtonElement>('[data-exhibit-id="stage2-reading-record"] button');
      if(trigger){trigger.click();break;}await new Promise(r=>setTimeout(r,10));
    }
  }
  w.stage2Ready=true;
}
void boot().catch(error=>{w.stage2Error=String(error);console.error(error);});
