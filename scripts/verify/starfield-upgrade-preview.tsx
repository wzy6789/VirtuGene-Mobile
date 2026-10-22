/** Test-only entry: independent origin, controlled records, real MobileLayout. */
import { createRoot } from 'react-dom/client';
import Dexie from 'dexie';
import { MobileLayout } from '../../src/components/layout/MobileLayout';
import { db, type Character, type WorldScene } from '../../src/db';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo, emptySceneState } from '../../src/db/world-scene-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useThemeStore } from '../../src/store/theme-store';
import { installThemePreferences } from '../../src/lib/theme';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { installUiFont } from '../../src/lib/ui-font';
import { IS_MOBILE, IS_CAPACITOR } from '../../src/lib/platform';
import { PRACTICAL_PRESETS } from '../../src/lib/practical-presets';
import { webApi } from '../../src/lib/web-api';
import { relationshipRepo } from '../../src/db/relationship-repo';
import { ChatAppearanceEditor } from '../../src/components/chat/ChatAppearanceSettings';

const w = window as any;
if (!w.__starfieldTestOrigin || !['127.0.0.1','localhost'].includes(location.hostname)) throw Error('Test entry requires its isolated server');
const allowed = ['empty','one','six','many','many-more','long-scenes','recent-entries','loading','load-error','assistant','long-name','home-sample','mixed-status','reader-sample','relations-sample','memory-sample','timeline-sample','world-settings-sample'] as const;
type State = typeof allowed[number];
let current: State='empty', owner='starfield-fixture:alpha', epoch=0;
const loadingReleases=new Set<()=>void>();
let loadingHeld=false, failLoad=false, failOpen=false;
let failRelations=false;
const listRelations=relationshipRepo.listStatesByWorld.bind(relationshipRepo);
relationshipRepo.listStatesByWorld=async(...args)=>{if(failRelations){failRelations=false;throw Error('Controlled relationship read failure');}return listRelations(...args);};
let failEntries=false, failIdentity=false, heldSceneId:string|undefined;
const identityReleases=new Set<()=>void>();
const reads={entryRows:0,entryQueries:0,heldIdentity:0};
const opens:(string|null)[]=[];
function releaseIdentity(){heldSceneId=undefined;for(const release of identityReleases)release();identityReleases.clear();}
// Count rows actually returned from IndexedDB, rather than a repository's sliced result.
db.use({stack:'dbcore',name:'starfield-test-read-count',create:core=>({...core,table(name){
  const table=core.table(name);if(name!=='worldSceneEntries')return table;
  return {...table,async query(request){const result=await table.query(request);reads.entryQueries++;reads.entryRows+=result.result.length;return result;}};
}})});
const identityGet=db.worldScenes.get.bind(db.worldScenes);
db.worldScenes.get=((...args:Parameters<typeof identityGet>)=>{
  if(failIdentity){failIdentity=false;return Promise.reject(Error('Controlled selected-identity read failure'));}
  if(args[0]===heldSceneId){reads.heldIdentity++;const pending=new Promise<void>(resolve=>identityReleases.add(resolve));return Dexie.waitFor(pending).then(()=>identityGet(...args));}
  return identityGet(...args);
}) as typeof db.worldScenes.get;
for(const method of ['listEntries','listRecentEntries'] as const){
  const original=worldSceneRepo[method].bind(worldSceneRepo);
  (worldSceneRepo[method] as any)=async(...args:any[])=>{if(failEntries){failEntries=false;throw Error('Controlled scene entries read failure');}return (original as any)(...args);};
}
const openCanvas=useUIStore.getState().openCanvas;
useUIStore.setState({openCanvas:id=>{opens.push(id);openCanvas(id);}});
function releaseLoading(){loadingHeld=false;for(const release of loadingReleases)release();loadingReleases.clear();}
const listScenes=worldSceneRepo.listScenes.bind(worldSceneRepo);
const getScene=worldSceneRepo.getScene.bind(worldSceneRepo);
worldSceneRepo.listScenes=async (...args)=>{
  const ticket=epoch;
  if(loadingHeld)await new Promise<void>(resolve=>{loadingReleases.add(resolve);});
  if(ticket!==epoch)return [];
  if(failLoad){failLoad=false;throw Error('Controlled P0 scene read failure');}
  return listScenes(...args);
};
worldSceneRepo.getScene=async (...args)=>{
  if(failOpen){failOpen=false;throw Error('Controlled P0 scene open failure');}
  return getScene(...args);
};
webApi.chat.send=async()=>{w.previewIsolation.modelBlocked++;throw Error('P0 never invokes a model');};
installThemePreferences();installUiPreferences();installUiFont();
useThemeStore.getState().setTheme(new URLSearchParams(location.search).get('theme')==='light'?'light':'dark');
// Explicit isolated visual demo can opt into real motion; verification stays reduced by default.
useSettingsStore.setState({reduceMotion:new URLSearchParams(location.search).get('motion')!=='on',ttsEnabled:false,aiVoiceMode:false});
const root=createRoot(document.getElementById('app')!);
const sceneIds:string[]=[];
async function setState(name:State){
  if(!allowed.includes(name))throw Error('Unknown fixed test state');
  epoch++;releaseLoading();releaseIdentity();failIdentity=false;failEntries=false;failOpen=false;opens.splice(0);current=name;loadingHeld=name==='loading';failLoad=name==='load-error';
  root.render(null);
  // Only this test origin's fixture-owned rows are touched. Never query a real origin.
  const fixtureScenes=await db.worldScenes.where('userId').equals(owner).primaryKeys();
  if(fixtureScenes.length)await db.worldSceneEntries.where('sceneId').anyOf(fixtureScenes).delete();
  await db.worldScenes.bulkDelete(fixtureScenes);
  const world=await worldRepo.ensureDefaultWorld(owner);
  await db.worlds.update(world.id,{userId:owner,clock:{worldAt:Date.now(),lastReconciledAt:Date.now(),pace:'realtime'}});
  const characters:Character[]=PRACTICAL_PRESETS.slice(0,2).map((base,index)=>({...base,id:`${owner}:role:${index}`,createdBy:owner,isPreset:false,isCustom:true,published:false,proactivity:0}));
  if(name==='assistant'||name==='long-name'||name==='home-sample')characters.push({...characters[0],id:`${owner}:assistant`,agentProfile:'secretary',secretaryStatus:'active',name:name==='long-name'?'这是一个需要完整展示的较长助理名字':'晓来'});
  await db.characters.bulkPut(characters);
  if(name==='world-settings-sample')await db.worldFacts.bulkPut(['这里一直是秋天。','街角的咖啡店周末营业。'].map((content,index)=>({id:`${owner}:setting:${index}`,userId:owner,worldId:world.id,category:'rule',content,visibility:'world',sourceType:'user',sourceId:`${owner}:setting:${index}`,priority:.5,active:index===0,createdAt:Date.now(),updatedAt:Date.now()})));
  if(name==='relations-sample'){
    const now=Date.now(),a=`c:${characters[0].id}`,b=`c:${characters[1].id}`,u=`u:${owner}`;
    const make=(id:string,x:string,y:string)=>({id,userId:owner,worldId:world.id,pairKey:[x,y].sort().join('|'),subjectA:x,subjectB:y,subjects:[x,y],trust:52,dependency:0,conflict:8,familiarity:38,updatedAt:now});
    const pair=make(`${owner}:relation:pair`,a,b),self=make(`${owner}:relation:self`,u,a);
    await db.relationshipStates.bulkPut([pair,self]);
    await db.characterStates.put({characterId:characters[0].id,userId:owner,affinity:25,mood:60,milestones:[],updatedAt:now});
    await db.worldEvents.put({id:`${owner}:relation-source`,userId:owner,worldId:world.id,type:'stage',title:'雨停前的约定',summary:'两个人在站台上把各自的打算说清楚，约好把那本书带回来。',participants:[a,b,u],timestamp:now,importance:.4,sourceType:'stage',sourceId:`${owner}:scene:0`,visibility:'world',resolved:true,relatedEventIds:[],updatedAt:now});
    await db.relationshipEvents.bulkPut(Array.from({length:5},(_,index)=>({id:`${owner}:relation-event:${index}`,userId:owner,worldId:world.id,pairKey:pair.pairKey,subjectA:a,subjectB:b,subjects:[a,b],facets:{trust:2},reason:index===0?'在站台上说清了各自的打算，答应下次把那本书带回来。':`一起经历后留下的第 ${index+1} 条真实变化记录。`,sourceEventId:`${owner}:relation-source`,sourceType:'stage',createdAt:now-index*1000})));
  }
  useAuthStore.setState({userId:owner,username:'独立UI测试',isLoggedIn:true,apiKey:null,gatewayAccessToken:null,gatewayRefreshToken:null});
  useChatStore.setState({characters,messages:[],selectedCharacterId:null,currentSessionId:null,charPreviews:{},unreadByCharacter:{}});
  const count=name==='many-more'?73:name==='many'?50:name==='six'||name==='long-scenes'||name==='mixed-status'?6:name==='empty'?0:1;
  sceneIds.splice(0);
  const scenes:WorldScene[]=Array.from({length:count},(_,index)=>{
    const id=`${owner}:scene:${index}`;sceneIds.push(id);
    const state=emptySceneState();state.participants=characters.filter(c=>c.agentProfile!=='secretary').map(c=>({characterId:c.id,goals:[],knowsEventIds:[],secrets:[],enteredAt:Date.now()}));
    return{id,userId:owner,worldId:world.id,title:name==='long-scenes'?`我们在街角旧书店聊到天黑，那些尚未说完的心事与很长很长的场景名称 ${index+1}`:index===0?'雨后的站台':`共同经历 ${index+1}`,place:'旧书店',timeLabel:'傍晚',mood:'平静',characterIds:characters.filter(c=>c.agentProfile!=='secretary').map(c=>c.id),status:name==='mixed-status'?(['active','paused','finished','draft'] as const)[index%4]:index%3===0?'paused':index%3===1?'active':'finished',state,startedAt:Date.now()-index*1000,createdAt:Date.now()-index*1000,updatedAt:Date.now()-index*1000};
  });
  await db.worldScenes.bulkPut(scenes);
  if(name==='timeline-sample'){
    const now=Date.now();
    await db.worldEvents.bulkPut(Array.from({length:12},(_,index)=>({id:`${owner}:timeline:${index}`,userId:owner,worldId:world.id,type:'stage',title:index===0?'在站台聊到天亮':`第 ${index+1} 次相遇留下的片段`,summary:index===0?'说到后来，雨已经停了。那些没来得及说完的话，留到下次见面。':'又一起经历了一件值得记住的事。',participants:[`u:${owner}`,`c:${characters[0].id}`],timestamp:now-index*21600000,importance:.4,sourceType:'stage',sourceId:`${owner}:timeline-source:${index}`,visibility:'world',resolved:true,relatedEventIds:[],tags:[],createdAt:now,updatedAt:now})));
  }
  if(name==='memory-sample'){
    const now=Date.now();
    await db.sharedMemories.bulkPut(Array.from({length:43},(_,index)=>({id:`${owner}:memory:${index}`,userId:owner,worldId:world.id,title:index===0?'雨后的站台':index===1?'那本还没送出的书':`留在这里的片段 ${index+1}`,summary:index===0?'雨声慢慢停了，我们把没说完的话留在站台。下次见面，再带上那本书。':'一起经历的这一小段时间，仍有值得记住的细节。',participants:[`u:${owner}`,`c:${characters[0].id}`],characterIds:[characters[0].id],visibility:'world',relatedCharacters:[],relatedRelationships:[],sourceType:'story',sourceId:scenes[0].id,importance:.5,tags:[],createdAt:now-index*3600000,updatedAt:now})));
    await db.worldSceneEntries.put({id:`${owner}:memory-origin`,sceneId:scenes[0].id,index:0,act:0,kind:'narration',content:'雨声慢慢停了，你们仍坐在站台边。',createdAt:now});
  }
  if(name!=='home-sample')await db.worldEvents.delete(`${owner}:home-sample`);
  if(name==='home-sample')await db.worldEvents.put({id:`${owner}:home-sample`,userId:owner,worldId:world.id,type:'stage',title:'旧书店的一小段时光',summary:'傍晚的灯亮起来，我们把没说完的话留在这里。',participants:characters.filter(c=>c.agentProfile!=='secretary').map(c=>`c:${c.id}`),timestamp:Date.now()-3600000,importance:.4,sourceType:'stage',sourceId:scenes[0].id,visibility:'world',resolved:true,relatedEventIds:[]});
  if(name==='recent-entries')await db.worldSceneEntries.bulkPut(Array.from({length:1005},(_,index)=>({id:`${owner}:entry:${index}`,sceneId:scenes[0].id,index,act:0,kind:'narration' as const,content:`第 ${index} 段记录：这是一段真实数据库里的隔离测试正文。`,createdAt:Date.now()+index})));
  if(name==='reader-sample')await db.worldSceneEntries.bulkPut(Array.from({length:15},(_,index)=>({id:`${owner}:reader:${index}`,sceneId:scenes[0].id,index,act:0,kind:(['narration','dialogue','action','dialogue','user_input'] as const)[index%5],...(index%5>0&&index%5<4?{speakerId:characters[0].id}:{}),content:[
    '店门铃轻轻响了一声。傍晚的光越过书架，落在那本摊开的书上。我们在这里停了一会儿，把未说完的话慢慢接起来。',
    '这页被折过一个小角。你刚才说的那句话，和旁边这行字有一点像。',
    '把书轻轻转向你，留出靠窗的位置。',
    '想接着读，还是先坐一会儿？不用急着决定。',
    '我在窗边坐下，翻回刚才读到的那一页。',
  ][index%5],createdAt:Date.now()+index})));
  useUIStore.setState({activeView:'chat',mobileTab:'world',worldTheaterOpen:false,chatFromList:false,chatFromCharacters:false,canvasSceneId:null});
  root.render(<MobileLayout key={`${owner}:${epoch}`} />);
}
function snapshot(){return{state:current,owner,sceneIds:[...sceneIds],IS_MOBILE,native:IS_CAPACITOR,mobileLayout:!!document.querySelector('.mobile-layout'),desktopTitlebar:!!document.querySelector('.title-bar'),
  viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visualViewport:visualViewport&&{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale}},
  theme:document.documentElement.dataset.vgTheme,navigation:{activeView:useUIStore.getState().activeView,mobileTab:useUIStore.getState().mobileTab},reads:{...reads},opens:[...opens],isolation:{...w.previewIsolation},sourceHashes:w.__starfieldSourceHashes};}
