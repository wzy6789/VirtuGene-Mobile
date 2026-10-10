import {db,type MemoryItem,type Message} from '../db';

/** Only raw, currently valid private-chat evidence for memories actually kept
 * in this request. Never turn a generated memory summary into user speech. */
export async function readRecalledUserHabitSources(userId:string,characterId:string,selected:MemoryItem[],suppressed:ReadonlySet<string>):Promise<Message[]> {
  if(!selected.length)return [];
  const candidates=selected.slice(0,12);
  const current=await db.memories.bulkGet(candidates.map(memory=>memory.id));
  const eligible=current.filter((memory,index):memory is MemoryItem=>!!memory
    &&memory.userId===userId&&memory.characterId===characterId
    &&(memory.status??'active')==='active'&&memory.content===candidates[index].content
    &&memory.type!=='summary'&&memory.memoryKind!=='character-life'
    &&!memory.importedFromCharacterId&&!!memory.sourceMessageIds?.length);
  // Bound reads rather than scanning conversations. An oversized dependent
  // source batch is omitted intact, never silently certified from a fragment.
  let remaining=64;
  const bounded=eligible.filter(memory=>{
    const count=memory.sourceMessageIds!.length;
    if(count>remaining)return false;
    remaining-=count;return true;
  });
  const ids=[...new Set(bounded.flatMap(memory=>memory.sourceMessageIds!))];
  const originals=await db.messages.bulkGet(ids);
  const byId=new Map(originals.filter((message):message is Message=>!!message).map(message=>[message.id,message]));
  const sessions=await db.sessions.bulkGet([...new Set(originals.flatMap(message=>message?[message.sessionId]:[]))]);
  const sessionsById=new Map(sessions.filter(session=>!!session).map(session=>[session.id,session]));
  const statements=new Map<string,Message>();
  for(const memory of bounded) {
    const valid=memory.sourceMessageIds!.map(id=>{
      const message=byId.get(id),session=message?sessionsById.get(message.sessionId):undefined;
      if(!message||message.failed||suppressed.has(id)||message.role!=='user'||message.secretaryDispatch?.bodyOrigin==='composed'
        ||!session||session.userId!==userId||session.characterId!==characterId
        ||memory.sourceSessionId&&memory.sourceSessionId!==session.id
        ||memory.sourceMessageRevisions?.[id]!==undefined&&memory.sourceMessageRevisions[id] !== (message.revision??1))return undefined;
      const start=memory.sourceMessageOffsets?.[id]??0,end=memory.sourceMessageEndOffsets?.[id]??message.content.length;
      if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>message.content.length||end-start>8000)return undefined;
      // A prefix cut before “吗/如果…” must not become a complete assertion.
      // Only complete sentence boundaries qualify as standalone evidence.
      if(start>0&&!/[。！？!?；;\n]/u.test(message.content[start-1])
        ||end<message.content.length&&!/[。！？!?；;\n]/u.test(message.content[end-1]))return undefined;
      return {...message,content:message.content.slice(start,end)};
    });
    if(memory.sourceEvidenceMode!=='independent'&&valid.some(message=>!message))continue;
    for(const message of valid)if(message)statements.set(message.id+'\0'+message.content,message);
  }
  return [...statements.values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
}
