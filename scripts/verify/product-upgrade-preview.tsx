/** Actual product components, synthetic records, separate localhost origin. */
import './chat-stream';
import { useEffect, useLayoutEffect, useState } from 'react';
import Dexie from 'dexie';
import { createRoot, type Root } from 'react-dom/client';
import { MobileLayout } from '../../src/components/layout/MobileLayout';
import { CharacterProfileModal } from '../../src/components/character/CharacterProfileModal';
import { CharacterAddModal } from '../../src/components/character/CharacterAddModal';
import { VoiceCallHost } from '../../src/components/chat/VoiceCallHost';
import { FeedbackHost } from '../../src/components/ui/FeedbackHost';
import { db, type Character, type Message } from '../../src/db';
import { useChatStore } from '../../src/store/chat-store';
import { useAuthStore } from '../../src/store/auth-store';
import { useUIStore, type MobileTab } from '../../src/store/ui-store';
import { useThemeStore } from '../../src/store/theme-store';
import { useVoiceCallUIStore } from '../../src/store/voice-call-ui-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { GITHUB_API } from '../../src/lib/update-config';
import { PRACTICAL_PRESETS } from '../../src/lib/practical-presets';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { localDateKey, addLocalDays, todoRepo } from '../../src/db/todo-repo';
import { momentsRepo } from '../../src/db/moments-repo';
import { SecretaryInboxModal } from '../../src/components/secretary/SecretaryInboxModal';
import { AuthPage } from '../../src/pages/AuthPage';
import { userRepo } from '../../src/db/user-repo';
import { installThemePreferences } from '../../src/lib/theme';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { installUiFont } from '../../src/lib/ui-font';
import { ensureChatBackground,publishBackground,readBackgroundRows,useChatBackgroundStore } from '../../src/store/chat-background-store';
import {chatBackgroundRepo} from '../../src/db/chat-background-repo';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { worldFactRepo } from '../../src/db/world-fact-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { emptySceneState } from '../../src/db/world-scene-repo';
import { installWorldGenerationTransport } from './world-generation-transport';
import { inspectChatParticleEngine, inspectChatParticleResources } from '../../src/lib/chat-particle-engine';

const firstOwner = 'stream-test-user';
let owner = firstOwner;
const fixedTime = Date.parse('2026-10-15T11:30:00+08:00');
let root: Root | undefined;
let showProfile: (character?: Character) => void = () => {};
let showEditor: (target: Character | 'new' | undefined) => void = () => {};
let onShellReady: () => void = () => {};
let responseCursor = 0;
let stopWorldDemo = () => {};
const fixture = (window as any).chatStreamTest;
const guard = (window as any).previewIsolation;
const nowTheme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
installThemePreferences(); installUiPreferences(); installUiFont();
useThemeStore.getState().setTheme(nowTheme);

function ProductPreview() {
  const [profile, setProfile] = useState<Character>();
  const [editor, setEditor] = useState<Character | 'new'>();
  showProfile = setProfile;
  showEditor = setEditor;
  useEffect(() => { onShellReady(); }, []);
  return <><MobileLayout /><VoiceCallHost /><FeedbackHost />
    {profile && <CharacterProfileModal character={profile} userId={owner} onClose={() => setProfile(undefined)} onChat={async character => { setProfile(undefined); await openChat(character.id); }} />}
    {editor && <CharacterAddModal open editCharacter={editor === 'new' ? undefined : editor} onClose={() => setEditor(undefined)} onSelected={() => {
      setEditor(undefined);
      useUIStore.setState({ activeView: 'chat', mobileTab: 'chat', chatFromList: true, chatFromCharacters: false });
    }} />}
  </>;
}

function InboxReadFixture({character,embedded}:{character:Character;embedded:boolean}) {
  const [open,setOpen]=useState(true);
  (window as any).__setInboxFixtureOpen=setOpen;
  useLayoutEffect(()=>{if(open){((window as any).__inboxRenderSamples??=[]).push(document.querySelector('.vg-secretary-inbox')?.textContent??'');}},[open]);
  return <SecretaryInboxModal character={character} open={open} embedded={embedded} onClose={()=>setOpen(false)} onDraft={()=>{}} />;
}

function AuthEntryFixture(){
  const loggedIn=useAuthStore(s=>s.isLoggedIn);
  return loggedIn ? <main><p role="status">本地模拟账号已登录</p></main> : <AuthPage />;
}

async function openChat(id = 'a') {
  showProfile(undefined);
  useVoiceCallUIStore.getState().close();
  await useChatStore.getState().selectCharacter(id);
  useUIStore.setState({ activeView: 'chat', mobileTab: 'chat', chatFromList: true, chatFromCharacters: false });
}

function closeMockCall() {
  useVoiceCallUIStore.getState().close();
  useVoiceCallStore.setState({ busy: false, saving: false, view: undefined, owner: undefined, record: undefined, error: undefined });
  document.documentElement.removeAttribute('data-preview-call');
  const label = document.getElementById('preview-isolation-label');
  if (label) label.textContent = '模拟资料 · 模型/麦克风/音频均隔离';
}

