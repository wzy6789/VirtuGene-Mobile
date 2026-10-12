import { db } from '../../src/db/index';
import { contradictsSimpleMemory } from '../../src/lib/memory-correction';
import { acceptExtractedMemories, userMemorySources } from '../../src/lib/ai/memory-evidence';
import { MEMORY_SOURCE_POLICY, memorySpeaker } from '../../server/memory-source-policy.mjs';
import { buildLocalFallbackSummary } from '../../src/lib/ai/context-summarizer';
import { messageRepo } from '../../src/db/message-repo';
import { memoryRepo } from '../../src/db/memory-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { todoRepo } from '../../src/db/todo-repo';
import { detectRecallIntent, indexPromptMemoryReferences, recallCharacterMemory, packCharacterMemory, buildCharacterMemoryContext, renderMemoryRetrievalStatus } from '../../src/lib/character-memory';
import {coolingWorldMotifs} from '../../src/lib/world/world-attention';
import { findSpokenMemoryIds, rankConversationMemories } from '../../src/lib/memory-engine';
import { buildContextTrace } from '../../src/lib/chat-trace';
import { buildWorldContext, renderCharacterContext, renderWorldLayer, renderWorldBrief } from '../../src/lib/world/world-context';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { momentsRepo, planAutonomousMomentInteraction } from '../../src/db/moments-repo';
import { collectSyncData, importSyncData } from '../../src/lib/sync';
import { diaryRepo } from '../../src/db/diary-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { clearDiarySharing, setDiarySharing } from '../../src/lib/world/diary-visibility';
import { useAuthStore } from '../../src/store/auth-store';
import { undoLastTurn } from '../../src/lib/world/world-undo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { findRelevantHistory } from '../../src/lib/world/world-recall';
import { recallHistoricalPrivateChat, formatHistoricalPrivateChat } from '../../src/lib/character-history-recall';
import { buildSummaryBatch, findUncoveredSummaryMessages } from '../../src/lib/ai/summary-batches';
import { memoryLedgerRepo } from '../../src/db/memory-ledger-repo';
import { generateGroupTurn } from '../../src/lib/ai/group-chat';
import { hasLivePrivateSummarySources } from '../../src/lib/chat-summary-evidence';

