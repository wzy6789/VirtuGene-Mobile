import React, { Profiler, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatWindow } from '../../src/components/chat/ChatWindow';
import { VoiceCallHost } from '../../src/components/chat/VoiceCallHost';
import { db, type Character } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { useVoiceCallUIStore } from '../../src/store/voice-call-ui-store';
import { persistSecret } from '../../src/lib/api-key-storage';
import { messageRepo } from '../../src/db/message-repo';

const root = createRoot(document.getElementById('root')!);
const userId = 'voice-chat-ui-user', sessionId = 'voice-chat-ui-session';
const character: Character = { id: 'voice-chat-ui-role', name: '星澜与长名字的聊天同行者', avatar: '🌙', createdBy: userId, createdAt: 1, isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '隔离界面角色', voice: { voice: 'zh-CN-XiaoxiaoNeural', band: 'female-soft', rate: '+0%', pitch: '+0Hz' } };
const other = { ...character, id: 'voice-chat-other-role', name: '另一位角色' }, otherSession = 'voice-chat-other-session';
let commits = 0, resumeCalls = 0;
const owner = { userId, characterId: character.id, sessionId };

async function setup() {
  await db.open();
  useAuthStore.setState({ userId, username: '隔离验收', isLoggedIn: true, apiKey: null });
  await db.characters.bulkPut([character, other]);
  await db.sessions.bulkPut([character, other].map(role => ({ id: role.id === character.id ? sessionId : otherSession, characterId: role.id, userId, title: role.name, createdAt: 1, updatedAt: 1, unreadCount: 0, modelAsked: true })));
  const audit = { userId, characterId: character.id, sessionId, startedAt: 1, endedAt: 2, voice: '茉莉' as const, exchanges: [], messageIds: [], status: 'ended' as const, summaryState: 'ready' as const };
  await db.voiceCalls.bulkPut([{ ...audit, id: 'matching-history', summary: '本会话交流原文' }, { ...audit, id: 'foreign-session-history', sessionId: otherSession, summary: '其他会话的私有交流' }, { ...audit, id: 'foreign-account-history', userId: 'foreign-user', summary: '其他账号的私有交流' }]);
  useChatStore.setState({ selectedCharacterId: character.id, currentSessionId: sessionId, characters: [character, other], messages: [], hasMoreMessages: false });
  root.render(<div className="mobile-layout" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}><Suspense fallback={<p>正在打开聊天…</p>}><Profiler id="chat" onRender={() => commits++}><ChatWindow /></Profiler><VoiceCallHost /></Suspense></div>);
}

function callFixture(foreign = false, phase = 'listening') {
  const role = foreign ? other : character, callSession = foreign ? otherSession : sessionId;
  useVoiceCallStore.setState({ owner: { userId, characterId: role.id, sessionId: callSession }, busy: true, saving: false, finishing: undefined, error: undefined,
    resume: async () => { resumeCalls++; },
    record: { id: 'voice-chat-fixture-call', userId, characterId: role.id, sessionId: callSession, startedAt: Date.now(), endedAt: Date.now(), voice: '茉莉', exchanges: [], messageIds: [], summaryState: 'pending', status: 'active' },
    view: { phase: phase as any, inputMode: 'voice', muted: false, userText: '', generatedText: '', heardText: '', level: 0 } });
  useVoiceCallUIStore.getState().open({ character: role, userId, sessionId: callSession });
  useVoiceCallUIStore.getState().minimize();
}

function resetCall() {
  useVoiceCallUIStore.getState().close();
  useVoiceCallStore.setState({ owner: undefined, busy: false, saving: false, finishing: undefined, view: undefined, record: undefined, error: undefined });
}

