import type { MemoryItem } from '../db/index';

export type ConversationMemory = MemoryItem & {
  memoryKind: NonNullable<MemoryItem['memoryKind']>;
};

const KIND_LABELS: Record<ConversationMemory['memoryKind'], string> = {
  fact: '关于用户',
  preference: '用户偏好',
  episode: '共同经历',
  promise: '未完成的约定',
  relationship: '关系记忆',
  'character-life': '角色自己的生活',
  summary: '对话摘要',
};

function compact(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function normalizeMemoryContent(text: string): string {
  return compact(text).slice(0, 240);
}

/** 只根据已经写入本地的文本分类，不调用模型，也不改变原文。 */
export function classifyMemoryKind(content: string, fallback: ConversationMemory['memoryKind'] = 'fact'): ConversationMemory['memoryKind'] {
  const value = compact(content);
  if (/记得|记住|别忘|答应|约好|说好了|下次|之后要|还没完成|待办|承诺/u.test(value)) return 'promise';
  if (/喜欢|不喜欢|偏好|习惯|爱吃|讨厌|害怕|不想要|更愿意|喜欢听/u.test(value)) return 'preference';
  if (/一起|共同|那天|上次|刚才|我们做过|你曾经|角色和用户/u.test(value)) return 'episode';
  if (/关系|信任|在意|疏远|和好|吵架|误会/u.test(value)) return 'relationship';
  if (/我最近|我正在|角色最近|今天在|此刻在|准备做|正在做/u.test(value)) return 'character-life';
  return fallback;
}

export function memoryKindLabel(kind?: MemoryItem['memoryKind']): string {
  return kind ? KIND_LABELS[kind] ?? '记忆' : '记忆';
}

export function prepareMemoryMetadata(
  content: string,
  options: {
    kind?: ConversationMemory['memoryKind'];
    pinned?: boolean;
    stability?: MemoryItem['stability'];
    confidence?: number;
  } = {},
): Pick<MemoryItem, 'memoryKind' | 'stability' | 'status' | 'confidence' | 'pinned'> {
  const kind = options.kind ?? classifyMemoryKind(content);
  const stable = options.stability ?? (options.pinned || kind === 'fact' || kind === 'preference' ? 'stable' : 'temporary');
  return {
    memoryKind: kind,
    stability: stable,
    status: 'active',
    confidence: options.confidence ?? 0.75,
    ...(options.pinned ? { pinned: true } : {}),
  };
}

function normalized(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/g, '');
}

function termsOf(query: string): string[] {
  const normalizedQuery = normalized(query);
  const terms = new Set<string>();
  for (const match of normalizedQuery.matchAll(/[\p{L}\p{N}]{2,}/gu)) terms.add(match[0]);
  const cjk = Array.from(normalizedQuery.matchAll(/[\u4e00-\u9fff]{2,}/gu)).flatMap(([chunk]) =>
    Array.from({ length: Math.max(0, chunk.length - 1) }, (_, index) => chunk.slice(index, index + 2)),
  );
  cjk.slice(0, 24).forEach((term) => terms.add(term));
  return [...terms].slice(0, 32);
}

function explicitMentioned(memory: MemoryItem, query: string): boolean {
  const q = normalized(query);
  const c = normalized(memory.content);
  if (q.length < 4 || c.length < 4) return false;
  return q.includes(c.slice(0, Math.min(18, c.length))) || c.includes(q.slice(0, Math.min(18, q.length)));
}

function ageScore(memory: MemoryItem, now: number): number {
  const ageDays = Math.max(0, (now - (memory.lastConfirmedAt ?? memory.updatedAt ?? memory.createdAt)) / 86_400_000);
  if (memory.stability === 'stable' || memory.pinned) return 1;
  return Math.max(0.08, 1 - ageDays / 180);
}

/**
 * 私聊召回：先过滤生命周期和冷却，再按相关度、重要性和用户明确程度排序。
 * 所有权限已经在调用方按 characterId + userId 隔离；这里不会跨角色取数据。
 */
export function rankConversationMemories(
  memories: MemoryItem[],
  query: string,
  recentlyMentionedIds: Set<string> = new Set(),
  limit = 8,
): MemoryItem[] {
  const terms = termsOf(query);
  const now = Date.now();
  const scored = memories
    .filter((memory) => (memory.status ?? 'active') === 'active' && memory.content.trim())
    .map((memory, index) => {
      const content = normalized(memory.content);
      const matches = terms.reduce((count, term) => count + (content.includes(term) ? 1 : 0), 0);
      const explicitlyMentioned = explicitMentioned(memory, query);
      const recentlyMentioned = recentlyMentionedIds.has(memory.id) && !explicitlyMentioned;
      const kindBoost = memory.memoryKind === 'promise' ? 1.2 : memory.memoryKind === 'relationship' ? 0.8 : 0;
      const score =
        (memory.pinned ? 12 : 0) +
        (explicitlyMentioned ? 9 : 0) +
        matches * 2.8 +
        ageScore(memory, now) * 1.1 +
        Math.max(0, Math.min(1, memory.confidence ?? 0.6)) * 0.8 +
        kindBoost -
        (recentlyMentioned ? 7 : 0) -
        Math.min(2, (memory.mentionCount ?? 0) * 0.04) +
        (memories.length - index) / Math.max(1, memories.length) / 100;
      return { memory, score, explicitlyMentioned };
    })
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const result: MemoryItem[] = [];
  for (const item of scored) {
    const key = normalized(item.memory.content);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item.memory);
    if (result.length >= Math.max(0, limit)) break;
  }
  return result;
}

export function buildMemoryContext(memories: MemoryItem[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((memory) => {
    const label = memoryKindLabel(memory.memoryKind);
    const certainty = (memory.confidence ?? 0.6) < 0.55 ? '（可能不准确，谨慎提及）' : '';
    const imported = memory.importedFromMemoryId
      ? '[用户创建你时主动分享的背景；不代表你亲历] '
      : `[${label}] `;
    return `- ${imported}${memory.content.slice(0, 220)}${certainty}`;
  });
  return `\n\n[用户画像与关系记忆（仅供你参考，不向用户展示）]\n${lines.join('\n')}\n这些内容只作为背景。标记为“用户主动分享”的内容是你后来听用户讲到的资料，不是你与用户共同经历过的回忆。当前用户的说法、角色人设和边界优先；除非用户主动问起，不要逐条复述，也不要把不确定内容说成事实。`;
}
