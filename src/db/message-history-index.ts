/** Search postings carry identity/order only. They are not authorization or text caches. */
export type HistorySearchEntry = [string, string, number, string, number, number, number];
export interface HistorySearchRow { key: string; sessionId: string; entries: [string, string][] }

export function normalizeHistorySearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u3000，。！？、,.!?;；:："“”‘’（）()【】[\]{}]/g, '');
}

export function historySearchGrams(text: string): string[] {
  const grams = new Set<string>();
  for (let i = 0; i + 2 <= text.length; i++) grams.add(text.slice(i, i + 2));
  return [...grams];
}

type SearchableMessage = {
  id: string; sessionId: string; content: string; createdAt: number;
  role: string; revision?: number; failed?: boolean;
  secretaryDispatch?: { bodyOrigin: string };
};

export function messageHistoryIdentity(row: SearchableMessage): string {
  return JSON.stringify([row.sessionId, row.createdAt, row.id, Number(row.role === 'assistant'),
    Number(row.role === 'user' && row.secretaryDispatch?.bodyOrigin !== 'composed'), row.revision ?? 1]);
}

export function messageHistoryProjection(row: SearchableMessage): HistorySearchRow {
  const entries: [string, string][] = row.failed || !['user', 'assistant'].includes(row.role) ? []
    : historySearchGrams(normalizeHistorySearchText(row.content)).map(gram => [row.sessionId, gram]);
  return { key: messageHistoryIdentity(row), sessionId: row.sessionId, entries };
}
