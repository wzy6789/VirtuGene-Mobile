import React from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Character } from '../../src/db';
import { VoiceCallDialog } from '../../src/components/chat/VoiceCallDialog';
import { VoiceCallHost } from '../../src/components/chat/VoiceCallHost';
import { useVoiceCallUIStore } from '../../src/store/voice-call-ui-store';
import { useAuthStore } from '../../src/store/auth-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { voiceProfileRepo } from '../../src/db/voice-profile-repo';
import { voiceCallRepo } from '../../src/db/voice-call-repo';
const root = createRoot(document.getElementById('root')!);
const role: Character = { id: 'ui-call-role', name: '晓来', avatar: '🌙', createdBy: 'ui-call-user', createdAt: 1, isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '' };
async function open() {
  await db.open(); useAuthStore.setState({ userId: role.createdBy });
  await db.characters.put(role); await db.sessions.put({ id: 'ui-call-session', characterId: role.id, userId: role.createdBy, title: role.name, createdAt: 1, updatedAt: 1, unreadCount: 0 });
  root.render(<VoiceCallDialog character={role} userId={role.createdBy} sessionId="ui-call-session" onClose={() => root.render(null)}/>);
}
function playing() {
  // Presentation-only fixture; no synthetic audio or real API is reported as a successful call.
  useVoiceCallStore.setState({ owner: { userId: role.createdBy, characterId: role.id, sessionId: 'ui-call-session' }, busy: true,
    view: { phase: 'playing', userText: '今天有点累，想和你说说话。', generatedText: '（内部动作，不应显示）', heardText: '', speakingText: '那就慢慢说，我在听。', level: .4, muted: false,
      capabilities: { sampleRate: 16000, echoCancellation: false, noiseSuppression: true, routes: [{ id: 2, type: 2, label: '扬声器', selected: true }] } } });
}
async function historyFixture() {
  const startedAt = new Date(2026, 9, 12, 12, 0).getTime();
  await voiceCallRepo.save({ id: 'history-fixture', userId: role.createdBy, characterId: role.id, sessionId: 'ui-call-session', startedAt, endedAt: startedAt + 120000, voice: '茉莉', summaryState: 'pending', messageIds: [], exchanges: [{
    turnId: 'history-turn', userText: '想听你说说话。', generatedText: '已经播完。未播放的秘密。', heardText: '不可信字幕', interrupted: true,
    segments: [{ id: 'history-spoken', turnId: 'history-turn', text: '已经播完。', generatedAt: 1, playedAt: 2, playedFrames: 12, interrupted: false }], metrics: { turnId: 'history-turn', stoppedAt: 1 },
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
(window as any).callUiTest = { open, playing, historyFixture, deferredStart,
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
  problem: (error: string) => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ busy: true, saving: false, finishing: undefined, error: undefined, view: { ...view, phase: 'error', error } }); },
  finishing: (stage?: 'saving' | 'summary' | 'memory') => { const current = useVoiceCallStore.getState(); useVoiceCallStore.setState({ busy: false, saving: !!stage, finishing: stage, error: undefined, view: { ...current.view!, phase: 'ended' }, record: { ...current.record!, status: stage === 'saving' ? 'active' : 'ended', exchanges: [{ turnId: 'ui-progress', userText: '今天想聊聊', generatedText: '', heardText: '', interrupted: false, segments: [], metrics: { turnId: 'ui-progress', stoppedAt: 1 } }] } }); },
  state: (phase: 'listening' | 'paused', muted = false) => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ error: undefined, view: { ...view, phase, muted, error: phase === 'paused' ? 'voice:background' : undefined } }); },
  routing: (routing: boolean) => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ view: { ...view, routing } }); },
  sourceWithdrawn: () => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ view: { ...view, phase: 'error', error: 'voice:source_withdrawn' } }); },
  emptyReply: () => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ view: { ...view, phase: 'error', error: 'voice:reply_empty' } }); },
  profile: () => voiceProfileRepo.getOrCreate(role.id, role.createdBy) };
