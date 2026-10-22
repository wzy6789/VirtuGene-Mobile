import Dexie from 'dexie';
import { db, type Message } from '../db/index';
import { historySearchGrams, normalizeHistorySearchText, messageHistoryIdentity, messageHistoryProjection, type HistorySearchEntry } from '../db/message-history-index';
import { hasActiveChatRequest } from './chat/request-coordinator';

let backfill: Promise<void> | undefined;
const idle = () => new Promise<void>(resolve => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), {timeout: 1500});
  else setTimeout(resolve, 100);
});

/** Bounded, restartable upgrade. Incomplete sessions merge indexed and missing originals. */
export function scheduleHistorySearchBackfill(): void {
  void backfillHistorySearchIndex().catch(() => undefined);
}

export function backfillHistorySearchIndex(): Promise<void> {
  if (backfill) return backfill;
  // A recall can request maintenance from inside its read-only transaction.
  // Do not inherit that transaction across idle timers: it will have closed
  // before the next batch, otherwise upgrades silently stop making progress.
  const pending = Dexie.ignoreTransaction(() => runHistorySearchBackfill());
  backfill = pending;
  void pending.then(() => { if (backfill === pending) backfill = undefined; },
    () => { if (backfill === pending) backfill = undefined; });
  return pending;
}

async function runHistorySearchBackfill(): Promise<void> {
  if (await db.messages.count() === await db.messageHistorySearch.count()) return;
  let after: string | undefined;
  for (;;) {
    await idle();
    if (!db.isOpen()) return;
    if (hasActiveChatRequest()) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
    const ids = await (after === undefined ? db.messages.orderBy(':id') : db.messages.where(':id').above(after)).limit(100).primaryKeys();
    if (!ids.length) return;
    await db.transaction('rw', db.messages, db.messageHistorySearch, async () => {
      const rows = await db.messages.bulkGet(ids);
      const existing = await db.messageHistorySearch.bulkGet(rows.map(row => row ? messageHistoryIdentity(row) : ''));
      // Never rewrite the archive just to build its index. The same transaction
      // locks message edits/deletions until the derived batch commits.
      const missing = rows.flatMap((row, i) => row && !existing[i] ? [messageHistoryProjection(row)] : []);
      if (missing.length) await db.messageHistorySearch.bulkPut(missing);
    });
    after = String(ids[ids.length - 1]);
  }
}

export interface IndexedHistoryHit { row: Message; score: number }
type HistorySearchRequest={sessionId:string;terms:string[];exactQuery:string;excluded:ReadonlySet<string>;preferAssistant:boolean;now:number;limit:number};
type RankedHistoryHit={entry:HistorySearchEntry;score:number};
const baseHistoryScore=(entry:HistorySearchEntry,p:HistorySearchRequest)=>Math.max(0,1-Math.max(0,(p.now-entry[2])/86400000)/365)
  +Number(p.preferAssistant?entry[4]===1:entry[5]===1)*4;
const compareHistoryHits=(a:RankedHistoryHit,b:RankedHistoryHit)=>b.score-a.score||b.entry[2]-a.entry[2]
  ||(a.entry[3]<b.entry[3]?-1:a.entry[3]>b.entry[3]?1:0);

/** Exact bounded optimization, not a newest-N approximation. Primary keys
 * are time ordered only within the same positive decimal width. Other dates,
 * difficult ties or insufficient progress use the unchanged exhaustive path. */