async function go(page: string, role = 'a') {
  stopWorldDemo(); stopWorldDemo = () => {};
  closeMockCall(); showProfile(undefined); showEditor(undefined);
  if(page==='world-generation'){
    const scene=await (window as any).productUpgradeTest.seedWorldReading();
    await (window as any).productUpgradeTest.installWorldGeneration(true);
    const transport=(window as any).__worldGeneration;let cursor=0;
    const timers=new Set<ReturnType<typeof setTimeout>>();
    const after=(ms:number,run:()=>void)=>{const timer=setTimeout(()=>{timers.delete(timer);run();},ms);timers.add(timer);};
    const tick=setInterval(()=>{const actors=transport.snapshot().actors;while(cursor<actors.length){const index=cursor++;after(650,()=>{transport.push(index,'这是一段本地脚本模拟的世界回应，');after(500,()=>transport.finish(index,'用来体验流式呈现与阅读滚动。'));});}},80);
    stopWorldDemo=()=>{clearInterval(tick);for(const timer of timers)clearTimeout(timer);transport.restore();};
    const label=document.getElementById('preview-isolation-label');if(label)label.textContent='本地脚本回复 · 无模型/麦克风/声音';
    useUIStore.setState({activeView:'canvas',mobileTab:'world',canvasSceneId:scene.id,canvasSheetOpen:false,chatFromList:false,chatFromCharacters:false});return;
  }
  if(page==='world-settings'){
    await (window as any).productUpgradeTest.worldSettingsFixture();
    (window as any).productUpgradeTest.openWorldSettings();
    return;
  }
  if(['todo','diary','moments','assistant'].includes(page)){
    useUIStore.setState({activeView:page==='assistant'?'actionCabin':page as 'todo'|'diary'|'moments',mobileTab:page==='assistant'?'chat':'world',chatFromList:false,chatFromCharacters:false});
    return;
  }
  if(page==='timeline'){
    await (window as any).productUpgradeTest.seedWorld();
    await (window as any).productUpgradeTest.seedWorldEvent();
    useUIStore.setState({activeView:'timeline',mobileTab:'world',chatFromList:false,chatFromCharacters:false});
    return;
  }
  if(page==='memory'){
    await (window as any).productUpgradeTest.seedMemoryOrigins();
    useUIStore.setState({activeView:'memory',mobileTab:'world',chatFromList:false,chatFromCharacters:false});
    return;
  }
  if(page==='world-reading'){
    const scene=await (window as any).productUpgradeTest.seedWorldReading();
    await (window as any).productUpgradeTest.enableWorldReadingSuggestions();
    useUIStore.setState({activeView:'canvas',mobileTab:'world',canvasSceneId:scene.id,canvasSheetOpen:false,chatFromList:false,chatFromCharacters:false});
    return;
  }
  if (page === 'create' || page === 'edit') {
    useUIStore.setState({ activeView: 'chat', mobileTab: 'characters', chatFromList: false, chatFromCharacters: false });
    showEditor(page === 'create' ? 'new' : useChatStore.getState().characters.find(character => character.id === role));
    return;
  }
  if (page === 'chat' || page.startsWith('call')) {
    await openChat(role);
    if (page.startsWith('call')) {
      const character = useChatStore.getState().characters.find(c => c.id === role)!;
      document.documentElement.dataset.previewCall = 'simulated';
      const label = document.getElementById('preview-isolation-label');
      if (label) label.textContent = '模拟通话阶段 · 无真实录音或播放';
      useVoiceCallUIStore.getState().open({ userId: owner, sessionId: role, character });
      if (page === 'call-connected') {
        useVoiceCallStore.setState({ owner: { userId: owner, sessionId: role, characterId: role }, busy: true, saving: false,
          record: { id: 'preview-call', userId: owner, sessionId: role, characterId: role, startedAt: Date.now() - 65000, endedAt: 0, voice: 'mimo_default', exchanges: [], messageIds: [], summaryState: 'pending', status: 'active' } as any,
          view: { phase: 'listening', inputMode: 'voice', userText: '', generatedText: '', heardText: '', level: 0, muted: false } });
      }
    }
    return;
  }
  useUIStore.setState({ activeView: 'chat', mobileTab: (page === 'home' ? 'chat' : page === 'profile'||page==='style' ? 'characters' : page) as MobileTab, chatFromList: false, chatFromCharacters: false });
  if (page === 'profile'||page==='style') showProfile(useChatStore.getState().characters.find(c => c.id === role));
  if(page==='style'){
    for(let frame=0;frame<60;frame++){
      await new Promise(requestAnimationFrame);
      const button=[...document.querySelectorAll('button')].find(node=>node.textContent?.includes('角色造型间'));
      if(button){button.click();return;}
    }
    throw Error('当前预览快照没有可用的角色造型间入口。');
  }
}

async function setup() {
  root?.unmount(); root = undefined;
  owner = firstOwner;
  // The full-product fixture reseeds business records on refresh. Retain only
  // this simulated owner's UI drafts so recovery can still be exercised.
  await db.open();
  const retainedDrafts = await db.characterEditorDrafts?.where('userId').equals(firstOwner).toArray() ?? [];
  await fixture.setup(0); fixture.unmount();
  useAuthStore.setState({ username: '本地体验者 · 模拟账号', avatar: null });
  useSettingsStore.setState({ aiVoiceMode: false, ttsEnabled: false, chatBackgroundEnabled: true });
  const order = ['preset-zhiwei', 'preset-chengyan', 'preset-wenchuan'];
  const chars: Character[] = order.map((id, i) => ({ ...PRACTICAL_PRESETS.find(c => c.id === id)!, id: ['a', 'b', 'c'][i], sourcePresetId: id, createdBy: owner,
    createdAt: fixedTime - 18 * 86400000, isPreset: false, isCustom: true, published: false, proactivity: 0, voice: DEFAULT_VOICE,
    systemPrompt: '本地 UI 演示角色。\n对话样本：用户说你好 → 你说来啦。',
    tags: i === 0 ? ['温柔', '古典', '周易'] : i === 1 ? ['理性', '沉静', '编程'] : ['稳重', '文学', '写作'] }));
  await db.characters.clear(); await db.characters.bulkPut(chars);
  await db.sessions.clear(); await db.sessions.bulkPut(chars.map((c, i) => ({ id: c.id, characterId: c.id, userId: owner, title: c.name, createdAt: fixedTime - 18 * 86400000, updatedAt: fixedTime - i * 3600000, modelAsked: true, model: { provider: 'deepseek', model: 'deepseek-v4-flash' } })));
  const texts = [
    ['今天想把步子放慢一点。', '那就先放慢一点。窗外的光刚好，未做完的事可以一件一件来。', '好，我们慢慢聊。'],
    ['我把那个报错找到了。', '很好，先保留能复现的最小例子。修好之后，我们再看边界情况。'],
    ['这段开头我终于写完了。', '发来看看。我想先听听，你最舍不得删掉的是哪一句。'],
  ];
  const messages: Message[] = texts.flatMap((rows, i) => rows.map((content, j) => ({ id: `preview-${i}-${j}`, sessionId: ['a', 'b', 'c'][i], role: j % 2 === 0 ? 'user' as const : 'assistant' as const, content,
    createdAt: fixedTime - i * 3600000 + j * 60000, isProactive: false })));
  await db.messages.clear(); await db.messages.bulkPut(messages);
  useChatStore.setState({ characters: chars, messages: messages.filter(m => m.sessionId === 'a'), selectedCharacterId: 'a', currentSessionId: 'a', hasMoreMessages: false, unreadByCharacter: {}, charPreviews: Object.fromEntries(chars.map(c => { const last = messages.filter(m => m.sessionId === c.id).at(-1)!; return [c.id, { content: last.content, createdAt: last.createdAt, role: last.role }]; })) });
  if (db.characterEditorDrafts) await db.characterEditorDrafts.bulkPut(retainedDrafts.filter(row => !row.characterId || chars.some(character => character.id === row.characterId)));
  await ensureChatBackground(owner, true);
  useUIStore.setState({ activeView: 'chat', mobileTab: 'chat', chatFromList: false, chatFromCharacters: false });
  const shellReady = new Promise<void>(resolve => { onShellReady = resolve; });
  root = createRoot(document.getElementById('app')!); root.render(<ProductPreview />);
  await shellReady;
  responseCursor = 0;
  return { user: owner, roles: chars.map(c => ({ id: c.id, name: c.name, tags: c.tags })), messages: messages.map(({ id, sessionId, role, content, createdAt }) => ({ id, sessionId, role, content, createdAt })), fixtureClock: fixedTime };
}

