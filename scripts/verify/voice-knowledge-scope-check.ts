import { db } from '../../src/db';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
/** Independent old-query oracle, including stable ordering, optional owner and limits. */
export async function verifyKnowledgeScope() {
  const levels = ['none','hint','partial','full'] as const;
  await db.characterKnowledge.bulkPut(Array.from({length:12},(_,i)=>({id:`scope-contract-${i}`,userId:i%2?'u':'foreign',worldId:i%3?'w':'elsewhere',characterId:'scope-role',eventId:`scope-event-${i}`,knowledgeLevel:levels[i%4],canMention:i%2===0,learnedAt:Math.floor(i/3)})));
  for(const userId of [undefined,'u','foreign'])for(const minLevel of levels)for(const limit of [0,1,4,200]){
    const rows=await db.characterKnowledge.where('characterId').equals('scope-role').toArray();
    const expected=rows.filter(r=>r.worldId==='w'&&(userId===undefined||r.userId===userId)&&levels.indexOf(r.knowledgeLevel)>=levels.indexOf(minLevel))
      .sort((a,b)=>b.learnedAt-a.learnedAt).slice(0,Math.max(1,limit));
    const actual=await knowledgeRepo.listKnownBy('scope-role','w',{userId,minLevel,limit});
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Scoped knowledge query changed filtering/order/limit semantics');
  }
  const before=await knowledgeRepo.listKnownBy('scope-role','w',{userId:'u',minLevel:'none'});
  const row=before[0]; if(!row)throw Error('Scope fixture absent');
  await db.characterKnowledge.update(row.id,{worldId:'elsewhere'});
  if((await knowledgeRepo.listKnownBy('scope-role','w',{userId:'u',minLevel:'none'})).some(r=>r.id===row.id))throw Error('Moved knowledge remained in next fresh read');
  await db.characterKnowledge.update(row.id,{worldId:'w',knowledgeLevel:'none',canMention:false});
  if((await knowledgeRepo.listKnownBy('scope-role','w',{userId:'u',minLevel:'full'})).some(r=>r.id===row.id))throw Error('Revoked knowledge remained full');
}
