import type { MemoryItem, WorldSceneEntry } from '../../db/index';
import { selectRelevantMemories } from '../chat-context-compiler';

/**
 * 剧情里的隐藏用户画像。
 * 画像只由当前角色已经拥有的 4.x 用户记忆拼成，绝不跨角色汇总，
 * 也不写入新的数据库字段。它只作为模型上下文存在，不渲染给用户。
 */
export function buildHiddenUserProfile(
  memories: Pick<MemoryItem, 'content' | 'createdAt' | 'pinned'>[],
  query = '',
  limit = 6,
): string {
  const unique = new Map<string, Pick<MemoryItem, 'content' | 'createdAt' | 'pinned'>>();
  for (const memory of memories) {
    const content = memory.content.trim().replace(/\s+/g, ' ');
    if (!content) continue;
    const key = content.toLocaleLowerCase();
    const existing = unique.get(key);
    if (!existing || (!existing.pinned && memory.pinned)) {
      unique.set(key, { content: content.slice(0, 180), createdAt: memory.createdAt, pinned: memory.pinned });
    }
  }

  const candidates = [...unique.values()];
  const selected = query.trim()
    ? selectRelevantMemories(candidates, query, limit)
    : [...candidates]
      .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || b.createdAt - a.createdAt)
      .slice(0, limit);
  const lines = selected.map((memory) => `- ${memory.content}`);
  if (lines.length === 0) return '';

  return (
    `【用户画像（仅供你参考，不向用户展示）】\n${lines.join('\n')}\n` +
    '这些是从你和用户过去对话中沉淀出的、关于用户的可能事实与偏好。它们只是参考：当前用户的说法优先，' +
    '角色自身的人设、边界和说话方式优先。不要直接说出“用户画像”“记忆库”或像报告一样复述这些内容；' +
    '只在自然合适时体现在回应的语气、例子和关注点里。'
  );
}

/** 让导演/角色把当前用户输入当作本轮主线，不强行拉回旧话题。 */
export function buildConversationFocus(userText: string, recentEntries: Pick<WorldSceneEntry, 'kind' | 'content'>[]): string {
  const current = userText.trim();
  if (!current) {
    return '【本轮对话重点】用户还没有发言。让角色从现场自然开始，不要替用户安排行动。';
  }
  const previousUser = recentEntries
    .filter((entry) => entry.kind === 'user_input' || entry.kind === 'choice')
    .map((entry) => entry.content.trim())
    .filter(Boolean)
    .slice(-2);
  const changed = previousUser.length > 0 && previousUser[previousUser.length - 1] !== current;
  return (
    `【本轮对话重点】用户现在说的是：「${current.slice(0, 260)}」\n` +
    (changed
      ? '以这句话的新意图为最高优先级；如果它换了话题，立刻顺着新话题，不要把旧冲突、旧问题或未完成事项硬拽回来。\n'
      : '围绕用户当前意图自然回应；不要为了推进旧线索而强行转回别的话题。\n') +
    '只推进一个小节拍，留出用户继续说话的空间；不要连续追问同一件事。'
  );
}
