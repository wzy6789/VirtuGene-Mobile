import React from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Character } from '../../src/db';
import { VoiceCallDialog } from '../../src/components/chat/VoiceCallDialog';
import { VoiceCallHost } from '../../src/components/chat/VoiceCallHost';
import { useVoiceCallUIStore } from '../../src/store/voice-call-ui-store';
import { useAuthStore } from '../../src/store/auth-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { soulOrbMotionActivity, orbFrameBudgetState } from '../../src/lib/soul-orb-motion';
import { useSettingsStore } from '../../src/store/settings-store';
import { ensureChatBackground,readBackgroundRows,publishBackground } from '../../src/store/chat-background-store';
import { chatBackgroundRepo } from '../../src/db/chat-background-repo';
import type { OrbColor } from '../../src/lib/orb-colors';
import type { OrbMotionIntensity } from '../../src/lib/orb-vitality';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { voiceProfileRepo } from '../../src/db/voice-profile-repo';
import { voiceCallRepo } from '../../src/db/voice-call-repo';
import type { CallInputMode } from '../../src/lib/voice-call/input';
installUiPreferences();
const root = createRoot(document.getElementById('root')!);
let presentationCommits = 0;
const role: Character = { id: 'ui-call-role', name: '晓来', avatar: '🌙', createdBy: 'ui-call-user', createdAt: 1, isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '' };
async function open() {
  await db.open(); useAuthStore.setState({ userId: role.createdBy });
  await db.characters.put(role); await db.sessions.put({ id: 'ui-call-session', characterId: role.id, userId: role.createdBy, title: role.name, createdAt: 1, updatedAt: 1, unreadCount: 0 });
  root.render(<React.Profiler id="call-presentation" onRender={() => presentationCommits++}><VoiceCallDialog character={role} userId={role.createdBy} sessionId="ui-call-session" onClose={() => root.render(null)}/></React.Profiler>);
}
function playing() {
  // Presentation-only fixture; no synthetic audio or real API is reported as a successful call.
  useVoiceCallStore.setState({ owner: { userId: role.createdBy, characterId: role.id, sessionId: 'ui-call-session' }, busy: true,
    view: { phase: 'playing', userText: '今天有点累，想和你说说话。', generatedText: '（内部动作，不应显示）', heardText: '', speakingText: '那就慢慢说，我在听。', level: .4, muted: false,
      capabilities: { sampleRate: 16000, echoCancellation: false, noiseSuppression: true, routes: [{ id: 2, type: 2, label: '扬声器', selected: true }] } } });
}
async function historyFixture(active = false) {
  const startedAt = new Date(2026, 9, 12, 12, 0).getTime();
  await voiceCallRepo.save({ id: active ? 'history-active' : 'history-fixture', status: active ? 'active' : 'ended', userId: role.createdBy, characterId: role.id, sessionId: 'ui-call-session', startedAt, endedAt: startedAt + 120000, voice: '茉莉', summaryState: 'pending', messageIds: [], exchanges: [{
    turnId: 'history-turn', userText: '想听你说说话。', generatedText: '已经播完。未播放的秘密。', heardText: '不可信字幕', interrupted: true,
    segments: [{ id: 'history-spoken', turnId: 'history-turn', text: '已经播完。', generatedAt: 1, playedAt: 2, playedFrames: 12, interrupted: false }], metrics: { turnId: 'history-turn', stoppedAt: 1 },
  }, {
    turnId: 'history-presence', origin: 'presence-check', userText: '', generatedText: '还在吗？我在。未播放的关怀。', heardText: '', interrupted: true,
    segments: [{ id: 'history-presence-spoken', turnId: 'history-presence', text: '还在吗？我在。', generatedAt: 1, playedAt: 2, playedFrames: 12, interrupted: false }], metrics: { turnId: 'history-presence', stoppedAt: 1 },
  }, {
    turnId: 'history-presence-unplayed', origin: 'presence-check', userText: '', generatedText: '不该显示的未播放确认。', heardText: '', interrupted: true,
    segments: [], metrics: { turnId: 'history-presence-unplayed', stoppedAt: 1 },
  }] });
}
function deferredStart() {
  const originalSet = voiceProfileRepo.set, originalStart = useVoiceCallStore.getState().start;
  let release!: () => void, saves = 0, starts = 0;
  voiceProfileRepo.set = async (...args) => { saves++; await new Promise<void>(resolve => { release = resolve; }); return originalSet(...args); };
  useVoiceCallStore.setState({ start: async () => { starts++; } });
  (window as any).deferredCall = { result: () => ({ saves, starts }), finish: async () => {
    release(); await new Promise(resolve => setTimeout(resolve, 20));
    voiceProfileRepo.set = originalSet; useVoiceCallStore.setState({ start: originalStart });
    return { saves, starts };
  } };
}
let hostedEnds = 0;
async function typed() {
  await open();
  const methods = useVoiceCallStore.getState();
  let resolveSend: ((accepted: boolean) => void) | undefined, rejectSend: ((error: Error) => void) | undefined;
  let modeFailure = false;
  let deferNextMode = false, pauseNextMode = false;
  const heldModes: (() => void)[] = [];
  const sent: string[] = [], modes: string[] = [], starts: string[] = [];
  let ends = 0, routeRequest = 0;
  useVoiceCallStore.setState({ busy: false, saving: false, owner: undefined, view: undefined, record: undefined, error: undefined, finishing: undefined,
    start: async (owner, _adapters, inputMode: CallInputMode = 'voice') => {
      starts.push(inputMode);
      useVoiceCallStore.setState({ owner, busy: true, record: { ...owner, id: `typed-ui-${starts.length}`, startedAt: Date.now(), endedAt: Date.now(), voice: '茉莉', status: 'active', exchanges: [], messageIds: [], summaryState: 'pending' }, view: { phase: 'listening', inputMode, muted: false, userText: '', generatedText: '', heardText: '', level: 0,
        capabilities: { sampleRate: 16000, echoCancellation: false, noiseSuppression: false, routes: [{id:2,type:2,label:'扬声器',selected:true},{id:1,type:1,label:'听筒',selected:false}] } } });
    },
    setInputMode: async inputMode => {
      modes.push(inputMode);
      if (modeFailure) throw new Error('voice:microphone_denied');
      // Presentation fixtures for legitimate no-op controller completions:
      // pause during stop, or an old call ending before its mode action returns.
      if (deferNextMode) { deferNextMode = false; await new Promise<void>(resolve => heldModes.push(resolve)); return; }
      const view = useVoiceCallStore.getState().view!;
      if (pauseNextMode) { pauseNextMode = false; useVoiceCallStore.setState({ view: { ...view, phase: 'paused', error: 'voice:background' } }); return; }
      useVoiceCallStore.setState({ view: { ...view, inputMode, phase: view.capabilities ? 'listening' : view.phase } });
    },
    sendText: text => { sent.push(text); return new Promise<boolean>((resolve, reject) => { resolveSend = resolve; rejectSend = reject; }); },
    resume: async () => { const view=useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view,phase:'listening',error:undefined}}); },
    interrupt: async () => { const view=useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view,phase:'listening',speakingText:undefined}}); },
    mute: async () => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view,muted:!view.muted}}); },
    routes: async () => {},
    route: async deviceId => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view,phase:'paused',routing:true,routeWait:{requestId:++routeRequest,deviceId,requestedType:deviceId,startedAt:Date.now(),stage:'waiting'}}}); },
    cancelRouteWait: async () => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view,phase:'paused',routing:false,routeWait:undefined,error:'voice:route_cancelled'}}); },
    end: async () => { ends++; useVoiceCallStore.setState({busy:false, view:{...useVoiceCallStore.getState().view!,phase:'ended'}}); },
  });
  useVoiceCallUIStore.getState().open({ character: role, userId: role.createdBy, sessionId: 'ui-call-session' });
  root.render(<VoiceCallHost/>);
  (window as any).typedCallUi = {
    sent: () => sent, modes: () => modes, starts: () => starts,
    ends: () => ends,
    snapshot: () => { const current=useVoiceCallStore.getState();return {owner:current.owner,recordId:current.record?.id,busy:current.busy,phase:current.view?.phase,inputMode:current.view?.inputMode,muted:current.view?.muted,routing:current.view?.routing,routeWait:current.view?.routeWait,routes:current.view?.capabilities?.routes,auth:useAuthStore.getState().userId,minimized:useVoiceCallUIStore.getState().minimized}; },
    confirmRoute: () => { const view=useVoiceCallStore.getState().view!,device=view.routeWait?.deviceId;useVoiceCallStore.setState({view:{...view,routing:false,routeWait:undefined,phase:'paused',capabilities:view.capabilities?{...view.capabilities,routes:view.capabilities.routes.map(route=>({...route,selected:route.id===device}))}:undefined}}); },
    completedCaptions: () => { const current=useVoiceCallStore.getState();if(current.record)useVoiceCallStore.setState({record:{...current.record,exchanges:Array.from({length:16},(_,index)=>({turnId:`typed-complete-${index}`,userText:`第${index+1}段已经说完的话。`,generatedText:'未播放的内部草稿',heardText:'',interrupted:false,segments:[{id:`typed-segment-${index}`,turnId:`typed-complete-${index}`,text:`第${index+1}段已经完整播放的回应。`,generatedAt:1,playedAt:2,playedFrames:12,interrupted:false}],metrics:{turnId:`typed-complete-${index}`,stoppedAt:1}}))}}); },
    foreignEndAttempt: () => { const button=document.querySelector<HTMLButtonElement>('.vg-voice-call-capsule-end'),current=useVoiceCallStore.getState();useVoiceCallStore.setState({owner:current.owner?{...current.owner,userId:'ui-call-foreign-user'}:undefined,record:current.record?{...current.record,userId:'ui-call-foreign-user'}:undefined});button?.click(); },
    complete: (accepted: boolean) => { resolveSend?.(accepted); resolveSend=undefined; rejectSend=undefined; },
    fail: () => { rejectSend?.(new Error('voice:audio_release_failed')); resolveSend=undefined; rejectSend=undefined; },
    modeFailure: (value: boolean) => { modeFailure=value; },
    deferMode: () => { deferNextMode = true; },
    heldModeCount: () => heldModes.length,
    releaseMode: () => { heldModes.shift()?.(); },
    pauseDuringMode: () => { pauseNextMode = true; },
    switchOwner: async () => {
      const other = { ...role, id: 'typed-ui-other-role', name: '另一位角色', createdBy: 'typed-ui-other-user' }, sessionId = 'typed-ui-other-session';
      await db.characters.put(other); await db.sessions.put({ id: sessionId, characterId: other.id, userId: other.createdBy, title: other.name, createdAt: 1, updatedAt: 1, unreadCount: 0 });
      useAuthStore.setState({ userId: other.createdBy });
      useVoiceCallStore.setState({ busy:false, owner:undefined, view:undefined, record:undefined, error:undefined });
      useVoiceCallUIStore.getState().open({ character:other, userId:other.createdBy, sessionId });
    },
    startupDenied: () => { const view=useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view,phase:'error',inputMode:'voice',capabilities:undefined,error:'voice:microphone_denied'}}); },
    phase: (phase: NonNullable<ReturnType<typeof useVoiceCallStore.getState>['view']>['phase']) => { const view=useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view,phase,error:phase==='error'?'voice:network':phase==='paused'?'voice:background':undefined}}); },
    cleanup: () => { useVoiceCallUIStore.getState().close(); useVoiceCallStore.setState({ busy:false, owner:undefined,view:undefined,record:undefined,
      start:methods.start,setInputMode:methods.setInputMode,sendText:methods.sendText,resume:methods.resume,interrupt:methods.interrupt,end:methods.end,mute:methods.mute,routes:methods.routes,route:methods.route,cancelRouteWait:methods.cancelRouteWait }); root.render(null); },
  };
}
function deferredAction(key: 'mute' | 'resume') {
  const original = useVoiceCallStore.getState()[key];
  let resolve!: () => void, reject!: (reason: unknown) => void, calls = 0;
  useVoiceCallStore.setState({ [key]: () => { calls++; return new Promise<void>((ok, fail) => { resolve=ok; reject=fail; }); } });
  (window as any).pendingCallAction = {
    calls: () => calls,
    finish: async (failed: boolean | 'native' | 'untrusted' = false) => {
      if (failed === 'native') reject({ message: 'voice:microphone_denied' });
      else if (failed === 'untrusted') reject({ message: 'voice:microphone_denied\nUNTRUSTED_BRIDGE_TEXT' });
      else if (failed) reject(new Error('voice:network'));
      else { resolve(); const view=useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view, phase:'listening',error:undefined,muted:key==='mute' ? !view.muted : view.muted}}); }
      await new Promise(ok => setTimeout(ok, 20));
      useVoiceCallStore.setState({[key]:original});
    },
  };
}
async function hosted() {
  await db.open(); useAuthStore.setState({ userId: role.createdBy });
  await db.characters.put(role);
  const originalEnd = useVoiceCallStore.getState().end;
  hostedEnds = 0;
  useVoiceCallStore.setState({ end: async () => { hostedEnds++; useVoiceCallStore.setState({ busy: false, view: { ...useVoiceCallStore.getState().view!, phase: 'ended' } }); } });
  playing();
  useVoiceCallStore.setState({ record: { id: 'host-ui-call', userId: role.createdBy, characterId: role.id, sessionId: 'ui-call-session', startedAt: Date.now() - 65000, endedAt: Date.now(), voice: '茉莉', exchanges: [], messageIds: [], summaryState: 'pending' } });
  useVoiceCallUIStore.getState().open({ character: role, userId: role.createdBy, sessionId: 'ui-call-session' });
  root.render(<><div id="page-content">聊天页面</div><VoiceCallHost /></>);
  (window as any).hostedCall = { ends: () => hostedEnds,
    navigate: () => root.render(<><div id="page-content">世界页面</div><VoiceCallHost /></>),
    cleanup: () => { useVoiceCallUIStore.getState().close(); useVoiceCallStore.setState({ end: originalEnd, busy: false, owner: undefined, view: undefined, record: undefined }); root.render(null); } };
}
(window as any).callUiTest = { open, playing, historyFixture, deferredStart, typed,
  commits: () => presentationCommits,
  motion: soulOrbMotionActivity,
  budget: orbFrameBudgetState,
  roleVisual:async(color:OrbColor|null,intensity:OrbMotionIntensity='lively')=>{await ensureChatBackground(role.createdBy);const rows=readBackgroundRows(role.createdBy,role.id);const config=rows.override??rows.global.config;const row=await chatBackgroundRepo.save(role.createdBy,role.id,{...config,roleVisual:{orbMotion:intensity,...(color?{orbColor:color}:{})}},rows.roleRow?.revision??0,rows.global.strategy);publishBackground(row);},
  globalOrbColor:(orbColor:OrbColor)=>useSettingsStore.setState({orbColor}),
  reduceMotion: (value:boolean) => useSettingsStore.getState().setReduceMotion(value),
  captionText: (text:string) => {const view=useVoiceCallStore.getState().view!;useVoiceCallStore.setState({view:{...view,userText:text,speakingText:text,heardText:''}});},
  noisyCapture: () => { for (let index=0;index<40;index++) { const view=useVoiceCallStore.getState().view!; useVoiceCallStore.setState({view:{...view,level:index/40,generatedText:`未播放内部文本${index}`}}); } },
  deferredAction,
  hosted,
  chatBlocked: () => useVoiceCallUIStore.getState().blocksChat,
  foreignPreparation: () => {
    useVoiceCallUIStore.getState().close();
    useVoiceCallStore.setState({ busy:false, view:{...useVoiceCallStore.getState().view!, phase:'error', error:'voice:network'},
      record:{...useVoiceCallStore.getState().record!, startedAt:Date.now()-600000, endedAt:Date.now(), status:'ended'} });
    useVoiceCallUIStore.getState().open({character:{...role,id:'other-ui-role',name:'另一个角色'},userId:role.createdBy,sessionId:'other-ui-session'});
    useVoiceCallUIStore.getState().minimize();
  },
  restartClock: () => {
    useVoiceCallStore.setState({busy:true,error:undefined,view:{...useVoiceCallStore.getState().view!,phase:'connecting',error:undefined},
      record:{...useVoiceCallStore.getState().record!,id:'restarted-call',startedAt:Date.now(),endedAt:Date.now(),status:'active'} });
  },
  problem: (error: string, errorStage?: 'asr' | 'dialogue' | 'tts', errorHttpStatus?: number) => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ busy: true, saving: false, finishing: undefined, error: undefined, view: { ...view, phase: 'error', error, errorStage, errorHttpStatus } }); },
  finishing: (stage?: 'saving' | 'summary' | 'memory') => { const current = useVoiceCallStore.getState(); useVoiceCallStore.setState({ busy: false, saving: !!stage, finishing: stage, error: undefined, view: { ...current.view!, phase: 'ended' }, record: { ...current.record!, status: stage === 'saving' ? 'active' : 'ended', exchanges: [{ turnId: 'ui-progress', userText: '今天想聊聊', generatedText: '', heardText: '', interrupted: false, segments: [], metrics: { turnId: 'ui-progress', stoppedAt: 1 } }] } }); },
  state: (phase: 'listening' | 'paused', muted = false) => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ error: undefined, view: { ...view, phase, muted, error: phase === 'paused' ? 'voice:background' : undefined } }); },
  routing: (routing: boolean) => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ view: { ...view, routing } }); },
  sourceWithdrawn: () => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ view: { ...view, phase: 'error', error: 'voice:source_withdrawn' } }); },
  emptyReply: () => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ view: { ...view, phase: 'error', error: 'voice:reply_empty' } }); },
  profile: () => voiceProfileRepo.getOrCreate(role.id, role.createdBy) };
