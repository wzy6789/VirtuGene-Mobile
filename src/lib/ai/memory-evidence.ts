export interface MemorySourceTurn {
  role: string;
  content: string;
  sourceId?: string;
  userAuthored?: boolean;
}

/** Generated speech can be recalled as speech, but cannot ground user facts. */
export function userMemorySources(history: MemorySourceTurn[]): MemorySourceTurn[] {
  return history.filter(turn => turn.role === 'user' && turn.userAuthored !== false && turn.content.trim());
}

export function acceptExtractedMemories(arr: unknown, history: MemorySourceTurn[]) {
  if (!Array.isArray(arr)) return { error: 'parse:error' };
  const sources = userMemorySources(history);
  const allowed = new Set(sources.map(turn => turn.sourceId).filter(Boolean));
  const indexed = history.some(turn => turn.sourceId);
  const memories: string[] = [];
  const evidence: { content: string; sourceIds: string[] }[] = [];
  for (const item of arr.slice(0, 20)) {
    if (!indexed && sources.length && typeof item === 'string' && item.trim()) {
      memories.push(item.trim());
    } else if (item && typeof item.content === 'string' && item.content.trim()) {
      const ids = Array.isArray(item.sourceIds)
        ? [...new Set<string>(item.sourceIds.filter((id: unknown): id is string => typeof id === 'string'))] : [];
      if (!ids.length || ids.some(id => !allowed.has(id))) continue;
      const content = item.content.trim();
      memories.push(content); evidence.push({ content, sourceIds: ids });
    }
  }
  // A nonempty, wholly unsupported result must not advance a durable cursor.
  return arr.length && !memories.length ? { error: 'parse:error' } : { memories, evidence };
}