w.starfieldPreview={setState,snapshot,releaseLoading,releaseIdentity,motion:(enabled:boolean)=>useSettingsStore.getState().setReduceMotion(!enabled),resetReads:()=>{reads.entryRows=0;reads.entryQueries=0;reads.heldIdentity=0;},holdIdentity:(id:string)=>{if(!sceneIds.includes(id))throw Error('Unknown fixture scene');reads.heldIdentity=0;heldSceneId=id;},
  holdLoading:()=>{loadingHeld=true;},
  ownedScenes:async()=>{const world=await worldRepo.ensureDefaultWorld(owner);return worldSceneRepo.listScenes(world.id,{userId:owner,limit:50});},
  setSceneStatus:async(index:number,status:WorldScene['status'])=>{if(!sceneIds[index]||!['active','paused','finished','draft'].includes(status))throw Error('Unknown fixture scene/status');await db.worldScenes.update(sceneIds[index],{status});},
  relationFixture:async(change:'long'|'delete-source'|'private-source'|'delete-event'|'revoke-world'|'no-reasons'|'invalid-time'|'remove-role')=>{
    if(change==='long'){const rows=await db.characters.bulkGet([`${owner}:role:0`,`${owner}:role:1`]);await db.characters.bulkPut(rows.filter((c):c is Character=>!!c).map((c,i)=>({...c,name:i?'这是另一位名字同样非常长的同行角色':'这是一个需要完整展示的很长很长的角色名字'})));useChatStore.setState({characters:await db.characters.where('createdBy').equals(owner).toArray()});}
    else if(change==='delete-source')await db.worldEvents.delete(`${owner}:relation-source`);
    else if(change==='private-source')await db.worldEvents.update(`${owner}:relation-source`,{visibility:'private'});
    else if(change==='delete-event')await db.relationshipEvents.delete(`${owner}:relation-event:0`);
    else if(change==='revoke-world'){const world=await worldRepo.ensureDefaultWorld(owner);await db.worlds.update(world.id,{userId:'starfield-fixture:revoked'});}
    else if(change==='no-reasons')await db.relationshipEvents.where('userId').equals(owner).delete();
    else if(change==='invalid-time')await db.relationshipEvents.update(`${owner}:relation-event:0`,{createdAt:NaN});
    else if(change==='remove-role')await db.characters.delete(`${owner}:role:1`);
  },
  failRelationRead:()=>{failRelations=true;},
  clearCharacters:async()=>{await db.characters.bulkDelete([`${owner}:role:0`,`${owner}:role:1`,`${owner}:assistant`]);useChatStore.setState({characters:[]});},
  memoryFixture:async(change:'delete-first'|'long'|'edit')=>{
    if(change==='delete-first')await db.sharedMemories.delete(`${owner}:memory:0`);
    else if(change==='edit')await db.sharedMemories.update(`${owner}:memory:0`,{title:'更新后的站台记录',summary:'这是当前编辑后的完整摘要。',updatedAt:Date.now()});
    else if(change==='long')await db.sharedMemories.update(`${owner}:memory:0`,{title:'雨后的站台与很久以后也会记得的那本尚未送出的书',summary:'这是一段很长但依然完整保存在原记录里的共同经历。'.repeat(50)});
  },
  timelineFixture:async(change:'edit'|'delete'|'private')=>{
    if(change==='delete')await db.worldEvents.delete(`${owner}:timeline:0`);
    else if(change==='private')await db.worldEvents.update(`${owner}:timeline:0`,{visibility:'private'});
    else await db.worldEvents.update(`${owner}:timeline:0`,{title:'更新后的那次相遇',summary:'现在保存的记录已经更新，不再保留旧正文。',updatedAt:Date.now()});
  },
  failTimelineRead:()=>{const original=db.worldEvents.where;db.worldEvents.where=function(index:any){if(index==='[worldId+timestamp]'){db.worldEvents.where=original;throw Error('Controlled timeline read failure');}return original.call(this,index); } as typeof original;},
  addSystemTail:async()=>{
    if(current!=='recent-entries')throw Error('Requires fixed long-history fixture');
    await db.worldSceneEntries.bulkPut([...Array.from({length:20},(_,offset)=>({id:`${owner}:tail:${offset}`,sceneId:sceneIds[0],index:1005+offset,act:0,kind:'system' as const,content:'系统时间更新',createdAt:Date.now()+offset})),...Array.from({length:8105},(_,index)=>({id:`starfield-fixture:unrelated:entry:${index}`,sceneId:'starfield-fixture:unrelated:scene',index,act:0,kind:'narration' as const,content:'另一场景的无关测试记录',createdAt:Date.now()}))]);
  },
  failNext:(kind:'load'|'open'|'entries'|'identity')=>{if(kind==='load')failLoad=true;else if(kind==='open')failOpen=true;else if(kind==='entries')failEntries=true;else if(kind==='identity')failIdentity=true;else throw Error('Unknown failure kind');},
  mutateScene:async(id:string,change:'delete'|'owner'|'rename')=>{if(!sceneIds.includes(id))throw Error('Unknown fixture scene');if(change==='delete')await db.worldScenes.delete(id);else if(change==='owner')await db.worldScenes.update(id,{userId:'starfield-fixture:revoked'});else if(change==='rename')await db.worldScenes.update(id,{title:'修改后仍属于这一幕的完整标题'});else throw Error('Unknown mutation');},
  revokeWorld:async()=>{const world=await worldRepo.ensureDefaultWorld(owner);await db.worlds.update(world.id,{userId:'starfield-fixture:revoked'});},
  changeAccountOnly:()=>{owner=owner==='starfield-fixture:alpha'?'starfield-fixture:beta':'starfield-fixture:alpha';useAuthStore.setState({userId:owner});},
  switchOwner:async(id:'alpha'|'beta')=>{if(!['alpha','beta'].includes(id))throw Error('Unknown test owner');owner=`starfield-fixture:${id}`;await setState('one');},
  theme:(theme:'dark'|'light')=>{if(!['dark','light'].includes(theme))throw Error('Unknown theme');useThemeStore.getState().setTheme(theme);}};
