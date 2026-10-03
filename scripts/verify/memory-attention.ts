import { detectTopicMove, isTopicRelated, updateChatConversationState, buildChatConversationStateContext } from '../../src/lib/chat-conversation-state';
import { buildHumanConversationContext } from '../../src/lib/chat-humanizer';
import { renderCharacterContext, renderObjectLayer, type WorldContext } from '../../src/lib/world/world-context';
import { buildActorSystem } from '../../src/lib/world/world-actor';
import { updateConversationState, directorConversationHints } from '../../src/lib/world/world-immersion';
import { coolingWorldMotifs, repeatedWorldMotifs, userRaisedWorldObject, WORLD_OBJECT_TOPIC_RULE } from '../../src/lib/world/world-attention';
import { directWorldTurn } from '../../src/lib/world/world-director';
import { actAsCharacter } from '../../src/lib/world/world-actor';
import { directSceneTurn } from '../../src/lib/ai/scene-director';
import type { WorldSceneEntry } from '../../src/db/index';
import { narrateWorldBeat } from '../../src/lib/world/world-narrator';
import { interpretWorldIntent } from '../../src/lib/world/world-intent';

const report = window.fetch.bind(window);
let count = 0;
function check(ok: unknown, label: string): void { if (!ok) throw Error(label); count += 1; }

