import './chat-stream-ui';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useThemeStore} from '../../src/store/theme-store';
import {useChatAppearanceStore} from '../../src/store/chat-appearance-store';
import {backgroundDb,backgroundSettingKey,chatBackgroundRepo} from '../../src/db/chat-background-repo';
import {useChatBackgroundStore,ensureChatBackground,publishBackground,readBackgroundRows,forgetRoleBackground} from '../../src/store/chat-background-store';
import {DEFAULT_CHAT_BACKGROUND,normalizeChatBackground,resolveChatBackground,type ChatBackgroundConfig} from '../../src/lib/chat-background-config';
import {inspectBackgroundImage,normalizeBackgroundImage,renderBackgroundImage} from '../../src/lib/chat-background-image';
import {CHAT_ATMOSPHERE_THEMES} from '../../src/lib/chat-atmosphere';
import {db} from '../../src/db';
import {installThemePreferences} from '../../src/lib/theme';
import {installUiPreferences} from '../../src/lib/ui-preferences';
import {useFeedbackStore} from '../../src/lib/feedback';
import {inspectChatParticleField,inspectChatParticleEngine} from '../../src/components/chat/ChatParticleField';
import {backgroundStyle} from '../../src/components/chat/useChatAtmosphere';
installThemePreferences();installUiPreferences();
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Isolated fixture cannot access microphone');};
const stream=(window as any).chatStreamTest;
let failSave=false; backgroundDb.settings.hook('updating',()=>{if(failSave){failSave=false;throw new DOMException('controlled quota','QuotaExceededError');}});
backgroundDb.settings.hook('creating',()=>{if(failSave){failSave=false;throw new DOMException('controlled quota','QuotaExceededError');}});
let activeUrls=0,createdUrls=0,revokedUrls=0;
const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=(blob:Blob)=>{activeUrls++;createdUrls++;return createURL(blob);};URL.revokeObjectURL=(url:string)=>{activeUrls--;revokedUrls++;revokeURL(url);};
const owner=()=>useAuthStore.getState().userId!;
async function image(kind='noise'){
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=640;const ctx=canvas.getContext('2d')!;
  if(kind==='white'||kind==='black'){ctx.fillStyle=kind;ctx.fillRect(0,0,320,640);}else{for(let y=0;y<640;y+=8)for(let x=0;x<320;x+=8){ctx.fillStyle=(x+y)%16?'#fff':'#000';ctx.fillRect(x,y,8,8);}ctx.fillStyle='#f00';ctx.fillRect(100,130,120,200);}
  return new Promise<Blob>(yes=>canvas.toBlob(blob=>yes(blob!),'image/png'));
}
async function save(patch:Partial<ChatBackgroundConfig>,roleId='a',strategy:'fixed'|'characterRecommended'='fixed'){
  const rows=readBackgroundRows(owner(),roleId),base=roleId?rows.override??rows.global.config:rows.global.config;
  publishBackground(await chatBackgroundRepo.save(owner(),roleId,{...base,...patch},(roleId?rows.roleRow:rows.globalRow)?.revision??0,strategy));
}
(window as any).backgroundTest={
  messageCount:()=>db.messages.count(),
  roleRecord:()=>db.characters.get(useChatStore.getState().selectedCharacterId??'a'),
  deleteRole:()=>db.characters.delete(useChatStore.getState().selectedCharacterId??'a'),
  themes:CHAT_ATMOSPHERE_THEMES, defaults:DEFAULT_CHAT_BACKGROUND,db:backgroundDb,repo:chatBackgroundRepo,normalize:normalizeChatBackground,resolve:resolveChatBackground,
  fields:(pixels=false)=>[...document.querySelectorAll<HTMLElement>('.vg-chat-particles')].map(host=>inspectChatParticleField(host,{pixels})),
  particleContainers:inspectChatParticleEngine,
  async setup(history=3){await stream.setup(history);await ensureChatBackground(owner());await backgroundDb.settings.clear();await backgroundDb.assets.clear();useChatAppearanceStore.setState({byRole:{}});useChatBackgroundStore.setState({rows:{},ready:{},errors:{}});useSettingsStore.setState({chatBackgroundEnabled:true,reduceMotion:false});await ensureChatBackground(owner(),true);},
  save,rows:()=>readBackgroundRows(owner(),useChatStore.getState().selectedCharacterId??'a'),
  readingStyle:backgroundStyle,legacyColor:()=>useChatAppearanceStore.getState().setPreference(owner(),'a',{mode:'manual',theme:'lively',motion:'vivid'}),
  cinematicAdoption:{reset:()=>useSettingsStore.setState(state=>{const markers={...state.cinematicChatDefaultsByUser};delete markers[owner()];return {chatBackgroundEnabled:false,cinematicChatDefaultsByUser:markers};}),snapshot:()=>({enabled:useSettingsStore.getState().chatBackgroundEnabled,version:useSettingsStore.getState().cinematicChatDefaultsByUser?.[owner()]})},
  async counts(){return {settings:await backgroundDb.settings.count(),assets:await backgroundDb.assets.count(),urls:activeUrls,createdUrls,revokedUrls};},
  theme:(mode:'dark'|'light')=>useThemeStore.getState().setTheme(mode),reduced:(value:boolean)=>useSettingsStore.getState().setReduceMotion(value),enabled:(value:boolean)=>useSettingsStore.getState().setChatBackgroundEnabled(value),
  account:(id:string)=>useAuthStore.setState({userId:id}),ensure:()=>ensureChatBackground(owner(),true),failSave:()=>{failSave=true;},
  async reset(roleId='a'){const row=readBackgroundRows(owner(),roleId).roleRow;await chatBackgroundRepo.resetRole(owner(),roleId,row?.revision??0);forgetRoleBackground(owner(),roleId);},
  async reload(){useChatBackgroundStore.setState({rows:{},ready:{},errors:{}});await ensureChatBackground(owner(),true);},
  async file(kind='noise'){return [...new Uint8Array(await (await image(kind)).arrayBuffer())];},
  async setImage(kind='noise',roleId='a',patch:Partial<ChatBackgroundConfig>={}){const source=await image(kind),normalized=await normalizeBackgroundImage(source),id=`bg:${crypto.randomUUID()}`,rows=readBackgroundRows(owner(),roleId),config={...DEFAULT_CHAT_BACKGROUND,...patch,mode:'image' as const,imageAssetId:id},display=await renderBackgroundImage(normalized.source,config.blur);publishBackground(await chatBackgroundRepo.save(owner(),roleId,config,(roleId?rows.roleRow:rows.globalRow)?.revision??0,'fixed',{id,...normalized,display,blur:config.blur}));return id;},
  inspect:inspectBackgroundImage,
  feedback:()=>useFeedbackStore.getState().current?.message,
  async configChecks(){let n=0;const check=(value:unknown)=>{if(!value)throw Error('config assertion '+n);n++;};
    check(normalizeChatBackground({schemaVersion:999,mode:'image'}).reasons.includes('schema-unsupported'));
    const invalid=normalizeChatBackground({...DEFAULT_CHAT_BACKGROUND,mode:'bogus',themeId:'bad',focalPoint:{x:-9,y:10},zoom:100,mask:-1,blur:99});check(invalid.config.mode===DEFAULT_CHAT_BACKGROUND.mode);check(invalid.config.themeId==='cool');check(invalid.config.focalPoint.x===0&&invalid.config.focalPoint.y===1);check(invalid.config.zoom===2&&invalid.config.mask===.35&&invalid.config.blur===12);check(!invalid.config.imageAssetId);
    for(const bad of [new Blob(['GIF89a']),new Blob(['<svg/>']),new Blob(['broken'])]){let rejected=false;try{await inspectBackgroundImage(bad);}catch{rejected=true;}check(rejected);}
    const png=new Uint8Array(33);png.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);const view=new DataView(png.buffer);view.setUint32(16,10000);view.setUint32(20,10000);let tooLarge=false;try{await inspectBackgroundImage(new Blob([png]));}catch{tooLarge=true;}check(tooLarge);
    const blob=await image('white');check((await inspectBackgroundImage(blob)).width===320);const normalized=await normalizeBackgroundImage(blob);check(normalized.source.type==='image/jpeg');check(normalized.width===320&&normalized.height===640);const bitmap=await createImageBitmap(normalized.source);check(bitmap.width===320);bitmap.close();return n;
  },
};
// Compatibility surface for the local preview only; all writes still use the new atomic repository.
(window as any).atmosphereTest={
  async demo(){await stream.setup(3);await ensureChatBackground(owner());const chars=useChatStore.getState().characters,rows=await db.messages.where('sessionId').equals('a').sortBy('createdAt');await db.messages.bulkPut(rows.map((row,i)=>({...row,role:i===2?'user' as const:'assistant' as const,content:i===2?'今天的风很轻，想和你慢慢聊。':'我在听。把今天的小事慢慢说给我吧。'})));useChatStore.setState({characters:chars.map(c=>c.id==='a'?{...c,tags:['清冷','温柔']}:c),messages:await db.messages.where('sessionId').equals('a').sortBy('createdAt')});},
  records:()=>({}),rehydrate:async()=>{},theme:(mode:'light'|'dark')=>useThemeStore.getState().setTheme(mode),
};
