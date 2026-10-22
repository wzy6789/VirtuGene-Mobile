import {db} from '../../src/db';
import {useAuthStore} from '../../src/store/auth-store';
import {prepareCallContext} from '../../src/lib/voice-call/context';
import {mentionableDiaryEvents} from '../../src/db/world-event-repo';
import {listMentionableDiaryIds} from '../../src/lib/world/diary-visibility';
import {knowledgeRepo} from '../../src/db/knowledge-repo';
import {voiceCallRepo} from '../../src/db/voice-call-repo';
async function main(){
 let checks=0;const check=(condition:unknown,label:string)=>{if(!condition)throw Error(label);checks++;};
 await db.open();useAuthStore.setState({userId:'u'});
 await db.characters.put({id:'c',name:'角色',createdBy:'u',createdAt:1,tags:[],systemPrompt:'认真简洁地说话。'} as any);
 await db.sessions.put({id:'s',userId:'u',characterId:'c',type:'single',title:'通话',createdAt:1,updatedAt:1,unreadCount:0} as any);
 await db.worlds.put({id:'w',userId:'u',name:'世界',createdAt:1,isDefault:true} as any);
 const event:any={id:'e',userId:'u',worldId:'w',type:'reality',title:'一起观星',summary:'在湖边',visibility:'world',participants:['c:c'],sourceType:'diary',sourceId:'d',timestamp:1,createdAt:1,memoryIds:[]};
 const diary:any={id:'d',userId:'u',title:'观星',content:'一起在湖边观星。',date:'2026-10-13',characterId:'c',worldEventId:'e',visibility:'world',createdAt:1,updatedAt:1};
 await db.diaries.put(diary);await db.worldEvents.put(event);
 const kid=await knowledgeRepo.upsert({userId:'u',worldId:'w',characterId:'c',eventId:'diary:d',knowledgeLevel:'full',canMention:true});
 check((await mentionableDiaryEvents([event], 'c','u'))[0],'current world diary consent accepted');
 check((await listMentionableDiaryIds('u',undefined,'c')).has('d'),'prefix index retains valid diary');
 for(const patch of [{visibility:'private'},{deletedAt:2},{characterId:'other'},{userId:'other'},{worldEventId:'other'}]){
  await db.diaries.put({...diary,...patch});check(!(await mentionableDiaryEvents([event],'c','u'))[0],'diary mutation must revoke');
 }await db.diaries.put(diary);
 for(const patch of [{canMention:false},{knowledgeLevel:'partial'},{userId:'other'},{worldId:'other'},{characterId:'other'}]){
  await db.characterKnowledge.update(kid,patch as any);check(!(await mentionableDiaryEvents([event],'c','u'))[0],'knowledge mutation must revoke');
  await db.characterKnowledge.delete(kid);await knowledgeRepo.upsert({userId:'u',worldId:'w',characterId:'c',eventId:'diary:d',knowledgeLevel:'full',canMention:true});
 }
 await db.characterKnowledge.delete(kid);check(!(await mentionableDiaryEvents([event],'c','u'))[0],'deleted consent rejected');
 await db.characterKnowledge.put({id:'legacy-random-key',userId:'u',worldId:'w',characterId:'c',eventId:'diary:d',knowledgeLevel:'full',canMention:true,learnedAt:1} as any);
 check((await mentionableDiaryEvents([event],'c','u'))[0],'legacy non-deterministic knowledge id remains valid');
 check((await listMentionableDiaryIds('u','w','c')).has('d')&&!(await listMentionableDiaryIds('u','other','c')).has('d'),'prefix query maintains world scope');
 check(!(await listMentionableDiaryIds('other',undefined,'c')).has('d'),'prefix query maintains account scope');
 const context=await prepareCallContext({userId:'u',characterId:'c',sessionId:'s',worldId:'w'},'通话中的停顿',[],new AbortController().signal,'voice','presence-check');
 check(context.messages.at(-1)?.role==='system'&&!context.messages.some(row=>row.role==='user'),'presence intent is a system event, never user speech');
 check(context.messages.at(-1)?.content.includes('不证明对方离开')&&context.messages[0].content.includes('认真简洁'),'presence preserves persona and honest silence semantics');
 const exchange:any={turnId:'t',origin:'presence-check',userText:'',generatedText:'还在吗？未播放。',heardText:'不可信',interrupted:true,segments:[{id:'seg',turnId:'t',text:'还在吗？',playedAt:2,playedFrames:40,generatedAt:1,interrupted:false}],metrics:{turnId:'t',stoppedAt:1}};
 const saved=await voiceCallRepo.save({id:'call',userId:'u',characterId:'c',sessionId:'s',startedAt:1,endedAt:3,status:'active',voice:'茉莉',summaryState:'pending',messageIds:[],exchanges:[exchange]});
 check(saved.messageIds.length===1&&saved.exchanges[0].heardText==='还在吗？','durable presence checkpoint stores only complete played speech');
 const next=await prepareCallContext({userId:'u',characterId:'c',sessionId:'s',worldId:'w',callId:'call'},'我在',[exchange],new AbortController().signal);
 check(next.messages.filter(row=>row.content==='还在吗？').length===1,'presence history is not duplicated by checkpoint');
 await db.messages.delete(saved.messageIds[0]);
 try{await next.assertCurrent!();throw Error('deletion accepted');}catch(e){check((e as Error).message==='voice:source_withdrawn','deleted presence checkpoint invalidates prepared context');}
 return{checks,realApiCalls:0,modelTokens:0,deviceTested:false,scope:'actual isolated IndexedDB; current consent, legacy ids, role presence and immutable facts'};
}
main().then(result=>{(window as any).voiceProfileResult=result;}).catch(error=>{(window as any).voiceProfileResult={error:String(error)};});
