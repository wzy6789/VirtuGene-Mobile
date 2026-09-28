import { detectTopicMove, isTopicRelated, updateChatConversationState, buildChatConversationStateContext } from '../../src/lib/chat-conversation-state';
import { buildHumanConversationContext } from '../../src/lib/chat-humanizer';
import { renderCharacterContext, type WorldContext } from '../../src/lib/world/world-context';
import { buildActorSystem } from '../../src/lib/world/world-actor';
import { updateConversationState, directorConversationHints } from '../../src/lib/world/world-immersion';

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

  await report('/result?suite=memory-attention', { method: 'POST', body: `ok ${count} assertions\nALL PASS` });
}
run().catch(async (error) => {
  await report('/result?suite=memory-attention', { method: 'POST', body: `FAIL ${String(error?.stack ?? error)}\n1 FAILED` });
});