async function searchCommonTerm(p:HistorySearchRequest,term:string,possible:ReadonlySet<string>):Promise<IndexedHistoryHit[]|undefined>{
  if(p.terms.some(value=>value.length<2))return;
  const range=db.messages.where('[sessionId+createdAt+id]').between([p.sessionId,Dexie.minKey,Dexie.minKey],[p.sessionId,Dexie.maxKey,Dexie.maxKey]);
  const [first,last]=await Promise.all([range.clone().limit(1).keys(),range.clone().reverse().limit(1).keys()]);
  const firstKey=first[0],lastKey=last[0];
  const oldest=Array.isArray(firstKey)&&typeof firstKey[1]==='number'?firstKey[1]:undefined;
  const newest=Array.isArray(lastKey)&&typeof lastKey[1]==='number'?lastKey[1]:undefined;
  if(oldest===undefined||newest===undefined||oldest<1e12||newest>=1e13||!Number.isFinite(oldest)||!Number.isFinite(newest))return;
  const active=p.terms.filter(value=>possible.has(value));
  const exact=p.exactQuery.length>=4&&possible.has(p.exactQuery);
  const simple=active.every(value=>value===term)&&!exact;
  const weight=active.length*2+Number(exact)*20;
  const outsideWeight=active.filter(value=>!value.includes(term)).length*2+Number(exact&&!p.exactQuery.includes(term))*20;
  const best:Array<RankedHistoryHit&{key:string;row?:Message}>=[];
  for(let offset=0;offset<128;offset+=32){
    // A difficult multi-term trial must not add hundreds of body reads before
    // falling back to the established gram-intersection algorithm.
    if(!simple&&offset>=32)return;
    const keys=await db.messageHistorySearch.where('entries').equals([p.sessionId,term]).reverse().offset(offset).limit(32).primaryKeys();
    let frontier:HistorySearchEntry|undefined;
    const candidates:Array<{entry:HistorySearchEntry;key:string}>=[];
    for(const key of keys){
      const [sessionId,createdAt,id,assistant,authored,revision]=JSON.parse(key);
      if(sessionId!==p.sessionId||typeof createdAt!=='number'||createdAt<oldest||createdAt>newest)return;
      const entry:HistorySearchEntry=[sessionId,term,createdAt,id,assistant,authored,revision];frontier=entry;
      if(p.excluded.has(id))continue;
      candidates.push({entry,key});
    }
    const candidateRows=simple?[]:await db.messages.bulkGet(candidates.map(hit=>hit.entry[3]));
    if(!simple&&candidateRows.some((row,index)=>!row||row.failed||messageHistoryIdentity(row)!==candidates[index].key))return;
    for(const [index,{entry,key}] of candidates.entries()){
      const row=candidateRows[index];
      const content=row?normalizeHistorySearchText(row.content):'';
      if(!simple&&!content.includes(term))return;
      const actualWeight=simple?weight:p.terms.reduce((sum,value)=>sum+Number(content.includes(value))*2,0)+Number(p.exactQuery.length>=4&&content.includes(p.exactQuery))*20;
      best.push({entry,key,row,score:actualWeight+baseHistoryScore(entry,p)});best.sort(compareHistoryHits);if(best.length>p.limit)best.pop();
    }
    // Every unseen row is older than the frontier and can earn at most the
    // preferred-speaker bonus. Strict inequality preserves timestamp/id ties.
    const upper=frontier?weight+Math.max(0,1-Math.max(0,(p.now-frontier[2])/86400000)/365)+4:Infinity;
    const exhausted=keys.length<32;
    const dominatesOutside=outsideWeight===0||best.length>=p.limit&&outsideWeight+5<best[best.length-1].score;
    if(dominatesOutside&&(exhausted||best.length>=p.limit&&upper<best[best.length-1].score)){
      const originals=simple?await db.messages.bulkGet(best.map(hit=>hit.entry[3])):best.map(hit=>hit.row);
      if(originals.some((row,index)=>!row||row.failed||messageHistoryIdentity(row)!==best[index].key||!normalizeHistorySearchText(row.content).includes(term)))return;
      return best.map((hit,index)=>({row:originals[index]!,score:hit.score}));
    }
  }
  // This cap limits only the attempted optimization, never retrieval coverage.
  return undefined;
}

/** Same substring score as the legacy scan, using postings before reading originals.
 * Two-character terms match exactly. Longer terms intersect grams then verify
 * the original substring; an intersection alone is never considered evidence. */
