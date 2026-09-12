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
export function selectRelevantMemories<T extends { content: string; createdAt: number }>(
  memories: T[],
  query: string,
  limit: number,
): T[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 12);
  const now = Date.now();
  return [...memories]
    .map((memory, index) => {
      const content = memory.content.toLowerCase();
      const matches = terms.reduce((count, term) => count + (content.includes(term) ? 1 : 0), 0);
      const ageDays = Math.max(0, (now - memory.createdAt) / 86_400_000);
      const recency = Math.max(0, 1 - ageDays / 365);
      return { memory, score: matches * 4 + recency + (memories.length - index) / memories.length / 10 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map((item) => item.memory);
}
