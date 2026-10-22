import Dexie from 'dexie';
import {db,type Message,type Session} from './index';
import {messageRepo,type MessagePageCursor} from './message-repo';
import {memorySourceTombstoneRepo} from './memory-source-tombstone-repo';
import {CHAT_ARCHIVE_PAGE_SIZE,readRecentChatMessages} from './chat-archive-reader';
import {hasLivePrivateSummarySources,summaryCoverageCursor} from '../lib/chat-summary-evidence';
import {buildSummaryBatch,SUMMARY_BATCH_SEGMENTS,type SummaryCursor,type SummarySegment} from '../lib/ai/summary-batches';

export const CHAT_SUMMARY_RECENT_MESSAGES=18;

const COVERED_SOURCE_GROUP_LIMIT=32;
const COVERED_SOURCE_GROUP_MIN=64;
const COVERED_SOURCE_MIN=CHAT_ARCHIVE_PAGE_SIZE*2;

/** A native index proves current revision AND length, not authorization or
 * nonfailed status. Unknown/partial/changed rows always fall back to originals.
 * Grouped getAllKeys avoids a JS key-cursor callback for every old message.
 * Missing revisions do not enter this index and therefore cannot be skipped. */
async function coveredSourceIds(sessionId:string,cursor:SummaryCursor,beforeMessage:MessagePageCursor,afterMessage?:MessagePageCursor):Promise<Set<string>|undefined>{
  const ids=cursor.sourceMessageIds??[];
  if(ids.length<COVERED_SOURCE_MIN)return;
  const interval=db.messages.where('[sessionId+createdAt+id]').between(
    afterMessage?[sessionId,afterMessage.createdAt,afterMessage.id]:[sessionId,Dexie.minKey,Dexie.minKey],
    [sessionId,beforeMessage.createdAt,beforeMessage.id],!afterMessage,false,
  );
  // Do not fetch broad length buckets for a mostly unprocessed archive.
  if(ids.length*2<await interval.count())return;
  const groups=new Map<string,{revision:number;offset:number;ids:Set<string>}>();
  for(const id of ids){
    const revision=cursor.sourceMessageRevisions?.[id],offset=cursor.sourceMessageOffsets?.[id];
    if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1
      ||typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0)continue;
    const key=JSON.stringify([revision,offset]);
    let group=groups.get(key);
    if(!group){group={revision,offset,ids:new Set()};groups.set(key,group);}
    group.ids.add(id);
  }
  const selected=[...groups.values()].filter(group=>group.ids.size>=COVERED_SOURCE_GROUP_MIN)
    .sort((a,b)=>b.ids.size-a.ids.size).slice(0,COVERED_SOURCE_GROUP_LIMIT);
  if(!selected.length)return;
  const matching=await Promise.all(selected.map(group=>db.messages
    .where('[sessionId+revision+content.length]').equals([sessionId,group.revision,group.offset]).primaryKeys()));
  const covered=new Set<string>();
  matching.forEach((keys,i)=>{for(const key of keys)if(typeof key==='string'&&selected[i].ids.has(key))covered.add(key);});
  return covered.size>=COVERED_SOURCE_MIN?covered:undefined;
}

/** Keep native getAll body pages instead of issuing a get for every unknown id.
 * The small extra get locates each next uncovered span; chronological keys also
 * discover older insertions. No last-source bookmark is treated as coverage. */
async function summaryPageReader(sessionId:string,cursor:SummaryCursor,beforeMessage:MessagePageCursor,startAfter?:MessagePageCursor){
  const covered=await coveredSourceIds(sessionId,cursor,beforeMessage,startAfter);
  if(!covered)return (afterMessage:MessagePageCursor|undefined)=>messageRepo.getRangePage(sessionId,{
    afterMessage,beforeMessage,direction:'forward',limit:CHAT_ARCHIVE_PAGE_SIZE,
  });
  const ids=await db.messages.where('[sessionId+createdAt+id]').between(
    startAfter?[sessionId,startAfter.createdAt,startAfter.id]:[sessionId,Dexie.minKey,Dexie.minKey],
    [sessionId,beforeMessage.createdAt,beforeMessage.id],!startAfter,false,
  ).primaryKeys();
  let position=0;
  return async():Promise<Message[]>=>{
    while(position<ids.length&&covered.has(ids[position] as string))position++;
    if(position===ids.length)return [];
    const first=await db.messages.get(ids[position]);
    // IDs and originals share the enclosing readonly snapshot.
    if(!first)throw new Error('Summary candidate disappeared from its snapshot');
    const tail=await messageRepo.getRangePage(sessionId,{
      afterMessage:{createdAt:first.createdAt,id:first.id},beforeMessage,direction:'forward',limit:CHAT_ARCHIVE_PAGE_SIZE-1,
    });
    const page=[first,...tail];
    const end=ids.indexOf(page[page.length-1].id,position);
    if(end<position)throw new Error('Summary candidate order changed within its snapshot');
    position=end+1;
    return page;
  };
}

