import {db,type Character,type Message} from '../../src/db';
import {emptyChatConversationState} from '../../src/lib/chat-conversation-state';
import {advanceExplicitTopics} from '../../src/lib/chat-topic-outcomes';
import {appendTopicReplyEvidence} from '../../src/lib/chat-topic-replies';
import {readValidatedConversation,updateConversationIfCurrent} from '../../src/db/chat-topic-state-repo';
import {collectSyncData,importSyncData,type SyncExportData} from '../../src/lib/sync';
import {messageRepo} from '../../src/db/message-repo';

type Check={name:string;ok:boolean;detail?:unknown};
const principal={sessionId:'reply-roundtrip-session',userId:'reply-roundtrip-owner',characterId:'reply-roundtrip-role'};
const stamp=1792370000000;
const checks:Check[]=[];
let unexpectedNetworkCalls=0;
window.fetch=async()=>{unexpectedNetworkCalls++;throw Error('Network is forbidden in the reply roundtrip fixture');};
function check(name:string,ok:unknown,detail?:unknown){checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});}
const responses=(state:any)=>state?.topics?.flatMap((topic:any)=>topic.responses??[])??[];
const userFacts=(state:any)=>state?.topics?.map(({responses:_responses,...topic}:any)=>topic);
const json=(value:unknown)=>JSON.stringify(value);

async function freshDatabase(){await db.delete();await db.open();}
async function seed(){
  await freshDatabase();
  const character:Character={id:principal.characterId,name:'合成同步角色',avatar:'🌙',systemPrompt:'合成验证，不连接模型。',tags:[],isPreset:false,isCustom:true,published:false,createdBy:principal.userId,createdAt:stamp,proactivity:0,signature:'隔离',greeting:'你好'};
  await db.characters.add(character);
  await db.sessions.add({id:principal.sessionId,userId:principal.userId,characterId:principal.characterId,title:character.name,createdAt:stamp,updatedAt:stamp+10});
  const plan:Message={id:'reply-roundtrip-plan',sessionId:principal.sessionId,role:'user',content:'周六14点去博物馆，坐地铁。',createdAt:stamp+1,isProactive:false,revision:1};
  const question:Message={id:'reply-roundtrip-question',sessionId:principal.sessionId,role:'user',content:'刚才安排是几点？',createdAt:stamp+2,isProactive:false,revision:1};
  const reply:Message={id:'reply-roundtrip-answer',sessionId:principal.sessionId,role:'assistant',content:'是14点。',createdAt:stamp+3,isProactive:false,revision:1,replyCompletion:'complete',replyToUserMessageId:question.id};
  await db.messages.bulkAdd([plan,question,reply]);
  let state={...emptyChatConversationState(),...advanceExplicitTopics({}, {message:plan,domain:'user-reality',utcOffsetMinutes:480})};
  state={...state,...advanceExplicitTopics(state,{message:question,domain:'user-reality',utcOffsetMinutes:480})};
  const next=appendTopicReplyEvidence(state,question,[reply],'user-reality');
  check('legal-helper-creates-response-with-user-only-facts',responses(next).length===1&&responses(next)[0].acts.some((act:any)=>act.kind==='answered-slot'&&act.value==='14点')&&next.topics?.[0].slots.time.source.every(ref=>ref.messageId===plan.id),next);
  check('real-repository-accepts-source-backed-response',await updateConversationIfCurrent(principal,0,next));
  const read=await readValidatedConversation(principal);
  check('seed-validates-real-durable-sources',responses(read?.conversation).length===1&&read?.invalidatedIds.length===0&&read?.invalidatedReplyIds?.length===0,read);
  return {plan,question,reply,state:read!.conversation!};
}
async function restoreSnapshot(snapshot:SyncExportData){
  await freshDatabase();
  const result=await importSyncData(JSON.parse(json(snapshot)));
  check('fresh-import-success',result.ok&&result.counts?.sessions===1&&result.counts.messages===3,result);
  return result;
}
function keepsFactsAndDropsReply(name:string,read:Awaited<ReturnType<typeof readValidatedConversation>>,facts:unknown,replyId:string){
  check(name+'-drops-only-response',!!read&&responses(read.conversation).length===0&&read.invalidatedReplyIds?.includes(replyId)&&read.invalidatedIds.length===0,read);
  check(name+'-preserves-user-facts-exactly',json(userFacts(read?.conversation))===json(facts),read?.conversation);
  check(name+'-retains-pending-plan-and-user-time',read?.conversation?.topics?.[0].outcome==='pending'&&read.conversation.topics[0].slots.time.value==='14点',read?.conversation?.topics);
}

