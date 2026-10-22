import { Profiler, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Character, type Message } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { useVoiceCallUIStore } from '../../src/store/voice-call-ui-store';
import { useUIStore } from '../../src/store/ui-store';
import { ChatPage } from '../../src/pages/ChatPage';
import { VoiceCallHost } from '../../src/components/chat/VoiceCallHost';
import { AppearanceSettings } from '../../src/components/settings/AppearanceSettings';
import { SoulOrbButton, type SoulOrbEmotion } from '../../src/components/ui/SoulOrb';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { soulOrbMotionActivity } from '../../src/lib/soul-orb-motion';
import { normalizeOrbSignal, sampleOrbCore } from '../../src/lib/orb-vitality';
import { callOrbSignal } from '../../src/lib/voice-call/orb-signal';

const userId='vitality-owner',sessionId='vitality-session';
const character={id:'vitality-character',name:'林舟',avatar:'🌙',systemPrompt:'本地界面验证',tags:[],proactivity:0,createdBy:userId,createdAt:1} as Character;
let commits=0,activations=0,changeMode:(mode:'chat'|'lab'|'settings')=>void;
let changeEmotion:(value:SoulOrbEmotion)=>void, changeCopies:(value:number)=>void, changeHidden:(value:boolean)=>void, cue:()=>void;
const stopPreferences=installUiPreferences();
const api:any={ready:false}; (window as any).vitalityTest=api;
function Fixture(){
  const [mode,setMode]=useState<'chat'|'lab'|'settings'>('chat'),[emotion,setEmotion]=useState<SoulOrbEmotion>('idle');
  const [copies,setCopies]=useState(1),[hidden,setHidden]=useState(false),[cueId,setCue]=useState(0);
  changeMode=setMode;changeEmotion=setEmotion;changeCopies=setCopies;changeHidden=setHidden;cue=()=>setCue(value=>value+1);
  return <Profiler id="actual-components" onRender={()=>commits++}>
    <main className="mobile-layout" style={{position:'relative',height:'100dvh',maxWidth:430,margin:'auto',overflow:'auto',display:'block'}}>
      {mode==='chat'?<ChatPage/>:mode==='settings'?<div className="vg-settings-design" style={{padding:20}}><AppearanceSettings/></div>:
        <div style={{padding:24,marginTop:hidden?2000:0}}>
          <h1 style={{fontSize:20,color:'var(--text)'}}>小星动态 · 实际组件</h1>
          <p style={{fontSize:14,color:'var(--text-secondary)',margin:'16px 0'}}>轮廓轻呼吸，柔光在球内慢慢流转。</p>
          {Array.from({length:copies},(_,index)=><SoulOrbButton key={`probe-${index}`} size={index?44:128} emotion={emotion} motionContext="reading" cueId={cueId}
            label={`动效测试小星${index}`} onActivate={()=>activations++}/>)}
          <p role="status" style={{color:'var(--text)',marginTop:20}}>{emotion}</p>
          <textarea aria-label="自由输入" placeholder="继续说你想说的话" style={{marginTop:24,width:'100%',minHeight:100,color:'var(--text)',background:'var(--bg-panel)',padding:12,fontSize:16}}/>
        </div>}
    </main><VoiceCallHost/>
  </Profiler>;
}
async function seed(){
  await db.delete();await db.open();
  const messages=[{id:'vitality-user-message',sessionId,role:'user',content:'刚刚路过那家小店，窗边还有一束花。',createdAt:Date.now()-2000},
    {id:'vitality-reply',sessionId,role:'assistant',content:'花还放在窗边啊。你有进去看看吗？',createdAt:Date.now()-1000}] as Message[];
  await db.characters.put(character);
  await db.sessions.put({id:sessionId,characterId:character.id,userId,title:character.name,type:'single',modelAsked:true,createdAt:1,updatedAt:1});
  await db.messages.bulkPut(messages);
  useAuthStore.setState({userId,username:'本地验证',isLoggedIn:true});
  useChatStore.setState({selectedCharacterId:character.id,currentSessionId:sessionId,characters:[character],messages});
  useUIStore.setState({activeView:'chat',mobileTab:'chat'});
  useSettingsStore.setState({reduceMotion:false,chatFontSize:16});
}
Object.assign(api,{
  activity:soulOrbMotionActivity, commits:()=>commits, activations:()=>activations,
  mode:(value:'chat'|'lab'|'settings')=>changeMode(value),emotion:(value:SoulOrbEmotion)=>changeEmotion(value),copies:(value:number)=>changeCopies(value),hidden:(value:boolean)=>changeHidden(value),cue:()=>cue(),
  intensity:(value:'gentle'|'lively'|'reduced')=>useSettingsStore.getState().setOrbMotionIntensity(useAuthStore.getState().userId!,value),
  owner:(value:string)=>useAuthStore.setState({userId:value}),
  reduce:(value:boolean)=>useSettingsStore.getState().setReduceMotion(value),
  preference:()=>useSettingsStore.getState().orbMotionByUser,
  font:(value:number)=>useSettingsStore.getState().setChatFontSize(value),
  platformBackground:(value:boolean)=>document.documentElement.toggleAttribute('data-vg-background',value),
  visibility:(value:boolean)=>{Object.defineProperty(document,'hidden',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));},
  call(phase='listening',overrides:any={}){
    useVoiceCallUIStore.getState().open({character,userId,sessionId});
    useVoiceCallStore.setState({busy:true,owner:{userId,characterId:character.id,sessionId},view:{phase,inputMode:'voice',muted:false,level:0,userText:'',generatedText:'',heardText:'',...overrides}});
  },
  level(value:number){const view=useVoiceCallStore.getState().view!;useVoiceCallStore.setState({view:{...view,level:value}});},
  signal:()=>callOrbSignal(userId,character.id,sessionId),
  callState:()=>({busy:useVoiceCallStore.getState().busy,target:useVoiceCallUIStore.getState().target,minimized:useVoiceCallUIStore.getState().minimized}),
  stopCall(){useVoiceCallStore.setState({busy:false,owner:undefined,view:undefined});useVoiceCallUIStore.getState().close();},
  async reloadPreference(){await useSettingsStore.persist.rehydrate();},
  async contracts(){
    const results:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);results.push(label);};
    check(normalizeOrbSignal({captureLevel:Infinity}).capture===0&&normalizeOrbSignal({captureLevel:NaN}).capture===0,'invalid audio amplitude never produces capture');
    check(normalizeOrbSignal().capture===0&&normalizeOrbSignal().playback===0,'absent audio has no invented microphone or output');
    const samples=Array.from({length:600},(_,index)=>sampleOrbCore(index*100,.5));
    check(samples.every(value=>Math.abs(value.breath)<=1&&Math.abs(value.x)<=13&&Math.abs(value.y)<=9),'core light stays bounded over a full minute');
    const rises=samples.flatMap((value,index)=>index>0&&samples[index-1].breath<=0&&value.breath>0?[index*100]:[]);
    check(rises.length>=5&&rises.slice(1).every((time,index)=>time-rises[index]>=6000&&time-rises[index]<=9000),'ambient breath follows the planned6–9second rhythm');
    check(Math.abs(sampleOrbCore(6800-.001,.5).breath-sampleOrbCore(6800+.001,.5).breath)<.001,'breath has no cycle-boundary jump');
    useSettingsStore.getState().setOrbMotionIntensity('another-owner','lively');
    check(!useSettingsStore.getState().orbMotionByUser['another-owner'],'a stale account cannot change another account preference');
    return results;
  },
  dispose(){stopPreferences();},
});
void seed().then(()=>{createRoot(document.getElementById('root')!).render(<Fixture/>);api.ready=true;});
