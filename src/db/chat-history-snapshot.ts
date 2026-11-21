import {db,type Message} from './index';
import {messageEvidenceKey} from './message-evidence-key';

/** Synchronize loaded UI candidates with committed revisions. This is not an
 * authorization decision: the sender still checks ownership and suppression.
 * Read exact index keys for unchanged rows and bodies only for changed ids. */
export async function refreshLoadedChatSources(sessionId:string,messages:Message[]):Promise<Message[]>{
  if(!messages.length)return [];
  return db.transaction('r',db.messages,async()=>{
    const live=new Set(await db.messages.where('sourceEvidenceKey').anyOf(messages.map(messageEvidenceKey)).primaryKeys());
    const changedIds=messages.filter(message=>!live.has(message.id)).map(message=>message.id);
    const replacements=new Map((await db.messages.bulkGet(changedIds)).filter(message=>!!message&&message.sessionId===sessionId).map(message=>[message!.id,message!]));
    return messages.flatMap(message=>live.has(message.id)?[message]:replacements.has(message.id)?[replacements.get(message.id)!]:[])
      .sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  });
}
