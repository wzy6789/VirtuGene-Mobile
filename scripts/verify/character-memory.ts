import { db } from '../../src/db/index';
import { messageRepo } from '../../src/db/message-repo';
import { memoryRepo } from '../../src/db/memory-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { todoRepo } from '../../src/db/todo-repo';
import { indexPromptMemoryReferences, recallCharacterMemory, packCharacterMemory } from '../../src/lib/character-memory';
import { rankConversationMemories } from '../../src/lib/memory-engine';
import { buildContextTrace } from '../../src/lib/chat-trace';
import { buildWorldContext, renderCharacterContext } from '../../src/lib/world/world-context';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { momentsRepo, planAutonomousMomentInteraction } from '../../src/db/moments-repo';
import { collectSyncData, importSyncData } from '../../src/lib/sync';
import { diaryRepo } from '../../src/db/diary-repo';
import { clearDiarySharing, setDiarySharing } from '../../src/lib/world/diary-visibility';
import { useAuthStore } from '../../src/store/auth-store';
import { undoLastTurn } from '../../src/lib/world/world-undo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { findRelevantHistory } from '../../src/lib/world/world-recall';
import { recallHistoricalPrivateChat } from '../../src/lib/character-history-recall';
import { buildSummaryBatch, findUncoveredSummaryMessages } from '../../src/lib/ai/summary-batches';
import { memoryLedgerRepo } from '../../src/db/memory-ledger-repo';

const report = window.fetch.bind(window);
async function run() {
  let count = 0;
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); count++; };
  window.fetch = (() => { throw new Error('Unexpected network'); }) as typeof fetch;
  await db.open();
  const now = Date.now();
  await db.characters.bulkPut(['a','b','c'].map(id => ({ id, createdBy: 'u', name: id, systemPrompt: 'test', createdAt: now })) as any);
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
  check((await findRelevantHistory({userId:'u',worldId:'old-history-world',characterId:'a',query:'还记得青海极光旧约吗'})).some((hit) => hit.id === 'very-old-event'), 'explicit world recall reaches beyond the former 500-event window');
  await db.worldScenes.put({id:'live',userId:'u',worldId:'w',characterIds:['a','b'],status:'active',title:'树林',updatedAt:now,state:{participants:[]}} as any);
  await db.worldSceneEntries.put({id:'live-entry',sceneId:'live',kind:'narration',content:'听到了树梢上的鸟鸣',createdAt:now,order:0} as any);
  check((await recall('a',{audience:['b']})).text.includes('鸟鸣'), 'ongoing world memory available before settlement');
  check(!(await recall('c')).text.includes('鸟鸣'), 'absent character cannot recall live world');
  const scene: any = {id:'scene',userId:'u',worldId:'w',characterIds:['a'],place:'海边',timeLabel:'午后',mood:'安静',state:{participants:[],entryMemoryMode:'memory'}};
  const characters = await db.characters.toArray();
  const context = await buildWorldContext({userId:'u',worldId:'w',scene,characters});
  check(renderCharacterContext(context,'a').includes('GROUP_MEMORY_SENTINEL_42'), 'actual world actor context receives group memory');
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
  check(!renderCharacterContext(sharedContext,'a').includes('天文观测营') && !renderCharacterContext(sharedContext,'b').includes('天文观测营'), 'multi-character scene cannot expose A-only private profile through dialogue');
  check(!renderCharacterContext(sharedContext,'a').includes('蓝色'), 'multi-character scene cannot expose pinned one-to-one chat memory');
  scene.state.entryMemoryMode='present';
  const present = await buildWorldContext({userId:'u',worldId:'w',scene,characters});
  check(!renderCharacterContext(present,'a').includes('GROUP_MEMORY_SENTINEL_42'), 'present mode excludes imported memory');
  await db.todos.put({ id:'shared-completed', userId:'u', title:'寄出资料包', note:'已经交给快递', dueDate:'2026-09-20', recurrence:{kind:'none'}, status:'completed', completedAt:now, visibility:'selected', visibleTo:['a'], createdAt:now, updatedAt:now } as any);
  await db.todoOccurrences.put({ id:'todo-occ:shared-completed:2026-09-20', userId:'u', todoId:'shared-completed', dueDate:'2026-09-20', originalDueDate:'2026-09-20', status:'completed', completedAt:now, createdAt:now, updatedAt:now } as any);
  await db.todos.put({ id:'private-pending', userId:'u', title:'未来提醒测试', recurrence:{kind:'none'}, status:'todo', visibility:'selected', visibleTo:['a'], createdAt:now, updatedAt:now } as any);
  const completedTodoRecall = await recall('a', { query:'资料包', sources:['todo'] });
  check(completedTodoRecall.text.includes('寄出资料包') && completedTodoRecall.text.includes('已在'), 'completed shared todo is recalled as an experience');
  check(!(await recall('a', { audience:['b'], query:'资料包', sources:['todo'] })).text.includes('寄出资料包'), 'completed todo requires authorization for every listener');
  check(!(await recall('a', { query:'提醒', sources:['todo'] })).text.includes('未来提醒测试'), 'unfinished todo is not duplicated as a past memory');
  check((await todoRepo.visibleOccurrencesForCharacter('u', 'a', 8)).some(({ todo }) => todo.id === 'private-pending'), 'selected unfinished todo remains available to its authorized character');
  const packed = packCharacterMemory([{source:'chat',id:'1',text:'记住蓝色',at:now,pinned:true},{source:'chat',id:'2',text:'记住蓝色',at:now},{source:'group',id:'3',text:'超长'.repeat(2000),at:now}], '', 600);
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
