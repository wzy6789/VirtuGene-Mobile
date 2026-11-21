import { cmp, type DBCoreIndex, type DBCoreTransaction } from 'dexie';
import { db } from './index';

/** Seek selected primary keys inside one exact secondary-index key. No session
 * values (including long summary source maps) enter the supported path. */
async function selectedIndexKeys(index: DBCoreIndex, key: string[], ids: string[],
  transaction: DBCoreTransaction): Promise<Set<string> | undefined> {
  const cursor = await db.sessions.core.openCursor({
    trans: transaction, values: false,
    query: { index, range: { type: 1, lower: key, upper: key } },
  });
  if (!cursor) return new Set();
  const found = new Set<string>();
  let position = 0, supported = true;
  await cursor.start(() => {
    // Dexie installs a placeholder before start(), then restores the actual
    // native capability inside it. Checking the unopened cursor is misleading.
    if (typeof cursor.continuePrimaryKey !== 'function' || cursor.value !== undefined) {
      supported = false; cursor.stop(); return;
    }
    while (position < ids.length && cmp(ids[position], cursor.primaryKey) < 0) position++;
    if (position === ids.length) { cursor.stop(); return; }
    if (cmp(ids[position], cursor.primaryKey) === 0) found.add(ids[position++]);
    if (position === ids.length) { cursor.stop(); return; }
    // The next requested key is strictly above the current primary key. Missing
    // IDs skip to their successor; unrelated sessions are never walked through.
    cursor.continuePrimaryKey(key, ids[position]);
  });
  return supported ? found : undefined;
}

/** Fresh selected-session authorization. Legacy missing/non-group types remain
 * private, exactly as with the owner index minus the explicit group index. */
export async function ownedSelectedPrivateSessionIds(userId: string, characterId: string,
  ids: Iterable<string>): Promise<Set<string>> {
  const selected = [...new Set(ids)].sort(cmp);
  if (!selected.length) return new Set();
  return db.transaction('r', db.sessions, async transaction => {
    const indexes = db.sessions.core.schema.indexes;
    // Only real exact indexes: virtual-prefix continuePrimaryKey has different
    // positioning semantics and must not substitute for these existing indexes.
    const exact = (name: string, keyPath: string[]) => indexes.find(index => index.name === name
      && JSON.stringify(index.keyPath) === JSON.stringify(keyPath));
    const ownerIndex = exact('[characterId+userId]', ['characterId', 'userId']);
    const groupIndex = exact('[characterId+userId+type]', ['characterId', 'userId', 'type']);
    if (ownerIndex && groupIndex) {
      const [owned, groups] = await Promise.all([
        selectedIndexKeys(ownerIndex, [characterId, userId], selected, transaction.idbtrans),
        selectedIndexKeys(groupIndex, [characterId, userId, 'group'], selected, transaction.idbtrans),
      ]);
      if (owned && groups) return new Set([...owned].filter(id => !groups.has(id)));
    }
    // Older cursor implementations retain exact scope and fresh ownership.
    // Other database failures propagate; they never widen authorization.
    const sessions = await db.sessions.bulkGet(selected);
    return new Set(sessions.filter(session => session && session.userId === userId
      && session.characterId === characterId && session.type !== 'group').map(session => session!.id));
  });
}