// Explicit isolated preview links may open a known synthetic state directly.
// The real application, account storage and route behavior are not involved.
const query=new URLSearchParams(location.search);
const initialState=allowed.find(state=>state===query.get('state'))??'empty';
void db.open().then(()=>setState(initialState)).then(async()=>{
  if(query.get('view')==='starfield')useUIStore.getState().setWorldTheaterOpen(true);
  if(query.get('view')==='stage')useUIStore.setState({activeView:'stage',mobileTab:'world',worldTheaterOpen:true});
  if(query.get('view')==='relations')useUIStore.setState({activeView:'relations',mobileTab:'world',worldTheaterOpen:true});
  if(query.get('view')==='memory')useUIStore.setState({activeView:'memory',mobileTab:'world',worldTheaterOpen:true});
  if(query.get('view')==='timeline')useUIStore.setState({activeView:'timeline',mobileTab:'world',worldTheaterOpen:true});
  if(query.get('view')==='worldSettings')useUIStore.setState({activeView:'worldSettings',mobileTab:'world',worldTheaterOpen:true});
  if(query.get('view')==='appearance'){
    const character=await db.characters.get(`${owner}:role:0`);
    if(character){useChatStore.setState({selectedCharacterId:character.id});root.render(<><MobileLayout/><ChatAppearanceEditor character={character} userId={owner} onClose={()=>root.render(<MobileLayout/>)}/></>);}
  }
  if(query.get('view')==='canvas'&&sceneIds[0]){
    if(query.get('sceneState')==='finished')await db.worldScenes.update(sceneIds[0],{status:'finished'});
    useUIStore.getState().setWorldTheaterOpen(true);useUIStore.getState().openCanvas(sceneIds[0]);
  }
  if(query.get('view')==='detail'){
    useUIStore.getState().setWorldTheaterOpen(true);
    for(let n=0;n<500;n++){const button=document.querySelector<HTMLButtonElement>('[data-scene-marker]');if(button){button.click();break;}await new Promise(r=>setTimeout(r,10));}
  }
  w.starfieldReady=true;
}).catch(error=>{w.starfieldStartupError=String(error);document.getElementById('app')!.textContent='独立测试启动失败';console.error(error);});
