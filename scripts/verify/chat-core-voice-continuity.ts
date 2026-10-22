import {db,type Character,type Message} from '../../src/db';
import {useAuthStore} from '../../src/store/auth-store';
import {advanceExplicitTopics,type TopicStateFields} from '../../src/lib/chat-topic-outcomes';
import {emptyChatConversationState} from '../../src/lib/chat-conversation-state';
import {readValidatedConversation,updateConversationIfCurrent} from '../../src/db/chat-topic-state-repo';
import {voiceCallRepo} from '../../src/db/voice-call-repo';
import {prepareCallContext} from '../../src/lib/voice-call/context';
import {projectCallMessages,callSummarySource,type VoiceCallRecord} from '../../src/lib/voice-call/record';
import type {CallExchange} from '../../src/lib/voice-call/controller';
import {memorySourceTombstoneRepo} from '../../src/db/memory-source-tombstone-repo';
const checks:Array<{name:string;ok:boolean;detail?:unknown}>=[];
const check=(name:string,ok:unknown,detail?:unknown)=>checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});
const owner={userId:'voice-core-owner',characterId:'voice-core-role',sessionId:'voice-core-session'};
const principal={...owner,isCurrent:()=>useAuthStore.getState().userId===owner.userId};
let sequence=0;
const user=(content:string):Message=>({id:'voice-core-user-'+(++sequence),sessionId:owner.sessionId,role:'user',content,createdAt:Date.now()+sequence*10,isProactive:false,revision:1});
async function storeFacts(state:TopicStateFields,rows:Message[]){
  await db.messages.bulkPut(rows);
  const version=(await db.sessions.get(owner.sessionId))?.conversation?.version??0;
  if(!await updateConversationIfCurrent(principal,version,{...emptyChatConversationState(),...state}))throw Error('Fixture facts rejected');
}
const next=(state:TopicStateFields,message:Message)=>advanceExplicitTopics(state,{message,domain:'user-reality',utcOffsetMinutes:new Date(message.createdAt).getTimezoneOffset()});
function exchange(turnId:string,text:string,heard:string,generated=heard,interrupted=false):CallExchange{
  return {turnId,userText:text,generatedText:generated,heardText:'UI字段不是证据',interrupted,recordedAt:Date.now()+sequence*10+100,
    segments:[{id:turnId+'-segment',turnId,text:heard,playedAt:10,playedFrames:100,interrupted:false,generatedAt:1}],metrics:{turnId,stoppedAt:1}};
}
(window as any).runCoreVoiceContinuity=async()=>{
  await db.delete();await db.open();useAuthStore.setState({userId:owner.userId,apiKey:undefined});
  const character:Character={id:owner.characterId,name:'测试搭档',avatar:'🌙',systemPrompt:'言辞自然、简短，认真听具体的问题。',createdBy:owner.userId,createdAt:1,isPreset:false,isCustom:true,published:false,tags:[],proactivity:0,sourcePresetId:'isolated-shared-voice-preset'};
  await db.characters.put(character);await db.sessions.put({id:owner.sessionId,userId:owner.userId,characterId:owner.characterId,title:'隔离文字语音',type:'single',createdAt:1,updatedAt:1,unreadCount:0});
  const initial=user('英语考试明天。');let state=next({},initial);await storeFacts(state,[initial]);
  let prepared=await prepareCallContext(owner,'英语考试什么时候？',[],new AbortController().signal,'text');
  check('voice receives the source-validated private conversation projection',prepared.messages[0].content.includes('[当前事项与结论]')&&prepared.messages[0].content.includes('英语考试'));
  const pause=user('先别聊考试这类话题了。');state=next(state,pause);await storeFacts(state,[pause]);
  prepared=await prepareCallContext(owner,'随便聊聊。',[],new AbortController().signal);
  check('a text category pause remains visible to the next voice turn',prepared.messages[0].content.includes('考试')&&prepared.messages[0].content.includes('不主动重提'));
  check('actual source-aware speech preparation withholds captured unsupported recent observation',await prepared.reviewSpeech?.('最近看窗外的叶子，比看花还多——你觉得好笑吗？')==='');
  const resume=user('可以继续聊考试这类话题了。');state=next(state,resume);await storeFacts(state,[resume]);
  let stale=false;try{await prepared.assertCurrent?.();}catch(error){stale=String(error).includes('voice:context_changed');}
  check('conversation changes invalidate a prepared voice response',stale);
  const complete=exchange('correction','不是明天，改到后天。','后天考试，知道了。');
  const record:VoiceCallRecord={id:'voice-core-call',...owner,startedAt:1,endedAt:Date.now()+1000,voice:'茉莉',summaryState:'pending',messageIds:[],status:'active',exchanges:[complete]};
  await voiceCallRepo.save(record);
  const corrected=await readValidatedConversation(principal);
  check('acknowledged call projection updates the shared date exactly once',corrected?.conversation?.topics?.[0].slots.date?.value==='后天',corrected?.conversation?.topics);
  const projected=(await db.messages.get('voice:'+record.id+':correction:assistant'))!;
  check('full playback creates settled complete speech evidence',projected?.replyDelivery==='settled'&&projected.replyCompletion==='complete');
  check('fully acknowledged call reply is available as speech evidence',corrected?.conversation?.topics?.[0].responses?.some(item=>item.replySources.some(ref=>ref.messageId===projected?.id)));
  const beforeVersion=corrected?.version;await voiceCallRepo.save(record);
  check('repeated call checkpoint does not reapply conversation facts',(await readValidatedConversation(principal))?.version===beforeVersion);
  const partial=exchange('partial','那是哪天？','是后天。','是后天。还要带准考证。',true);
  const partialRecord={...record,id:'voice-core-partial',exchanges:[partial]};await voiceCallRepo.save(partialRecord);
  const partialRow=await db.messages.get('voice:'+partialRecord.id+':partial:assistant');
  check('interrupted playback retains only heard text and no completed-answer claim',partialRow?.content==='是后天。'&&partialRow.replyCompletion==='interrupted'&&partialRow.replyDelivery==='settled');
  const afterPartial=await readValidatedConversation(principal);
  check('partial playback cannot mark the requested date as answered',!afterPartial?.conversation?.topics?.[0].responses?.some(item=>item.replySources.some(ref=>ref.messageId===partialRow?.id)));
  check('call summary input distinguishes heard fragments from a whole answer',callSummarySource(partialRecord).includes('未完成回复片段'));
  const forged={...partial,turnId:'forged',interrupted:false,segments:partial.segments.map(segment=>({...segment,id:'forged-segment',turnId:'forged'}))};
  const forgedProjection=projectCallMessages({...record,id:'forged-call',exchanges:[forged]}).find(row=>row.role==='assistant');
  check('a false interrupted flag cannot hide an unplayed generated suffix',forgedProjection?.replyCompletion==='interrupted');
  const contradictory={...complete,segments:complete.segments.map(segment=>({...segment,interrupted:true}))};
  check('contradictory partial segment receipts do not become heard history',!projectCallMessages({...record,id:'contradictory-call',exchanges:[contradictory]}).some(row=>row.role==='assistant'));
  const shortFrames={...complete,segments:complete.segments.map(segment=>({...segment,playbackStartFrame:500,playbackEndFrame:800,playedFrames:100}))};
  check('a timestamp cannot certify playback short of its known segment frame span',!projectCallMessages({...record,id:'short-frames-call',exchanges:[shortFrames]}).some(row=>row.role==='assistant'));
  const wrong=await readValidatedConversation({...principal,characterId:'different-instance'});
  check('voice facts stay scoped to the owned role instance',wrong===undefined);
  for(const mutation of ['edit','delete','withdraw'] as const){
    const plain:Message={...user('普通历史对白：我更喜欢蓝色这个选择。'),id:'ordinary-assistant-'+mutation,role:'assistant',createdAt:Date.now()+100000+sequence,replyDelivery:'settled',replyCompletion:'complete'};
    await db.messages.put(plain);
    const current=await prepareCallContext(owner,'聊聊自己的看法。',[],new AbortController().signal,'text');
    check('ordinary assistant speech actually enters voice history: '+mutation,current.messages.some(message=>message.role==='assistant'&&message.content.includes('普通历史对白')));
    if(mutation==='edit')await db.messages.update(plain.id,{content:'这一句已被修改。',revision:2});
    else if(mutation==='delete')await db.messages.delete(plain.id);
    else await memorySourceTombstoneRepo.record({userId:owner.userId,sourceType:'message',sourceId:plain.id,sourceRevision:1,status:'withdrawn'});
    let invalid=false;try{await current.assertCurrent?.();}catch{invalid=true;}
    check('voice rechecks assistant history before next speech packet: '+mutation,invalid);
    if(mutation==='withdraw'){
      const rebuilt=await prepareCallContext(owner,'换一句聊。',[],new AbortController().signal,'text');
      check('withdrawn assistant source does not return on fresh voice preparation',!rebuilt.messages.some(message=>message.role==='assistant'&&message.content.includes(plain.content)));
    }
  }
  const examA=user('英语考试周六。'),examB=user('另外一场英语考试周日。'),amb=user('英语考试改到周一。');
  const ambiguous=next(next(next({},examA),examB),amb);await storeFacts(ambiguous,[examA,examB,amb]);
  const withAmbiguity=await prepareCallContext(owner,'接着刚才那场考试说。',[],new AbortController().signal,'text');
  check('voice projection keeps source-backed same-name ambiguity',withAmbiguity.messages[0].content.includes('多个同名事项'));
  const selection=user('周六那场英语考试改到周一。'),completion=user('周一那场英语考试已经考完了。');
  const finished=next(next(ambiguous,selection),completion);await storeFacts(finished,[selection,completion]);
  const reread=await readValidatedConversation(principal);
  check('two same-name events keep their identities after selecting, changing and completing one',reread?.conversation?.topics?.length===2&&!reread.conversation.ambiguousTopic
    &&reread.conversation.topics.some(topic=>topic.anchorSource.messageId===examA.id&&topic.outcome==='resolved'&&topic.slots.date?.value==='周一')
    &&reread.conversation.topics.some(topic=>topic.anchorSource.messageId===examB.id&&topic.outcome==='pending'&&topic.slots.date?.value==='周日'),reread?.conversation);
  const combined=await prepareCallContext(owner,'两场英语考试哪个还没完成，分别是哪天？',[],new AbortController().signal,'text');
  const block=combined.messages[0].content.match(/\[当前事项与结论\]([\s\S]*?)\[\/当前事项与结论\]/u)?.[1]??'';
  const projectedTopics=block.split('\n').filter(line=>line.startsWith('{')&&line.includes('已知字段')).map(line=>JSON.parse(line));
  check('next voice query receives one resolved Monday and a separate pending Sunday',projectedTopics.some(topic=>topic.状态==='resolved'&&topic.已知字段.date?.value==='周一')&&projectedTopics.some(topic=>topic.状态==='pending'&&topic.已知字段.date?.value==='周日'),projectedTopics);
  await db.characters.update(character.id,{name:'更名后的搭档'});
  const renamed=await prepareCallContext(owner,'两场英语考试哪个还没完成？',[],new AbortController().signal,'text');
  check('renaming the same role preserves its exact source-backed event identities',renamed.messages[0].content.includes('周一')&&renamed.messages[0].content.includes('周日')&&(await readValidatedConversation(principal))?.conversation?.topics?.every(topic=>reread?.conversation?.topics?.some(previous=>previous.id===topic.id)));
  const copyId='voice-core-same-preset-copy',copySession='voice-core-same-preset-session';
  await db.characters.put({...character,id:copyId,name:'更名后的搭档'});
  await db.sessions.put({id:copySession,userId:owner.userId,characterId:copyId,title:'另一个实例',type:'single',createdAt:1,updatedAt:1,unreadCount:0});
  const copyState=await readValidatedConversation({...principal,characterId:copyId,sessionId:copySession});
  check('same-name same-preset second instance does not inherit either examination',copyState?.version===0&&!copyState.conversation?.topics?.length);
  return {complete:checks.every(row=>row.ok),checks,failures:checks.filter(row=>!row.ok),apiCalls:0,microphoneUsed:false,audioPlayed:false};
};