(window as any).runTopicReplyRoundtrip=async()=>{
  const seeded=await seed(),record=responses(seeded.state)[0],facts=userFacts(seeded.state);
  const collected=await collectSyncData(principal.userId,'合成同步用户');
  const serialized=json(collected),snapshot=JSON.parse(serialized) as SyncExportData;
  check('collect-sync-exports-original-response-fields',json(responses(collected.sessions[0].conversation))===json([record]));
  check('collect-sync-exports-completion-metadata',collected.messages.find(row=>row.id===seeded.reply.id)?.replyCompletion==='complete');
  check('actual-json-wire-retains-response-and-completion',json(responses(snapshot.sessions[0].conversation))===json([record])&&snapshot.messages.find(row=>row.id===seeded.reply.id)?.replyCompletion==='complete');
  check('serialized-payload-has-only-owned-session-and-sources',snapshot.__meta__.userId===principal.userId&&snapshot.sessions.length===1&&snapshot.messages.length===3&&snapshot.messages.every(row=>row.sessionId===principal.sessionId));

  await restoreSnapshot(snapshot);
  let imported=await readValidatedConversation(principal);
  check('import-native-idb-preserves-exact-response-record',json(responses((await db.sessions.get(principal.sessionId))?.conversation))===json([record]));
  check('import-native-idb-preserves-complete-response-message',json(await db.messages.get(seeded.reply.id))===json(seeded.reply));
  check('import-validated-response-is-not-invalidated',json(responses(imported?.conversation))===json([record])&&imported?.invalidatedIds.length===0&&imported.invalidatedReplyIds?.length===0,imported);
  check('import-preserves-user-facts-exactly',json(userFacts(imported?.conversation))===json(facts));
  check('import-preserves-conversation-cas-version',imported?.version===seeded.state.version,{before:seeded.state.version,after:imported?.version});
  db.close();await db.open();
  imported=await readValidatedConversation(principal);
  check('database-close-open-still-validates-imported-response',json(responses(imported?.conversation))===json([record]));
  const recollected=JSON.parse(json(await collectSyncData(principal.userId,'合成同步用户'))) as SyncExportData;
  check('second-real-export-preserves-response-evidence',json(responses(recollected.sessions[0].conversation))===json([record]));
  check('second-real-export-preserves-completion-state',recollected.messages.find(row=>row.id===seeded.reply.id)?.replyCompletion==='complete');

  check('real-message-repository-edits-imported-assistant',await messageRepo.update(seeded.reply.id,{content:'是15点。'})===1);
  const editedRow=await db.messages.get(seeded.reply.id);
  check('actual-edit-increments-source-revision',editedRow?.revision===2&&editedRow.content==='是15点。',editedRow);
  keepsFactsAndDropsReply('after-imported-source-edit',await readValidatedConversation(principal),facts,record.id);
  const editReimport=await importSyncData(JSON.parse(serialized));
  check('old-snapshot-reimport-after-edit-succeeds-without-old-message',editReimport.ok&&(await db.messages.get(seeded.reply.id))?.revision===2&&(await db.messages.get(seeded.reply.id))?.content==='是15点。',editReimport);
  keepsFactsAndDropsReply('old-snapshot-cannot-reactivate-edited-response',await readValidatedConversation(principal),facts,record.id);

  await restoreSnapshot(snapshot);
  await messageRepo.deleteById(seeded.reply.id);
  check('real-message-repository-deletes-imported-assistant',await db.messages.get(seeded.reply.id)===undefined);
  check('real-delete-creates-owned-source-tombstone',await db.memorySourceTombstones.where('userId').equals(principal.userId).filter(row=>row.sourceType==='message'&&row.sourceId===seeded.reply.id&&row.status==='deleted').count()===1);
  keepsFactsAndDropsReply('after-imported-source-delete',await readValidatedConversation(principal),facts,record.id);
  const deleteReimport=await importSyncData(JSON.parse(serialized));
  check('old-snapshot-reimport-cannot-recreate-deleted-source',deleteReimport.ok&&await db.messages.get(seeded.reply.id)===undefined,deleteReimport);
  keepsFactsAndDropsReply('old-snapshot-cannot-reactivate-deleted-response',await readValidatedConversation(principal),facts,record.id);

  const deletedExport=JSON.parse(json(await collectSyncData(principal.userId,'合成同步用户'))) as SyncExportData;
  check('post-delete-real-export-retains-tombstone-without-assistant-source',deletedExport.sourceTombstones?.some(row=>row.sourceType==='message'&&row.sourceId===seeded.reply.id&&row.status==='deleted')&&!deletedExport.messages.some(row=>row.id===seeded.reply.id));
  await freshDatabase();
  const finalImport=await importSyncData(deletedExport);
  check('post-delete-snapshot-import-success',finalImport.ok,finalImport);
  keepsFactsAndDropsReply('tombstone-roundtrip-does-not-resurrect-response',await readValidatedConversation(principal),facts,record.id);
  check('zero-model-or-network-calls',unexpectedNetworkCalls===0,unexpectedNetworkCalls);
  const result={complete:checks.every(check=>check.ok),checks,failures:checks.filter(check=>!check.ok),serializedCharacters:serialized.length,record,sourceRows:[seeded.plan,seeded.question,seeded.reply],collectedSnapshot:snapshot,editReimport,deleteReimport,finalImport,unexpectedNetworkCalls,apiCalls:0,scope:'Real collectSyncData / JSON serialize / delete isolated native IndexedDB / importSyncData / source-validated read. No send-service, API, private data, audio, Android or component rendering.'};
  await db.delete();
  return result;
};
