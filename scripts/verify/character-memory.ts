import { db } from '../../src/db/index';
import { messageRepo } from '../../src/db/message-repo';
import { recallCharacterMemory, packCharacterMemory } from '../../src/lib/character-memory';
import { buildContextTrace } from '../../src/lib/chat-trace';
import { buildWorldContext, renderCharacterContext } from '../../src/lib/world/world-context';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { momentsRepo, planAutonomousMomentInteraction } from '../../src/db/moments-repo';
import { useAuthStore } from '../../src/store/auth-store';

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
  await messageRepo.create({ id:'msg', sessionId:'s', role:'user', content:'周五一起去看海', createdAt:now, isProactive:false });
  check((await db.messages.get('msg'))?.witnessedBy?.join(',') === 'a,b', 'message audience snapshot');
  const recall = (characterId = 'a', extra = {}) => recallCharacterMemory({userId:'u',characterId, ...extra});
  check((await recall()).text.includes('看海'), 'group to private chat');
  await db.groups.update('g',{characterIds:['a','b','c']});
  check(!(await recall('c')).text.includes('看海'), 'late joiner cannot inherit old memory');
  check(!(await recall('a',{audience:['b','c']})).text.includes('看海'), 'shared prompt excludes unheard group history');
  await db.messages.put({id:'legacy',sessionId:'s',role:'user',content:'旧群机密',createdAt:now,isProactive:false});
  check(!(await recall()).text.includes('旧群机密'), 'legacy messages fail closed');
  await db.messages.update('msg',{failed:true});
  check(!(await recall()).text.includes('看海'), 'failed message excluded');
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
  check(!(await recall('a',{audience:['b']})).text.includes('蓝色'), 'private memory not disclosed to group');
  await db.moments.put({id:'post',userId:'u',authorCharacterId:'b',text:'今天看到彩虹',visibility:'all',audienceCharacterIds:['a','b'],visibilityRevision:0,mediaIds:['image'],createdAt:now,updatedAt:now} as any);
  check(!(await recall()).text.includes('彩虹'), 'unseen post not treated as known');
  await db.momentViews.put({id:'view',userId:'u',momentId:'post',characterId:'a',viewedAt:now});
  await db.momentReactions.put({id:'comment',userId:'u',momentId:'post',characterId:'b',type:'comment',content:'在西边看到的',status:'active',createdAt:now,updatedAt:now});
  const social = await recall();
  check(social.text.includes('彩虹') && social.text.includes('在西边'), 'role post and comment recall');
  check(social.text.includes('配图内容未知'), 'no invented image knowledge');
  await db.momentReactions.update('comment',{status:'withdrawn'});
  check(!(await recall()).text.includes('在西边'), 'withdrawn comment disappears');
  await db.momentContacts.put({id:'blocked',userId:'u',characterId:'a',blocked:true,updatedAt:now} as any);
  check(!(await recall()).text.includes('彩虹'), 'blocking immediately revokes recall');
  await db.momentContacts.delete('blocked');
  await db.moments.update('post',{visibility:'private'});
  check(!(await recall('a',{query:'朋友圈彩虹'})).text.includes('彩虹'), 'private overrides direct question');
  await db.moments.update('post',{visibility:'all',deleted:true} as any);
  check(!(await recall()).text.includes('彩虹'), 'deleted source not resurrected');
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
  await db.worldScenes.put({id:'live',userId:'u',worldId:'w',characterIds:['a','b'],status:'active',title:'树林',updatedAt:now,state:{participants:[]}} as any);
  await db.worldSceneEntries.put({id:'live-entry',sceneId:'live',kind:'narration',content:'听到了树梢上的鸟鸣',createdAt:now,order:0} as any);
  check((await recall('a',{audience:['b']})).text.includes('鸟鸣'), 'ongoing world memory available before settlement');
  check(!(await recall('c')).text.includes('鸟鸣'), 'absent character cannot recall live world');
  const scene: any = {id:'scene',userId:'u',worldId:'w',characterIds:['a'],place:'海边',timeLabel:'午后',mood:'安静',state:{participants:[],entryMemoryMode:'memory'}};
  const characters = await db.characters.toArray();
  const context = await buildWorldContext({userId:'u',worldId:'w',scene,characters});
  check(renderCharacterContext(context,'a').includes('看海'), 'actual world actor context receives group memory');
  scene.state.entryMemoryMode='present';
  const present = await buildWorldContext({userId:'u',worldId:'w',scene,characters});
  check(!renderCharacterContext(present,'a').includes('看海') && !renderCharacterContext(present,'a').includes('蓝色'), 'present mode excludes imported memory');
  const packed = packCharacterMemory([{source:'chat',id:'1',text:'记住蓝色',at:now,pinned:true},{source:'chat',id:'2',text:'记住蓝色',at:now},{source:'group',id:'3',text:'超长'.repeat(2000),at:now}], '', 600);
  check(packed.references.length === 1 && packed.references[0].id === '1' && packed.text.length <= 600, 'dedup, pinned priority, budget');
  const trace = buildContextTrace({compiled:{prompt:'',included:[],partial:['cross-channel-memory'],omitted:[]},crossChannelReferences:[{source:'group',id:'msg'}]});
  check(!trace.crossChannelReferences, 'partial injection has no false provenance');
  await db.messages.delete('msg');
  check(!(await recall()).text.includes('看海'), 'deleted message disappears');
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
  document.body.textContent = `ok   ${count} assertions (real IndexedDB, zero network)\n\nALL PASS`;
  await report('/result', { method:'POST', body:document.body.textContent });
}
run().catch(async e => {
  // 失败时把首个不通过的断言与堆栈都留下来；结尾必须是 runner 认得的判定行
  document.body.textContent = `FAIL ${e?.message ?? e}\n${e?.stack ?? ''}\n\n1 FAILED`;
  await report('/result', { method:'POST', body:document.body.textContent });
});