const report = window.fetch.bind(window);
async function run() {
  let count = 0;
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); count++; };
  for(const text of ['对了，我把刚买的面包落在店里了，走到家才想起来，真服了。','我到家才想起来忘了买牛奶','刚刚想起要拿钥匙','他说“你想起来了吗”'])check(!detectRecallIntent(text).explicit,'ordinary recollection or quoted recall does not request a history search: '+text);
  for(const text of ['你想起来了吗？','你能不能想起那件事','我刚才想起什么来着？','帮我回想一下','我想起以前和你逛过小吃街','查一下日记','你还记得上次说过什么吗'])check(detectRecallIntent(text).explicit,'actual recall, historical anchors and channel queries remain available: '+text);
  window.fetch = (() => { throw new Error('Unexpected network'); }) as typeof fetch;
  await db.open();
  const now = Date.now();
  await db.characters.bulkPut(['a','b','c'].map(id => ({ id, createdBy: 'u', name: id, systemPrompt: 'test', createdAt: now })) as any);
  const raceDiary = await diaryRepo.create({userId:'u',date:'2026-10-12',title:'读取中撤权',content:'RACE_DIARY_PRIVATE',mood:3,tags:[],characterId:'a'});
  await setDiarySharing({userId:'u',diaryId:raceDiary,visibility:'selected',visibleTo:['a']});
  const originalVisible = diaryRepo.listVisibleFor;
  let diaryReads = 0;
  try {
    diaryRepo.listVisibleFor = async (...args) => {
      if (++diaryReads === 2) await clearDiarySharing('u',raceDiary);
      return originalVisible.apply(diaryRepo,args);
    };
    const recalled = await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'查一下读取中撤权的日记',sources:['diary']});
    check(diaryReads >= 2,'diary permission changes between candidate selection and final validation');
    check(!recalled.references.some(ref=>ref.id===raceDiary),'mid-read revoked diary is removed from references');
    check(!recalled.text.includes('RACE_DIARY_PRIVATE')&&!JSON.stringify(recalled.sections).includes('RACE_DIARY_PRIVATE'),'mid-read revoked diary is removed from all prompt renderings');
    check(!recalled.provenance.some(ref=>ref.id===raceDiary),'mid-read revoked diary is removed from provenance');
  } finally {diaryRepo.listVisibleFor=originalVisible;}
  await setDiarySharing({userId:'u',diaryId:raceDiary,visibility:'selected',visibleTo:['a']});
  diaryReads=0;
  try {
    diaryRepo.listVisibleFor=async (...args)=>{
      if(++diaryReads===2) throw Error('source validation unavailable');
      return originalVisible.apply(diaryRepo,args);
    };
    const recalled=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'查一下读取中撤权的日记',sources:['diary']});
    check(recalled.retrieval?.status==='unavailable','failed final source read is reported as unavailable, not a confirmed empty history');
    check(!recalled.text.includes('RACE_DIARY_PRIVATE')&&!recalled.references.some(ref=>ref.id===raceDiary),'read failure cannot fall back to a previously authorized private copy');
  } finally {diaryRepo.listVisibleFor=originalVisible;}
  const originalLedgerRecord=memoryLedgerRepo.record;
  try {
    memoryLedgerRepo.record=async()=>{throw Error('optional ledger maintenance failed');};
    const recalled=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'查一下读取中撤权的日记',sources:['diary']});
    check(recalled.text.includes('RACE_DIARY_PRIVATE')&&recalled.references.some(ref=>ref.id===raceDiary),'optional ledger failure preserves an independently revalidated visible source');
    check(recalled.retrieval?.status==='references','ledger maintenance failure does not misreport a successful source read');
  } finally {memoryLedgerRepo.record=originalLedgerRecord;}
  await clearDiarySharing('u',raceDiary);
  await db.sessions.put({id:'race-private',userId:'u',characterId:'a',type:'single',title:'读取竞态',createdAt:now,updatedAt:now,unreadCount:0} as any);
  await db.messages.put({id:'race-deleted-message',sessionId:'race-private',role:'user',content:'RACE_MESSAGE_PRIVATE',createdAt:now,isProactive:false} as any);
  const originalMemoryGet = db.memories.get;
  try {
    db.memories.get = (async (key:any) => {
      if(key==='race-deleted-message') await db.messages.delete(key);
      return originalMemoryGet.call(db.memories,key);
    }) as typeof db.memories.get;
    const recalled = await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'还记得 RACE_MESSAGE_PRIVATE 吗',sources:['chat']});
    check(!(await db.messages.get('race-deleted-message')),'source is actually deleted during the full recall flow');
    check(!recalled.references.some(ref=>ref.id==='race-deleted-message')&&!recalled.text.includes('RACE_MESSAGE_PRIVATE'),'mid-read deleted private message never enters the prompt');
  } finally {db.memories.get=originalMemoryGet;}
  await db.messages.put({id:'race-edited-message',sessionId:'race-private',role:'user',content:'EDITED_CHAT_OLD',revision:1,createdAt:now,isProactive:false} as any);
  try {
    db.memories.get=(async(key:any)=>{
      if(key==='race-edited-message') await db.messages.update(key,{content:'EDITED_CHAT_NEW'});
      return originalMemoryGet.call(db.memories,key);
    }) as typeof db.memories.get;
    const recalled=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'还记得 EDITED_CHAT_OLD 吗',sources:['chat']});
    check((await db.messages.get('race-edited-message'))?.content==='EDITED_CHAT_NEW','chat source is actually edited, even when a legacy writer does not bump revision');
    check(!recalled.text.includes('EDITED_CHAT_OLD')&&!recalled.references.some(ref=>ref.id==='race-edited-message'),'edited chat cannot reuse the old text under a current source');
  } finally {db.memories.get=originalMemoryGet;}
  await db.messages.delete('race-edited-message');
  await db.messages.bulkPut([
    {id:'race-old-history',sessionId:'race-private',role:'user',content:'旧约定是星期五到黑沙码头',revision:1,createdAt:now-1000,isProactive:false},
    {id:'race-old-correction',sessionId:'race-private',role:'user',content:'不是星期五，是星期四',revision:1,createdAt:now-999,isProactive:false},
    ...Array.from({length:8},(_,i)=>({id:`race-filler-${i}`,sessionId:'race-private',role:'assistant',content:'普通闲聊',createdAt:now-100+i,isProactive:false})),
  ] as any);
  try {
    db.memories.get=(async(key:any)=>{
      if(key==='race-old-history'||key==='race-old-correction') await db.messages.update('race-old-history',{content:'旧约定是星期三到白沙码头',revision:2});
      return originalMemoryGet.call(db.memories,key);
    }) as typeof db.memories.get;
    const recalled=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'还记得黑沙码头的旧约定吗',sources:['chat']});
    check((await db.messages.get('race-old-history'))?.revision===2,'historical original is changed after paged selection');
    check(!recalled.references.some(ref=>ref.id==='race-old-history'||ref.id==='race-old-correction'),'old original and a correction quoting that original both reject the changed dependency');
    check(!recalled.text.includes('黑沙码头'),'historical snapshot evidence survives score removal, correction linking and prompt packing');
  } finally {db.memories.get=originalMemoryGet;}
  await db.messages.update('race-old-history',{content:'旧约定是星期五到黑沙码头',revision:1});
  const originalHistoryPage=messageRepo.getPage;
  try {
    messageRepo.getPage=async(...args)=>{
      const page=await originalHistoryPage.apply(messageRepo,args);
      if(args[0]==='race-private') await db.messages.update('race-old-history',{content:'旧约定是星期三到白沙码头',revision:2});
      return page;
    };
    const hits=await recallHistoricalPrivateChat({userId:'u',characterId:'a',query:'还记得黑沙码头的旧约定吗'});
    check(!hits.some(hit=>hit.messageId==='race-old-history'||hit.messageId==='race-old-correction'),'standalone historical recall used by world turns also revalidates the selected originals and linked corrections');
  } finally {messageRepo.getPage=originalHistoryPage;}
  await db.messages.where('sessionId').equals('race-private').delete();
  await db.todos.put({id:'race-todo',userId:'u',title:'EDIT_TODO_OLD',status:'todo',recurrence:{kind:'none'},visibility:'selected',visibleTo:['a'],createdAt:now,updatedAt:now} as any);
  const originalPending=todoRepo.visibleOccurrencesForCharacter;
  try {
    todoRepo.visibleOccurrencesForCharacter=async(...args)=>{
      const candidates=await originalPending.apply(todoRepo,args);
      await db.todos.update('race-todo',{title:'EDIT_TODO_NEW'});
      return candidates;
    };
    const recalled=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'查一下待办',sources:['todo']});
    check((await db.todos.get('race-todo'))?.title==='EDIT_TODO_NEW','todo definition really changes after occurrence selection');
    check(!recalled.text.includes('EDIT_TODO_OLD'),'occurrence references validate their parent todo definition as well');
  } finally {todoRepo.visibleOccurrencesForCharacter=originalPending;}
  await db.todoOccurrences.where('todoId').equals('race-todo').delete();
  await db.todos.delete('race-todo');
  await setDiarySharing({userId:'u',diaryId:raceDiary,visibility:'selected',visibleTo:['a']});
  diaryReads=0;
  try {
    diaryRepo.listVisibleFor=async(...args)=>{
      const selected=await originalVisible.apply(diaryRepo,args);
      if(++diaryReads===1) await db.diaries.update(raceDiary,{content:'EDITED_DIARY_NEW'});
      return selected;
    };
    const recalled=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'查一下读取中撤权的日记',sources:['diary']});
    check((await db.diaries.get(raceDiary))?.content==='EDITED_DIARY_NEW','diary content changes after the candidate read');
    check(!recalled.text.includes('RACE_DIARY_PRIVATE')&&!recalled.references.some(ref=>ref.id===raceDiary),'old diary content cannot be recorded against a fresh read');
    check(!(await db.memoryEvidence.toArray()).some(row=>row.sourceId===raceDiary),'changed diary does not create durable source evidence for a stale claim');
  } finally {diaryRepo.listVisibleFor=originalVisible;}
  await clearDiarySharing('u',raceDiary);
  await db.sessions.delete('race-private');
  const emptyRead=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'还记得上次北港的约定吗？',sources:['chat']});
  check(emptyRead.retrieval?.status==='no-match'&&emptyRead.retrieval.selectedCount===0,'successful empty recall is distinct from an unavailable read');
  check(renderMemoryRetrievalStatus(emptyRead).includes('没有选出可引用')&&renderMemoryRetrievalStatus(emptyRead).includes('不等于事情没发生'),'empty lookup frame states uncertainty rather than negating an event');
  const notRequested=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'你好',sources:[]});
  check(notRequested.retrieval?.status==='not-requested','a disabled/no-source request cannot claim it searched history');
  check(renderMemoryRetrievalStatus(notRequested)==='','ordinary no-search turns do not acquire a memory warning');
  const blockedAudience=await buildCharacterMemoryContext({userId:'u',characterId:'a',audience:['a','b'],topic:'还记得那次吗？',sources:['chat']});
  check(blockedAudience.retrieval?.status==='not-requested'&&blockedAudience.text==='','private-chat-only sources are not reported as searched for a shared audience');
  const originalRead=memoryRepo.getByCharacter;
  try {memoryRepo.getByCharacter=async()=>{throw Error('isolated read failure');};
    const failedRead=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'还记得北港的约定吗？',sources:['chat']});
    check(failedRead.retrieval?.status==='unavailable'&&failedRead.references.length===0,'local DB failure cannot become a no-match result');
    check(renderMemoryRetrievalStatus(failedRead).includes('读取未完成'),'failed read frame does not turn unavailable into a missing past');
  } finally {memoryRepo.getByCharacter=originalRead;}
  const deniedRead=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'还记得那次吗？',worldId:'nonexistent-scope'});
  check(deniedRead.retrieval?.status==='denied'&&deniedRead.text==='','invalid scope keeps empty content and distinct status without disclosing foreign records');
  check(renderMemoryRetrievalStatus(deniedRead)==='','denied scope cannot leak a record-presence cue');
  await db.characters.put({ id: 'foreign', createdBy: 'other', name: 'foreign' } as any);
  await db.groups.put({ id:'g', userId:'u', characterIds:['a','b'], name:'朋友群', createdAt:now, updatedAt:now });
  await db.sessions.put({ id:'s', userId:'u', type:'group', groupId:'g', characterId:'', createdAt:now, updatedAt:now } as any);
  await messageRepo.create({ id:'msg', sessionId:'s', role:'user', content:'GROUP_MEMORY_SENTINEL_42', createdAt:now, isProactive:false });
  check((await db.messages.get('msg'))?.witnessedBy?.join(',') === 'a,b', 'message audience snapshot');
  const initialJobs = (await db.memoryJobs.where('userId').equals('u').toArray()).filter((job) => job.sourceIds.includes('msg'));
  check(initialJobs.length === 1 && initialJobs[0].characterIds.join(',') === 'a,b' && initialJobs[0].sourceRevisions?.msg === 1
    && !('content' in initialJobs[0]), 'durable extraction job stores source ids, revision and witnessed audience without duplicating message text');
  await messageRepo.update('msg', { content:'updated message to trigger a durable replacement job' });
  const editedJobs = (await db.memoryJobs.where('userId').equals('u').toArray()).filter((job) => job.sourceIds.includes('msg'));
  check((await db.messages.get('msg'))?.revision === 2 && editedJobs.some((job) => job.status === 'cancelled' && job.sourceRevisions?.msg === 1)
    && editedJobs.some((job) => job.status === 'queued' && job.sourceRevisions?.msg === 2), 'editing a source cancels the old extraction revision and queues the new one');
  await messageRepo.update('msg', { content:'GROUP_MEMORY_SENTINEL_42' });
  const recall = (characterId = 'a', extra = {}) => recallCharacterMemory({userId:'u',characterId, ...extra});
  const firstRecall = await recall();
  check(firstRecall.references.some((item) => item.source === 'group' && item.id === 'msg'), 'group to private chat');
  check(firstRecall.text.includes('GROUP_MEMORY_SENTINEL_42'), 'group memory content preserved');
  await sessionRepo.create({ id:'private-history', userId:'u', characterId:'a', type:'single', title:'旧私聊', createdAt:now - 100_000, updatedAt:now - 100_000, unreadCount:0 } as any);
  await db.messages.put({ id:'old-private-quote', sessionId:'private-history', role:'user', content:'小时候我在青海看过极光，那次旅行一直记得', createdAt:now - 100_000, isProactive:false });
  const oldPrivateHits = await recallHistoricalPrivateChat({ userId:'u', characterId:'a', query:'还记得青海那次极光旅行吗' });
  check(oldPrivateHits.some((hit) => hit.messageId === 'old-private-quote'), 'explicit old-topic query can retrieve raw one-to-one chat beyond the recent prompt window');
  await db.messages.bulkPut(Array.from({length: 170}, (_, index) => ({
    id:`private-filler-${index}`,sessionId:'private-history',role:'user',content:`普通闲聊第${index}条`,createdAt:now - 90_000 + index,isProactive:false,
  })) as any);
  check((await recallHistoricalPrivateChat({ userId:'u', characterId:'a', query:'还记得青海那次极光旅行吗' })).some((hit) => hit.messageId === 'old-private-quote'), 'explicit recall reaches older raw chat beyond 160-message window');
  const foundRead=await buildCharacterMemoryContext({userId:'u',characterId:'a',topic:'还记得青海那次极光旅行吗',sources:['chat']});
  check(foundRead.retrieval?.status==='references'&&foundRead.retrieval.selectedCount===foundRead.references.length,'found recall outcome follows actual selected source references');
  check(renderMemoryRetrievalStatus(foundRead).includes('候选资料')&&!renderMemoryRetrievalStatus(foundRead).includes('已确认发生'),'retrieved user speech is not promoted into a verified event');
  check(!(await recallHistoricalPrivateChat({ userId:'u', characterId:'a', query:'周五一起去看海' })).some((hit) => hit.messageId === 'msg'), 'raw private-chat recall never searches group messages');
  await db.groups.update('g',{characterIds:['a','b','c']});
  check(!(await recall('c')).references.some((item) => item.id === 'msg'), 'late joiner cannot inherit old memory');
  check(!(await recall('a',{audience:['b','c']})).references.some((item) => item.id === 'msg'), 'shared prompt excludes unheard group history');
  await db.messages.put({id:'legacy',sessionId:'s',role:'user',content:'旧群机密',createdAt:now,isProactive:false});
  check(!(await recall()).text.includes('旧群机密'), 'legacy messages fail closed');
  await db.groups.put({id:'old-group',userId:'u',characterIds:['a','b'],name:'旧友群',createdAt:now,updatedAt:now} as any);
  for (let index = 0; index < 7; index += 1) {
    const sessionId = `old-group-session-${index}`;
    await db.sessions.put({id:sessionId,userId:'u',type:'group',groupId:'old-group',characterId:'',title:'旧群',createdAt:now-index*1000,updatedAt:now-index*1000,unreadCount:0} as any);
    if (index === 6) {
      await db.messages.put({id:'old-group-fact',sessionId,role:'user',content:'群里约定青海极光之后一起寄明信片',createdAt:now-200_000,isProactive:false,witnessedBy:['a','b']} as any);
      await db.messages.bulkPut(Array.from({length:45},(_,row)=>({id:`old-group-filler-${row}`,sessionId,role:'user',content:`普通闲聊${row}`,createdAt:now-190_000+row,isProactive:false,witnessedBy:['a','b']})) as any);
    }
  }
  check((await recall('a',{query:'还记得群里青海极光那次约定吗',sources:['group']})).text.includes('青海极光'), 'explicit group recall searches beyond six sessions and forty recent messages');
  await db.messages.update('msg',{failed:true});
  check(!(await recall()).references.some((item) => item.id === 'msg'), 'failed message excluded');
  await db.messages.update('msg',{failed:false});
  check(!(await recall('foreign')).text, 'foreign character rejected');
  check(!(await recall('a',{audience:['foreign']})).text, 'foreign audience rejected');

  // Real group generator path: the shared speaker selector must never see
  // actor-private memory; each selected actor and its disclosure review may see
  // only that actor's own context.
  const priorFetch = window.fetch;
  const privatePromptBodies: Record<string, unknown>[] = [];
  const privateResponses = [
    JSON.stringify({ turns:[{speaker:'角色甲',content:'导演草稿甲'},{speaker:'角色乙',content:'导演草稿乙'}] }),
    '甲自然地回应。', JSON.stringify({ safe:true }),
    '乙自然地回应。', JSON.stringify({ safe:true }),
  ];
  window.fetch = async (_input, init) => {
    privatePromptBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const content = privateResponses.shift() ?? '';
    return new Response(JSON.stringify({ choices:[{message:{content},finish_reason:'stop'}] }), {
      status:200, headers:{'Content-Type':'application/json'},
    });
  };
  try {
    const generated = await generateGroupTurn({
      apiKey:'sk-fake', groupName:'验收群', userMessage:'你们说说看',
      history:[{role:'user',content:'刚刚的话题'}],
      members:[
        {id:'actor-a',name:'角色甲',persona:'甲的人设，话不多。',privateMemory:'PRIVATE_MEMORY_A only',memory:'GROUP_SHARED_MEMORY'},
        {id:'actor-b',name:'角色乙',persona:'乙的人设，爱开玩笑。',privateMemory:'PRIVATE_MEMORY_B only',memory:'GROUP_SHARED_MEMORY'},
      ],
    });
    const messages = (index: number) => privatePromptBodies[index]?.messages as {role:string;content:unknown}[];
    const systemAt = (index: number) => String(messages(index)?.[0]?.content ?? '');
    const allAt = (index: number) => JSON.stringify(privatePromptBodies[index] ?? {});
    check(generated.turns.length === 2 && generated.turns[0].content === '甲自然地回应。' && generated.turns[1].content === '乙自然地回应。', 'group actors generate their own sequential replies');
    check(!systemAt(0).includes('PRIVATE_MEMORY_A') && !systemAt(0).includes('PRIVATE_MEMORY_B'), 'shared group director sees no actor-private memories');
    check(systemAt(1).includes('PRIVATE_MEMORY_A') && !systemAt(1).includes('PRIVATE_MEMORY_B'), 'actor A receives only A private memory');
    check(allAt(2).includes('PRIVATE_MEMORY_A') && !allAt(2).includes('PRIVATE_MEMORY_B'), 'actor A disclosure review is scoped to A');
    check(systemAt(3).includes('PRIVATE_MEMORY_B') && !systemAt(3).includes('PRIVATE_MEMORY_A'), 'actor B receives only B private memory');
    check(allAt(4).includes('PRIVATE_MEMORY_B') && !allAt(4).includes('PRIVATE_MEMORY_A'), 'actor B disclosure review is scoped to B');
  } finally {
    window.fetch = priorFetch;
  }
  await db.memories.bulkPut([
    {id:'pin',userId:'u',characterId:'a',content:'一定记住喜欢蓝色',pinned:true,status:'active',type:'auto',createdAt:now},
    {id:'old',userId:'u',characterId:'a',content:'已经作废的偏好',status:'superseded',type:'auto',createdAt:now},
    {id:'wrong',userId:'other',characterId:'a',content:'其他账号的秘密',type:'auto',createdAt:now},
  ] as any);
  const own = await recall();
  check(own.text.includes('蓝色'), 'pinned chat memory recalled');
  check(!own.text.includes('作废') && !own.text.includes('其他账号'), 'lifecycle and user isolation');
  check(!(await memoryRepo.getRecentActiveByCharacter('a', 'u', 20)).some((item) => item.id === 'old'), 'runtime recent-memory query excludes superseded items');
  await memoryRepo.create({ id:'new-version', userId:'u', characterId:'a', content:'已经作废的偏好', type:'auto', status:'active', createdAt:now + 1 } as any);
  check((await db.memories.get('old'))?.status === 'superseded' && (await db.memories.get('new-version'))?.status === 'active', 'new evidence never reactivates a superseded row');
  check((await recall()).text.includes('已经作废的偏好'), 'fresh active evidence can be recalled independently');
  await memoryRepo.importRecentUserMemories('c', 'u', 2);
  const importedRows = await db.memories.where('characterId').equals('c').filter((item) => item.userId === 'u' && Boolean(item.importedFromMemoryId)).toArray();
  check(importedRows.length > 0 && importedRows.every((item) => !item.sourceSessionId && !item.sourceMessageIds), 'chosen memory import keeps lineage without copying raw chat ids');
  const importedRecall = await recall('c', { sources: ['chat'] });
  check(importedRecall.text.includes('不是你亲历') && importedRecall.text.includes('用户创建你时主动分享'), 'new character frames imported memory as user-shared background');
  check(!(await recall('a',{audience:['b']})).text.includes('蓝色'), 'private memory not disclosed to group');
  const recallCooldown = rankConversationMemories([
    {id:'cool-pinned', userId:'u', characterId:'a', content:'必须记住的固定偏好', pinned:true, type:'auto', createdAt:now},
    {id:'cool-used', userId:'u', characterId:'a', content:'刚刚用过的普通回忆', type:'auto', createdAt:now},
    {id:'cool-fresh', userId:'u', characterId:'a', content:'另一条仍可用的旧记忆', type:'auto', createdAt:now - 1000},
  ] as any, '今天聊点别的', new Set(['cool-pinned','cool-used']), 2);
  check(recallCooldown.some((item) => item.id === 'cool-pinned') && recallCooldown.some((item) => item.id === 'cool-fresh') && !recallCooldown.some((item) => item.id === 'cool-used'), 'cooldown preserves pinned facts and backfills from eligible memories');
  const spokenFixture = { id:'spoken-memory', userId:'u', characterId:'a', content:'用户喜欢喝咖啡，每天早上都喝', type:'auto', createdAt:now } as any;
  check(findSpokenMemoryIds('我记得你喜欢喝咖啡，早上也会喝一杯。', [spokenFixture]).includes(spokenFixture.id), 'a memory echoed in the assistant reply is marked spoken');
  check(findSpokenMemoryIds('早上的咖啡你一直都挺喜欢的。', [spokenFixture]).includes(spokenFixture.id), 'a clear paraphrase of a memory is recognized as spoken');
  check(findSpokenMemoryIds('今天风挺舒服的。', [spokenFixture]).length === 0, 'a memory merely present in the prompt is not marked spoken');
  await db.memories.bulkPut([
    { id:'ambiguous-correction-tea', userId:'u', characterId:'a', content:'用户喜欢喝红茶', memoryKind:'preference', status:'active', type:'auto', createdAt:now },
    { id:'ambiguous-correction-coffee', userId:'u', characterId:'a', content:'用户喜欢喝咖啡', memoryKind:'preference', status:'active', type:'auto', createdAt:now },
  ] as any);
  await memoryRepo.supersedeLikelyCorrections('a','u',{ id:'ambiguous-correction-new', userId:'u', characterId:'a', content:'其实我喜欢喝绿茶', memoryKind:'preference', type:'auto', createdAt:now + 1 } as any);
  check((await db.memories.get('ambiguous-correction-tea'))?.status === 'active' && (await db.memories.get('ambiguous-correction-coffee'))?.status === 'active', 'ambiguous correction wording does not silently supersede unrelated preferences');
  await db.memories.put({ id:'unique-correction-old', userId:'u', characterId:'a', content:'用户不吃香菜', memoryKind:'preference', status:'active', type:'auto', createdAt:now } as any);
  await db.memories.put({id:'unique-correction-new',userId:'u',characterId:'a',content:'其实我很喜欢香菜',memoryKind:'preference',type:'auto',createdAt:now+2} as any);
  await memoryRepo.supersedeLikelyCorrections('a','u',{ id:'unique-correction-new', userId:'u', characterId:'a', content:'其实我很喜欢香菜', memoryKind:'preference', type:'auto', createdAt:now + 2 } as any);
  check((await db.memories.get('unique-correction-old'))?.status === 'active', 'not eating something and liking it can coexist; shared topic does not prove a correction');
  await db.memories.put({id:'polarity-old',userId:'u',characterId:'a',content:'用户不喜欢香菜',memoryKind:'preference',status:'active',type:'auto',createdAt:now} as any);
  await memoryRepo.supersedeLikelyCorrections('a','u',(await db.memories.get('unique-correction-new'))!);
  check((await db.memories.get('polarity-old'))?.status==='superseded','an actual opposite preference with the same object replaces the old active claim');
  for(const [old,next] of [
    ['用户喜欢牛肉','其实我也喜欢牛肉和面包'],
    ['用户喜欢咖啡','我不喜欢咖啡的包装'],
    ['用户喜欢咖啡','我今天不喜欢咖啡'],
    ['用户喜欢咖啡','我不喜欢咖啡，只是今天不想喝'],
    ['用户喜欢咖啡','他说“我不喜欢咖啡”'],
    ['用户喜欢咖啡','如果我不喜欢咖啡呢'],
    ['用户喜欢咖啡','我喜欢红茶'],
  ]) check(!contradictsSimpleMemory(old,next),`addition, qualification or reported speech cannot auto-retire a fact: ${next}`);
  check(contradictsSimpleMemory('用户喜欢喝咖啡','我不再喜欢喝咖啡了'),'directly ending the same preference is recognized without a correction keyword');
  await db.memories.bulkPut([
    {id:'addition-old',userId:'u',characterId:'a',content:'用户喜欢牛肉',memoryKind:'preference',status:'active',type:'auto',createdAt:now},
    {id:'addition-new',userId:'u',characterId:'a',content:'其实我也喜欢牛肉和面包',memoryKind:'preference',status:'active',type:'auto',createdAt:now+1},
  ] as any);
  await memoryRepo.supersedeLikelyCorrections('a','u',(await db.memories.get('addition-new'))!);
  check((await db.memories.get('addition-old'))?.status==='active','actual addition of a second food preference does not retire the first preference');
  await sessionRepo.create({id:'changed-taste-session',userId:'u',characterId:'a',type:'single',title:'过去与现在',createdAt:now,updatedAt:now,unreadCount:0} as any);
  await db.messages.put({id:'past-coffee-source',sessionId:'changed-taste-session',role:'user',content:'我喜欢喝咖啡',createdAt:now-50000,isProactive:false});
  await db.memories.bulkPut([
    {id:'past-coffee-memory',userId:'u',characterId:'a',content:'用户喜欢喝咖啡',memoryKind:'preference',status:'active',type:'auto',sourceSessionId:'changed-taste-session',sourceMessageIds:['past-coffee-source'],createdAt:now-50000},
    {id:'present-coffee-memory',userId:'u',characterId:'a',content:'我不再喜欢喝咖啡了',memoryKind:'preference',status:'active',type:'auto',createdAt:now},
    {id:'other-owner-replacement',userId:'other',characterId:'a',content:'我不喜欢喝咖啡',memoryKind:'preference',status:'active',type:'auto',createdAt:now},
  ] as any);
  await memoryRepo.supersede('past-coffee-memory','missing-replacement');
  await memoryRepo.supersede('past-coffee-memory','other-owner-replacement');
  check((await db.memories.get('past-coffee-memory'))?.status==='active','missing or other-account replacement cannot retire an owned memory');
  await memoryRepo.supersedeLikelyCorrections('a','u',(await db.memories.get('present-coffee-memory'))!);
  check((await db.memories.get('past-coffee-memory'))?.status==='superseded','current opposite preference retires its earlier claim in the actual DB');
  check((await db.memories.get('ambiguous-correction-coffee'))?.status==='superseded','duplicate copies of the same directly contradicted preference all retire');
  const pastTaste=await recallHistoricalPrivateChat({userId:'u',characterId:'a',query:'我以前喜欢喝咖啡吗',limit:8});
  check(pastTaste.some(row=>row.messageId==='past-coffee-source'),'changing a preference preserves original dated speech for historical questions');
  await memoryRepo.deleteById('past-coffee-memory');
  check(!(await recallHistoricalPrivateChat({userId:'u',characterId:'a',query:'我以前喜欢喝咖啡吗',limit:8})).some(row=>row.messageId==='past-coffee-source'),'explicitly forgetting the old memory still suppresses its original message');
  const attributedHistory=formatHistoricalPrivateChat([{messageId:'format-invented',sessionId:'s',role:'assistant',content:'我亲眼看过锻造',createdAt:now},{messageId:'format-relay',sessionId:'s',role:'user',content:'这是代写',createdAt:now,userAuthored:false}]);
  check(attributedHistory.includes('未经独立核实')&&attributedHistory.includes('不是用户原话'),'standalone history formatter obeys the same source boundary as unified recall');
  const crowdedPins = Array.from({length: 9}, (_, index) => ({id:`crowded-pin-${index}`,userId:'u',characterId:'a',content:`固定偏好编号${index}`,pinned:true,type:'auto',createdAt:now}));
  const relevantUnpinned = {id:'relevant-unpinned',userId:'u',characterId:'a',content:'我在青海看见极光并拍了照片',type:'auto',createdAt:now};
  check(rankConversationMemories([...crowdedPins,relevantUnpinned] as any,'青海极光',new Set(),8).some((item) => item.id === 'relevant-unpinned'), 'relevant memory survives a crowded pinned-memory set');
  check(packCharacterMemory([...crowdedPins.map((item) => ({source:'chat' as const,id:item.id,text:item.content,at:now,pinned:true})),{source:'chat',id:'relevant-raw',text:'青海极光照片',at:now}], '青海极光', 550).references.some((item) => item.id === 'relevant-raw'), 'cross-channel packing prioritizes relevant fact over unrelated pins');

  const retained = Array.from({length:35}, (_, index) => ({
    id:`retained-memory-${index}`, userId:'u', characterId:'c', content:`长期事实编号 ${index}`, type:'auto' as const, createdAt:now + index,
  }));
  await memoryRepo.createMany(retained as any);
  const retainedRows = await db.memories.where('characterId').equals('c').toArray();
  check(retained.every((item) => retainedRows.some((row) => row.id === item.id)), 'memory archive no longer deletes older entries after a row-count threshold');
  const longMessage = { id:'long-summary-source', revision:1, content:'甲'.repeat(2_750) };
  const firstSummaryBatch = buildSummaryBatch([longMessage], {});
  check(firstSummaryBatch.length === 3 && firstSummaryBatch.reduce((sum, segment) => sum + segment.content.length, 0) === 2_750, 'summary batches preserve all text in long messages');
  check(findUncoveredSummaryMessages([longMessage], { sourceMessageIds:[longMessage.id], sourceMessageRevisions:{[longMessage.id]:1}, sourceMessageOffsets:{[longMessage.id]:1_200} }).length === 1, 'partial summary offset keeps long-message tail uncovered');
  const oldLongMessage = { id:'old-long-summary-source', revision:1, content:'乙'.repeat(1_500) };
  const oldSummaryTail = buildSummaryBatch([oldLongMessage], { sourceMessageIds:[oldLongMessage.id] });
  check(oldSummaryTail.length === 1 && oldSummaryTail[0].content.length === 300 && oldSummaryTail[0].content === '乙'.repeat(300), 'legacy summary cursor reprocesses message text beyond its former 1,200-character clip');

  await sessionRepo.create({ id:'summary-session', userId:'u', characterId:'a', title:'摘要来源测试', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await sessionRepo.updateSummary('summary-session', '旧摘要里有这条事实', undefined, ['summary-source']);
  await db.messages.put({ id:'summary-source', sessionId:'summary-session', role:'user', content:'这条事实原文', createdAt:now, isProactive:false });
  await memoryRepo.create({ id:'summary-memory', userId:'u', characterId:'a', content:'旧摘要里有这条事实', type:'summary', sourceSessionId:'summary-session', sourceMessageIds:['summary-source'], createdAt:now } as any);
  await messageRepo.deleteById('summary-source');
  check(!(await sessionRepo.getById('summary-session'))?.summary, 'deleting a summarized message invalidates the session summary');
  check((await db.memories.get('summary-memory'))?.status === 'superseded', 'deleting a summarized message invalidates its derived memory');
  await sessionRepo.create({ id:'edited-summary-session', userId:'u', characterId:'a', title:'摘要编辑测试', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await sessionRepo.updateSummary('edited-summary-session', '未更正的摘要', undefined, ['edited-summary-source']);
  await db.messages.put({ id:'edited-summary-source', sessionId:'edited-summary-session', role:'user', content:'原来的错误事实', createdAt:now, isProactive:false });
  await memoryRepo.create({ id:'edited-summary-memory', userId:'u', characterId:'a', content:'未更正的摘要', type:'summary', sourceSessionId:'edited-summary-session', sourceMessageIds:['edited-summary-source'], createdAt:now } as any);
  await messageRepo.update('edited-summary-source', { content:'更正后的事实' });
  check(!(await sessionRepo.getById('edited-summary-session'))?.summary, 'editing a summarized message invalidates its stale summary');
  check((await db.memories.get('edited-summary-memory'))?.status === 'superseded', 'editing a summarized message invalidates its derived memory');

  await sessionRepo.create({ id:'granular-ledger-session', userId:'u', characterId:'a', title:'证据边粒度测试', type:'single', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await db.messages.bulkPut([
    { id:'granular-source-edited', sessionId:'granular-ledger-session', role:'user', content:'我喜欢青绿色', createdAt:now, isProactive:false },
    { id:'granular-source-survives', sessionId:'granular-ledger-session', role:'user', content:'再说一次，我喜欢青绿色', createdAt:now + 1, isProactive:false },
  ] as any);
  await sessionRepo.updateSummary('granular-ledger-session', '一段覆盖两条消息的旧摘要', undefined,
    ['granular-source-edited','granular-source-survives'], { 'granular-source-edited':1, 'granular-source-survives':1 });
  await memoryRepo.create({ id:'granular-extracted-memory', userId:'u', characterId:'a', content:'用户喜欢青绿色', type:'auto', memoryKind:'preference', sourceEvidenceMode:'independent', sourceSessionId:'granular-ledger-session', sourceMessageIds:['granular-source-edited','granular-source-survives'], createdAt:now } as any);
  await memoryRepo.create({ id:'granular-summary-memory', userId:'u', characterId:'a', content:'一段覆盖两条消息的旧摘要', type:'summary', memoryKind:'summary', sourceSessionId:'granular-ledger-session', sourceMessageIds:['granular-source-edited','granular-source-survives'], createdAt:now } as any);
  const granularClaim = await memoryLedgerRepo.findClaim('u', 'preference', '用户喜欢青绿色');
  await messageRepo.update('granular-source-edited', { content:'刚刚被修改的消息' });
  const survivingEvidence = granularClaim
    ? await db.memoryEvidence.where('[userId+claimId]').equals(['u', granularClaim.id]).filter((row) => row.sourceId === 'granular-source-survives').first()
    : undefined;
  check((await db.memories.get('granular-extracted-memory'))?.status === 'active'
    && (await db.memories.get('granular-extracted-memory'))?.sourceMessageIds?.join(',') === 'granular-source-survives', 'editing one summary source preserves an extracted fact supported by a surviving source');
  check(Boolean(granularClaim && survivingEvidence && !survivingEvidence.withdrawnAt
    && (await db.memoryClaims.get(granularClaim.id))?.status === 'active'), 'summary invalidation revokes only its own claim-source evidence edge');

  await sessionRepo.create({ id:'pinned-summary-session', userId:'u', characterId:'a', title:'置顶摘要失效测试', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await db.messages.put({ id:'pinned-summary-source', sessionId:'pinned-summary-session', role:'user', content:'摘要来源', createdAt:now, isProactive:false } as any);
  await sessionRepo.updateSummary('pinned-summary-session', '会话摘要只作为聚合记忆', undefined, ['pinned-summary-source']);
  await memoryRepo.create({ id:'pinned-session-summary', userId:'u', characterId:'a', content:'会话摘要只作为聚合记忆', type:'summary', memoryKind:'summary', pinned:true, sourceSessionId:'pinned-summary-session', sourceMessageIds:['pinned-summary-source'], createdAt:now } as any);
  let rejectedSummaryPin = false;
  try { await memoryRepo.setPinned('pinned-session-summary', true); } catch { rejectedSummaryPin = true; }
  check(rejectedSummaryPin, 'session aggregate summaries cannot be pinned as permanent standalone facts');
  await messageRepo.update('pinned-summary-source', { content:'摘要来源已修改' });
  check((await db.memories.get('pinned-session-summary'))?.status === 'superseded'
    && !(await db.memories.get('pinned-session-summary'))?.pinned, 'editing a source supersedes a legacy pinned aggregate summary instead of orphaning it');
  await sessionRepo.create({ id:'detached-pinned-summary-session', userId:'u', characterId:'a', title:'旧版孤儿摘要', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await memoryRepo.create({ id:'detached-pinned-summary', userId:'u', characterId:'a', content:'来源已丢失的旧置顶摘要', type:'summary', memoryKind:'summary', pinned:true, sourceSessionId:'detached-pinned-summary-session', createdAt:now } as any);
  check(!(await memoryRepo.getRecentActiveByCharacter('a','u',100)).some((memory) => memory.id === 'detached-pinned-summary')
    && (await db.memories.get('detached-pinned-summary'))?.status === 'superseded', 'legacy detached pinned aggregate is retired on first memory read');
  await db.memories.put({ id:'detached-cross-channel-summary', userId:'u', characterId:'a', content:'过时的蓝湖暗号', type:'summary', memoryKind:'summary', pinned:true, sourceSessionId:'detached-pinned-summary-session', createdAt:now } as any);
  check(!(await recall('a', { query:'过时的蓝湖暗号', sources:['chat'] })).text.includes('过时的蓝湖暗号')
    && (await db.memories.get('detached-cross-channel-summary'))?.status === 'superseded', 'cross-channel recall retires a detached legacy summary before using it');

  await sessionRepo.create({ id:'memory-summary-stale-session', userId:'u', characterId:'a', title:'记忆撤回摘要失效', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await db.messages.put({ id:'memory-summary-stale-source', sessionId:'memory-summary-stale-session', role:'user', content:'旧的置顶事实来源', createdAt:now, isProactive:false } as any);
  await sessionRepo.updateSummary('memory-summary-stale-session', '摘要里烘入了旧的置顶事实', undefined, ['memory-summary-stale-source']);
  await memoryRepo.create({ id:'memory-summary-derived-row', userId:'u', characterId:'a', content:'摘要里烘入了旧的置顶事实', type:'summary', memoryKind:'summary', sourceSessionId:'memory-summary-stale-session', sourceMessageIds:['memory-summary-stale-source'], createdAt:now } as any);
  await memoryRepo.create({ id:'retractable-pinned-fact', userId:'u', characterId:'a', content:'旧的置顶事实', type:'auto', memoryKind:'fact', pinned:true, sourceSessionId:'memory-summary-stale-session', sourceMessageIds:['memory-summary-stale-source'], createdAt:now } as any);
  await memoryRepo.deleteById('retractable-pinned-fact');
  check(!(await sessionRepo.getById('memory-summary-stale-session'))?.summary, 'deleting a durable fact invalidates a session summary that cited its source');
  check((await db.memories.get('memory-summary-derived-row'))?.status === 'superseded', 'fact deletion also supersedes the derived summary memory');
  await sessionRepo.create({ id:'legacy-summary-session', userId:'u', characterId:'a', title:'旧版摘要来源测试', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await db.messages.put({ id:'legacy-summary-source', sessionId:'legacy-summary-session', role:'user', content:'旧版摘要依据', createdAt:now - 10, isProactive:false });
  await sessionRepo.updateSummary('legacy-summary-session', '旧版摘要中的事实');
  await memoryRepo.create({ id:'legacy-summary-memory', userId:'u', characterId:'a', content:'旧版摘要中的事实', type:'summary', sourceSessionId:'legacy-summary-session', createdAt:now } as any);
  await messageRepo.update('legacy-summary-source', { content:'已修正的事实' });
  check(!(await sessionRepo.getById('legacy-summary-session'))?.summary, 'editing a source covered by a legacy timestamp-only summary invalidates it');
  check((await db.memories.get('legacy-summary-memory'))?.status === 'superseded', 'legacy timestamp-only summary memory is invalidated with its source session');
  await sessionRepo.create({ id:'multi-evidence-session', userId:'u', characterId:'a', type:'single', title:'多来源事实', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await db.messages.bulkPut([
    { id:'multi-source-a', sessionId:'multi-evidence-session', role:'user', content:'用户每周五会去游泳', createdAt:now, isProactive:false },
    { id:'multi-source-b', sessionId:'multi-evidence-session', role:'user', content:'用户周五下班后去游泳', createdAt:now + 1, isProactive:false },
  ] as any);
  await memoryRepo.create({ id:'multi-source-memory', userId:'u', characterId:'a', content:'用户每周五下班后会去游泳', type:'auto', sourceEvidenceMode:'independent', sourceSessionId:'multi-evidence-session', sourceMessageIds:['multi-source-a','multi-source-b'], createdAt:now } as any);
  await messageRepo.update('multi-source-a', { content:'更正：用户改为周日游泳' });
  const survivingMemory = await db.memories.get('multi-source-memory');
  check(survivingMemory?.status === 'active' && survivingMemory.sourceMessageIds?.join(',') === 'multi-source-b', 'editing one source preserves an active fact supported by another independent source');
  check((await memoryLedgerRepo.claimIdsForSource('u','chat','multi-source-a')).length === 0 && (await memoryLedgerRepo.claimIdsForSource('u','chat','multi-source-b')).length > 0, 'source edits revoke only stale ledger evidence and retain surviving evidence');
  await sessionRepo.create({ id:'delete-session-memory', userId:'u', characterId:'a', type:'single', title:'删除会话清理', createdAt:now, updatedAt:now, unreadCount:0 } as any);
  await messageRepo.create({ id:'delete-session-pending-source', sessionId:'delete-session-memory', role:'user', content:'这条消息用于检查提取任务取消', createdAt:now, isProactive:false });
  await memoryRepo.create({ id:'delete-session-summary-memory', userId:'u', characterId:'a', content:'来自待删除会话的旧摘要', type:'summary', sourceSessionId:'delete-session-memory', createdAt:now } as any);
  await sessionRepo.deleteById('delete-session-memory');
  const deleteSessionJobs = (await db.memoryJobs.where('userId').equals('u').toArray()).filter((job) => job.sourceIds.includes('delete-session-pending-source'));
  check(deleteSessionJobs.length > 0 && deleteSessionJobs.every((job) => job.status === 'cancelled'), 'deleting a session cancels every unfinished extraction job from its messages');
  check((await db.memories.get('delete-session-summary-memory'))?.status === 'superseded', 'deleting a session invalidates a legacy summary memory without message ids');
  await db.moments.put({id:'post',userId:'u',authorCharacterId:'b',text:'今天看到彩虹',visibility:'all',audienceCharacterIds:['a','b'],visibilityRevision:0,mediaIds:['image'],createdAt:now,updatedAt:now} as any);
  check(!(await recall()).text.includes('彩虹'), 'unseen post not treated as known');
  await indexPromptMemoryReferences({ userId:'u', characterId:'a' }, [{ source:'moment', id:'post', text:'visible social post', at:now }], 'unseen-prompt');
  check(!(await db.memoryEvidence.where('[userId+sourceType+sourceId]').equals(['u','moment','post']).count()), 'visible but unopened moments are not made durable prior knowledge');
  await db.momentViews.put({id:'view',userId:'u',momentId:'post',characterId:'a',viewedAt:now});
  await db.momentReactions.put({id:'comment',userId:'u',momentId:'post',characterId:'b',type:'comment',content:'在西边看到的',status:'active',createdAt:now,updatedAt:now});
  const social = await recall();
  check((await db.memoryEvidence.where('[userId+sourceType+sourceId]').equals(['u','moment','post']).count()) > 0, 'actually viewed social source can enter the character memory ledger');
  check(social.text.includes('彩虹') && social.text.includes('在西边'), 'role post and comment recall');
  check(social.text.includes('配图内容未知'), 'no invented image knowledge');
  await db.moments.bulkPut(Array.from({length:36},(_,index)=>({
    id:`old-window-moment-${index}`,userId:'u',text:index===0?'青海极光的照片，后来寄出了明信片':`普通动态内容${index}`,
    visibility:'all',audienceCharacterIds:['a'],mediaIds:[],createdAt:now-200_000+index,updatedAt:now-200_000+index,
  })) as any);
  check((await recall('a',{query:'还记得朋友圈那条青海极光照片吗',sources:['moment']})).text.includes('青海极光的照片'), 'explicit Moments recall searches beyond the recent thirty posts');
  await db.momentReactions.update('comment',{status:'withdrawn'});
  check(!(await recall()).text.includes('在西边'), 'withdrawn comment disappears');
  await db.momentContacts.put({id:'blocked',userId:'u',characterId:'a',blocked:true,updatedAt:now} as any);
  check(!(await recall()).text.includes('彩虹'), 'blocking immediately revokes recall');
  await db.momentContacts.delete('blocked');
  await db.moments.update('post',{visibility:'private'});
  check(!(await recall('a',{query:'朋友圈彩虹'})).text.includes('彩虹'), 'private overrides direct question');
  await db.moments.update('post',{visibility:'all',deleted:true} as any);
  check(!(await recall()).text.includes('彩虹'), 'deleted source not resurrected');
  await db.moments.put({id:'authored-post',userId:'u',authorCharacterId:'a',text:'我今天修好了旧相机',visibility:'all',audienceCharacterIds:['a'],visibilityRevision:1,mediaIds:[],createdAt:now,updatedAt:now} as any);
  await db.momentReactions.put({id:'authored-reaction',userId:'u',momentId:'authored-post',characterId:'b',type:'comment',content:'修好后拍了什么？',status:'active',createdAt:now,updatedAt:now} as any);
  const authoredUnseen = await recall('a', { query:'今天过得怎么样', sources:['moment'] });
  check(authoredUnseen.text.includes('旧相机') && !authoredUnseen.text.includes('修好后拍了什么'), 'author knows own post but not unseen reactions');
  const askedAboutReactions = await recall('a', { query:'朋友圈评论了什么', sources:['moment'] });
  check(askedAboutReactions.text.includes('修好后拍了什么') && askedAboutReactions.text.includes('现在查看'), 'explicit question may inspect current reactions without claiming prior view');
  await db.worlds.put({id:'w',userId:'u',name:'world',createdAt:now} as any);
  await db.worldScenes.put({id:'finished',userId:'u',worldId:'w',characterIds:['a','b'],status:'finished',worldEventId:'event',title:'钟楼',place:'钟楼',updatedAt:now,finishedAt:now,state:{participants:[]}} as any);
  await db.worldEvents.put({id:'event',userId:'u',worldId:'w',type:'stage',title:'修好钟摆',summary:'一起修好了钟摆',visibility:'selected',visibleTo:['a','b'],createdAt:now,timestamp:now,memoryIds:[]} as any);
  await knowledgeRepo.upsert({userId:'u',worldId:'w',characterId:'a',eventId:'event'});
  check((await recall()).text.includes('修好了钟摆'), 'world to private recall');
  check(!(await recall('a',{audience:['b']})).text.includes('修好了钟摆'), 'permission alone not knowledge');
  await knowledgeRepo.upsert({userId:'u',worldId:'w',characterId:'b',eventId:'event'});
  check((await recall('a',{audience:['b']})).text.includes('修好了钟摆'), 'shared world memory available in group and comments');
  await db.worldEvents.update('event',{visibility:'private'});
  check(!(await recall()).text.includes('修好了钟摆'), 'world visibility withdrawal wins over knowledge');
  await db.worldEvents.put({id:'old-recall',userId:'u',worldId:'w',type:'stage',title:'雨夜一起修好钟摆',summary:'在钟楼避雨时修好了停摆的旧钟',visibility:'selected',visibleTo:['a','b'],createdAt:now - 86_400_000,timestamp:now - 86_400_000,memoryIds:[]} as any);
  await knowledgeRepo.upsert({userId:'u',worldId:'w',characterId:'a',eventId:'old-recall'});
  const aHistory = await findRelevantHistory({userId:'u',worldId:'w',characterId:'a',query:'还记得雨夜修钟摆吗'});
  const bHistory = await findRelevantHistory({userId:'u',worldId:'w',characterId:'b',query:'还记得雨夜修钟摆吗'});
  const sharedHistory = await findRelevantHistory({userId:'u',worldId:'w',audienceCharacterIds:['a','b'],query:'还记得雨夜修钟摆吗'});
  check(aHistory.some((hit) => hit.id === 'old-recall') && !bHistory.some((hit) => hit.id === 'old-recall') && !sharedHistory.some((hit) => hit.id === 'old-recall'), 'historical world recall reaches only actors who know and may mention the event');
  await db.worlds.put({id:'old-history-world',userId:'u',name:'旧事测试',createdAt:now} as any);
  await db.worldEvents.put({id:'very-old-event',userId:'u',worldId:'old-history-world',type:'stage',title:'青海极光旧约',summary:'在青海看到极光后约定写信',visibility:'world',createdAt:now - 100_000,timestamp:now - 100_000,memoryIds:[]} as any);
  await db.worldEvents.bulkPut(Array.from({length:510}, (_, index) => ({id:`newer-event-${index}`,userId:'u',worldId:'old-history-world',type:'stage',title:`普通近事${index}`,summary:'日常',visibility:'world',createdAt:now + index,timestamp:now + index,memoryIds:[]})) as any);
  check(!(await findRelevantHistory({userId:'u',worldId:'old-history-world',characterId:'b',query:'还记得青海极光旧约吗'})).some(hit => hit.id === 'very-old-event'), 'world visibility does not grant an uninformed actor historical knowledge');
  await knowledgeRepo.upsert({userId:'u',worldId:'old-history-world',characterId:'a',eventId:'very-old-event',knowledgeLevel:'full',canMention:true});
  check((await findRelevantHistory({userId:'u',worldId:'old-history-world',characterId:'a',query:'还记得青海极光旧约吗'})).some((hit) => hit.id === 'very-old-event'), 'explicit world recall reaches beyond the former 500-event window');
  await Promise.all(Array.from({length:510},(_,index)=>knowledgeRepo.upsert({userId:'u',worldId:'old-history-world',characterId:'a',eventId:`newer-event-${index}`,knowledgeLevel:'full',canMention:true,learnedAt:now+index+1000})));
  const oldWorldContext=await buildCharacterMemoryContext({userId:'u',characterId:'a',worldId:'old-history-world',topic:'还记得青海极光旧约吗',sources:['world']});
  check(oldWorldContext.references.some(ref=>ref.id==='very-old-event')&&oldWorldContext.text.includes('青海极光旧约'),'final validation checks exact scoped knowledge instead of silently dropping an older known event beyond 500 newer knowledge rows');
  await db.worldScenes.put({id:'live',userId:'u',worldId:'w',characterIds:['a','b'],status:'active',title:'树林',updatedAt:now,state:{participants:[]}} as any);
  await db.worldSceneEntries.put({id:'live-entry',sceneId:'live',index:0,kind:'narration',content:'听到了树梢上的鸟鸣',createdAt:now} as any);
  check((await recall('a',{audience:['b']})).text.includes('鸟鸣'), 'ongoing world memory available before settlement');
  check(!(await recall('c')).text.includes('鸟鸣'), 'absent character cannot recall live world');
  const scene: any = {id:'scene',userId:'u',worldId:'w',characterIds:['a'],place:'海边',timeLabel:'午后',mood:'安静',state:{participants:[],entryMemoryMode:'memory'}};
  const characters = await db.characters.toArray();
  await db.messages.put({id:'world-summary-source',sessionId:'private-history',role:'user',content:'一起在海边约好看流星雨。',revision:1,createdAt:now-1000,isProactive:false});
  await db.sessions.update('private-history', {summary:'私聊摘要：一起在海边约好看流星雨',summarySourceMessageIds:['world-summary-source'],summarySourceMessageRevisions:{'world-summary-source':1}});
  await db.characterStates.put({characterId:'a',userId:'u',affinity:64,mood:82,milestones:[],lifeFocus:'准备流星雨观测',storyRelations:[{targetCharacterId:'b',label:'旧友',createdAt:now}],updatedAt:now});
  const context = await buildWorldContext({userId:'u',worldId:'w',scene,characters});
  check(renderCharacterContext(context,'a').includes('GROUP_MEMORY_SENTINEL_42'), 'actual world actor context receives group memory');
  const singleActor = renderCharacterContext(context,'a');
  check(singleActor.includes('私聊摘要：一起在海边约好看流星雨'), 'single-actor world receives current private-chat summary');
  check(singleActor.includes('明确关系记录') && !singleActor.includes('你和用户的关系等阶') && singleActor.includes('状态较好') && singleActor.includes('准备流星雨观测') && singleActor.includes('旧友'), 'single-actor world carries authored relationship boundaries, mood and life without inventing a relationship from counters');
  await db.memories.put({ id:'detached-world-profile-summary', userId:'u', characterId:'a', content:'过时的星域密语', type:'summary', memoryKind:'summary', pinned:true, sourceSessionId:'detached-pinned-summary-session', createdAt:now } as any);
  const cleanedWorldContext = await buildWorldContext({userId:'u',worldId:'w',scene,characters,userText:'过时的星域密语'});
  check(!renderCharacterContext(cleanedWorldContext,'a').includes('过时的星域密语')
    && (await db.memories.get('detached-world-profile-summary'))?.status === 'superseded', 'world actor uses the same legacy-summary cleanup as private chat');
  await db.characterLifeEvents.put({id:'a-private-life',userId:'u',characterId:'a',threadId:'a-private-thread',kind:'reflection',title:'独处修表',summary:'独处时修好怀表QF77',visibility:'private',status:'active',occurredAt:now,createdAt:now,updatedAt:now} as any);
  const oneActorLife = await buildWorldContext({userId:'u',worldId:'w',scene,characters,userText:'你独处时修好怀表QF77了吗'});
  check(renderCharacterContext(oneActorLife,'a').includes('独处时修好怀表QF77'), 'single-character world recalls that character own private life as private chat does');
  const sharedLife = await buildWorldContext({userId:'u',worldId:'w',scene:{...scene,characterIds:['a','b']},characters,userText:'你独处时修好怀表QF77了吗'});
  check(renderCharacterContext(sharedLife,'a', '你独处时修好怀表QF77了吗').includes('独处时修好怀表QF77')
    && !renderCharacterContext(sharedLife,'b', '你独处时修好怀表QF77了吗').includes('独处时修好怀表QF77'), 'private life follows its own actor into a shared scene without moving to another actor');
  check(!renderWorldBrief(sharedLife).includes('独处时修好怀表QF77'), 'shared director never receives an actor private life event');
  await db.memories.bulkPut(Array.from({length:25}, (_, index) => ({
    id:`old-profile-${index}`,userId:'u',characterId:'a',content:index === 0 ? '用户早年参加过天文观测营并很喜欢看木星' : `较早的普通个人事实 ${index}`,
    type:'auto',status:'active',createdAt:now - (100 - index) * 1000,
  })) as any);
  const oldProfileContext = await buildWorldContext({userId:'u',worldId:'w',scene,characters,userText:'你还记得我参加过天文观测营吗'});
  check(renderCharacterContext(oldProfileContext,'a').includes('天文观测营'), 'world actor retrieves a relevant older private-chat memory beyond the former latest-18 window');
  await db.memories.bulkPut(Array.from({length: 9}, (_, index) => ({id:`profile-pin-${index}`,userId:'u',characterId:'a',content:`长期保留的偏好${index}`,pinned:true,type:'auto',status:'active',createdAt:now + index})) as any);
  const crowdedProfile = await buildWorldContext({userId:'u',worldId:'w',scene,characters,userText:'你还记得我参加过天文观测营吗'});
  check(renderCharacterContext(crowdedProfile,'a').includes('天文观测营'), 'world profile recalls requested fact even with more than six unrelated pins');
  const sharedScene = {...scene, characterIds:['a','b']};
  const sharedContext = await buildWorldContext({userId:'u',worldId:'w',scene:sharedScene,characters,userText:'你还记得我参加过天文观测营吗'});
  const aWorldContext = renderCharacterContext(sharedContext,'a');
  const bWorldContext = renderCharacterContext(sharedContext,'b');
  check(aWorldContext.includes('天文观测营') && aWorldContext.includes('蓝色') && aWorldContext.includes('私聊摘要：一起在海边约好看流星雨'), 'multi-character scene still gives A their own private memory, profile and chat summary');
  check(!bWorldContext.includes('天文观测营') && !bWorldContext.includes('蓝色') && !bWorldContext.includes('私聊摘要：一起在海边约好看流星雨'), 'B does not inherit A-only private memory');
  check(aWorldContext.includes('明确关系记录') && !aWorldContext.includes('你和用户的关系等阶') && aWorldContext.includes('状态较好') && aWorldContext.includes('准备流星雨观测') && aWorldContext.includes('旧友'), 'A carries their own relationship evidence, mood, life and authored links');
  check(aWorldContext.includes('不要主动向其他在场者透露'), 'A sees an explicit boundary against disclosing personal memory to other actors');
  check(!renderWorldLayer(sharedContext).includes('天文观测营') && !renderWorldLayer(sharedContext).includes('蓝色'), 'private character memories stay out of the shared world layer');
  // 出场状态只决定**这场戏的正文**从哪开始，不再决定"这个人记得什么"：
  // present = 从此刻开始参与（保留自己的私聊/群聊/既有经历）；
  // amnesiac = 明确标注的失忆玩法，才压掉他自己的过往记忆。
  scene.state.entryMemoryMode='present';
  const present = await buildWorldContext({userId:'u',worldId:'w',scene,characters});
  check(renderCharacterContext(present,'a').includes('GROUP_MEMORY_SENTINEL_42')
    && renderCharacterContext(present,'a').includes('私聊摘要：一起在海边约好看流星雨'), 'present mode starts from now but keeps the character own history');
  check(renderCharacterContext(present,'a').includes('明确关系记录') && !renderCharacterContext(present,'a').includes('你和用户的关系等阶'), 'present mode retains relationship evidence without treating counters as fact');
  scene.state.entryMemoryMode='amnesiac';
  const amnesiac = await buildWorldContext({userId:'u',worldId:'w',scene,characters});
  check(!renderCharacterContext(amnesiac,'a').includes('GROUP_MEMORY_SENTINEL_42')
    && !renderCharacterContext(amnesiac,'a').includes('私聊摘要：一起在海边约好看流星雨'), 'amnesiac mode is the explicit setting that drops the character own memory');
  check(renderCharacterContext(amnesiac,'a').includes('明确关系记录') && !renderCharacterContext(amnesiac,'a').includes('你和用户的关系等阶'), 'amnesiac mode retains authored relationship boundaries without inventing a counter-based relationship');
  scene.state.entryMemoryMode='memory';
  await db.todos.put({ id:'shared-completed', userId:'u', title:'寄出资料包', note:'已经交给快递', dueDate:'2026-09-20', recurrence:{kind:'none'}, status:'completed', completedAt:now, visibility:'selected', visibleTo:['a'], createdAt:now, updatedAt:now } as any);
  await db.todoOccurrences.put({ id:'todo-occ:shared-completed:2026-09-20', userId:'u', todoId:'shared-completed', dueDate:'2026-09-20', originalDueDate:'2026-09-20', status:'completed', completedAt:now, createdAt:now, updatedAt:now } as any);
  await db.todos.put({ id:'private-pending', userId:'u', title:'未来提醒测试', recurrence:{kind:'none'}, status:'todo', visibility:'selected', visibleTo:['a'], createdAt:now, updatedAt:now } as any);
  const completedTodoRecall = await recall('a', { query:'资料包', sources:['todo'] });
  check(completedTodoRecall.text.includes('寄出资料包') && completedTodoRecall.text.includes('已在'), 'completed shared todo is recalled as an experience');
  check(!(await recall('a', { audience:['b'], query:'资料包', sources:['todo'] })).text.includes('寄出资料包'), 'completed todo requires authorization for every listener');
  const pendingTodoRecall = await recall('a', { query:'提醒', sources:['todo'] });
  check(pendingTodoRecall.text.includes('未来提醒测试') && pendingTodoRecall.text.includes('未完成事项'), 'explicit todo question recalls authorized pending item as pending, never as a completed experience');
  check(!(await todoRepo.visibleOccurrencesForCharacter('u', 'a', 8)).some(({ todo }) => todo.id === 'private-pending'), 'undated todo is not injected on every ordinary chat turn');
  check((await todoRepo.visibleOccurrencesForCharacter('u', 'a', 8, true)).some(({ todo }) => todo.id === 'private-pending'), 'explicit todo-related chat can still recall an authorized undated task');
  const packed = packCharacterMemory([{source:'chat',id:'1',text:'记住蓝色',at:now,pinned:true},{source:'chat',id:'2',text:'记住蓝色',at:now},{source:'group',id:'3',text:'超长'.repeat(2000),at:now}], '', 600);
  for(const source of ['chat','group','world','moment','todo','diary'] as const){
    const unrelatedPins=Array.from({length:14},(_,index)=>({source:'chat' as const,id:'long-pin-'+index,text:'无关的长期收纳资料'+index+'：'+'抽屉物品已经按颜色整理。'.repeat(12),at:now,pinned:true}));
    const relevant={source,id:'old-relevant-'+source,text:'北港散步约定：周五去岸边。'+'这是已经确认但还没完成的安排，保留原来的日期。'.repeat(5),at:now-86400000};
    const result=packCharacterMemory([...unrelatedPins,relevant],'还记得北港散步约定吗？',540);
    check(result.references.some(r=>r.id===relevant.id),source+' budget pressure cannot let unrelated pins crowd out explicitly queried old agreement');
    check(result.references[0]?.id===relevant.id,source+' topical source is packed before unrelated pins');
    check(result.text.length<=540,source+' relevance fix preserves bounded prompt length');
    const neutral=packCharacterMemory([relevant,...unrelatedPins],'',540);
    check(neutral.references[0]?.pinned===true,source+' pin priority remains for topicless recall');
  }
  check(packed.references.length === 1 && packed.references[0].id === '1' && packed.text.length <= 600, 'dedup, pinned priority, budget');
  const trace = buildContextTrace({compiled:{prompt:'',included:[],partial:['cross-channel-memory'],omitted:[]},crossChannelReferences:[{source:'group',id:'msg'}]});
  check(!trace.crossChannelReferences, 'partial injection has no false provenance');
  const historyTrace = buildContextTrace({compiled:{prompt:'',included:['historical-chat'],partial:[],omitted:[]},historicalChatReferences:[{id:'old-private-quote'}]});
  check(historyTrace.crossChannelReferences?.some((ref) => ref.source === 'chat' && ref.id === 'old-private-quote'), 'complete historical chat injection records its source message id');
  await db.messages.delete('msg');
  check(!(await recall()).references.some((item) => item.id === 'msg'), 'deleted message disappears');
  // 评论不依赖点赞：真实任务经过 IndexedDB 写入，模型边界由夹具接管。
  await db.characters.update('a', { tags: [], proactivity: 0.7 });
  useAuthStore.setState({ userId: 'u' });
  const role = { id: 'a', tags: [], proactivity: 0.7 };
  const postId = Array.from({ length: 2000 }, (_, i) => `spontaneous-${i}`)
    .find((id) => { const decision = planAutonomousMomentInteraction(id, role, 0, '今天看到晚霞'); return decision.comment && !decision.like; });
  check(Boolean(postId), 'independent comment-only decision exists');
  const when = Date.now();
  await db.moments.put({ id: postId!, userId: 'u', text: '今天看到晚霞', visibility: 'all', audienceCharacterIds: ['a'], visibilityRevision: 1, mediaIds: [], createdAt: when, updatedAt: when });
  await db.momentJobs.put({ id: 'spontaneous-job', userId: 'u', momentId: postId!, characterId: 'a', type: 'react', status: 'queued', visibilityRevision: 1, attempts: 0, availableAt: when - 1, createdAt: when, updatedAt: when });
  let commentCalls = 0;
  const writeComment = async () => { commentCalls++; return '这片晚霞一定很好看'; };
  await momentsRepo.processJobs('u', when, writeComment);
  const socialReactions = await momentsRepo.reactions(postId!, 'u');
  check(socialReactions.some((item) => item.type === 'comment' && item.content === '这片晚霞一定很好看'), 'character comments without liking');
  check(!socialReactions.some((item) => item.type === 'like'), 'comment-only path leaves no like');
  check((await momentsRepo.unreadNotifications('u')).some((item) => item.momentId === postId! && item.type === 'comment'), 'proactive comment creates reminder');
  await momentsRepo.processJobs('u', when, writeComment);
  check(commentCalls === 1 && (await momentsRepo.reactions(postId!, 'u')).length === 1, 'reprocessing never duplicates comment');
  const retryId = Array.from({ length: 2000 }, (_, i) => `retry-${i}`)
    .find((id) => planAutonomousMomentInteraction(id, role, 0, '刚刚读完一本书').comment);
  check(Boolean(retryId), 'retry fixture selects a commenter');
  await db.moments.put({ id: retryId!, userId: 'u', text: '刚刚读完一本书', visibility: 'all', audienceCharacterIds: ['a'], visibilityRevision: 1, mediaIds: [], createdAt: when, updatedAt: when });
  await db.momentJobs.put({ id: 'retry-job', userId: 'u', momentId: retryId!, characterId: 'a', type: 'react', status: 'queued', visibilityRevision: 1, attempts: 0, availableAt: when - 1, createdAt: when, updatedAt: when });
  let retryCalls = 0;
  await momentsRepo.processJobs('u', when, async () => { retryCalls++; return undefined; });
  check((await db.momentJobs.get('retry-job'))?.status === 'queued' && !(await momentsRepo.reactions(retryId!, 'u')).some((r) => r.type === 'comment'), 'empty model response queues one retry without fake comment');
  await momentsRepo.processJobs('u', when + 120_000, async () => { retryCalls++; return '看到哪一段想停下来？'; });
  check(retryCalls === 2 && (await momentsRepo.reactions(retryId!, 'u')).some((r) => r.content === '看到哪一段想停下来？'), 'retry writes exactly one real comment');
  const privatePost = await momentsRepo.create('u', '不公开的话', { visibility: 'private' });
  check(!(await db.momentJobs.where('momentId').equals(privatePost.id).first()), 'private post schedules no character interactions');

  // 旧备份只能补齐仍然有效的来源，不能撤回消息/记忆/日记/动态的权限。
  const backupImport = (rows: Record<string, unknown>) => importSyncData({
    __meta__: { app:'VirtuGene', kind:'sync', version:'5.1.3', exportedAt:new Date().toISOString(), userId:'u' },
    characters:[], sessions:[], messages:[], memories:[], emotionSnapshots:[], characterStates:[], diaries:[],
    ...rows,
  } as any);
  const memoryRevision = now + 100;
  await memoryRepo.create({ id:'memory-tombstone', userId:'u', characterId:'a', content:'仅测试撤回的旧事实', type:'auto', createdAt:memoryRevision, updatedAt:memoryRevision } as any);
  await memoryRepo.deleteById('memory-tombstone');
  const replacementMemoryId = await memoryRepo.create({ id:'memory-tombstone', userId:'u', characterId:'a', content:'同一事实后来被用户重新确认', type:'auto', createdAt:memoryRevision + 1, updatedAt:memoryRevision + 1 } as any);
  check(replacementMemoryId !== 'memory-tombstone' && !(await db.memories.get('memory-tombstone')), 'deleted memory id is never reused for new evidence');
  await backupImport({ memories:[{ id:'memory-tombstone', userId:'u', characterId:'a', content:'仅测试撤回的旧事实', type:'auto', createdAt:memoryRevision, updatedAt:memoryRevision }] });
  check(!(await db.memories.get('memory-tombstone')) && !(await recall('a')).text.includes('仅测试撤回的旧事实'), 'old backup cannot resurrect deleted memory');

  const sourceSession: any = { id:'tombstone-session', userId:'u', characterId:'a', title:'摘要版本测试', createdAt:now, updatedAt:now, unreadCount:0 };
  await sessionRepo.create(sourceSession);
  await messageRepo.create({ id:'versioned-source', sessionId:sourceSession.id, role:'user', content:'旧版本说法', createdAt:now, isProactive:false });
  await sessionRepo.updateSummary(sourceSession.id, '旧摘要包含错误说法', undefined, ['versioned-source'], { 'versioned-source':1 });
  await memoryRepo.create({ id:'versioned-summary-memory', userId:'u', characterId:'a', content:'旧摘要包含错误说法', type:'summary', sourceSessionId:sourceSession.id, sourceMessageIds:['versioned-source'], createdAt:now } as any);
  await messageRepo.update('versioned-source', { content:'用户刚刚更正的说法' });
  const staleSession = { ...sourceSession, summary:'旧摘要包含错误说法', summaryUpdatedAt:now, summarySourceMessageIds:['versioned-source'], summarySourceMessageRevisions:{ 'versioned-source':1 } };
  await backupImport({ sessions:[staleSession], messages:[{ id:'versioned-source', sessionId:sourceSession.id, role:'user', content:'旧版本说法', revision:1, createdAt:now, isProactive:false }] });
  check((await db.messages.get('versioned-source'))?.content === '用户刚刚更正的说法', 'old message backup cannot overwrite edited message');
  check(!(await sessionRepo.getById(sourceSession.id))?.summary, 'old backup cannot restore summary derived from edited message');
  check((await db.memories.get('versioned-summary-memory'))?.status === 'superseded', 'edited source keeps its derived memory withdrawn');

  const diaryId = await diaryRepo.create({ userId:'u', date:'2026-09-21', title:'权限版本测试', content:'仅测试授权撤回', mood:3, tags:[], characterId:'a' });
  await setDiarySharing({ userId:'u', diaryId, visibility:'selected', visibleTo:['a'] });
  const sharedDiary = await db.diaries.get(diaryId);
  check(sharedDiary?.visibility === 'selected' && Boolean(await db.characterKnowledge.where('eventId').equals(`diary:${diaryId}`).first()), 'selected diary creates current scoped knowledge');
  const staleDiaryRevision = sharedDiary!.revision!;
  const staleDiary = { ...sharedDiary!, visibility:'selected', visibleTo:['a'] };
  await clearDiarySharing('u', diaryId);
  await backupImport({
    diaries:[staleDiary],
    characterKnowledge:[{ id:'stale-diary-knowledge', userId:'u', worldId:'default-world:u', characterId:'a', eventId:`diary:${diaryId}`, knowledgeLevel:'full', canMention:true, isSecret:false, sourceRevision:staleDiaryRevision, learnedAt:now, updatedAt:now }],
    worldEvents:[{ id:'stale-diary-event', userId:'u', worldId:'default-world:u', type:'reality', title:'权限版本测试', summary:'仅测试授权撤回', visibility:'world', timestamp:now, createdAt:now, sourceType:'diary', sourceId:diaryId, meta:{ diaryRevision:staleDiaryRevision } }],
  });
  check((await db.diaries.get(diaryId))?.visibility === 'private', 'old backup cannot restore withdrawn diary visibility');
  check(!(await db.characterKnowledge.where('eventId').equals(`diary:${diaryId}`).first()), 'old backup cannot restore withdrawn diary knowledge');
  check(!(await db.worldEvents.get('stale-diary-event')), 'old backup cannot restore withdrawn diary world event');

  const worldDiaryId = await diaryRepo.create({ userId:'u', date:'2026-09-22', title:'橘色天文穹顶', content:'那晚我们在橘色天文穹顶下看到了流星', mood:4, tags:[], characterId:'a' });
  await setDiarySharing({ userId:'u', diaryId:worldDiaryId, visibility:'world' });
  const worldDiary = await db.diaries.get(worldDiaryId);
  const worldDiaryEvent = worldDiary?.worldEventId ? await db.worldEvents.get(worldDiary.worldEventId) : undefined;
  const diaryWorldId = worldDiaryEvent?.worldId ?? '';
  const diaryParticipantHistory = await findRelevantHistory({ userId:'u', worldId:diaryWorldId, characterId:'a', query:'还记得橘色天文穹顶那晚吗' });
  const unrelatedHistory = await findRelevantHistory({ userId:'u', worldId:diaryWorldId, characterId:'b', query:'还记得橘色天文穹顶那晚吗' });
  const unrelatedDiaryRecall = await recall('b', { worldId:diaryWorldId, query:'星域里你还记得橘色天文穹顶那晚吗', sources:['world','diary'] });
  check(Boolean(worldDiaryEvent && diaryParticipantHistory.some((hit) => hit.id === worldDiaryEvent.id)), 'world-shared diary remains recallable by its linked participant');
  check(Boolean(worldDiaryEvent && !unrelatedHistory.some((hit) => hit.id === worldDiaryEvent.id)
    && !(await worldEventRepo.listVisibleToCharacter(diaryWorldId,'b',200,'u')).some((event) => event.id === worldDiaryEvent.id)
    && !unrelatedDiaryRecall.text.includes('橘色天文穹顶')), 'world diary stays hidden from characters without diary participation and knowledge');

  const likedPostId = 'request-like-records-view';
  await db.moments.put({ id:likedPostId, userId:'u', text:'用户发出的动态', visibility:'all', audienceCharacterIds:['a'], visibilityRevision:1, mediaIds:[], createdAt:now, updatedAt:now } as any);
  const likeCharacter = (await db.characters.get('a'))!;
  const requestedLike = await momentsRepo.requestCharacterLike('u', likeCharacter, true, likedPostId);
  check(requestedLike.status === 'liked'
    && Boolean(await db.momentViews.get(`moment-view:${likedPostId}:a`)), 'a requested character like records that character as having seen the post');
  check((await recall('a', { query:'还记得点了赞吗', sources:['moment'] })).text.includes('点了赞'), 'the character can later recall its own requested like');

  const deletedMomentId = 'deleted-moment-source';
  await db.moments.put({ id:deletedMomentId, userId:'u', authorCharacterId:'a', text:'这条动态已经删除', visibility:'all', audienceCharacterIds:['a','b'], visibilityRevision:2, mediaIds:['deleted-media'], createdAt:now, updatedAt:now } as any);
  await db.momentMedia.put({ id:'deleted-media', userId:'u', momentId:deletedMomentId, dataUrl:'data:image/jpeg;base64,AA==', width:1, height:1, mime:'image/jpeg', order:0, createdAt:now } as any);
  await momentsRepo.remove('u', deletedMomentId);
  await backupImport({
    moments:[{ id:deletedMomentId, userId:'u', authorCharacterId:'a', text:'这条动态已经删除', visibility:'all', audienceCharacterIds:['a','b'], visibilityRevision:2, mediaIds:['deleted-media'], createdAt:now, updatedAt:now }],
    momentMedia:[{ id:'deleted-media', userId:'u', momentId:deletedMomentId, dataUrl:'data:image/jpeg;base64,AA==', width:1, height:1, mime:'image/jpeg', order:0, createdAt:now }],
    momentReactions:[{ id:'deleted-reaction', userId:'u', momentId:deletedMomentId, characterId:'b', type:'comment', content:'旧评论', status:'active', createdAt:now, updatedAt:now }],
  });
  check((await db.moments.get(deletedMomentId))?.deleted === true && !(await db.momentMedia.get('deleted-media')), 'old backup cannot restore deleted moment or image');
  check(!(await db.momentReactions.get('deleted-reaction')), 'old backup cannot restore deleted moment comments');

  const reactionMomentId = 'withdrawn-reaction-source';
  await db.moments.put({ id:reactionMomentId, userId:'u', text:'鎾ゅ洖浜掑姩娴嬭瘯', visibility:'all', audienceCharacterIds:['a'], visibilityRevision:1, mediaIds:[], createdAt:now, updatedAt:now } as any);
  await momentsRepo.toggleLike('u', reactionMomentId);
  const withdrawnLike = (await db.momentReactions.where('momentId').equals(reactionMomentId).first())!;
  await momentsRepo.toggleLike('u', reactionMomentId);
  await backupImport({
    moments:[{ id:reactionMomentId, userId:'u', text:'鎾ゅ洖浜掑姩娴嬭瘯', visibility:'all', audienceCharacterIds:['a'], visibilityRevision:1, mediaIds:[], createdAt:now, updatedAt:now }],
    momentReactions:[withdrawnLike],
  });
  check((await db.momentReactions.get(withdrawnLike.id))?.status === 'withdrawn', 'old backup cannot restore a withdrawn like');

  const undoSceneId = 'tombstone-scene';
  await db.worldScenes.put({ id:undoSceneId, userId:'u', worldId:'w', title:'回收测试', place:'林间', timeLabel:'午后', mood:'平静', characterIds:['a'], status:'active', state:{ participants:[] }, startedAt:now, createdAt:now, updatedAt:now } as any);
  const undoEntry = { id:'undo-entry-source', sceneId:undoSceneId, index:0, kind:'narration', act:1, content:'被撤销的场景正文', createdAt:now + 10 } as any;
  await db.worldSceneEntries.put(undoEntry);
  await db.worldTurns.put({
    id:'undo-turn-source', userId:'u', worldId:'w', sceneId:undoSceneId, input:'测试撤销', origin:'text', status:'completed',
    entryIds:[undoEntry.id], settledEventIds:[], settledMemoryIds:[], settledRelationshipEventIds:[], settledThreadIds:[],
    settledFactIds:[], deactivatedFactIds:[], settledLifeEventIds:[], stateDeltas:[], characterIds:['a'], settled:true,
    llmCalls:0, retries:0, createdAt:now, updatedAt:now,
  } as any);
  const undone = await undoLastTurn({ userId:'u', worldId:'w', turnId:'undo-turn-source' });
  check(undone.ok && !(await db.worldSceneEntries.get(undoEntry.id)), 'undo removes the exact scene entries');
  await backupImport({ worldScenes:[await db.worldScenes.get(undoSceneId)], worldSceneEntries:[undoEntry] });
  check(!(await db.worldSceneEntries.get(undoEntry.id)), 'old backup cannot restore undone world text');
  const undoneTurn = await db.worldTurns.get('undo-turn-source');
  await backupImport({ worldScenes:[await db.worldScenes.get(undoSceneId)], worldTurns:[{ ...undoneTurn, status:'completed', settled:false, entryIds:[undoEntry.id], updatedAt:now }] });
  check((await db.worldTurns.get('undo-turn-source'))?.status === 'undone', 'old backup cannot make an undone world turn undoable again');

  const deletedScene = { id:'deleted-scene-source', userId:'u', worldId:'w', title:'已删除星域', place:'旧地点', timeLabel:'夜晚', mood:'安静', characterIds:['a'], status:'finished', state:{ participants:[] }, startedAt:now, createdAt:now, updatedAt:now } as any;
  const deletedSceneEntry = { id:'deleted-scene-entry', sceneId:deletedScene.id, index:0, kind:'narration', act:1, content:'已删除场景内容', createdAt:now } as any;
  await db.worldScenes.put(deletedScene);
  await db.worldSceneEntries.put(deletedSceneEntry);
  await worldSceneRepo.deleteScene(deletedScene.id);
  await backupImport({ worldScenes:[deletedScene], worldSceneEntries:[deletedSceneEntry] });
  check(!(await db.worldScenes.get(deletedScene.id)) && !(await db.worldSceneEntries.get(deletedSceneEntry.id)), 'old backup cannot restore a deleted world or its text');

  const deletedTodo = { id:'deleted-todo-source', userId:'u', title:'已删除待办', priority:'normal', status:'todo', dueDate:'2026-09-23', recurrence:{kind:'none'}, visibility:'private', createdAt:now, updatedAt:now } as any;
  const deletedOccurrence = { id:'deleted-todo-occurrence', userId:'u', todoId:deletedTodo.id, dueDate:'2026-09-23', originalDueDate:'2026-09-23', status:'todo', createdAt:now, updatedAt:now } as any;
  await db.todos.put(deletedTodo);
  await db.todoOccurrences.put(deletedOccurrence);
  await todoRepo.remove('u', deletedTodo.id);
  await backupImport({ todos:[deletedTodo], todoOccurrences:[deletedOccurrence] });
  check((await db.todos.get(deletedTodo.id))?.status === 'deleted' && !(await todoRepo.list('u', '2026-09-23', '2026-09-23')).some(({ todo }) => todo.id === deletedTodo.id), 'old backup cannot make a deleted todo visible again');

  const cancelledTodo = { ...deletedTodo, id:'cancelled-todo-source', title:'已取消待办' };
  await db.todos.put(cancelledTodo);
  await todoRepo.update('u', cancelledTodo.id, { status:'cancelled' });
  await backupImport({ todos:[cancelledTodo] });
  check((await db.todos.get(cancelledTodo.id))?.status === 'cancelled', 'old backup cannot restore a cancelled todo');

  const completedTodo = { ...deletedTodo, id:'completed-occurrence-source', title:'完成状态待办', recurrence:{kind:'daily'} };
  const completedOccurrence = { ...deletedOccurrence, id:'completed-occurrence-row', todoId:completedTodo.id, status:'completed', completedAt:now + 20, updatedAt:now + 20 };
  await db.todos.put(completedTodo);
  await db.todoOccurrences.put(completedOccurrence);
  await backupImport({ todos:[completedTodo], todoOccurrences:[{ ...completedOccurrence, status:'todo', completedAt:undefined, updatedAt:now }] });
  check((await db.todoOccurrences.get(completedOccurrence.id))?.status === 'completed', 'older todo backup cannot roll a completed occurrence back to pending');

  const scopedExport = await collectSyncData('u', 'test');
  const correctionSession='correction-source-window';
  await db.sessions.put({id:correctionSession,characterId:'a',userId:'u',title:'接续测试',createdAt:now,updatedAt:now});
  const sourceRows=[
    {id:'context-first',role:'user',content:'我晚上不喝咖啡，喝了睡不着。'},
    {id:'context-plan',role:'user',content:'下周五下午三点面试。'},
    {id:'context-echo',role:'assistant',content:'面试是下周五下午三点。'},
    {id:'context-correction',role:'user',content:'不是周五，改成周四下午三点。'},
    {id:'context-other',role:'user',content:'换个话题，我想买个杯子。'},
    {id:'context-unrelated-correction',role:'user',content:'不对，要买两个杯子。'},
    {id:'context-query',role:'user',content:'我前面更正过面试时间，最后是哪天几点？'},
  ];
  await db.messages.bulkPut(sourceRows.map((row,index)=>({...row,sessionId:correctionSession,createdAt:now+1000+index,isProactive:false})) as any);
  const historicalQuery={userId:'u',characterId:'a',query:sourceRows.at(-1)!.content,currentSessionId:correctionSession,excludeMessageIds:['context-query']};
  const correctedHits=await recallHistoricalPrivateChat(historicalQuery);
  const colorSession='color-correction-cooling';
  await db.sessions.put({id:colorSession,characterId:'a',userId:'u',title:'颜色更正',createdAt:now+100000,updatedAt:now+110000});
  const colorRows=[
    {id:'color-original',role:'user',content:'今天买了一本灰色封面的笔记本。'},
    {id:'color-correction',role:'user',content:'刚才说错了，其实带回来的是蓝色那本，灰色的最后没买。'},
    ...Array.from({length:12},(_,index)=>({id:'color-filler-'+index,role:index%2?'assistant':'user',content:index%2?'蓝色真好看。':'换个话题聊两句。'})),
  ];
  await db.messages.bulkPut(colorRows.map((row,index)=>({...row,sessionId:colorSession,createdAt:now+100001+index,isProactive:false})) as any);
  const colorQuery='我后来买的笔记本是什么颜色？';
  const colorConversation=['蓝色也好。','蓝色那本素净。','那本蓝色封面我记着。'].flatMap(content=>[{kind:'user_input' as const,content:'说点别的。'},{kind:'dialogue' as const,content}]);
  check(coolingWorldMotifs(colorQuery,colorConversation).includes('蓝色'),'fixture reproduces repeated color cooling while the query names the object rather than color value');
  const colorParams={sources:['chat'],query:colorQuery,recentConversation:colorConversation};
  const colorRecall=await recall('a',colorParams);
  check(colorRecall.references.some(row=>row.id==='color-original'),'object recall includes the original speaker-owned notebook statement');
  check(colorRecall.references.some(row=>row.id==='color-correction'&&row.text.includes('随后用户更正')&&row.text.includes('蓝色')),'motif cooling cannot erase a source-linked raw correction in actual packed memory');
  check(!(await recall('a',{...colorParams,excludeMessageIds:['color-correction']})).references.some(row=>row.id==='color-correction'),'cooling exemption never overrides explicit source exclusion');
  check(!(await recall('b',colorParams)).references.some(row=>row.id==='color-correction'),'protected correction stays within its owning character');
  await db.messages.delete('color-correction');
  check(!(await recall('a',colorParams)).references.some(row=>row.id==='color-correction'),'deleted protected correction cannot survive recall');
  await db.messages.where('sessionId').equals(colorSession).delete();
  await db.sessions.delete(colorSession);
  check(correctedHits.some(hit=>hit.messageId==='context-correction'&&hit.followsMessageId==='context-plan'&&hit.content.includes('周四')),'noun-free adjacent user correction is recalled as its own sourced message');
  check(!correctedHits.some(hit=>hit.messageId==='context-query'),'pending recall question cannot become its own evidence');
  check(!correctedHits.some(hit=>hit.followsMessageId==='context-plan'&&hit.messageId==='context-unrelated-correction'),'correction chain stops at an intervening unrelated user topic');
  const beginning=await recallHistoricalPrivateChat({...historicalQuery,query:'我开头说的习惯是什么？'});
  check(beginning.some(hit=>hit.messageId==='context-first'&&hit.content.includes('不喝咖啡')),'positional reference reads the owned active session beginning');
  check(!(await recallHistoricalPrivateChat({...historicalQuery,userId:'other'})).some(hit=>hit.sessionId===correctionSession),'active session hint cannot cross account ownership');
  check(!(await recallHistoricalPrivateChat({...historicalQuery,characterId:'b'})).some(hit=>hit.sessionId===correctionSession),'active session hint cannot cross character ownership');
  await db.messages.delete('context-correction');
  check(!(await recallHistoricalPrivateChat(historicalQuery)).some(hit=>hit.messageId==='context-correction'),'deleted correction disappears from future raw recall');
  await db.messages.update('context-plan',{content:'下周六下午四点面试。',revision:2});
  check((await recallHistoricalPrivateChat(historicalQuery)).some(hit=>hit.messageId==='context-plan'&&hit.content.includes('周六')),'source edit is read from current DB rather than a stale linked snippet');
  await db.messages.put({id:'context-composed',sessionId:correctionSession,role:'user',content:'助理代写：我想买三个杯子。',createdAt:now+999,isProactive:false,secretaryDispatch:{bodyOrigin:'composed'}} as any);
  const composedHits=await recallHistoricalPrivateChat({...historicalQuery,query:'我想买三个杯子'});
  check(composedHits.some(hit=>hit.messageId==='context-composed'&&hit.userAuthored===false),'assistant-composed relay is explicitly distinguished from user-authored evidence');
  const firstWithRelay=await recallHistoricalPrivateChat({...historicalQuery,query:'我开头说的习惯是什么？'});
  check(firstWithRelay.some(hit=>hit.messageId==='context-first')&&!firstWithRelay.some(hit=>hit.messageId==='context-composed'),'positional user reference skips an earlier assistant-composed relay');
  const extractionSources = [
    {role:'user',content:'我现在更喜欢清淡的饭菜。',sourceId:'food-source'},
    {role:'assistant',content:'我以前亲眼看过你锻造。',sourceId:'invented-witness'},
    {role:'user',content:'我每天都吃牛肉。',sourceId:'composed-source',userAuthored:false},
  ];
  check(userMemorySources(extractionSources).map(turn=>turn.sourceId).join(',')==='food-source','fact extractor receives only user-authored sources, not invented witnesses or relay drafts');
  check(acceptExtractedMemories([{content:'用户喜欢锻造',sourceIds:['invented-witness']}],extractionSources).error==='parse:error','assistant-only evidence cannot create a durable user fact or advance cursor');
  check(acceptExtractedMemories([{content:'用户每天吃牛肉',sourceIds:['composed-source']}],extractionSources).error==='parse:error','assistant-composed user-role evidence cannot create a fact');
  check(acceptExtractedMemories(['用户喜欢清淡饭菜'],extractionSources).error==='parse:error','indexed extraction cannot silently assign a string claim to the whole source batch');
  const accepted=acceptExtractedMemories([{content:'用户现在更喜欢清淡饭菜',sourceIds:['food-source']},{content:'虚构',sourceIds:['invented-witness']}],extractionSources);
  check(accepted.memories?.join(',')==='用户现在更喜欢清淡饭菜'&&accepted.evidence?.[0].sourceIds.join(',')==='food-source','valid correction survives alongside rejected generated evidence with precise provenance');
  check(acceptExtractedMemories([],extractionSources).memories?.length===0,'genuine empty extraction remains a successful no-fact result');
  check(acceptExtractedMemories(['用户喜欢清淡饭菜'],[{role:'user',content:'我喜欢清淡饭菜'}]).memories?.length===1,'legacy unindexed user extraction remains compatible');
  check(memorySpeaker('assistant').includes('未经独立核实')&&memorySpeaker('user',false).includes('不是用户原话')&&MEMORY_SOURCE_POLICY.includes('承诺记为承诺'),'summary source labels distinguish generated speech, relay drafts and unfulfilled promises');
  const fallback=buildLocalFallbackSummary(extractionSources,'以前的话题记录');
  check(fallback.includes('角色曾说（未经独立核实')&&fallback.includes('我以前亲眼看过你锻造')&&fallback.includes('不是用户原话'),'offline summary preserves generated speech with provenance rather than upgrading it into shared experience');
  await sessionRepo.create({id:'source-attribution-session',userId:'u',characterId:'a',type:'single',title:'来源边界',createdAt:now+90000,updatedAt:now+90000,unreadCount:0} as any);
  await db.messages.bulkPut(extractionSources.map((turn,index)=>({id:turn.sourceId,sessionId:'source-attribution-session',role:turn.role,content:turn.content,createdAt:now+90000+index,isProactive:false,...(turn.userAuthored===false?{secretaryDispatch:{bodyOrigin:'composed'}}:{})})) as any);
  const attributedRecall=await recall('a',{sources:['chat'],query:'锻造'});
  check(attributedRecall.references.some(row=>row.id==='invented-witness'&&row.text.includes('未经独立核实')),'actual recent-session recall keeps invented witness as attributed speech instead of confirmed experience');
  check(attributedRecall.references.some(row=>row.id==='composed-source'&&row.text.includes('不是用户原话')),'actual recent-session recall distinguishes assistant-composed relay from user facts');
  check(attributedRecall.references.some(row=>row.id==='food-source'&&row.text.includes('用户原话')),'actual user preference remains recallable with its authorship');
  for (const [index, persona] of ['现代同事，关系为朋友。','古代导师，不了解现代生活。','原创航行员，与对话者是同伴。','稀疏导入角色，无额外关系。'].entries()) {
    const characterId='global-summary-'+index, sessionId=characterId+'-valid', sourceId=sessionId+'-source';
    await db.characters.put({id:characterId,createdBy:'u',name:characterId,systemPrompt:persona,createdAt:now} as any);
    const valid={id:sessionId,userId:'u',characterId,title:'旧约定',createdAt:now,updatedAt:now+100000,unreadCount:0,summary:'旧约定：下次聊茶的味道。',summarySourceMessageIds:[sourceId],summarySourceMessageRevisions:{[sourceId]:1}};
    await db.sessions.put(valid);
    await db.messages.put({id:sourceId,sessionId,role:'user',content:'下次聊茶的味道。',revision:1,createdAt:now,isProactive:false});
    check(await hasLivePrivateSummarySources(valid,'u',characterId),persona+' exact source allows summary');
    check(!await hasLivePrivateSummarySources({...valid,userId:'foreign'},'u',characterId),persona+' foreign account summary denied');
    check(!await hasLivePrivateSummarySources(valid,'u','other'),persona+' other character summary denied');
    check(!await hasLivePrivateSummarySources({...valid,type:'group'},'u',characterId),persona+' group summary cannot become private summary');
    check(!await hasLivePrivateSummarySources({...valid,summarySourceMessageIds:[]},'u',characterId),persona+' source-less summary is not vacuously verified');
    check(!await hasLivePrivateSummarySources({...valid,summarySourceMessageRevisions:{}},'u',characterId),persona+' missing revision is not guessed from current content');
    check(!await hasLivePrivateSummarySources(valid,'u',characterId,new Set([sourceId])),persona+' forgotten source denies summary');
    check(!await hasLivePrivateSummarySources({...valid,summarySourceMessageIds:[sourceId,sourceId]},'u',characterId),persona+' duplicate source metadata denied');
    await db.sessions.put({...valid,id:characterId+'-orphan',updatedAt:now+300000,summary:'旧约定：虚构过的共同旅行。',summarySourceMessageIds:[]});
    await db.sessions.put({...valid,id:characterId+'-unversioned',updatedAt:now+200000,summary:'旧约定：未经核验的偏好。',summarySourceMessageRevisions:{}});
    for(const mode of ['private-chat','proactive-chat','world-scene'] as const){
      const recalled=await recallCharacterMemory({userId:'u',characterId,mode,sources:['chat'],query:'还记得旧约定吗',budget:4000});
      check(recalled.references.some(r=>r.id===sessionId),persona+' '+mode+' invalid newer summaries cannot displace valid older summary');
      check(!recalled.references.some(r=>r.id===characterId+'-orphan'||r.id===characterId+'-unversioned'),persona+' '+mode+' never recalls orphan or unversioned summary');
    }
    await db.messages.update(sourceId,{revision:2,content:'下次改聊咖啡。'});
    check(!await hasLivePrivateSummarySources(valid,'u',characterId),persona+' source correction invalidates old summary at read time');
    const corrected=await recallCharacterMemory({userId:'u',characterId,mode:'private-chat',sources:['chat'],query:'还记得旧约定吗',budget:4000});
    check(!corrected.references.some(r=>r.id===sessionId),persona+' corrected source cannot revive stale summary');
    check((await db.sessions.get(sessionId))?.summary===valid.summary,persona+' old stored summary retained without rewriting history');
    await db.messages.update(sourceId,{revision:1,failed:true});
    check(!await hasLivePrivateSummarySources(valid,'u',characterId),persona+' failed source denied');
    await db.messages.update(sourceId,{failed:false,sessionId:characterId+'-orphan'});
    check(!await hasLivePrivateSummarySources(valid,'u',characterId),persona+' another session source denied');
    await db.messages.delete(sourceId);
    check(!await hasLivePrivateSummarySources(valid,'u',characterId),persona+' deleted source denied');
  }
  for(const [index,persona] of ['现代同伴','古代导师','原创星际向导','资料稀疏的导入角色'].entries()) {
    const roleId='world-scope-role-'+index,left='world-scope-left-'+index,right='world-scope-right-'+index;
    await db.characters.put({id:roleId,createdBy:'u',name:persona,systemPrompt:persona,createdAt:now} as any);
    for(const worldId of [left,right]) {
      await db.worlds.put({id:worldId,userId:'u',name:worldId,createdAt:now,updatedAt:now+900000} as any);
      await db.worldEvents.put({id:worldId+'-event',userId:'u',worldId,type:'stage',title:'世界边界记号 '+worldId,summary:'仅属于这个世界的秘密凭据',visibility:'selected',visibleTo:[roleId],timestamp:now,createdAt:now,memoryIds:[]} as any);
      await knowledgeRepo.upsert({userId:'u',worldId,characterId:roleId,eventId:worldId+'-event',knowledgeLevel:'full',canMention:true});
      await db.worldScenes.put({id:worldId+'-scene',userId:'u',worldId,characterIds:[roleId],status:'active',title:'边界场景 '+worldId,place:'旧站台',timeLabel:'午后',mood:'安静',updatedAt:now,state:{participants:[]}} as any);
      await db.worldSceneEntries.put({id:worldId+'-entry',sceneId:worldId+'-scene',index:0,kind:'narration',content:'世界边界记号现场 '+worldId,createdAt:now,witnessedBy:[roleId]} as any);
    }
    const request={userId:'u',characterId:roleId,sources:['world' as const],query:'世界边界记号',budget:6000,withCatalog:true};
    const scoped=await buildCharacterMemoryContext({...request,mode:'world-scene',scene:{worldId:left,sceneId:left+'-scene',liveSegments:true}});
    check(scoped.references.some(r=>r.id===left+'-event'),persona+' scoped world retains known current-world event');
    check(!scoped.references.some(r=>r.id===right+'-event'||r.id===right+'-entry'),persona+' scoped world excludes parallel-world event and live entry');
    check(scoped.catalog?.events.every(e=>e.worldId===left),persona+' structured catalog obeys the same world boundary');
    const activeScene=(await db.worldScenes.get(left+'-scene'))!;
    const actorContext=await buildWorldContext({userId:'u',worldId:left,scene:activeScene,characters:await db.characters.toArray(),userText:'世界边界记号'});
    const rendered=renderCharacterContext(actorContext,roleId);
    check(rendered.includes(left+'-event')||rendered.includes('世界边界记号 '+left),persona+' actual world actor prompt retains scoped known event');
    check(!rendered.includes(right+'-event')&&!rendered.includes('世界边界记号 '+right),persona+' actual world actor prompt never contains parallel-world secret');
    const foreignStage='world-scope-injection-'+index;
    await indexPromptMemoryReferences({userId:'u',characterId:roleId,worldId:left},[{source:'world',id:right+'-event',text:'世界边界记号 '+right,at:now}],foreignStage);
    check(!(await db.memoryUsage.toArray()).some(row=>row.messageId===foreignStage),persona+' manual source indexing cannot register foreign-world injection');
    const direct=await buildCharacterMemoryContext({...request,worldId:right});
    check(direct.references.some(r=>r.id===right+'-event')&&!direct.references.some(r=>r.id===left+'-event'),persona+' explicit world request scopes without mode inference');
    const unscoped=await buildCharacterMemoryContext({...request,mode:'private-chat'});
    check(unscoped.references.some(r=>r.id===left+'-event')&&unscoped.references.some(r=>r.id===right+'-event'),persona+' ordinary private recall retains owned cross-world references');
    const conflict=await buildCharacterMemoryContext({...request,worldId:right,scene:{worldId:left}});
    check(conflict.references.length===0,persona+' contradictory world scope is not silently widened');
    const missing=await buildCharacterMemoryContext({...request,worldId:'missing-world'});
    check(!missing.references.length&&!missing.catalog,persona+' unknown scope cannot fall back to all worlds');
    await db.worlds.put({id:'foreign-world-'+index,userId:'other',name:'foreign'} as any);
    const foreign=await buildCharacterMemoryContext({...request,worldId:'foreign-world-'+index});
    check(!foreign.references.length&&!foreign.catalog,persona+' foreign world cannot open account-global fallback');
  }
  const crossRole='cross-source-role';
  await db.characters.put({id:crossRole,createdBy:'u',name:'独立的资料稀疏角色',systemPrompt:'表达简短',createdAt:now} as any);
  const originalLegacyGet=db.sharedStoryEvents.get;
  for(const mode of ['event','shared','scene','live-entry'] as const){
    const worldId='cross-source-'+mode, eventId=worldId+'-event', sceneId=worldId+'-scene', entryId=worldId+'-entry', sharedId=worldId+'-memory';
    const marker='CROSS_OLD_'+mode;
    await db.worlds.put({id:worldId,userId:'u',name:worldId,createdAt:now,updatedAt:now} as any);
    await db.worldEvents.put({id:eventId,userId:'u',worldId,type:mode==='shared'?'shared_memory':'stage',title:marker,summary:marker,visibility:'selected',visibleTo:[crossRole],memoryIds:mode==='shared'?[sharedId]:[],createdAt:now,timestamp:now,updatedAt:now} as any);
    await knowledgeRepo.upsert({userId:'u',worldId,characterId:crossRole,eventId,knowledgeLevel:'full',canMention:true});
    await db.sharedMemories.put({id:sharedId,userId:'u',worldId,title:marker,summary:marker,visibility:'selected',visibleTo:[crossRole],characterIds:[crossRole],createdAt:now,updatedAt:now} as any);
    await db.worldScenes.put({id:sceneId,userId:'u',worldId,characterIds:[crossRole],title:marker,status:mode==='live-entry'?'active':'finished',worldEventId:eventId,createdAt:now,updatedAt:now,state:{participants:[]}} as any);
    await db.worldSceneEntries.put({id:entryId,sceneId,index:0,kind:'user_input',content:marker,createdAt:now,witnessedBy:[crossRole]} as any);
    const request={userId:'u',characterId:crossRole,worldId,topic:'还记得 '+marker+' 吗',sources:['world' as const],budget:6000};
    const target=mode==='event'?eventId:mode==='shared'?sharedId:mode==='scene'?sceneId:entryId;
    check((await buildCharacterMemoryContext(request)).references.some(ref=>ref.id===target),mode+' race fixture proves the target is actually recallable');
    let edits=0;
    try{
      db.sharedStoryEvents.get=(async(key:any)=>{
        if(key===target && !edits++){
          if(mode==='shared')await db.sharedMemories.update(sharedId,{summary:'CROSS_NEW_shared'});
          else if(mode==='live-entry')await db.worldSceneEntries.update(entryId,{content:'CROSS_NEW_live-entry'});
          else await db.worldEvents.update(eventId,{summary:'CROSS_NEW_'+mode});
        }
        return originalLegacyGet.call(db.sharedStoryEvents,key);
      }) as typeof db.sharedStoryEvents.get;
      const recalled=await buildCharacterMemoryContext(request);
      check(edits>0,mode+' source changes after selection inside the full recall flow');
      check(!recalled.references.some(ref=>ref.id===target),mode+' changed source or parent event removes the stale reference');
      if(mode==='scene')check(!recalled.references.some(ref=>ref.id===eventId),'final batch cannot retain an earlier event changed while a later scene is validated');
    }finally{db.sharedStoryEvents.get=originalLegacyGet;}
  }
  const permissionWorld='cross-source-scene',permissionEvent=permissionWorld+'-event',permissionScene=permissionWorld+'-scene';
  const permissionRequest={userId:'u',characterId:crossRole,worldId:permissionWorld,topic:'还记得 CROSS_OLD_scene 吗',sources:['world' as const],budget:6000};
  const permissionBaseline=await buildCharacterMemoryContext(permissionRequest);
  const eventPosition=permissionBaseline.references.findIndex(ref=>ref.id===permissionEvent),scenePosition=permissionBaseline.references.findIndex(ref=>ref.id===permissionScene);
  check(eventPosition>=0&&scenePosition>eventPosition,'permission race fixture retains an event before validating its related scene');
  let revoked=0;
  try{
    db.sharedStoryEvents.get=(async(key:any)=>{
      if(key===permissionScene&&!revoked++)await knowledgeRepo.upsert({userId:'u',worldId:permissionWorld,characterId:crossRole,eventId:permissionEvent,knowledgeLevel:'full',canMention:false});
      return originalLegacyGet.call(db.sharedStoryEvents,key);
    }) as typeof db.sharedStoryEvents.get;
    const recalled=await buildCharacterMemoryContext(permissionRequest);
    check(revoked>0,'knowledge permission is actually revoked while a later scene candidate is being checked');
    check(!recalled.references.some(ref=>ref.id===permissionEvent||ref.id===permissionScene),'final batch rereads knowledge permissions, not only source text snapshots');
  }finally{db.sharedStoryEvents.get=originalLegacyGet;}
  await db.moments.put({id:'cross-moment',userId:'u',authorCharacterId:null,text:'CROSS_POST_OLD',mediaIds:[],visibility:'selected',audienceCharacterIds:[crossRole],deleted:false,createdAt:now,updatedAt:now} as any);
  await db.momentViews.put({id:'cross-view',userId:'u',momentId:'cross-moment',characterId:crossRole,viewedAt:now});
  await db.momentReactions.bulkPut([
    {id:'cross-parent',userId:'u',momentId:'cross-moment',characterId:'a',type:'comment',content:'CROSS_PARENT_OLD',status:'active',createdAt:now-1,updatedAt:now},
    {id:'cross-reply',userId:'u',momentId:'cross-moment',characterId:'b',type:'comment',replyToId:'cross-parent',content:'CROSS_REPLY',status:'active',createdAt:now,updatedAt:now},
  ] as any);
  const momentRequest={userId:'u',characterId:crossRole,topic:'查一下 CROSS_POST_OLD 的朋友圈评论',sources:['moment' as const],budget:6000};
  check((await buildCharacterMemoryContext(momentRequest)).references.some(ref=>ref.id==='cross-reply'),'reaction race fixture proves the nested reply is selected');
  const originalReactionGet=db.momentReactions.get;
  for(const dependency of ['post','parent'] as const){
    await db.moments.update('cross-moment',{text:'CROSS_POST_OLD'});
    await db.momentReactions.update('cross-parent',{content:'CROSS_PARENT_OLD'});
    let edits=0;
    try{
      db.momentReactions.get=(async(key:any)=>{
        if(key==='cross-reply'&&!edits++){
          if(dependency==='post')await db.moments.update('cross-moment',{text:'CROSS_POST_NEW'});
          else await db.momentReactions.update('cross-parent',{content:'CROSS_PARENT_NEW'});
        }
        return originalReactionGet.call(db.momentReactions,key);
      }) as typeof db.momentReactions.get;
      const recalled=await buildCharacterMemoryContext(momentRequest);
      check(edits>0,dependency+' dependency really changes during reaction validation');
      check(!recalled.references.some(ref=>ref.id==='cross-reply'),dependency+' edit invalidates the nested comment referencing it');
      if(dependency==='post')check(!recalled.text.includes('CROSS_POST_OLD'),'post edit also removes an earlier retained post in the final batch');
    }finally{db.momentReactions.get=originalReactionGet;}
  }
  check(scopedExport.memories.every((item) => item.userId === 'u') && scopedExport.sessions.every((item) => item.userId === 'u'), 'backup export contains only the requested account');
  check(scopedExport.groups?.some((group) => group.id === 'g') && scopedExport.sourceTombstones?.every((row) => row.userId === 'u'), 'backup preserves group continuity and only same-account tombstones');
  document.body.textContent = `ok   ${count} assertions (real IndexedDB, zero network)\n\nALL PASS`;
  await report('/result', { method:'POST', body:document.body.textContent });
}
run().catch(async e => {
  // 失败时把首个不通过的断言与堆栈都留下来；结尾必须是 runner 认得的判定行
  document.body.textContent = `FAIL ${e?.message ?? e}\n${e?.stack ?? ''}\n\n1 FAILED`;
  await report('/result', { method:'POST', body:document.body.textContent });
});