async function pagination(initialCount = 199, guard: 'none' | 'session' | 'account' | 'earlier' | 'new-message' = 'none') {
  resetCall();
  const racing = guard === 'earlier' || guard === 'new-message';
  const now = Date.now();
  await db.messages.where('sessionId').equals(sessionId).delete();
  // Bulk insert only the synthetic fixture; message hooks and indexes stay active.
  await db.messages.bulkPut(Array.from({ length: initialCount }, (_, index) => ({ id: `archive-${index}`, sessionId, role: 'user' as const, content: `存量资料 ${index}`, createdAt: now - initialCount + index, isProactive: false })));
  useAuthStore.setState({ userId });
  useChatStore.setState({ currentSessionId: sessionId, selectedCharacterId: character.id, messages: await messageRepo.getPage(sessionId, { limit: racing ? 200 : initialCount }), hasMoreMessages: racing && initialCount > 200 });
  await persistSecret('mimo-key', 'isolated-test-placeholder');
  (window as any).integrationCallExchanges = Array.from({ length: 4 }, (_, index) => ({ turnId: `presence-${index}`, origin: 'presence-check', userText: '', generatedText: '我在。', heardText: '', interrupted: false,
    segments: [{ id: `played-${index}`, turnId: `presence-${index}`, text: '我在。', generatedAt: now, playedAt: now + 1, playedFrames: 10, interrupted: false }], metrics: { turnId: `presence-${index}`, stoppedAt: now } }));
  await useVoiceCallStore.getState().start(owner, { audio: {} as any, api: {} as any }, 'text');
  if (!useVoiceCallStore.getState().busy) throw Error(`Fixture start failed: ${useVoiceCallStore.getState().error}`);
  const originalPage = messageRepo.getPage, originalCount = messageRepo.countBySession, originalAll = messageRepo.getBySession;
  const core = (db.messages as any).core, originalQuery = core.query.bind(core), originalCoreCount = core.count.bind(core);
  let pageCalls = 0, countCalls = 0, fullReads = 0, returnedRows = 0;
  let pageReady!: () => void, countReady!: () => void, releaseCount!: () => void;
  const pageRead = new Promise<void>(resolve => { pageReady = resolve; });
  const countRead = new Promise<void>(resolve => { countReady = resolve; });
  const heldCount = new Promise<void>(resolve => { releaseCount = resolve; });
  const queries: unknown[] = [], counts: unknown[] = [];
  core.query = async (request: any) => { const result = await originalQuery(request); queries.push({ index: request.query.index.name, rows: result.result.length, limit: request.limit }); return result; };
  core.count = async (request: any) => { counts.push({ index: request.query.index.name }); return originalCoreCount(request); };
  messageRepo.getPage = async (...args) => {
    pageCalls++; const result = await originalPage(...args); returnedRows += result.length;
    pageReady();
    if (guard === 'session') useChatStore.setState({ currentSessionId: otherSession, messages: [], hasMoreMessages: false });
    if (guard === 'account') useAuthStore.setState({ userId: 'different-user' });
    return result;
  };
  messageRepo.countBySession = async (...args) => {
    countCalls++; const result = await originalCount(...args);
    countReady(); if (racing) await heldCount;
    return result;
  };
  messageRepo.getBySession = async (...args) => { fullReads++; return originalAll(...args); };
  try {
    const ending = useVoiceCallStore.getState().end();
    let changedWindow: { ids: string[]; hasMore: boolean } | undefined;
    if (racing) {
      // Hold the indexed count after both refresh reads have completed, then
      // update the same visible session while the stale snapshot is pending.
      await Promise.all([pageRead, countRead]);
      if (guard === 'earlier') await useChatStore.getState().loadEarlierMessages();
      else {
        const message = { id: 'new-message-during-count', sessionId, role: 'user' as const, content: '挂断后刚发出的消息', createdAt: Date.now() + 100, isProactive: false };
        await messageRepo.create(message); useChatStore.getState().addMessage(message);
      }
      const changed = useChatStore.getState();
      changedWindow = { ids: changed.messages.map(message => message.id), hasMore: changed.hasMoreMessages };
      releaseCount();
    }
    await ending;
    const state = useChatStore.getState();
    const result = { initialCount, guard, loaded: state.messages.length, hasMore: state.hasMoreMessages, currentSession: state.currentSessionId, pageCalls, countCalls, fullReads, returnedRows, queries, counts };
    if (changedWindow) {
      const ids = state.messages.map(message => message.id);
      const subsequentPage = await originalPage(sessionId);
      return { ...result, changedWindow, windowPreserved: JSON.stringify(ids) === JSON.stringify(changedWindow.ids), hasMorePreserved: state.hasMoreMessages === changedWindow.hasMore,
        freshMessageVisible: ids.includes('new-message-during-count'), laterCallMessages: subsequentPage.filter(message => message.id.startsWith('voice:')).length };
    }
    if (guard === 'none') {
      await useChatStore.getState().loadEarlierMessages();
      return { ...result, afterLoadEarlier: useChatStore.getState().messages.length };
    }
    return result;
  } finally {
    releaseCount();
    messageRepo.getPage = originalPage; messageRepo.countBySession = originalCount; messageRepo.getBySession = originalAll; core.query = originalQuery; core.count = originalCoreCount;
    useAuthStore.setState({ userId }); resetCall();
    useChatStore.setState({ currentSessionId: sessionId, selectedCharacterId: character.id, messages: [], hasMoreMessages: false });
  }
}

(window as any).voiceChatIntegration = { setup, callFixture, resetCall, pagination, commits: () => commits, resumeCalls: () => resumeCalls,
  target: () => useVoiceCallUIStore.getState().target?.character.name,
  profiles: () => db.characterStates.count(),
  level: () => { for (let index = 0; index < 40; index++) { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ view: { ...view, level: index / 40, generatedText: `内部草稿 ${index}` } }); } },
  phase: (phase: string) => { const view = useVoiceCallStore.getState().view!; useVoiceCallStore.setState({ view: { ...view, phase: phase as any } }); },
};