export async function searchIndexedHistorySession(p: HistorySearchRequest): Promise<IndexedHistoryHit[] | undefined> {
  return db.transaction('r', db.messages, db.messageHistorySearch, async () => {
    const [total, indexed] = await Promise.all([
      db.messages.where('sessionId').equals(p.sessionId).count(),
      db.messageHistorySearch.where('sessionId').equals(p.sessionId).count(),
    ]);
    // Both counts share this read transaction. No original or posting can
    // match an empty session; a mismatched derived store still falls back below.
    if (total === 0 && indexed === 0) return [];
    let missingSourceIds: string[] = [];
    if (total !== indexed) {
      scheduleHistorySearchBackfill();
      const [allIds, builtKeys] = await Promise.all([
        db.messages.where('sessionId').equals(p.sessionId).primaryKeys(),
        db.messageHistorySearch.where('sessionId').equals(p.sessionId).primaryKeys(),
      ]);
      const builtIds = new Set<string>(builtKeys.map(key => JSON.parse(key)[2]));
      missingSourceIds = allIds.filter(id => !builtIds.has(id));
      // A damaged/unexpected derived store is never allowed to hide originals.
      // Normally hooks make the count difference exactly the missing rows.
      if (total - indexed !== missingSourceIds.length) return undefined;
    }
    const phrases = [...p.terms, ...(p.exactQuery.length >= 4 ? [p.exactQuery] : [])];
    const grams = [...new Set(phrases.flatMap(historySearchGrams))];
    // Empty/one-row postings are already complete. Reuse these tiny native
    // probes if a complex query needs the full scoring path below.
    const probes=new Map(await Promise.all(grams.map(async gram=>[gram,await db.messageHistorySearch.where('entries').equals([p.sessionId,gram]).limit(2).primaryKeys()] as const)));
    const possible=[...new Set(phrases.filter(phrase=>{const terms=historySearchGrams(phrase);return terms.length>0&&terms.every(gram=>{
      const probe=probes.get(gram)!;
      // A complete tiny posting containing only the current/excluded input is
      // not an archive candidate. Two rows may hide further eligible rows, so
      // keep that case conservatively possible and retain the full fallback.
      return probe.length===2||probe.some(key=>!p.excluded.has(JSON.parse(key)[2]));
    });}))];
    const anchor=p.terms.find(term=>term.length===2&&possible.includes(term));
    if(!missingSourceIds.length&&anchor){
      const fast=await searchCommonTerm(p,anchor,new Set(possible));if(fast!==undefined)return fast;
    }
    const postings = new Map<string, Map<string, HistorySearchEntry>>();
    const decodedKeys = new Map<string, HistorySearchEntry>();
    await Promise.all(grams.map(async gram => {
      // Native getAllKeys returns encoded primary keys in bulk. Do not use
      // index.keys(): that iterates a JS cursor for every matching message.
      const probe=probes.get(gram)!;
      const keys = probe.length<2?probe:await db.messageHistorySearch.where('entries').equals([p.sessionId, gram]).primaryKeys();
      const entries: HistorySearchEntry[] = keys.map(key => {
        const cached = decodedKeys.get(key);
        if (cached) return cached;
        const [sessionId, createdAt, id, assistant, authored, revision] = JSON.parse(key);
        const entry: HistorySearchEntry = [sessionId, gram, createdAt, id, assistant, authored, revision];
        decodedKeys.set(key, entry);
        return entry;
      });
      postings.set(gram, new Map(entries.filter(entry => !p.excluded.has(entry[3])).map(entry => [entry[3], entry])));
    }));
    const candidates = (phrase: string): Map<string, HistorySearchEntry> => {
      const groups = historySearchGrams(phrase).map(gram => postings.get(gram)!);
      if (!groups.length) return new Map();
      groups.sort((a, b) => a.size - b.size);
      return new Map([...groups[0]].filter(([id]) => groups.every(group => group.has(id))));
    };
    const phraseCandidates = phrases.map(candidates);
    const uncertainIds = [...new Set(phraseCandidates.flatMap((group, i) => phrases[i].length > 2 ? [...group.keys()] : []))];
    const uncertain = new Set(uncertainIds);
    const scores = new Map<string, {entry: HistorySearchEntry; matches: number; exact: boolean}>();
    phraseCandidates.forEach((group, i) => {
      for (const [id, entry] of group) {
        const score = scores.get(id) ?? {entry, matches: 0, exact: false};
        if (i < p.terms.length) score.matches++;
        else score.exact = true;
        scores.set(id, score);
      }
    });
    const baseScore = (entry: HistorySearchEntry) => baseHistoryScore(entry,p);
    type Ranked = {entry: HistorySearchEntry; score: number};
    // Legacy paging visits tied timestamps in primary-key order. Preserve that
    // order when equally scoring terms entered the posting maps differently.
    const compare = compareHistoryHits;
    const best: Ranked[] = [];
    const retain = (hit: Ranked) => {
      if (best.length >= p.limit && compare(hit, best[best.length - 1]) >= 0) return;
      const at = best.findIndex(other => compare(hit, other) < 0);
      best.splice(at < 0 ? best.length : at, 0, hit);
      if (best.length > p.limit) best.pop();
    };
    const pending: Ranked[] = [];
    for (const hit of scores.values()) {
      if (!hit.matches) continue;
      const ranked = {entry: hit.entry, score: Number(hit.exact) * 20 + hit.matches * 2 + baseScore(hit.entry)};
      if (uncertain.has(hit.entry[3])) pending.push(ranked);
      else retain(ranked);
    }
    // A gram intersection gives an upper score, not proof of the phrase.
    // Verify in descending upper-bound order. Once no candidate can beat the
    // actual Kth score (including date ties), all remaining bodies are irrelevant.
    const originals = new Map<string, Message>();
    // Old sessions benefit immediately from their completed batches. Only the
    // as-yet-unindexed originals are scanned; their exact scores compete with
    // indexed candidates. Nothing is truncated or silently deferred.
    for (let i = 0; i < missingSourceIds.length; i += 100) {
      const rows = await db.messages.bulkGet(missingSourceIds.slice(i, i + 100));
      for (const row of rows) {
        if (!row || row.failed || p.excluded.has(row.id) || !['user', 'assistant'].includes(row.role)) continue;
        const text = normalizeHistorySearchText(row.content);
        const matches = p.terms.reduce((sum, term) => sum + Number(text.includes(term)), 0);
        if (!matches) continue;
        const entry: HistorySearchEntry = [row.sessionId, '', row.createdAt, row.id, Number(row.role === 'assistant'),
          Number(row.role === 'user' && row.secretaryDispatch?.bodyOrigin !== 'composed'), row.revision ?? 1];
        retain({entry, score: matches * 2 + Number(p.exactQuery.length >= 4 && text.includes(p.exactQuery)) * 20 + baseScore(entry)});
        if (best.some(hit => hit.entry[3] === row.id)) originals.set(row.id, row);
        for (const id of originals.keys()) if (!best.some(hit => hit.entry[3] === id)) originals.delete(id);
      }
    }
    pending.sort(compare);
    for (let i = 0; i < pending.length;) {
      if (best.length >= p.limit && compare(pending[i], best[best.length - 1]) > 0) break;
      const batch = pending.slice(i, i + 32); i += batch.length;
      const rows = await db.messages.bulkGet(batch.map(hit => hit.entry[3]));
      rows.forEach((row, index) => {
        const hit = batch[index];
        if (!row || row.failed || row.sessionId !== p.sessionId || (row.revision ?? 1) !== hit.entry[6]) return;
        originals.set(row.id, row);
        const content = normalizeHistorySearchText(row.content);
        const matches = p.terms.reduce((sum, term) => sum + Number(content.includes(term)), 0);
        if (matches) retain({entry: hit.entry, score: matches * 2 + Number(p.exactQuery.length >= 4 && content.includes(p.exactQuery)) * 20 + baseScore(hit.entry)});
      });
    }
    const missingIds = best.filter(hit => !originals.has(hit.entry[3])).map(hit => hit.entry[3]);
    for (const row of await db.messages.bulkGet(missingIds)) if (row) originals.set(row.id, row);
    return best.flatMap(hit => {
      const row = originals.get(hit.entry[3]);
      return row && !row.failed && row.sessionId === p.sessionId && (row.revision ?? 1) === hit.entry[6]
        && ['user', 'assistant'].includes(row.role) ? [{row, score: hit.score}] : [];
    });
  });
}