async function run(): Promise<void> {
  check(detectTopicMove('对了，我要去商场', '我刚才在说海边散步'), 'explicit topic move');
  check(detectTopicMove('我现在要去商场', '我们刚在海边散步'), 'natural topic move');
  check(!detectTopicMove('商场二楼在哪里', '我现在要去商场'), 'follow-up stays on topic');
  check(!detectTopicMove('然后呢', '我现在要去商场'), 'short continuation stays on topic');
  check(isTopicRelated('我现在要去商场', '用户说过准备去商场买东西'), 'related memory can return');
  check(!isTopicRelated('我现在要去商场', '那天在海边看落日'), 'unrelated memory does not steer the turn');

  const first = updateChatConversationState(undefined, '我们刚在海边散步', '挺好的', 'react', 1);
  const next = updateChatConversationState(first, '我现在要去商场', '那就走吧', 'react', 2, '我们刚在海边散步');
  check(next.currentTopic === '我现在要去商场' && next.userWantsToShift, 'new topic replaces stale anchor');
  check(next.pausedTopics.includes('我们刚在海边散步'), 'old topic paused without deleting history');
  check(next.turnCount === 2, 'turn count persists beyond message window');
  check(!buildChatConversationStateContext(next).includes('当前话题只作为背景参考：「我们刚在海边散步」'), 'old anchor not put back into prompt');

  const character = { name: '星遥', tags: [], proactivity: 0.5, signature: '', greeting: '', catchphrase: '', boundaries: '', systemPrompt: '' };
  const history = [{ role: 'user', content: '今天有点空闲' }, { role: 'assistant', content: '我也有空。' }];
  const opts = { proactiveTopics: ['附近新开的书店'], turnNumber: 5 };
  check(buildHumanConversationContext('今天仍然有点空闲', history, character, opts).includes('附近新开的书店'), 'proactive cadence uses persistent turn count');
  check(!buildHumanConversationContext('今天仍然有点空闲', history, character, { ...opts, turnNumber: 6 }).includes('附近新开的书店'), 'no opener on every turn');
  check(!buildHumanConversationContext('今天仍然有点空闲', [...history, { role: 'assistant', content: '附近新开的书店挺有趣。' }], character, opts).includes('打开一个具体小话题：「附近新开的书店」'), 'recently spoken seed cools down');

  const ctx = {
    place: '街角', timeLabel: '午后', mood: '平静', presence: ['a', 'b'],
    objects: [], recentEntries: [], nameOf: (id: string) => id,
    perCharacter: {
      a: { characterId: 'a', name: '星遥', persona: '记得自己的事', facts: [],
        memories: [{ id: 'sea', title: '海边的约定', summary: '一起看落日' }],
        diaries: [{ id: 'mall', date: '2026-09-27', title: '商场采购', content: '用户打算去商场' }],
        events: [], scenes: [], threads: [], todos: [],
        privateChatSummary: '之前一直在谈海边的约定',
      },
      b: { characterId: 'b', name: '月见', persona: '', facts: [], memories: [], diaries: [], events: [], scenes: [], threads: [], todos: [] },
    },
  } as unknown as WorldContext;
  const archive = renderCharacterContext(ctx, 'a');
  const focused = renderCharacterContext(ctx, 'a', '我要去商场');
  check(archive.includes('海边的约定') && archive.includes('商场采购'), 'full authorized archive remains intact');
  check(focused.includes('商场采购') && !focused.includes('海边的约定'), 'live actor prompt uses topical memory');
  check(!renderCharacterContext(ctx, 'b', '我要去商场').includes('商场采购'), 'other actor cannot inherit private diary');
  check(renderCharacterContext(ctx, 'a', '还记得海边的约定吗').includes('海边的约定'), 'explicit recall reopens past');
  const actor = buildActorSystem({ ctx, speaker: { characterId: 'a', intent: '回应当前去向', mode: 'dialogue' }, userText: '我要去商场' });
  check(actor.includes('商场采购') && !actor.includes('海边的约定'), 'actual world actor gets focused context');
  ctx.perCharacter.a.crossChannelMemory = '【你在不同地方真实知道的事】\n[chat 2026-09-28] 用户亲口告诉你：收件人是姐姐。';
  check(renderCharacterContext(ctx, 'a', '那就给她吧').includes('收件人是姐姐'), 'selected personal memory survives a pronoun follow-up in world actor');
  check(!renderCharacterContext(ctx, 'b', '那就给她吧').includes('收件人是姐姐'), 'selected personal memory never moves to another actor');
  const worldBefore = updateConversationState(undefined, '我们在海边散步', []);
  const worldAfter = updateConversationState(worldBefore, '我要去商场', []);
  check(worldAfter.userWantsToShift && worldAfter.currentTopic?.includes('商场'), 'world recognizes natural topic move');
  check(directorConversationHints(worldAfter).includes('立刻跟随新话题'), 'world Director receives new focus');

  // Reproduce an object loop with different language on every turn. The old
  // exact topic-label matcher missed this and older scenes had no cooldown.
  const loop = [
    ['今天想喝茶', '字条还藏着秘密，我再看看。'],
    ['我们坐一会儿', '先弄明白字条是谁留下的。'],
    ['陪我说说话', '字条上的内容仍有疑点。'],
  ].flatMap(([user, dialogue], beat) => [
    { id: `u${beat}`, index: beat * 2, kind: 'user_input', content: user },
    { id: `a${beat}`, index: beat * 2 + 1, kind: 'dialogue', speakerId: 'a', content: dialogue, meta: { beatId: `beat${beat}` } },
  ]) as WorldSceneEntry[];
  const originalLoop = JSON.stringify(loop);
  check(repeatedWorldMotifs(loop).includes('字条'), 'different sentences about one object trigger cooldown');
  check(repeatedWorldMotifs([...loop].reverse()).includes('字条'), 'newest-first context detects the same repeated subject');
  check(!repeatedWorldMotifs(loop.slice(0, 4)).includes('字条'), 'one or two mentions do not suppress a subject');
  check(!repeatedWorldMotifs(loop.map(entry => ({ ...entry, meta: { beatId: 'same-beat' } }))).includes('字条'), 'multiple speakers in a single beat do not count as a loop');
  check(!repeatedWorldMotifs(loop.filter(entry => entry.kind === 'user_input').map(entry => ({ ...entry, content: '字条写了什么' }))).length, 'user questions never count as generated repetition');
  check(coolingWorldMotifs('继续', loop).includes('字条'), 'generic continuation does not reopen old mystery');
  check(!coolingWorldMotifs('字条写了什么', loop).includes('字条'), 'explicit object question reopens the subject');
  check(coolingWorldMotifs('不要再纠结字条了，我们喝茶', loop).includes('字条'), 'mentioning a subject to stop it does not reopen it');
  const askedLoop = [...loop, { index: 6, kind: 'user_input', content: '字条写了什么' }] as WorldSceneEntry[];
  check(!coolingWorldMotifs('它是谁写的', askedLoop).includes('字条'), 'pronoun question follows the users own active subject');
  check(coolingWorldMotifs('继续', loop.map(entry => ({ ...entry, content: entry.content.replace('字条', '古月娜') })), ['古月娜']).length === 0, 'character names are not treated as exhausted props');
  const quiet = Array.from({ length: 40 }, (_, index) => ({ index: index + 6, kind: 'system', content: '时间经过' })) as WorldSceneEntry[];
  check(!repeatedWorldMotifs([...loop, ...quiet]).length, 'cooldown expires outside the recent window');
  const resumed = updateConversationState({ ...worldAfter, exhaustedMotifs: ['字条'] }, '喝茶', quiet);
  check(resumed.exhaustedMotifs.length === 0, 'persisted cooldown is not a permanent blacklist');

  ctx.recentEntries = [...loop].reverse();
  ctx.conversation = undefined; // Existing saved scene, no migration required.
  ctx.worldFacts = []; ctx.recentEvents = []; ctx.openThreads = [];
  ctx.objects = [{ name: '字条', description: '原来的字条仍在桌上', lastAction: '放在茶杯旁' }] as WorldContext['objects'];
  ctx.perCharacter.a.name = '古月娜';
  ctx.perCharacter.a.memories = [{ id: 'note', title: '寻找字条来源', summary: '字条上的内容仍待查明' }] as typeof ctx.perCharacter.a.memories;
  ctx.perCharacter.a.privateChatSummary = '字条上的内容仍待查明';
  const cooled = buildActorSystem({ ctx, speaker: { characterId: 'a', intent: '陪伴用户', mode: 'dialogue' }, userText: '你们随便聊聊' });
  check(cooled.includes('【本轮注意力】') && cooled.includes('字条'), 'old scene gets contextual actor cooldown without saved rhythm state');
  check(!cooled.includes('原来的字条仍在桌上'), 'legacy object background never enters actor prompt');
  check(!cooled.includes('寻找字条来源'), 'free conversation stops reinjecting exhausted episode as a task');
  check(!cooled.includes('【你们早前私聊的摘要】'), 'cooled summary cannot keep pulling the actor back');
  check(renderCharacterContext(ctx, 'a').includes('寻找字条来源'), 'full authorized archive is preserved');
  const asked = buildActorSystem({ ctx, speaker: { characterId: 'a', intent: '回答字条内容', mode: 'dialogue' }, userText: '还记得字条写了什么吗' });
  check(asked.includes('寻找字条来源') && !asked.includes('【本轮注意力】'), 'actor can still use known history when user returns to it');
  check(!renderCharacterContext(ctx, 'b', '字条写了什么').includes('寻找字条来源'), 'reopening a cooled subject does not grant another actor private memory');

  let actorPrompt = '', directorPrompt = '', scenePrompt = '', calls = 0, networkCalls = 0;
  window.fetch = (() => { networkCalls += 1; throw new Error('unexpected network'); }) as typeof fetch;
  const beat = await actAsCharacter({ ctx, speaker: { characterId: 'a', intent: '一起喝茶', mode: 'both' }, userText: '继续', call: async params => {
    calls += 1; actorPrompt = String(params.messages[0].content);
    return { content: '{"dialogue":"茶还热着，坐这里。","action":"递来茶杯"}' };
  } });
  check(beat.dialogue === '茶还热着，坐这里。' && beat.llmCalls === 1 && actorPrompt.includes('【本轮注意力】'), 'real actor request receives cooldown with one model call');
  const plan = await directWorldTurn({ ctx, action: { intent: 'talk' }, userText: '继续', call: async params => {
    calls += 1; directorPrompt = String(params.messages[0].content);
    return { content: '{"speakers":[{"character":"a","intent":"一起喝茶"}]}' };
  } });
  check(plan.speakers.length === 1 && directorPrompt.includes('【本轮注意力】'), 'real director request also sees the repeated-subject guard');
  check(!directorPrompt.includes('原来的字条仍在桌上'), 'director does not inject legacy object background');
  const scene = await directSceneTurn({ apiKey: '', scene: { title: '喝茶', place: '家里', timeLabel: '午后', mood: '平静' }, state: { currentTension: 0, activeConflicts: [], pendingConsequences: [] }, members: [{ characterId: 'a', name: '古月娜', persona: '妻子' }], history: loop.map(entry => ({ kind: entry.kind as 'user_input' | 'dialogue', content: entry.content })), userAction: '继续' }, async params => {
    calls += 1; scenePrompt = String(params.messages[0].content);
    return { content: '{"entries":[{"kind":"dialogue","speaker":"古月娜","content":"一起喝茶吧。"}]}' };
  });
  check(scene.entries.length === 1 && scenePrompt.includes('【本轮注意力】'), 'legacy scene director follows the same attention rule');
  check(calls === 3 && networkCalls === 0, 'attention handling adds no model or network calls');
  check(JSON.stringify(loop) === originalLoop, 'attention handling never edits original dialogue');

  const freshCtx = { ...ctx, recentEntries: [], sceneGoal: '研究虹纹石', objects: [
    { name: '虹纹石', description: '窗台上的石头' },
    { name: '铜钥匙', description: '门边挂着的钥匙' },
  ] } as WorldContext;
  const beforeUser = renderObjectLayer(freshCtx, '你好');
  check(beforeUser === '', 'no unseen object is rendered as background');
  check(!beforeUser.includes('用户已提起，本轮可回应'), 'mere presence selects no object as a topic');
  const selectedObject = renderObjectLayer(freshCtx, '铜钥匙能开哪扇门');
  check(selectedObject === '', 'even user questions do not inject an automatic inventory');
  check(!selectedObject.includes('虹纹石'), 'asking about one object cannot inject another');
  check(!userRaisedWorldObject('继续', '虹纹石', []), 'generic continuation cannot select a new prop');
  check(!userRaisedWorldObject('看看周围', '虹纹石', []), 'general observation does not choose a mystery');
  check(!userRaisedWorldObject('它怎么回事', '虹纹石', [{ kind: 'dialogue', content: '虹纹石是不是藏着秘密？' }]), 'model initiated dialogue cannot authorize an object topic');
  const userChose = [{ kind: 'user_input', content: '研究虹纹石的花纹' }] as WorldSceneEntry[];
  check(userRaisedWorldObject('继续', '虹纹石', userChose), 'user chosen subject supports a natural continuation');
  check(!userRaisedWorldObject('先不说虹纹石了', '虹纹石', userChose), 'user can stop the chosen subject');
  check(!userRaisedWorldObject('陪我聊天', '虹纹石', userChose), 'new user topic does not inherit an old object task');
  const freshActor = buildActorSystem({ ctx: freshCtx, speaker: { characterId: 'a', intent: '自然打招呼', mode: 'dialogue' }, userText: '你好' });
  check(freshActor.includes(WORLD_OBJECT_TOPIC_RULE) && !freshActor.includes('【本轮注意力】'), 'object topic rule applies to a new scene before any repetition');

  await directWorldTurn({ ctx: freshCtx, action: { intent: 'talk' }, userText: '你好', call: async params => {
    directorPrompt = String(params.messages[0].content);
    return { content: '{"speakers":[{"character":"a","intent":"自然打招呼"}]}' };
  } });
  check(directorPrompt.includes(WORLD_OBJECT_TOPIC_RULE) && !directorPrompt.includes('从现场的一件物品'), 'director cannot seed a prop topic on its own');
  check(directorPrompt.includes('场景背景意向') && directorPrompt.includes('不自动作为本轮主题'), 'saved scene goal does not override the user chosen topic');
  let narratorPrompt = '', interpreterPrompt = '';
  const narration = await narrateWorldBeat({ ctx: freshCtx, action: { intent: 'act' }, userText: '看看周围', call: async params => {
    narratorPrompt = String(params.messages[0].content);
    return { content: '{"narration":"窗边透进午后的光。"}' };
  } });
  check(narration.narration && narratorPrompt.includes(WORLD_OBJECT_TOPIC_RULE) && !narratorPrompt.includes('用户已提起，本轮可回应'), 'narrator observation preserves background without inventing a subject');
  await interpretWorldIntent({ text: '看看周围', place: freshCtx.place, timeLabel: freshCtx.timeLabel, presence: ['a'], characters: [{ id: 'a', name: '古月娜' }], recent: [], call: async params => {
    interpreterPrompt = String(params.messages[0].content);
    return { content: '{"intent":"freeform"}' };
  } });
  check(interpreterPrompt.includes('不等于用户想把它作为主题'), 'intent parser cannot inherit a model chosen object topic');
  await directSceneTurn({ apiKey: '', scene: { title: '午后', place: '家里', timeLabel: '午后', mood: '平静' }, state: { sceneGoal: '研究虹纹石', currentTension: 0, activeConflicts: [], pendingConsequences: [] }, members: [{ characterId: 'a', name: '古月娜', persona: '妻子', goal: '研究虹纹石' }], history: [], userAction: '你好' }, async params => {
    scenePrompt = String(params.messages[0].content);
    return { content: '{"entries":[{"kind":"dialogue","speaker":"古月娜","content":"回来了。"}]}' };
  });
  check(scenePrompt.includes(WORLD_OBJECT_TOPIC_RULE) && scenePrompt.includes('背景意向（不自动作为本轮主题）'), 'legacy scene goals also defer to user chosen topics');
  check(networkCalls === 0, 'user initiated object rules add no network requests');

  await report('/result?suite=memory-attention', { method: 'POST', body: `ok ${count} assertions\nALL PASS` });
}
run().catch(async (error) => {
  await report('/result?suite=memory-attention', { method: 'POST', body: `FAIL ${String(error?.stack ?? error)}\n1 FAILED` });
});
