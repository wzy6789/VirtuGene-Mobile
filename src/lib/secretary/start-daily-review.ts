import { db, type Message } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { collectDailyReview, dailyReviewRequest, validateDailyReview } from './daily-review';
import { diaryAccessAllowed, runSecretaryRequest } from './agent';
import type { DailyReviewOptions } from './types';

export async function startDailyReview(userId: string, characterId: string, sessionId: string, input: DailyReviewOptions, employmentId: string) {
  const options = validateDailyReview(input);
  await collectDailyReview(userId, options, diaryAccessAllowed());
  const message: Message = { id: crypto.randomUUID(), sessionId, role: 'user', content: dailyReviewRequest(options), createdAt: Date.now(), isProactive: false };
  await db.transaction('rw', db.characters, db.secretaryBindings, db.sessions, db.messages, async () => {
    const character = await db.characters.get(characterId);
    const binding = await db.secretaryBindings.get(userId);
    const session = await db.sessions.get(sessionId);
    if (useAuthStore.getState().userId !== userId || !character || character.createdBy !== userId || character.agentProfile !== 'secretary' || character.isPreset
      || character.secretaryStatus === 'dismissed' || binding?.status === 'dismissed' || (binding?.employmentId ?? `legacy:${characterId}`) !== employmentId
      || !session || session.userId !== userId || session.characterId !== characterId || session.type === 'group') throw new Error('助理或账号已变化，请重新打开每日整理。');
    await db.messages.add(message);
  });
  const store = useChatStore.getState();
  if (useAuthStore.getState().userId === userId && store.currentSessionId === sessionId) store.addMessage(message);
  try {
    const task = await runSecretaryRequest(userId, characterId, message, { dailyReview: options, expectedEmploymentId: employmentId });
    const reply = await db.messages.get(`secretary-reply:${message.id}`);
    if (reply && useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId === sessionId) useChatStore.getState().addMessage(reply);
    return task;
  } catch (error) {
    if (useAuthStore.getState().userId === userId) {
      await db.messages.update(message.id, { failed: true });
      if (useChatStore.getState().currentSessionId === sessionId) useChatStore.getState().updateMessage(message.id, { failed: true });
    }
    throw error;
  }
}
