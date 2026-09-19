/**
 * Builds a bounded prompt for a single character chat.
 * Character identity and the current user message always win over optional context.
 * The limits are character based on purpose: this works offline and avoids a tokenizer
 * dependency in the mobile bundle while still providing a stable upper bound.
 */
export interface PromptSection {
  key: string;
  text: string;
  priority: number;
}

export interface CompiledChatContext {
  prompt: string;
  /** 完整进入 prompt 的区块（截断过的不算，见 partial） */
  included: string[];
  /** 只放进去一部分（被预算截断）的区块；这些区块的条目无法逐条确认，不用于溯源 */
  partial: string[];
  /** 完全没有进入 prompt 的区块 */
  omitted: string[];
}

const DEFAULT_BUDGET = 24_000;

export function compileChatContext(
  identity: string,
  sections: PromptSection[],
  budget = DEFAULT_BUDGET,
): CompiledChatContext {
  const safeBudget = Math.max(6_000, Math.floor(budget));
  const base = identity.trim();
  const included: string[] = [];
  const partial: string[] = [];
  const omitted: string[] = [];
  let remaining = Math.max(0, safeBudget - base.length);
  const output = [base];

  const ordered = [...sections]
    .filter((section) => section.text.trim().length > 0)
    // 同一个 key 只允许注入一次：重复的区块（例如不小心把 diary 写了两遍）会让同一段
    // 内容被塞进 Prompt 两次——既浪费预算，也让模型看到重复信息。
    // 保留优先级最高的那一条；优先级相同则保留先出现的那条（可预测）。
    .reduce<PromptSection[]>((acc, section) => {
      const existing = acc.findIndex((s) => s.key === section.key);
      if (existing === -1) acc.push(section);
      else if (section.priority > acc[existing].priority) acc[existing] = section;
      return acc;
    }, [])
    .sort((a, b) => b.priority - a.priority);

  for (const section of ordered) {
    const text = section.text.trim();
    if (text.length <= remaining) {
      output.push(text);
      remaining -= text.length;
      included.push(section.key);
      continue;
    }

    // Optional sections may be shortened once, then dropped if the remaining budget
    // is too small. This keeps the identity and current-turn instructions intact.
    const minimum = Math.min(text.length, section.priority >= 80 ? 500 : 240);
    if (remaining >= minimum) {
      output.push(text.slice(0, remaining));
      // 截断：区块里的条目可能有部分没进去，因此只报 partial，不谎报"完整注入"
      partial.push(section.key);
      remaining = 0;
    } else {
      omitted.push(section.key);
    }
  }

  return { prompt: output.filter(Boolean).join('\n\n'), included, partial, omitted };
}

/** Selects relevant memories without a vector database. Exact words are enough for
 * the first release and can later be replaced by embeddings behind this interface. */
export function selectRelevantMemories<T extends { content: string; createdAt: number; confidence?: number; updatedAt?: number; pinned?: boolean }>(
  memories: T[],
  query: string,
  limit: number,
): T[] {
  const baseTerms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 12);
  const cjkTerms = Array.from(query.toLowerCase().matchAll(/[\u4e00-\u9fff]{2,}/g))
    .flatMap(([chunk]) => Array.from({ length: Math.max(0, chunk.length - 1) }, (_, index) => chunk.slice(index, index + 2)))
    .slice(0, 16);
  const terms = Array.from(new Set([...baseTerms, ...cjkTerms])).slice(0, 20);
  const now = Date.now();
  const ranked = [...memories]
    .map((memory, index) => {
      const content = memory.content.toLowerCase();
      const matches = terms.reduce((count, term) => count + (content.includes(term) ? 1 : 0), 0);
      const ageDays = Math.max(0, (now - (memory.updatedAt ?? memory.createdAt)) / 86_400_000);
      const recency = Math.max(0, 1 - ageDays / 365);
      const confidence = Math.max(0, Math.min(1, memory.confidence ?? 0.6));
      // Explicitly remembered items are a hard preference. They stay eligible even
      // when the current turn has no matching keyword; relevance must never make a
      // user-requested fact disappear from the small prompt budget.
      const pinnedBoost = memory.pinned === true ? 1000 : 0;
      return { memory, score: pinnedBoost + matches * 4 + recency * 0.8 + confidence * 0.6 + (memories.length - index) / Math.max(1, memories.length) / 10 };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.memory);
  const seen = new Set<string>();
  return ranked.filter((memory) => {
    const key = memory.content.normalize('NFKC').toLowerCase().replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.max(0, limit));
}
