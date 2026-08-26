import { ipc } from './ipc-client';
import { sessionRepo } from '../db/session-repo';
import { messageRepo } from '../db/message-repo';

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

/** 收集「关联角色」的对话：优先今天，今天没有则取最近 12 条 */
export async function collectCharacterConversations(characterId: string, userId: string): Promise<string> {
  const sessions = await sessionRepo.getByCharacter(characterId, userId);
  if (sessions.length === 0) return '';
  const msgs = await messageRepo.getBySession(sessions[0].id);
  const todayMsgs = msgs.filter((m) => isToday(m.createdAt));
  const base = todayMsgs.length > 0 ? todayMsgs : msgs.slice(-12);
  return base.map((m) => `${m.role === 'user' ? '我' : 'TA'}：${m.content}`).join('\n');
}

export interface GeneratedDiary {
  draft?: string;
  /** AI 建议的标题 */
  title?: string;
  /** AI 给出的内容相关标签建议 */
  tags?: string[];
  error?: string;
  /** 生成是否基于「日记片段」：为 true 时采纳应直接替换成一段完整文章，而非追加 */
  replace: boolean;
}

/**
 * 生成日记初稿：
 * - 关联了角色 + 有日记片段 → 把「片段 + TA 的对话」融合成一篇（mode: combine）
 * - 只有关联角色 → 基于 TA 的对话生成（mode: auto）
 * - 只有日记片段 → 整理成一篇完整日记（mode: compile）
 * - 都没有 → { error: 'no_content' }
 */
export async function generateTodayDiary(
  apiKey: string,
  userId: string,
  characterId?: string,
  diaryContent?: string,
  characterName?: string,
): Promise<GeneratedDiary> {
  const hasFragments = !!diaryContent && diaryContent.trim().length > 0;

  if (characterId && hasFragments) {
    const convo = await collectCharacterConversations(characterId, userId);
    const r = await ipc.diary.assist({
      apiKey,
      mode: 'combine',
      text: diaryContent!.trim(),
      context: convo ? `[与「${characterName ?? 'TA'}」的对话]\n${convo}` : undefined,
    });
    if (r.error) return { error: r.error, replace: false };
    return { draft: r.text, title: r.title, tags: r.tags, replace: true };
  }

  if (characterId) {
    const convo = await collectCharacterConversations(characterId, userId);
    const r = await ipc.diary.assist({ apiKey, mode: 'auto', text: '', context: convo });
    if (r.error) return { error: r.error, replace: false };
    return { draft: r.text, title: r.title, tags: r.tags, replace: false };
  }

  if (hasFragments) {
    const r = await ipc.diary.assist({ apiKey, mode: 'compile', text: diaryContent!.trim() });
    if (r.error) return { error: r.error, replace: false };
    return { draft: r.text, title: r.title, tags: r.tags, replace: true };
  }

  return { error: 'no_content', replace: false };
}