export interface ChatSummaryArchive {
  session:Session;
  /** Only a still-sourced summary can be merged into a new one. */
  previousSummary?:string;
  cursor:SummaryCursor;
  segments:SummarySegment<Message>[];
}

/** Capture the recent boundary and bounded original segments in one readonly
 * snapshot. A timestamp never grants provenance to a legacy summary. This
 * locates candidates from chronological keys, not a last-source bookmark: an
 * older insertion or changed source must not disappear behind covered text.
 * Diverse legacy offsets/ineligible prefixes can still require body pages. */
export async function captureChatSummaryArchive(userId:string,characterId:string,sessionId:string,isCurrent:()=>boolean):Promise<ChatSummaryArchive|undefined>{
  return db.transaction('r',db.sessions,db.messages,db.memorySourceTombstones,async()=>{
    if(!userId||!isCurrent())return;
    const session=await db.sessions.get(sessionId);
    if(!session||session.userId!==userId||session.characterId!==characterId||session.type==='group')return;
    if(session.summaryAttemptedAt&&Date.now()-session.summaryAttemptedAt<60_000)return;
    const recent=await readRecentChatMessages(userId,characterId,sessionId,{
      limit:CHAT_SUMMARY_RECENT_MESSAGES,allowFailedUser:false,includeComposed:true,
    });
    if(recent.length<CHAT_SUMMARY_RECENT_MESSAGES||!isCurrent())return;
    const sourceIds=session.summarySourceMessageIds??[];
    const suppressed=await memorySourceTombstoneRepo.selectedSuppressedMessages(userId,characterId,sourceIds);
    const validOffsets=sourceIds.every(id=>{
      const offset=session.summarySourceMessageOffsets?.[id];
      return offset===undefined||Number.isSafeInteger(offset)&&offset>=0;
    });
    const usePrevious=validOffsets&&await hasLivePrivateSummarySources(session,userId,characterId,suppressed);
    let cursor:SummaryCursor=usePrevious?summaryCoverageCursor(session):{};
    let previousSummary=usePrevious?session.summary:undefined;
    const beforeMessage={createdAt:recent[0].createdAt,id:recent[0].id};
    // A malformed imported offset must not mark unseen text as processed.
    // Rebuild locally if encountered; final commit also validates all offsets.
    for(let pass=0;pass<2;pass++){
      const segments:SummarySegment<Message>[]=[];
      const knownSourceIds=new Set(cursor.sourceMessageIds??[]);
      let readPage:((afterMessage?:MessagePageCursor)=>Promise<Message[]>)|undefined;
      let afterMessage:MessagePageCursor|undefined,rebuild=false;
      while(segments.length<SUMMARY_BATCH_SEGMENTS&&isCurrent()){
        // Preserve the original first body page: if it already fills a batch,
        // early backfills/long tails need no additional archive-wide key work.
        const probePrefix=!afterMessage&&knownSourceIds.size>=COVERED_SOURCE_MIN;
        const page=probePrefix
          ?await messageRepo.getRangePage(sessionId,{beforeMessage,direction:'forward',limit:CHAT_ARCHIVE_PAGE_SIZE})
          :await(readPage??=await summaryPageReader(sessionId,cursor,beforeMessage,afterMessage))(afterMessage);
        if(!page.length)break;
        const hidden=await memorySourceTombstoneRepo.selectedSuppressedMessages(userId,characterId,page.map(message=>message.id));
        const eligible=page.filter(message=>!message.failed&&!hidden.has(message.id));
        if(previousSummary&&eligible.some(message=>{
          const offset=cursor.sourceMessageOffsets?.[message.id];
          return offset!==undefined&&offset>message.content.length;
        })){rebuild=true;break;}
        segments.push(...buildSummaryBatch(eligible,cursor,SUMMARY_BATCH_SEGMENTS-segments.length,knownSourceIds));
        // Advance past raw rows, including a completely suppressed page.
        const last=page[page.length-1];
        afterMessage={createdAt:last.createdAt,id:last.id};
        if(page.length<CHAT_ARCHIVE_PAGE_SIZE)break;
      }
      if(rebuild){cursor={};previousSummary=undefined;continue;}
      if(!segments.length||!isCurrent())return;
      return {session,previousSummary,cursor,segments};
    }
  });
}
