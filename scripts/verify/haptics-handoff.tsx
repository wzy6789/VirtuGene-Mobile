import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Character } from '../../src/db';
import { messageRepo } from '../../src/db/message-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { MobileLayout } from '../../src/components/layout/MobileLayout';
import { SettingsSwitch } from '../../src/components/settings/SettingsUI';
import { FontRuler } from '../../src/components/ui/PhysicalInteractions';
import { SwipeActionItem } from '../../src/components/ui/SwipeActionItem';
import { DiaryLockScreen } from '../../src/components/diary/DiaryLock';
import { ImagePreview } from '../../src/components/ui/ImagePreview';
import { breathe, confirm, resonate, holdHapticSilence, warmHaptics } from '../../src/lib/haptics';
import { beginSoulHandoff, cancelSoulHandoff } from '../../src/lib/soul-handoff';
import { installThemePreferences } from '../../src/lib/theme';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { sha256 } from '../../src/store/settings-store';

const root = createRoot(document.getElementById('root')!);
const owner = 'touch-handoff-owner';
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#273855"/><circle cx="130" cy="120" r="100" fill="#ad9bff"/><circle cx="350" cy="120" r="70" fill="#7fe0db"/></svg>')}`;
function Controls() {
  const enabled=useSettingsStore(s=>s.hapticsEnabled),setEnabled=useSettingsStore(s=>s.setHapticsEnabled);
  const [checked,setChecked]=useState(false),[size,setSize]=useState(14);
  return <div className="mobile-layout" style={{height:'100vh',padding:24}}><SettingsSwitch title="触感反馈" checked={enabled} onChange={setEnabled}/><SettingsSwitch title="测试开关" checked={checked} onChange={setChecked}/><FontRuler value={size} onChange={setSize}/><SwipeActionItem actions={[{label:'操作',color:'bg-red-500',onClick:()=>{}}]}><button style={{height:64,width:'100%'}}>左滑测试</button></SwipeActionItem></div>;
}
function Picture() {
  const [open,setOpen]=useState(false);
  return <div className="mobile-layout" style={{height:'100vh'}}><button onClick={event=>{beginSoulHandoff('media:test',event.currentTarget.querySelector('img'),'media');setOpen(true);}} aria-label="图片接力"><img src={image} style={{width:150,height:150,objectFit:'cover',borderRadius:16,margin:32}}/></button>{open&&<ImagePreview images={[image,image]} soulKeys={['media:test','media:second']} onClose={()=>setOpen(false)}/>}</div>;
}
installThemePreferences(); installUiPreferences(); warmHaptics();
let release=()=>{};
(window as any).techTest={
  selectionRace:async(reset=false)=>{
    const original=messageRepo.getPage;let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
    messageRepo.getPage=async(...args)=>{if(args[0]==='touch-session-touch-character-0'){entered();await gate;}return original(...args);};
    try{const old=useChatStore.getState().selectCharacter('touch-character-0');await started;
      if(reset)useChatStore.getState().reset();else await useChatStore.getState().selectCharacter('touch-character-2');
      release();await old;return useChatStore.getState().selectedCharacterId===(reset?null:'touch-character-2');
    }finally{release();messageRepo.getPage=original;}
  },
  breathe,confirm,resonate,cancel:cancelSoulHandoff,useSettingsStore,useAuthStore,useChatStore,useUIStore,db,
  mute:()=>{release=holdHapticSilence();},unmute:()=>release(),
  pin:async()=>{useSettingsStore.getState().setDiaryPin(await sha256('1234'));root.render(<DiaryLockScreen onUnlock={()=>document.documentElement.dataset.unlocked='true'}/>);},
  mount:async(mode:string)=>{
    cancelSoulHandoff();useAuthStore.setState({userId:owner,username:'界面验收',isLoggedIn:true,apiKey:null});
    useSettingsStore.setState({hapticsEnabled:true,reduceMotion:false,ttsEnabled:false,modelAsked:true});
    if(mode==='layout'){
      const characters=Array.from({length:40},(_,i)=>({id:`touch-character-${i}`,name:`灵魂${String(i).padStart(2,'0')}${i===10?' · 一段足够长的姓名用于标题适配验收':''}`,avatar:i%2? '🌌':image,createdBy:owner,systemPrompt:'',tags:[],greeting:'',isPreset:false,isCustom:true,published:false,proactivity:0,signature:'会话头像与真实导航',createdAt:i} satisfies Character));
      await db.characters.bulkPut(characters);await db.sessions.bulkPut(characters.map(c=>({id:`touch-session-${c.id}`,characterId:c.id,userId:owner,createdAt:Date.now(),updatedAt:Date.now(),modelAsked:true,type:'single' as const})));useChatStore.setState({characters,selectedCharacterId:null,currentSessionId:null,messages:[]});
      useUIStore.setState({activeView:'chat',mobileTab:'chat',chatFromList:false,chatFromCharacters:false,worldTheaterOpen:false});
      root.render(<StrictMode><MobileLayout/></StrictMode>);
    }else if(mode==='picture')root.render(<Picture/>);else root.render(<StrictMode><Controls/></StrictMode>);
  }
};
document.documentElement.dataset.techReady='true';
