import Dexie from 'dexie';
import { db } from '../../db';
import { useAuthStore } from '../../store/auth-store';

export interface SecretarySearchEntry {
  id: string; userId: string; characterId: string; sourceId: string; sessionId: string;
  kind: 'message' | 'task' | 'suppression'; version: number; createdAt: number; keys: string[];
  permanent?: boolean;
}
export interface SecretarySearchCursor { id: string; sessionId?: string; sessionCreatedAt?: number; messageAt: number; messageId: string; complete: boolean }

function terms(text: string): string[] {
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const tokens = new Set<string>();
  for (let i = 0; i < clean.length - 1 && tokens.size < 96; i++) tokens.add(clean.slice(i, i + 2));
  for (const word of text.toLowerCase().match(/[a-z0-9_-]{2,40}/gu) ?? []) tokens.add(word);
  return [...tokens];
}
const jobs = new Set<Promise<unknown>>();
const rebuilding = new Set<string>();
function track(work: Promise<unknown>) { jobs.add(work); work.catch(() => undefined).finally(() => jobs.delete(work)); }
export async function flushSecretarySearchJobs() { await Promise.allSettled([...jobs]); }

export async function refreshSearchEntry(kind: 'message' | 'task', sourceId: string): Promise<void> {
  const source = kind === 'message' ? await db.messages.get(sourceId) : await db.secretaryTasks.get(sourceId);
  const id = `${kind}:${sourceId}`;
  if (!source) { await db.secretarySearch.delete(id); return; }
  const session = await db.sessions.get(source.sessionId);
  const character = session ? await db.characters.get(session.characterId) : undefined;
  if (!session || session.type === 'group' || character?.agentProfile !== 'secretary' || character.createdBy !== session.userId
    || 'request' in source && source.userId !== session.userId
    || kind === 'message' && ('role' in source && (source.role !== 'user' || source.failed))) { await db.secretarySearch.delete(id); return; }
  const messageId = 'messageId' in source ? source.messageId : source.id;
  const blocked = await db.secretarySearch.get(`suppression:${session.userId}:${messageId}`);
  if (blocked) {
    const message = 'messageId' in source ? await db.messages.get(messageId) : source;
    const revision = message && 'revision' in message ? message.revision ?? 1 : 1;
    if (blocked.permanent || blocked.version >= revision) { await db.secretarySearch.delete(id); return; }
  }
  const text = 'request' in source ? source.request : 'content' in source ? source.content : '';
  const version = 'request' in source ? source.updatedAt : 'revision' in source ? source.revision ?? 1 : 1;
  await db.secretarySearch.put({ id, kind, sourceId, sessionId: session.id, userId: session.userId, characterId: session.characterId,
    version, createdAt: source.createdAt, keys: terms(text).map(t => `${session.userId}:${session.characterId}:${t}`) });
}

// Source hooks schedule work after commit; index writes never break a caller's transaction.
for (const [kind, table] of [['message', db.messages], ['task', db.secretaryTasks]] as const) {
  table.hook('creating', (_key, row, tx) => { tx.on('complete', () => Dexie.ignoreTransaction(() => track(refreshSearchEntry(kind, row.id)))); });
  table.hook('updating', (_changes, key, _row, tx) => { tx.on('complete', () => Dexie.ignoreTransaction(() => track(refreshSearchEntry(kind, String(key))))); });
  table.hook('deleting', (key, _row, tx) => { tx.on('complete', () => Dexie.ignoreTransaction(() => track(db.secretarySearch.delete(`${kind}:${String(key)}`)))); });
}

async function invalidateSourceReferences(row: import('../../db').MemorySourceTombstone) {
  const ids = new Set([...(row.suppressedMessageIds ?? []), ...(row.sourceType === 'message' ? [row.sourceId] : [])]);
  if (!ids.size) return;
  await db.transaction('rw', db.secretarySearch, db.secretaryBindings, db.secretaryTasks, async () => {
    for (const id of ids) {
      const suppressionId = `suppression:${row.userId}:${id}`;
      const previous = await db.secretarySearch.get(suppressionId);
      const permanent = previous?.permanent || row.suppressedMessageIds?.includes(id) || row.status === 'deleted';
      for (const key of [`message:${id}`, `task:secretary-task:${row.userId}:${id}`]) {
        const entry = await db.secretarySearch.get(key);
        if (entry?.userId === row.userId && (permanent || entry.kind === 'task' || entry.version <= row.sourceRevision)) await db.secretarySearch.delete(key);
      }
      await db.secretarySearch.put({ id: suppressionId, userId: row.userId, characterId: row.characterId ?? '', sessionId: '', sourceId: id,
        kind: 'suppression', version: Math.max(previous?.version ?? 0, row.sourceRevision), permanent, createdAt: row.updatedAt, keys: [] });
    }
    const binding = await db.secretaryBindings.get(row.userId);
    if (!binding) return;
    for (const field of ['pendingFocusTaskId', 'workspaceFocusTaskId'] as const) {
      const task = binding[field] ? await db.secretaryTasks.get(binding[field]!) : undefined;
      if (!task || task.userId !== row.userId) continue;
      const origins = await db.secretaryTasks.bulkGet(task.results.flatMap(r => r.sourceTaskId ? [r.sourceTaskId] : []));
      if (ids.has(task.messageId) || task.pendingContext?.sources.some(s => ids.has(s.messageId)) || origins.some(t => t?.userId === row.userId && ids.has(t.messageId))) {
        await db.secretaryBindings.update(row.userId, { [field]: undefined, ...(field === 'pendingFocusTaskId' ? { pendingFocusDisplayTaskId: undefined } : {}) });
        if (task.pendingContext) await db.secretaryTasks.update(task.id, { pendingContext: { ...task.pendingContext, state: 'invalid' } });
      }
    }
  });
}
db.memorySourceTombstones.hook('creating', (_key, row, tx) => { tx.on('complete', () => Dexie.ignoreTransaction(() => track(invalidateSourceReferences(row)))); });
db.memorySourceTombstones.hook('updating', (changes, _key, row, tx) => { tx.on('complete', () => Dexie.ignoreTransaction(() => track(invalidateSourceReferences({ ...row, ...changes })))); });

