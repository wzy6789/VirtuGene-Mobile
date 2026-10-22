import {db,type Message} from './index';
import {messageRepo,type MessagePageCursor} from './message-repo';
import {memorySourceTombstoneRepo} from './memory-source-tombstone-repo';

/** Small, stable pages; caller owns the surrounding account/session transaction. */
export const CHAT_ARCHIVE_PAGE_SIZE=64;

export interface RecentChatMessageOptions {
  limit:number;
  /** Failed sends still carry user facts; failed assistant text never does. */
  allowFailedUser:boolean;
  /** A summary may quote assistant dispatches; personal analysis must not. */
  includeComposed:boolean;
}

function eligible(message:Message,options:RecentChatMessageOptions):boolean{
  return (!message.failed||options.allowFailedUser&&message.role==='user')
    &&(options.includeComposed||message.secretaryDispatch?.bodyOrigin!=='composed');
}

/** Read just enough newest eligible bodies, preserving timestamp/id order and
 * empty-text slots. Suppressions are checked only for each selected page; this
 * deliberately keeps walking when pages are wholly suppressed or failed. */
export async function readRecentChatMessages(userId:string,characterId:string,sessionId:string,options:RecentChatMessageOptions):Promise<Message[]>{
  const limit=Math.max(0,Math.floor(options.limit));
  if(!userId||!characterId||!sessionId||!Number.isFinite(limit)||!limit)return [];
  const newest:Message[]=[];
  let beforeMessage:MessagePageCursor|undefined;
  while(newest.length<limit){
    const page=await messageRepo.getRangePage(sessionId,{beforeMessage,direction:'backward',limit:CHAT_ARCHIVE_PAGE_SIZE});
    if(!page.length)break;
    const suppressed=await memorySourceTombstoneRepo.selectedSuppressedMessages(userId,characterId,page.map(message=>message.id));
    for(let index=page.length-1;index>=0&&newest.length<limit;index--){
      const message=page[index];
      if(eligible(message,options)&&!suppressed.has(message.id))newest.push(message);
    }
    beforeMessage={createdAt:page[0].createdAt,id:page[0].id};
    if(page.length<CHAT_ARCHIVE_PAGE_SIZE)break;
  }
  return newest.reverse();
}

/** The settlement gate counts eligible users in the whole conversation, while
 * its model input remains the bounded recent window. Only rare insufficient
 * windows enter this indexed user-only scan: no assistant bodies are loaded.
 * Offset skips index positions; an all-ineligible archive still scans user
 * pages and incurs repeated cursor positioning, rather than constant work. */
export async function hasEligibleChatUsers(userId:string,characterId:string,sessionId:string,recent:readonly Message[],minimum:number):Promise<boolean>{
  let found=recent.filter(message=>message.role==='user').length;
  if(found>=minimum)return true;
  const known=new Set(recent.map(message=>message.id));
  for(let offset=0;;offset+=CHAT_ARCHIVE_PAGE_SIZE){
    const page=await db.messages.where('[sessionId+role]').equals([sessionId,'user']).offset(offset).limit(CHAT_ARCHIVE_PAGE_SIZE).toArray();
    if(!page.length)return false;
    const candidates=page.filter(message=>!known.has(message.id)&&message.secretaryDispatch?.bodyOrigin!=='composed');
    const suppressed=await memorySourceTombstoneRepo.selectedSuppressedMessages(userId,characterId,candidates.map(message=>message.id));
    for(const message of candidates)if(!suppressed.has(message.id)&&++found>=minimum)return true;
    if(page.length<CHAT_ARCHIVE_PAGE_SIZE)return false;
  }
}
