import {db,type Session} from '../../db';
import {findModel} from '../ai/model-selection';

/** Provider metadata only: no prompt, reply or credential. */
export interface ChatUsageEvent {
  modelId:string;
  usage?:{inputTokens:number;outputTokens:number};
  /** An older native bridge cannot prove whether internal retries occurred. */
  incomplete?:boolean;
}

export async function appendSessionUsage(sessionId:string,userId:string,events:ChatUsageEvent[],isCurrentAccount:()=>boolean):Promise<Session['cost']> {
  if(!events.length||!isCurrentAccount())return undefined;
  return db.transaction('rw',db.sessions,async()=>{
    const session=await db.sessions.get(sessionId);
    if(!session||session.userId!==userId||!isCurrentAccount())return undefined;
    const previous=session.cost??{calls:0,inputTokens:0,outputTokens:0,cost:0};
    const next:NonNullable<Session['cost']>={...previous,perAttemptAccounting:true};
    if(session.cost&&previous.calls>0&&!previous.perAttemptAccounting)next.incomplete=true;
    for(const event of events) {
      next.calls++;
      const usage=event.usage;
      if(!usage||!Number.isFinite(usage.inputTokens)||!Number.isFinite(usage.outputTokens)||usage.inputTokens<0||usage.outputTokens<0) {
        next.unknownUsageCalls=(next.unknownUsageCalls??0)+1;
        next.incomplete=true;
        continue;
      }
      next.inputTokens+=usage.inputTokens;
      next.outputTokens+=usage.outputTokens;
      const price=findModel(event.modelId)?.pricing;
      if(price)next.cost+=(usage.inputTokens*price.in+usage.outputTokens*price.out)/1_000_000;
      else next.incomplete=true;
      if(event.incomplete)next.incomplete=true;
    }
    if(!isCurrentAccount())return undefined;
    await db.sessions.update(sessionId,{cost:next});
    return next;
  });
}
