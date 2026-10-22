import { createRoot } from 'react-dom/client';
import { db, type Message } from '../../src/db';
import { messageRepo } from '../../src/db/message-repo';
import { createSecretary } from '../../src/lib/secretary/character';
import { runSecretaryRequest } from '../../src/lib/secretary/agent';
import { useAuthStore } from '../../src/store/auth-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { ChatWindow } from '../../src/components/chat/ChatWindow';

// Independent localhost origin and synthetic account; never contact a model.
window.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (!body.messages) throw Error('隔离演示禁止外部请求');
  const text = body.messages.find((m: { role: string }) => m.role === 'user')?.content ?? '';
  const data = JSON.parse(text.split('仅供参考的资料JSON：')[1] || '{}');
  const memories = data.assistantMemory;
  const corrected = memories?.previousUserMessages?.find((m: { followsMessageId?: string; content: string }) => m.followsMessageId && m.content.includes('周四'));
  const facts = memories?.memories?.map((m: { content: string }) => m.content) ?? [];
  const reply = corrected ? `记录里你后来更正为：${corrected.content}` : facts.length ? `这次找到的记忆：${facts.join('；')}` : '这是本地隔离演示。可以查看、纠正或忘记记忆，也可以询问曦原项目的核对会。';
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply, actions: [] }) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
};

await db.open();
const userId = 'isolated-assistant-memory-preview';
useAuthStore.setState({ userId, username: '本地演示', isLoggedIn: true, apiKey: 'local-stub-only' });
useSettingsStore.setState({ diaryPin: null });
const assistant = await createSecretary(userId, '记忆演示助理');
const oldSessionId = 'assistant-memory-preview-old';
const currentSessionId = 'assistant-memory-preview-current';
const stamp = Date.now() - 60000;
for (const id of [oldSessionId, currentSessionId]) await db.sessions.put({ id, userId, characterId: assistant.id, type: 'single', title: '隔离记忆演示', createdAt: stamp, updatedAt: stamp, unreadCount: 0, modelAsked: true });
const request = async (id: string, content: string, at: number, sessionId = oldSessionId) => {
  const message: Message = { id, sessionId, role: 'user', content, createdAt: at, revision: 1, isProactive: false };
  const existing = await db.messages.get(id);
  if (!existing) await messageRepo.create(message);
  return runSecretaryRequest(userId, assistant.id, existing ?? message);
};
await request('preview-name', '记住：请叫我小林', stamp + 1);
await request('preview-work', '记住：我长期在杭州工作', stamp + 2);
await request('preview-style', '记住：回复简短一些，不要反复催我', stamp + 3);
if (!await db.messages.get('preview-note-a')) await messageRepo.create({ id: 'preview-note-a', sessionId: oldSessionId, role: 'user', content: '曦原项目的核对会定在周五。', createdAt: stamp + 10, revision: 1, isProactive: false });
if (!await db.messages.get('preview-note-b')) await messageRepo.create({ id: 'preview-note-b', sessionId: oldSessionId, role: 'user', content: '不是周五，是周四。', createdAt: stamp + 10, revision: 1, isProactive: false });
await request('preview-question', '曦原项目的核对会是哪天？', Date.now(), currentSessionId);
useChatStore.setState({ characters: [assistant], selectedCharacterId: assistant.id, currentSessionId, messages: await messageRepo.getBySession(currentSessionId) });
useUIStore.setState({ activeView: 'chat' });
createRoot(document.getElementById('root')!).render(<ChatWindow />);
(window as any).assistantMemoryPreview = { ready: true, realModelCalls: 0, microphone: false, syntheticData: true };
