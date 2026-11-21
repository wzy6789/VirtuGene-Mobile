import Dexie from 'dexie';
import {db, type SharedMemory} from './index';

export interface MemoryExhibitCursor { createdAt: number; id: string }
export interface MemoryExhibitPage {
  available: boolean;
  items: SharedMemory[];
  next?: MemoryExhibitCursor;
}
export const MEMORY_EXHIBIT_PAGE_SIZE = 40;

/** Display-only pagination; model retrieval and source authorization are unchanged.
 * The existing time index orders duplicate timestamps by primary key. A key-only
 * cursor can seek that pair directly, rather than decoding/skipping every prior
 * row again. Only this page's keys are decoded through Dexie bulkGet. */
export async function readMemoryExhibitPage(userId: string, worldId: string, after?: MemoryExhibitCursor): Promise<MemoryExhibitPage> {
  if (after && (typeof after.id !== 'string' || !Number.isFinite(after.createdAt))) throw Error('memory:invalid-cursor');
  return db.transaction('r', db.worlds, db.sharedMemories, async () => {
    const world = await db.worlds.get(worldId);
    if (!userId || world?.userId !== userId) return {available:false,items:[]};
    const transaction = Dexie.currentTransaction!.idbtrans;
    const keys = await new Promise<{ids:string[]; next?:MemoryExhibitCursor}>((resolve,reject) => {
      const request = transaction.objectStore('sharedMemories').index('[worldId+createdAt]').openKeyCursor(
        IDBKeyRange.bound([worldId, -Infinity], [worldId, after?.createdAt ?? Infinity]), 'prev');
      const ids:string[]=[];
      let last:MemoryExhibitCursor | undefined;
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve({ids}); return; }
        const createdAt = (cursor.key as [string,number])[1], id = cursor.primaryKey as string;
        if (after && createdAt === after.createdAt && id >= after.id) {
          // Seeking the duplicate key/primary-key pair also works if the boundary
          // row was deleted between pages. Equality alone advances once more.
          if (id > after.id) cursor.continuePrimaryKey([worldId,after.createdAt], after.id);
          else cursor.continue();
          return;
        }
        if (ids.length === MEMORY_EXHIBIT_PAGE_SIZE) { resolve({ids,next:last}); return; }
        ids.push(id); last={createdAt,id}; cursor.continue();
      };
    });
    const rows = await db.sharedMemories.bulkGet(keys.ids);
    return {available:true,next:keys.next,items:rows.filter((row):row is SharedMemory => !!row && row.userId === userId && row.worldId === worldId)};
  });
}

/** Refresh only displayed identities; no candidate or source scan per card. */
export async function readCurrentExhibitRows(userId:string, worldId:string, ids:string[]):Promise<MemoryExhibitPage> {
  return db.transaction('r', db.worlds, db.sharedMemories, async () => {
    const world = await db.worlds.get(worldId);
    if (world?.userId !== userId) return {available:false,items:[]};
    const rows = await db.sharedMemories.bulkGet(ids);
    return {available:true,items:rows.filter((row):row is SharedMemory => !!row && row.userId === userId && row.worldId === worldId)
      .sort((a,b) => b.createdAt-a.createdAt || (a.id<b.id?1:a.id>b.id?-1:0))};
  });
}