// Reply fixture is local and explicit; no production model endpoint is reachable.
setInterval(() => {
  const requests = fixture.requests();
  if (requests.length <= responseCursor) return;
  const index = responseCursor++;
  setTimeout(() => {
    if (fixture.requests()[index]?.aborted) return;
    fixture.push(index, '这是一条本地模拟回复，');
    setTimeout(() => { if (!fixture.requests()[index]?.aborted) { fixture.push(index, '可以用来查看流式续写与界面效果。'); fixture.finish(index); } }, 600);
  }, 900);
}, 80);

(window as any).productUpgradeTest = {
  seedDiaryReading:async()=>{
    const {diaryRepo,todayStr}=await import('../../src/db/diary-repo');
    const {useDiaryStore}=await import('../../src/store/diary-store');
    useSettingsStore.setState({diaryAiEnabled:false});
    const title='沿着晚风与灯光，把今天值得记住的事情完整留下来。'.repeat(3)+' UnbrokenDiaryTitleForWrapping';
    const content=Array.from({length:12},(_,i)=>`第${i+1}段。`+'傍晚的风经过窗台，我把琐碎但重要的小事留在这里。'.repeat(6)).join('\n\n');
    const id=await diaryRepo.create({userId:owner,date:todayStr(),title,content,mood:3,tags:['隔离阅读']});
    useDiaryStore.getState().reset();await useDiaryStore.getState().load();await go('diary');
    return{id,title,content};
  },
  diaryWriteFailure:async(fail:boolean)=>{
    const {diaryRepo}=await import('../../src/db/diary-repo');
    const test=window as any;
    if(fail&&!test.restoreDiaryWrite){const original=diaryRepo.update;test.restoreDiaryWrite=()=>{diaryRepo.update=original;delete test.restoreDiaryWrite;};diaryRepo.update=async()=>{throw Error('isolated fixture: diary write rejected');};}
    else if(!fail)test.restoreDiaryWrite?.();
  },
  diaryRecord:(id:string)=>db.diaries.get(id),
  installWorldGeneration:async(longHistory:boolean|number=false)=>{
    const scene=await db.worldScenes.get('preview-world-scene');if(!scene)throw Error('Missing world fixture scene');
    await db.worldScenes.update(scene.id,{characterIds:['a'],state:{...scene.state,participants:scene.state.participants.filter(p=>p.characterId==='a')}});
    if(longHistory)await db.worldSceneEntries.bulkPut(Array.from({length:typeof longHistory==='number'?longHistory:28},(_,index)=>({id:'preview-generation-history-'+index,sceneId:scene.id,index:index+10,act:1,kind:'narration' as const,content:`更早的站台记录 ${index+1}。`+'这是一段用于检验上翻阅读的本地场景记录。'.repeat(8),createdAt:fixedTime+index+10,witnessedBy:['a']})));
    useAuthStore.setState({apiKey:'preview-not-a-real-key'});
    (window as any).__worldGeneration=installWorldGenerationTransport();
  },
  worldGenerationState:()=> (window as any).__worldGeneration.snapshot(),
  worldGenerationPush:(index:number,text:string)=>(window as any).__worldGeneration.push(index,text),
  worldGenerationFinish:(index:number,text?:string)=>(window as any).__worldGeneration.finish(index,text),
  worldGenerationFail:()=> (window as any).__worldGeneration.failNextActor(),
  worldGenerationSuggestions:(values:string[])=> (window as any).__worldGeneration.suggestNext(values),
  failWorldGenerationStateOnce:()=>{
    const original=worldSceneRepo.patchSceneState;
    worldSceneRepo.patchSceneState=async(...args)=>{
      if(args[1].conversation){worldSceneRepo.patchSceneState=original;throw Error('Controlled local state save failure after actor body');}
      return original.apply(worldSceneRepo,args);
    };
  },
  holdWorldGenerationRefresh:()=>{
    const original=worldSceneRepo.countEntries,state={entered:false,release:()=>{}};
    worldSceneRepo.countEntries=async(...args)=>{worldSceneRepo.countEntries=original;const count=await original.apply(worldSceneRepo,args);state.entered=true;await new Promise<void>(resolve=>{state.release=resolve;});return count;};
    (window as any).__worldGenerationRefresh=state;
  },
  worldGenerationRefreshState:()=>({entered:!!(window as any).__worldGenerationRefresh?.entered}),
  releaseWorldGenerationRefresh:()=>{(window as any).__worldGenerationRefresh?.release();},
  worldGenerationRows:async()=>({entries:await db.worldSceneEntries.where('sceneId').equals('preview-world-scene').toArray(),turns:await db.worldTurns.where('sceneId').equals('preview-world-scene').toArray()}),
  failWorldRecordOnce:(stage:'memory'|'knowledge'='memory')=>{
    const state={stage,calls:0};(window as any).__worldRecordFailure=state;
    if(stage==='memory'){
      const original=sharedMemoryRepo.create;sharedMemoryRepo.create=async(...args)=>{state.calls++;sharedMemoryRepo.create=original;throw Error('Controlled world record memory failure');};
    }else{
      const original=knowledgeRepo.grantForEvent;knowledgeRepo.grantForEvent=async(...args)=>{if(++state.calls===2){knowledgeRepo.grantForEvent=original;throw Error('Controlled world record knowledge failure');}return original.apply(knowledgeRepo,args);};
    }
  },
  holdWorldRecordPreparation:()=>{
    const original=worldRepo.ensureDefaultWorld,state={entered:false,calls:0,release:()=>{}};
    worldRepo.ensureDefaultWorld=async(...args)=>{worldRepo.ensureDefaultWorld=original;state.entered=true;state.calls++;await new Promise<void>(resolve=>{state.release=resolve;});return original(...args);};
    (window as any).__worldRecordPreparation=state;
  },
  worldRecordPreparation:()=>{const state=(window as any).__worldRecordPreparation;return {entered:!!state?.entered,calls:state?.calls??0};},
  holdWorldRecordExit:()=>{
    const original=worldSceneRepo.setSceneStatus,state={entered:false,release:()=>{}};
    worldSceneRepo.setSceneStatus=async(...args)=>{
      worldSceneRepo.setSceneStatus=original;state.entered=true;
      await new Promise<void>(resolve=>{state.release=resolve;});return original.apply(worldSceneRepo,args);
    };
    (window as any).__worldRecordExit=state;
  },
  worldRecordExit:()=>({entered:!!(window as any).__worldRecordExit?.entered}),
  releaseWorldRecordExit:()=>{(window as any).__worldRecordExit?.release();},
  worldRecordFailure:()=>({...((window as any).__worldRecordFailure??{})}),
  pauseWorldRecordScene:()=>db.worldScenes.update('preview-world-scene',{status:'paused'}),
  changeWorldRecordScopeDuringWrite:(mode:'owner'|'exit')=>{
    const original=knowledgeRepo.grantForEvent;
    knowledgeRepo.grantForEvent=async(...args)=>{
      knowledgeRepo.grantForEvent=original;const result=await original.apply(knowledgeRepo,args);
      Dexie.ignoreTransaction(()=>{
        if(mode==='owner')useAuthStore.setState({userId:'world-record-another-owner',apiKey:null});
        else useUIStore.setState({activeView:'chat',mobileTab:'world'});
      });
      return result;
    };
  },
  releaseWorldRecordPreparation:()=>{(window as any).__worldRecordPreparation?.release();},
  worldRecordRows:async()=>{
    const world=await worldRepo.ensureDefaultWorld(owner),event=await worldEventRepo.getBySource(owner,world.id,'story','preview-world-scene'),memory=await sharedMemoryRepo.getBySource(owner,world.id,'story','preview-world-scene');
    const knowledge=event?await db.characterKnowledge.where('eventId').equals(event.id).toArray():[];
    return {event,memory,knowledge};
  },
  worldSettingsFixture:async()=>{
    useAuthStore.setState({apiKey:null});
    for(const userId of [firstOwner,'world-settings-other']){
      const world=await worldRepo.ensureDefaultWorld(userId);
      await worldFactRepo.upsert({userId,worldId:world.id,category:'rule',content:userId===firstOwner?'这里一直是秋天。':'另一账号的春天。',sourceType:'user',sourceId:'world-settings-fixture'});
    }
  },
  openWorldSettings:()=>useUIStore.setState({activeView:'worldSettings',mobileTab:'world',chatFromList:false,chatFromCharacters:false}),
  worldSettingsOwner:(userId:string)=>useAuthStore.setState({userId,apiKey:null}),
  worldSettingRows:async(userId=firstOwner)=>{const world=await worldRepo.ensureDefaultWorld(userId);return worldFactRepo.listByWorld(world.id,{userId});},
  controlWorldSettings:(method:'listByWorld'|'upsert'|'update'|'remove'|'setActive'|'ensureDefaultWorld',mode:'fail'|'hold')=>{
    const repo:any=method==='ensureDefaultWorld'?worldRepo:worldFactRepo,original=repo[method];
    const state={entered:false,calls:0,release:()=>{},restore:()=>{repo[method]=original;}};
    repo[method]=async(...args:any[])=>{state.calls++;state.entered=true;if(mode==='fail'){state.restore();throw Error('Controlled world settings '+method+' failure');}if(method==='listByWorld'||method==='ensureDefaultWorld')state.restore();const gate=new Promise<void>(resolve=>{state.release=resolve;});const result=method==='listByWorld'?await original(...args):undefined;await gate;state.restore();return method==='listByWorld'?result:original(...args);};
    (window as any).__worldSettingsControl=state;
  },
  worldSettingsControl:()=>{const c=(window as any).__worldSettingsControl;return {entered:!!c?.entered,calls:c?.calls??0};},
  releaseWorldSettings:()=>{(window as any).__worldSettingsControl?.release();},
  manualAuthoringOffline:()=>useAuthStore.setState({apiKey:null}),
  authoringRows:async(id?:string)=>{
    const userId=useAuthStore.getState().userId!;
    const characters=id?[]:await db.characters.where('createdBy').equals(userId).toArray();
    const rows=await chatBackgroundRepo.load(userId);
    return {characters:characters.map(({id,name,systemPrompt})=>({id,name,systemPrompt})),character:id?await db.characters.get(id):undefined,appearance:id?rows.find(row=>row.roleId===id):undefined};
  },
  particleDiagnostics: inspectChatParticleEngine,
  particleResources: inspectChatParticleResources,
  seedSocialNotes:async(stock=false)=>{
    const common={visibility:'private' as const,audienceCharacterIds:[],visibilityRevision:1,mediaIds:[],createdAt:fixedTime,updatedAt:fixedTime};
    await db.moments.put({...common,id:'preview-social-note',userId:owner,text:'雨停之后，想去街角走走。'});
    if(stock)await db.moments.bulkPut([...Array.from({length:9},(_,i)=>({...common,id:'preview-social-own-'+i,userId:owner,text:'本地动态记录 '+i})),...Array.from({length:1000},(_,i)=>({...common,id:'preview-social-foreign-'+i,userId:'another-social-owner-'+i%3,text:'x'.repeat(1000)}))]);
  },
  seedSocialLayout:async()=>{
    await (window as any).productUpgradeTest.seedSocialNotes();
    momentsRepo.processJobs=async()=>{};
    const name='星河旅人_LuminousTraveler';useAuthStore.setState({username:name});
    const text='晚风经过街角，我想把今天的小事留下来。'.repeat(8)+' LongUnbrokenSocialPostForReading';
    await db.moments.update('preview-social-note',{text,visibility:'all',audienceCharacterIds:['a','b']});
    await db.momentReactions.bulkPut([{id:'layout-social-comment',userId:owner,momentId:'preview-social-note',characterId:'a',type:'comment',content:'把想记住的这一刻慢慢写下来。'.repeat(5),status:'active',createdAt:fixedTime+1,updatedAt:fixedTime+1}]);
    await db.momentNotifications.bulkPut(['like','comment'].map((type,i)=>({id:'layout-social-notice-'+i,userId:owner,momentId:'preview-social-note',characterId:'a',type:type as 'like'|'comment',preview:'知微留下了新的互动。',read:false,createdAt:fixedTime+i+1})));
    await go('moments');return{name,text};
  },
  socialWriteFailure:(fail:boolean)=>{
    const test=window as any;
    if(fail&&!test.restoreSocialWrite){const original=momentsRepo.create;test.restoreSocialWrite=()=>{momentsRepo.create=original;delete test.restoreSocialWrite;};momentsRepo.create=async()=>{throw Error('isolated fixture: moment write rejected');};}
    else if(!fail)test.restoreSocialWrite?.();
  },
  socialOwnRecords:()=>db.moments.where('userId').equals(owner).toArray(),
  seedSocialViewJob:async(revoked=false)=>{
    await (window as any).productUpgradeTest.seedSocialNotes();
    await db.moments.update('preview-social-note',{visibility:'selected',audienceCharacterIds:['a'],visibilityRevision:revoked?2:1});
    await db.momentJobs.put({id:'preview-social-view-job',userId:owner,momentId:'preview-social-note',characterId:'a',type:'view',status:'queued',visibilityRevision:1,attempts:0,availableAt:1,createdAt:fixedTime,updatedAt:fixedTime});
  },
  socialViewSnapshot:async()=>({job:await db.momentJobs.get('preview-social-view-job'),view:await db.momentViews.get('moment-view:preview-social-note:a')}),
  seedMutedSocialNote:async()=>{
    await (window as any).productUpgradeTest.seedSocialNotes();
    await db.moments.update('preview-social-note',{authorCharacterId:'a'});
    await db.momentContacts.put({id:`moment-contact:${owner}:a`,userId:owner,characterId:'a',muted:true,updatedAt:fixedTime});
  },
  quietSocialJobs:()=>{momentsRepo.processJobs=async()=>{};},
  holdSocialJobs:()=>{const original=momentsRepo.processJobs;let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});momentsRepo.processJobs=async()=>{await gate;};(window as any).__socialJobsRelease=()=>{momentsRepo.processJobs=original;release();};},
  releaseSocialJobs:()=>{(window as any).__socialJobsRelease?.();},
  controlNextSocialRead:(mode:'hold'|'fail')=>{
    const original=momentsRepo.list;
    const state={entered:false,release:()=>{}};
    momentsRepo.list=async(...args)=>{momentsRepo.list=original;state.entered=true;if(mode==='fail')throw Error('Controlled local social read failure');const gate=new Promise<void>(resolve=>{state.release=resolve;});const result=await original(...args);await gate;return result;};
    (window as any).__socialReadControl=state;
  },
  socialReadEntered:()=>Boolean((window as any).__socialReadControl?.entered),
  releaseSocialRead:()=>{(window as any).__socialReadControl?.release();},
  refreshSocialNotes:()=>window.dispatchEvent(new CustomEvent('virtugene:moments-updated',{detail:{userId:owner}})),
  editSocialNote:async(text:string)=>{await db.moments.update('preview-social-note',{text,updatedAt:Date.now()});window.dispatchEvent(new CustomEvent('virtugene:moments-updated',{detail:{userId:owner}}));},
  auditSocialReads:()=>{
    const original=momentsRepo.list,report={calls:0,rows:0};momentsRepo.list=async(...args)=>{report.calls++;const rows=await original(...args);report.rows+=rows.length;return rows;};(window as any).__socialReadAudit=report;
  },
  socialReadAudit:()=>({...((window as any).__socialReadAudit??{} )}),
  quietTodoReminders:()=>{todoRepo.rebuildReminders=async()=>{};},
  seedLifeTodos:async()=>{
    const day=localDateKey(),common={userId:owner,priority:'normal' as const,status:'todo' as const,recurrence:{kind:'none' as const},visibility:'private' as const,createdAt:fixedTime,updatedAt:fixedTime};
    await db.todos.bulkPut([{...common,id:'preview-life-today',title:'把读到的一页留给自己',dueDate:day},{...common,id:'preview-life-future',title:'下周去取那本书',dueDate:addLocalDays(day,5)}]);
  },
  seedTodoLayout:async()=>{
    (window as any).productUpgradeTest.quietTodoReminders();await (window as any).productUpgradeTest.seedLifeTodos();
    const title='沿着日常的小事，把值得认真安排的行动完整留下来。'.repeat(2)+' LuminousActionForTomorrow';
    await db.todos.update('preview-life-today',{title,note:'这里保留事项的原始备注。'.repeat(8)});await go('todo');return{id:'preview-life-today',title,date:localDateKey()};
  },
  todoWriteFailure:(fail:boolean)=>{
    const test=window as any;
    if(fail&&!test.restoreTodoWrite){const original=todoRepo.update;test.restoreTodoWrite=()=>{todoRepo.update=original;delete test.restoreTodoWrite;};todoRepo.update=async()=>{throw Error('隔离验证：暂时未能保存，输入仍在。');};}
    else if(!fail)test.restoreTodoWrite?.();
  },
  todoRecord:async(id:string,date:string)=>{const{occurrenceId}=await import('../../src/db/todo-repo');return{todo:await db.todos.get(id),occurrence:await db.todoOccurrences.get(occurrenceId(id,date))};},
  controlNextTodoRead:(mode:'hold'|'fail')=>{
    const original=db.transaction.bind(db);
    const state={entered:false,release:()=>{},restore:()=>{db.transaction=original as typeof db.transaction;}};
    (db as any).transaction=function(...args:any[]){
      if(args[0]==='r'&&args.includes(db.todos)&&args.includes(db.todoOccurrences)){
        state.entered=true;state.restore();
        if(mode==='fail')return Promise.reject(Error('Controlled local todo read failure'));
        const result=(original as any)(...args);
        const gate=new Promise<void>(resolve=>{state.release=resolve;});
        return Promise.all([result,gate]).then(([rows])=>rows);
      }
      return (original as any)(...args);
    };
    (window as any).__todoReadControl=state;
  },
  todoReadEntered:()=>Boolean((window as any).__todoReadControl?.entered),
  releaseTodoRead:()=>{const control=(window as any).__todoReadControl;control?.restore();control?.release();},
  failWorldLoadOnce:()=>{const original=worldRepo.ensureDefaultWorld;worldRepo.ensureDefaultWorld=async(...args)=>{worldRepo.ensureDefaultWorld=original;throw Error('Controlled local world read failure');};},
  editWorldNarration:(content:string)=>db.worldSceneEntries.update('preview-world-narration',{content}),
  editWorldEvent:(summary:string)=>db.worldEvents.update('preview-world-event',{summary}),
  removeWorldEvent:()=>db.worldEvents.delete('preview-world-event'),
  removeWorldScene:()=>db.worldScenes.delete('preview-world-scene'),
  removeWorldSource:async()=>{const scene=await db.worldScenes.get('preview-world-scene');if(scene){await worldRepo.clearWorld(scene.worldId);await db.worlds.delete(scene.worldId);}},
  seedWorldEvent:async()=>{const world=await worldRepo.ensureDefaultWorld(owner);await db.worldEvents.put({id:'preview-world-event',userId:owner,worldId:world.id,type:'stage',title:'雨后的站台',summary:'这是一条本地模拟世界记录。',participants:[`u:${owner}`,'c:a','c:b'],timestamp:fixedTime,importance:.3,sourceType:'stage',sourceId:'preview-world-scene',visibility:'world',resolved:false,relatedEventIds:[],memoryIds:[],tags:[],createdAt:fixedTime,updatedAt:fixedTime});},
  seedWorldMemories:async()=>{
    const world=await worldRepo.ensureDefaultWorld(owner);
    const common={userId:owner,worldId:world.id,importance:.5,visibility:'world' as const,relatedCharacters:['a','b'],relatedRelationships:[],tags:[]};
    await db.sharedMemories.bulkPut([
      {...common,id:'preview-world-memory-a',title:'雨后的站台',summary:'雨声停了，你们把没说完的话留在了站台。',participants:['c:a','c:b'],characterIds:['a','b'],sourceType:'story',sourceId:'preview-world-scene',createdAt:fixedTime+25800000,updatedAt:fixedTime+25800000},
      {...common,id:'preview-world-memory-b',title:'那本还没送出的书',summary:'说好了，下次见面把书带给你。',participants:['c:a',`u:${owner}`],characterIds:['a'],sourceType:'message',sourceId:'preview-memory-message',createdAt:fixedTime+17400000,updatedAt:fixedTime+17400000},
    ]);return world.id;
  },
  editWorldMemory:(summary:string)=>db.sharedMemories.update('preview-world-memory-a',{summary,updatedAt:Date.now()}),
  removeWorldMemory:()=>db.sharedMemories.delete('preview-world-memory-a'),
  seedMemoryOrigins:async()=>{
    await (window as any).productUpgradeTest.seedWorld();
    await (window as any).productUpgradeTest.seedWorldMemories();
    await db.worldSceneEntries.bulkPut(Array.from({length:12},(_,index)=>({id:'preview-memory-passage-'+index,sceneId:'preview-world-scene',index:index+1,act:1,kind:'narration' as const,content:index===11?'雨声慢慢停了，你们仍坐在站台边。':`站台上的这一刻 · ${index+1}`,createdAt:fixedTime+index,witnessedBy:['a','b']})));
    await db.sessions.put({id:'preview-memory-source-session',userId:owner,characterId:'a',title:'那本书',createdAt:fixedTime,updatedAt:fixedTime,unreadCount:0});
    await db.messages.put({id:'preview-memory-message',sessionId:'preview-memory-source-session',role:'user',content:'下次见面，我把那本书带给你。',revision:1,isProactive:false,createdAt:fixedTime});
  },
  editMemoryOrigin:(content:string)=>db.worldSceneEntries.update('preview-memory-passage-11',{content}),
  failNextMemoryDetail:()=>{const original=db.sharedMemories.get;let failed=false;(db.sharedMemories as any).get=function(...args:any[]){if(!failed){failed=true;db.sharedMemories.get=original;return Promise.reject(Error('Controlled selected record read failure'));}return original.apply(this,args as [string]);};},
  seedWorld: async (empty=false) => {
    const world=await worldRepo.ensureDefaultWorld(owner),id='preview-world-scene';
    await db.worlds.update(world.id,{clock:{worldAt:fixedTime,lastReconciledAt:Date.now(),pace:'realtime'}});
    await db.worldScenes.delete(id);await db.worldSceneEntries.where('sceneId').equals(id).delete();await db.continuityThreads.delete('preview-world-thread');
    if(!empty){
      const state=emptySceneState();state.participants=['a','b'].map(characterId=>({characterId,goals:[],knowsEventIds:[],secrets:[],enteredAt:fixedTime}));
      await db.worldScenes.put({id,userId:owner,worldId:world.id,title:'雨后的站台',place:'站台',timeLabel:'傍晚',mood:'平静',characterIds:['a','b'],status:'paused',state,startedAt:fixedTime,createdAt:fixedTime,updatedAt:fixedTime});
      await db.worldSceneEntries.put({id:'preview-world-narration',sceneId:id,index:0,kind:'narration',act:1,content:'雨声渐渐停了，你们的话还没有说完。',createdAt:fixedTime,witnessedBy:['a','b']});
      await db.continuityThreads.put({id:'preview-world-thread',userId:owner,characterId:'a',kind:'promise',title:'把那本书交给知微',status:'open',sourceSceneId:id,origin:'user',createdAt:fixedTime,updatedAt:fixedTime});
    }
    return{id,worldId:world.id,scope:'Synthetic local scene, no model request; clock reset only to prevent automatic fixture pulse.'};
  },
  seedWorldReading:async()=>{
    const source=await (window as any).productUpgradeTest.seedWorld();
    await db.worldSceneEntries.bulkPut([
      {id:'preview-reading-zhiwei',sceneId:source.id,index:1,act:1,kind:'dialogue',speakerId:'a',content:'雨停了。',createdAt:fixedTime+1,witnessedBy:['a','b']},
      {id:'preview-reading-chengyan',sceneId:source.id,index:2,act:1,kind:'dialogue',speakerId:'b',content:'但有些话，或许才刚刚开始。',createdAt:fixedTime+2,witnessedBy:['a','b']},
      {id:'preview-reading-user',sceneId:source.id,index:3,act:1,kind:'user_input',content:'我想再等一会儿。',createdAt:fixedTime+3,witnessedBy:['a','b']},
      {id:'preview-reading-suggestion',sceneId:source.id,index:4,act:1,kind:'suggestion',content:JSON.stringify({options:['要不要沿着站台走走？']}),createdAt:fixedTime+4,witnessedBy:['a','b']},
    ]);
    return source;
  },
  enableWorldReadingSuggestions:()=>db.worldSceneEntries.update('preview-reading-suggestion',{meta:{options:['要不要沿着站台走走？']}}),
  worldReadingScene:()=>db.worldScenes.get('preview-world-scene'),
  setWorldReadingAvatar:async(color:string)=>{
    await ensureChatBackground(owner);const rows=readBackgroundRows(owner,'a');const config=rows.override??rows.global.config;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const paint=canvas.getContext('2d')!;paint.fillStyle=color;paint.fillRect(0,0,32,32);const image=canvas.toDataURL('image/jpeg');
    const row=await chatBackgroundRepo.save(owner,'a',{...config,roleVisual:{...config.roleVisual,avatar:{source:image,image,x:0,y:0,zoom:1}}},rows.roleRow?.revision??0,rows.global.strategy);publishBackground(row);return image;
  },
  dropWorldReadingAppearanceCache:()=>useChatBackgroundStore.setState({rows:{},ready:{},errors:{}}),
  setup, go, openChat, theme: (mode: 'dark' | 'light') => useThemeStore.getState().setTheme(mode),
  reduced: (enabled: boolean) => useSettingsStore.setState({ reduceMotion: enabled }),
  previewAiConfigured:(enabled:boolean)=>useAuthStore.setState({apiKey:enabled?'preview-not-a-real-key':undefined}),
  previewDefaultModel:(model:{provider:string;model:string}|null)=>useSettingsStore.getState().setDefaultModel(model),
  preferencesSnapshot:()=>({themePreference:useThemeStore.getState().preference,ttsEnabled:useSettingsStore.getState().ttsEnabled,chatFontSize:useSettingsStore.getState().chatFontSize,reduceMotion:useSettingsStore.getState().reduceMotion}),
  seedPersonalState:()=>db.characterStates.put({characterId:'a',userId:owner,affinity:0,mood:70,milestones:[],updatedAt:Date.now()}),
  seedPersonalPrivateReview:()=>db.memories.put({id:'private-personal-review',userId:owner,characterId:'a',type:'auto',content:'仅旧账号可见的回顾内容',createdAt:Date.now()}),
  personalLayoutIdentity:(name:string)=>{useAuthStore.setState({username:name});useThemeStore.getState().setTheme('system');},
  previewPersonalOwner:()=>useAuthStore.setState({userId:'another-personal-owner',username:'另一个账号',avatar:''}),
  seedPersonalCountStock:async()=>{await db.characterStates.bulkPut(Array.from({length:9000},(_,i)=>({characterId:'unrelated-count-role-'+i,userId:i%2?owner:'other-owner',affinity:0,mood:70,milestones:[],lifeEvents:[{id:'synthetic-life-'+i,type:'memory' as const,title:'synthetic unrelated record',detail:'x'.repeat(1000),createdAt:1}],updatedAt:1})));await db.characterStates.put({characterId:'a',userId:owner,affinity:0,mood:70,milestones:[],updatedAt:1});},
  startPersonalCountAudit:()=>{const core=(db.characterStates as any).core,report={bodies:0,keys:0};const restore:(()=>void)[]=[];for(const method of ['query','openCursor','get','getMany']){const original=core[method];core[method]=async function(request:any){const result=await original.call(this,request);if(method==='get')report.bodies+=result?1:0;else if(method==='getMany')report.bodies+=result.filter(Boolean).length;else if(method==='query'){if(request.values)report.bodies+=result.result.length;else report.keys+=result.result.length;}else if(result){const start=result.start;result.start=function(callback:any){return start.call(this,()=>{if(request.values)report.bodies++;else report.keys++;callback();});};}return result;};restore.push(()=>core[method]=original);}(window as any).__personalCountAudit={report,stop:()=>restore.forEach(f=>f())};},
  stopPersonalCountAudit:()=>{const audit=(window as any).__personalCountAudit;audit.stop();return{...audit.report};},
  addForeignPersonalRole:()=>useChatStore.setState(s=>({characters:[...s.characters,{...s.characters[0],id:'foreign-personal-role',createdBy:'other-owner',name:'Other account role'}]})),
  mockPersonalUpdates:(mode:string)=>{
    const existing=(window as any).__personalUpdates;if(existing){existing.mode=mode;return;}
    const state={mode,calls:0,aborts:0,heads:0,nativeConfirm:0,opened:[] as string[]};(window as any).__personalUpdates=state;const original=window.fetch;
    window.confirm=()=>{state.nativeConfirm++;return false;};window.open=((url:unknown)=>{state.opened.push(String(url));return null;}) as typeof window.open;
    window.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);if(init?.method==='HEAD'&&url.includes('virtugene-fixture')){state.heads++;return new Response(null,{status:200});}
      if(url!==GITHUB_API)return original(input,init);state.calls++;
      if(state.mode==='pending')return new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>{state.aborts++;reject(new DOMException('Cancelled','AbortError'));},{once:true});});
      if(state.mode==='error')return new Response(null,{status:503});
      return new Response(JSON.stringify({tag_name:state.mode==='latest'?'v0.0.0':'v99.0.0',body:'本地模拟更新说明。',assets:[{name:'fixture.apk',browser_download_url:'https://example.invalid/virtugene-fixture/fixture.apk'}]}),{status:200});
    }) as typeof window.fetch;
  },
  personalUpdateSnapshot:()=>{const s=(window as any).__personalUpdates;return s&&{calls:s.calls,aborts:s.aborts,heads:s.heads,nativeConfirm:s.nativeConfirm,opened:[...s.opened]};},
  openInboxReadFixture: async (embedded = true, hub = false, fail = true) => {
    const character = {...(await db.characters.get('a'))!, name:hub?'这是一个用于窄屏核验的助理名字':'知微', agentProfile:'secretary' as const, isPreset:false};
    await db.characters.put(character);
    await db.messages.put({id:'preview-inbox-source',sessionId:'a',role:'user',content:'核对明天的安排',createdAt:fixedTime,isProactive:false});
    await db.secretaryTasks.put({id:'preview-inbox-task',userId:owner,characterId:'a',sessionId:'a',messageId:'preview-inbox-source',request:'核对明天的安排',privacyScope:'plain',status:'failed',results:[],createdAt:fixedTime,updatedAt:fixedTime});
    const core=(db.secretaryTasks as any).core;
    const state={fail,calls:0};
    for(const method of ['query','openCursor']){const original=core[method];core[method]=async function(request:any){state.calls++;if(state.fail)throw new Error('Controlled inbox read failure');return original.call(this,request);};}
    (window as any).__inboxReadFixture=state;
    if(hub){useChatStore.setState(s=>({characters:s.characters.map(c=>c.id===character.id?character:c)}));useUIStore.setState({assistantTab:'pending'});await go('assistant');}
    else root!.render(<InboxReadFixture character={character} embedded={embedded} />);
  },
  allowInboxRead:()=>{(window as any).__inboxReadFixture.fail=false;},
  closeInboxReadFixture:()=>{(window as any).__setInboxFixtureOpen(false);},
  revokeAndReopenInbox:async()=>{await db.messages.delete('preview-inbox-source');(window as any).__inboxReadFixture.fail=true;(window as any).__inboxRenderSamples=[];(window as any).__setInboxFixtureOpen(true);},
  openAuthFixture:()=>{useAuthStore.getState().logout();root!.render(<AuthEntryFixture />);},
  authFixtureUser:async()=>{const id=useAuthStore.getState().userId;const user=id?await db.users.get(id):undefined;return {loggedIn:useAuthStore.getState().isLoggedIn,username:user?.username,hasHash:!!user?.passwordHash,hasSalt:!!user?.passwordSalt,adultConfirmed:!!user?.adultConfirmedAt};},
  holdAuthFixtureRead:()=>{const original=userRepo.findByUsername;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const state={calls:0,release:()=>{userRepo.findByUsername=original;release();}};userRepo.findByUsername=async name=>{state.calls++;await gate;return original.call(userRepo,name);};(window as any).__authRead=state;},
  releaseAuthFixtureRead:()=>{(window as any).__authRead.release();},
  rename: async (id: string, name: string) => { await db.characters.update(id, { name }); useChatStore.setState(state => ({ characters: state.characters.map(c => c.id === id ? { ...c, name } : c) })); },
  seedMany: async (count = 30) => {
    const base = (await db.characters.get('a'))!;
    await db.characters.bulkPut(Array.from({ length: count }, (_, i) => ({ ...base, id: `extra-${i}`, name: `预览角色${String(i + 1).padStart(2, '0')}`, sourcePresetId: undefined, tags: ['预览数据'], signature: '用于验证长列表位置恢复的隔离角色', createdBy: owner, createdAt: fixedTime - 86400000 * 30 - i })));
    await useChatStore.getState().loadCharacters();
  },
  account: async (next: string) => {
    closeMockCall(); showProfile(undefined);
    if (next !== firstOwner && !(await db.characters.get('other-role'))) {
      const base = (await db.characters.get('a'))!;
      await db.characters.put({ ...base, id: 'other-role', createdBy: next, name: '另一个账号的角色' });
      await db.sessions.put({ id: 'other-session', characterId: 'other-role', userId: next, title: '隔离账号对话', createdAt: fixedTime, updatedAt: fixedTime, modelAsked: true });
      await db.messages.put({ id: 'other-message', sessionId: 'other-session', role: 'assistant', content: '这是另一个模拟账号的独立记录。', createdAt: fixedTime, isProactive: false });
    }
    owner = next; useAuthStore.getState().login(next, '隔离模拟账号', 'sk-fake', '');
    useUIStore.setState({ activeView: 'chat', mobileTab: 'chat', chatFromList: false, chatFromCharacters: false });
    await useChatStore.getState().loadCharacters();
  },
  snapshot: () => ({ owner: useAuthStore.getState().userId, selectedCharacterId: useChatStore.getState().selectedCharacterId, sessionId: useChatStore.getState().currentSessionId, characters: useChatStore.getState().characters.map(c => ({ id: c.id, name: c.name })), navigation: useUIStore.getState(), call: { target: useVoiceCallUIStore.getState().target && { characterId: useVoiceCallUIStore.getState().target!.character.id, sessionId: useVoiceCallUIStore.getState().target!.sessionId, userId: useVoiceCallUIStore.getState().target!.userId }, phase: useVoiceCallStore.getState().view?.phase, busy: useVoiceCallStore.getState().busy }, isolation: { ...guard, fixtureRejectedNetwork: fixture.extraNetwork(), simulatedReplyRequests: fixture.requests().length } }),
};
void setup().then(async data => {
  (window as any).productUpgradeFixture = data;
  const requested = new URLSearchParams(location.search).get('page');
  if (requested === 'todo') await (window as any).productUpgradeTest.seedLifeTodos();
  if (requested === 'moments') await (window as any).productUpgradeTest.seedSocialNotes();
  if (requested === 'assistant') { await (window as any).productUpgradeTest.openInboxReadFixture(true,true,false); useUIStore.setState({assistantTab:'today'}); }
  if (requested === 'auth') (window as any).productUpgradeTest.openAuthFixture();
  else if (requested) await go(requested);
  (window as any).productUpgradeReady = true;
}).catch(error => { document.getElementById('app')!.textContent = `本地预览未启动：${error.message}`; console.error(error); });