/** Old accounts build 128 messages at a time. No full-history read on the first request. */
export async function buildSearchBatch(userId: string, characterId: string): Promise<boolean> {
  const id = `${userId}:${characterId}`;
  if (rebuilding.has(id)) return false;
  rebuilding.add(id);
  try {
    const cursor = await db.secretarySearchCursors.get(id) ?? { id, messageAt: 0, messageId: '', complete: false };
    if (cursor.complete || useAuthStore.getState().userId !== userId) return cursor.complete;
    let session = cursor.sessionId ? await db.sessions.get(cursor.sessionId) : undefined;
    if (!session || session.userId !== userId || session.characterId !== characterId) {
      session = await db.sessions.where('[characterId+userId+createdAt+id]').between([characterId, userId, cursor.sessionCreatedAt ?? 0, cursor.sessionId ?? ''], [characterId, userId, Dexie.maxKey, Dexie.maxKey], !cursor.sessionId, true).first();
      cursor.messageAt = 0; cursor.messageId = '';
    }
    if (!session) { await db.secretarySearchCursors.put({ ...cursor, complete: true }); return true; }
    const rows = await db.messages.where('[sessionId+createdAt+id]').between([session.id, cursor.messageAt, cursor.messageId], [session.id, Dexie.maxKey, Dexie.maxKey], false, true).limit(128).toArray();
    for (const message of rows) {
      await refreshSearchEntry('message', message.id);
      await refreshSearchEntry('task', `secretary-task:${userId}:${message.id}`);
    }
    if (rows.length === 128) {
      const last = rows[rows.length - 1]; await db.secretarySearchCursors.put({ ...cursor, sessionId: session.id, sessionCreatedAt: session.createdAt, messageAt: last.createdAt, messageId: last.id }); return false;
    }
    const next = await db.sessions.where('[characterId+userId+createdAt+id]').between([characterId, userId, session.createdAt, session.id], [characterId, userId, Dexie.maxKey, Dexie.maxKey], false, true).first();
    await db.secretarySearchCursors.put({ id, sessionId: next?.id, sessionCreatedAt: next?.createdAt, messageAt: 0, messageId: '', complete: !next });
    return !next;
  } finally { rebuilding.delete(id); }
}

export function startSearchBackfill(userId: string, characterId: string): void {
  if (rebuilding.has(`${userId}:${characterId}`)) return;
  void buildSearchBatch(userId, characterId).then(done => { if (!done && useAuthStore.getState().userId === userId) setTimeout(() => startSearchBackfill(userId, characterId), 50); }).catch(() => undefined);
}

export async function searchHistoryCandidates(userId: string, characterId: string, request: string) {
  await flushSecretarySearchJobs();
  if (useAuthStore.getState().userId !== userId) return { messages: [], tasks: [], incomplete: true };
  const keys = terms(request).slice(0, 24).map(t => `${userId}:${characterId}:${t}`);
  const indexed = keys.length ? await db.secretarySearch.where('keys').anyOf(keys).distinct().limit(128).toArray() : [];
  const sessionRows = await db.sessions.where('[characterId+userId+createdAt+id]').between([characterId, userId, 0, ''], [characterId, userId, Dexie.maxKey, Dexie.maxKey]).reverse().limit(8).toArray();
  const fallback = (await Promise.all(sessionRows.map(s => db.messages.where('[sessionId+createdAt]').between([s.id, 0], [s.id, Dexie.maxKey]).reverse().limit(32).toArray()))).flat();
  const rawMessages = await db.messages.bulkGet(indexed.filter(r => r.kind === 'message').map(r => r.sourceId));
  const messages = [...new Map([...rawMessages.filter((m): m is NonNullable<typeof m> => !!m), ...fallback].map(m => [m.id, m])).values()];
  const recentTasks = await db.secretaryTasks.where('[userId+characterId+createdAt]').between([userId, characterId, 0], [userId, characterId, Dexie.maxKey]).reverse().limit(64).toArray();
  const indexedTasks = await db.secretaryTasks.bulkGet(indexed.filter(r => r.kind === 'task').map(r => r.sourceId));
  const tasks = [...new Map([...recentTasks, ...indexedTasks.filter((t): t is NonNullable<typeof t> => !!t)].map(t => [t.id, t])).values()];
  startSearchBackfill(userId, characterId);
  return { messages, tasks, incomplete: !(await db.secretarySearchCursors.get(`${userId}:${characterId}`))?.complete || indexed.length === 128 };
}

export async function recentSecretaryTasks(userId: string, sessionId: string, limit = 4) {
  return db.secretaryTasks.where('[userId+sessionId+createdAt]').between([userId, sessionId, 0], [userId, sessionId, Dexie.maxKey]).reverse().limit(limit).toArray();
}
