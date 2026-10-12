import { db, type Character } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { buildCallContext, prepareCallContext } from '../../src/lib/voice-call/context';
import type { CallExchange } from '../../src/lib/voice-call/controller';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { worldFactRepo } from '../../src/db/world-fact-repo';
import { memorySourceTombstoneRepo } from '../../src/db/memory-source-tombstone-repo';
import { LU_XUE_QI_PRESET } from '../../src/lib/lu-xue-qi-preset';
import { GU_YUE_NA_CARE } from '../../src/lib/gu-yue-na-personality';

async function main() {
  let checks = 0;
  function check(value: unknown, label: string) { if (!value) throw new Error(label); checks++; }
  await db.open();
  useAuthStore.setState({ userId: 'voice-owner' });
  const character: Character = { id: 'voice-role', name: '阿遥', avatar: '🌙', createdBy: 'voice-owner', createdAt: 1, isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '你是阿遥，言辞简洁，爱读诗。' };
  await db.characters.put(character);
  await db.sessions.put({ id: 'voice-session', userId: 'voice-owner', characterId: character.id, title: '阿遥', createdAt: 1, updatedAt: 1, unreadCount: 0, type: 'single', scenePlace: '湖畔' });
  await db.messages.bulkPut([
    { id: 'old-user', sessionId: 'voice-session', role: 'user', content: '我爱读诗', createdAt: 10 },
    { id: 'old-reply', sessionId: 'voice-session', role: 'assistant', content: '我也喜欢。', createdAt: 11 },
    { id: 'failed-reply', sessionId: 'voice-session', role: 'assistant', content: '失败占位不应出现', failed: true, createdAt: 12 },
  ]);
  const owner = { userId: 'voice-owner', characterId: character.id, sessionId: 'voice-session' };
  const exchange: CallExchange = { turnId: 'turn-one', userText: '上一句真实用户台词', generatedText: '已经播完。还未播放的秘密。', heardText: '不可信已听字幕', interrupted: true, segments: [{ id: 'spoken-one', turnId: 'turn-one', text: '已经播完。', playedAt: 2, playedFrames: 40, interrupted: false, generatedAt: 1 }], metrics: { turnId: 'turn-one', stoppedAt: 1 } };
  const messages = await buildCallContext(owner, '继续聊聊诗吧', [exchange], new AbortController().signal);
  const all = messages.map(m => m.content).join('\n');
  check(messages[0].role === 'system' && all.includes('你是阿遥'), 'original persona enters call context');
  check(all.includes('我爱读诗') && all.includes('湖畔'), 'original session history and scene are inherited');
  check(all.includes('已经播完。') && !all.includes('还未播放的秘密'), 'only acknowledged speech enters next turn');
  check(!all.includes('不可信已听字幕'), 'context recomputes listening evidence instead of trusting UI text');
  await db.messages.put({ id: 'voice:ongoing-call:turn-one:user', sessionId: 'voice-session', role: 'user', content: exchange.userText, createdAt: 20, isProactive: false });
  const checkpointContext = await buildCallContext({ ...owner, callId: 'ongoing-call' }, '继续说', [exchange], new AbortController().signal);
  check(checkpointContext.filter(row => row.role === 'user' && row.content === exchange.userText).length === 1, 'checkpointed live turns are not duplicated by database history and controller receipts');
  const checkpointOwner = { ...owner, callId: 'ongoing-call' };
  const checkpointId = 'voice:ongoing-call:turn-one:user';
  const originalCheckpoint = (await db.messages.get(checkpointId))!;
  const beforeCheckpointEdit = await prepareCallContext(checkpointOwner, '继续说', [exchange], new AbortController().signal);
  await db.messages.update(checkpointId, { content: '已经更正的转写', revision: 2 });
  try { await beforeCheckpointEdit.assertCurrent!(); throw new Error('edited call transcript accepted'); } catch (error) { check((error as Error).message === 'voice:source_withdrawn', 'editing the current call checkpoint invalidates in-memory transcript evidence'); }
  try { await prepareCallContext(checkpointOwner, '继续说', [exchange], new AbortController().signal); throw new Error('old call transcript reused'); } catch (error) { check((error as Error).message === 'voice:source_withdrawn', 'next turn cannot prepare from a stale edited call checkpoint'); }
  await db.messages.put(originalCheckpoint);
  const beforeCheckpointDelete = await prepareCallContext(checkpointOwner, '继续说', [exchange], new AbortController().signal);
  await db.messages.delete(checkpointId);
  try { await beforeCheckpointDelete.assertCurrent!(); throw new Error('deleted call transcript accepted'); } catch (error) { check((error as Error).message === 'voice:source_withdrawn', 'deleting a committed call checkpoint invalidates prepared speech'); }
  const pendingCheckpoint = await prepareCallContext(checkpointOwner, '继续说', [exchange], new AbortController().signal);
  await db.messages.put(originalCheckpoint); await pendingCheckpoint.assertCurrent!();
  check(true, 'pending checkpoint becoming committed does not falsely revoke the live exchange');
  const assistantCheckpointId = 'voice:ongoing-call:turn-one:assistant';
  await db.messages.put({ id: assistantCheckpointId, sessionId: owner.sessionId, role: 'assistant', content: '已经播完。', revision: 1, createdAt: 21 });
  const beforeAssistantEdit = await prepareCallContext(checkpointOwner, '继续说', [exchange], new AbortController().signal);
  await db.messages.update(assistantCheckpointId, { content: '已经修改的角色原话', revision: 2 });
  try { await beforeAssistantEdit.assertCurrent!(); throw new Error('edited listening evidence accepted'); } catch (error) { check((error as Error).message === 'voice:source_withdrawn', 'editing fully heard projected speech cannot leave stale in-memory relationship history'); }
  await db.messages.delete(assistantCheckpointId);
  const unwrittenOwner = { ...owner, callId: 'unwritten-call' };
  const unwrittenContext = await prepareCallContext(unwrittenOwner, '继续说', [exchange], new AbortController().signal);
  await memorySourceTombstoneRepo.record({ userId: owner.userId, sourceType: 'message', sourceId: 'voice:unwritten-call:turn-one:user', sourceRevision: 1, status: 'deleted' });
  try { await unwrittenContext.assertCurrent!(); throw new Error('withdrawn pending transcript accepted'); } catch (error) { check((error as Error).message === 'voice:source_withdrawn', 'tombstone rejects a withdrawn transcript even if its checkpoint never became locally visible'); }
  const worlds = await db.worlds.where('userId').equals(owner.userId).toArray();
  check(worlds.some(world => world.isDefault), 'call context inherits the original default world selection');
  const defaultWorld = worlds.find(world => world.isDefault)!;
  await db.worlds.put({ id: 'parallel-world', userId: owner.userId, name: '另一个世界', createdAt: 1 });
  for (const [id, worldId, summary] of [['default-stargazing', defaultWorld.id, '在海边观星D11'], ['parallel-stargazing', 'parallel-world', '在山顶观星P77']]) {
    await db.worldEvents.put({ id, userId: owner.userId, worldId, type: 'stage', title: '一起观星', summary, visibility: 'selected', visibleTo: [character.id], timestamp: Date.now(), createdAt: Date.now(), memoryIds: [] } as any);
    await knowledgeRepo.upsert({ userId: owner.userId, worldId, characterId: character.id, eventId: id });
  }
  const worldRecall = (await buildCallContext(owner, '还记得我们一起观星吗', [], new AbortController().signal)).map(row => row.content).join('\n');
  check(worldRecall.includes('观星D11'), 'default-world authorized events enter real call memory context');
  check(!worldRecall.includes('观星P77'), 'another world does not cross into the default call');
  const originalEvent = (await db.worldEvents.get('default-stargazing'))!;
  const originalKnowledge = (await knowledgeRepo.listKnownBy(character.id, defaultWorld.id, { minLevel: 'full', userId: owner.userId })).find(row => row.eventId === originalEvent.id)!;
  for (const mutation of ['mention-revoked', 'partial-knowledge', 'event-private', 'event-edited', 'event-deleted'] as const) {
    const recalledEvent = await prepareCallContext(owner, '还记得我们一起观星吗', [], new AbortController().signal);
    if (!recalledEvent.messages[0].content.includes('观星D11')) throw new Error('event fixture was not in actual prompt');
    if (mutation === 'mention-revoked') await db.characterKnowledge.update(originalKnowledge.id, { canMention: false });
    if (mutation === 'partial-knowledge') await db.characterKnowledge.update(originalKnowledge.id, { knowledgeLevel: 'partial' });
    if (mutation === 'event-private') await db.worldEvents.update(originalEvent.id, { visibility: 'private' });
    if (mutation === 'event-edited') await db.worldEvents.update(originalEvent.id, { summary: '已经修正的观星地点' });
    if (mutation === 'event-deleted') await db.worldEvents.delete(originalEvent.id);
    try { await recalledEvent.assertCurrent!(); throw new Error('withdrawn event accepted'); } catch (error) { check((error as Error).message === 'voice:context_changed', `${mutation} invalidates a previously presented world event before playback`); }
    await db.worldEvents.put(originalEvent); await db.characterKnowledge.put(originalKnowledge);
  }
  const worldRuleId = await worldFactRepo.upsert({ userId: owner.userId, worldId: defaultWorld.id, category: 'rule', content: '世界规则R51：这里没有魔法，角色不能瞬间移动。', sourceType: 'user', visibility: 'world' });
  await worldFactRepo.upsert({ userId: owner.userId, worldId: defaultWorld.id, category: 'location', content: '可见设定V52：湖边有一座旧书亭。', sourceType: 'user', visibility: 'selected', visibleTo: [character.id] });
  for (const fixture of [
    { content: '私密规则SECRET53', visibility: 'private' as const },
    { content: '他人可见OTHER54', visibility: 'selected' as const, visibleTo: ['other-role'] },
    { content: '停用规则INACTIVE55', active: false },
    { content: '平行世界PARALLEL56', worldId: 'parallel-world' },
    { content: '其他账号FOREIGN57', userId: 'another-owner' },
  ]) await worldFactRepo.upsert({ userId: owner.userId, worldId: defaultWorld.id, category: 'rule', sourceType: 'user', ...fixture });
  const settingsContext = await prepareCallContext(owner, '继续聊吧', [], new AbortController().signal);
  const settingsPrompt = settingsContext.messages[0].content;
  check(settingsPrompt.includes('世界规则R51') && settingsPrompt.includes('设定不代表本次通话现场'), 'world rules reach actual speech prompt without inventing current call presence');
  check(settingsPrompt.includes('可见设定V52'), 'selected world settings reuse the original character visibility gate');
  check(!/SECRET53|OTHER54|INACTIVE55|PARALLEL56|FOREIGN57/.test(settingsPrompt), 'private inactive other-role other-world and other-account facts stay excluded');
  await settingsContext.assertCurrent!(); await settingsContext.assertCurrent!();
  check(await settingsContext.reviewSpeech!('你好。') === '你好。', 'repeated read-only source checks do not advance or duplicate the sentence filter');
  const originalRule = (await db.worldFacts.get(worldRuleId))!;
  for (const [label, patch] of [
    ['edited', { content: '世界规则已修改', updatedAt: originalRule.updatedAt + 1 }],
    ['deactivated', { active: false }],
    ['private', { visibility: 'private' as const }],
  ] as const) {
    const preparedRule = await prepareCallContext(owner, '继续聊吧', [], new AbortController().signal);
    await db.worldFacts.update(worldRuleId, patch);
    try { await preparedRule.reviewSpeech!('你好。'); throw new Error('stale rule accepted'); } catch (error) { check((error as Error).message === 'voice:context_changed', `${label} world fact invalidates pending speech`); }
    await db.worldFacts.put(originalRule);
  }
  const deletedRuleContext = await prepareCallContext(owner, '继续聊吧', [], new AbortController().signal);
  await db.worldFacts.delete(worldRuleId);
  try { await deletedRuleContext.reviewSpeech!('你好。'); throw new Error('deleted rule accepted'); } catch (error) { check((error as Error).message === 'voice:context_changed', 'deleted world setting cannot certify pending speech'); }
  await db.worldFacts.put(originalRule);
  const deletedWorldContext = await prepareCallContext(owner, '继续聊吧', [], new AbortController().signal);
  await db.worlds.delete(defaultWorld.id);
  try { await deletedWorldContext.reviewSpeech!('你好。'); throw new Error('deleted world accepted'); } catch (error) { check((error as Error).message === 'voice:world_changed', 'deleting the default world invalidates prepared speech too'); }
  await db.worlds.put(defaultWorld);
  await db.worlds.put({ id: 'foreign-world', userId: 'another-owner', name: '不属于本账号', createdAt: 1 });
  try { await buildCallContext({ ...owner, worldId: 'foreign-world' }, '你好', [], new AbortController().signal); throw new Error('foreign world accepted'); } catch (error) { check((error as Error).message === 'voice:world_changed', 'explicit world scope rejects another account'); }
  check(!all.includes('失败占位不应出现'), 'failed messages are not supplied');
  check(messages[messages.length - 1].content === '继续聊聊诗吧', 'current utterance appears last');
  check(messages.reduce((n, m) => n + m.content.length, 0) <= 40000, 'context fits call transport bound');
  const questioning: CallExchange = { ...exchange, segments: [{ ...exchange.segments[0], text: '你会选什么颜色？' }] };
  const ownView = (await buildCallContext(owner, '你会选什么颜色？', [questioning], new AbortController().signal))[0].content;
  check(ownView.includes('这一轮是在问你的想法'), 'call uses the shared previous-question guidance for the characters own contribution');
  const unheardQuestion = { ...questioning, segments: questioning.segments.map(segment => ({ ...segment, playedAt: undefined, interrupted: true })) };
  const withoutUnheard = (await buildCallContext(owner, '你会选什么颜色？', [unheardQuestion], new AbortController().signal))[0].content;
  check(!withoutUnheard.includes('这一轮是在问你的想法'), 'unheard generated questions do not drive the next-turn expression guidance');
  await db.characters.put({ ...character, sourcePresetId: LU_XUE_QI_PRESET.id, systemPrompt: LU_XUE_QI_PRESET.systemPrompt });
  const unclaimed = (await buildCallContext(owner, '你好', [], new AbortController().signal))[0].content;
  check(unclaimed.includes('陆雪琪当前关系'), 'call inherits the original owned-role identity boundary');
  const claimed = (await buildCallContext(owner, '我是张小凡，想你了', [], new AbortController().signal))[0].content;
  check(claimed.includes('陆雪琪的关心'), 'explicit user identity selects the same relationship as text chat');
  const roleplay = { ...exchange, userText: '我是张小凡' };
  const exited = (await buildCallContext(owner, '退出扮演，我不是张小凡', [roleplay], new AbortController().signal))[0].content;
  check(exited.includes('用户已明确否认相应身份或退出扮演'), 'current identity withdrawal supersedes prior call recognition');
  await db.characters.put({ ...character, sourcePresetId: LU_XUE_QI_PRESET.id, systemPrompt: '这是用户自己编辑的人设。' });
  const custom = (await buildCallContext(owner, '你好', [], new AbortController().signal))[0].content;
  check(custom.includes('这是用户自己编辑的人设') && !custom.includes('陆雪琪当前关系'), 'edited persona is not overwritten by owned-role rules');
  await db.characters.put({ ...character, sourcePresetId: 'preset-guyuena', systemPrompt: GU_YUE_NA_CARE });
  const guClaimed = (await buildCallContext(owner, '我是舞麟，想和你说说话', [], new AbortController().signal))[0].content;
  check(guClaimed.includes('当前聊天者已明确认领唐舞麟'), 'second original relationship adapter is inherited by voice');
  await db.messages.put({ id: 'assistant-identity-claim', sessionId: owner.sessionId, role: 'assistant', content: '我是舞麟', createdAt: 30 });
  const guUnclaimed = (await buildCallContext(owner, '你好', [], new AbortController().signal))[0].content;
  check(guUnclaimed.includes('当前聊天者不是已认领的唐舞麟'), 'generated assistant identity claim cannot select the users relationship');
  await db.messages.delete('assistant-identity-claim');
  await db.characters.put(character);
  const reviewed = await prepareCallContext(owner, '想你了', [], new AbortController().signal);
  check(await reviewed.reviewSpeech!('你很少说喜欢我。我也喜欢你。') === '我也喜欢你。', 'prepared call review removes unsupported relationship history while retaining present affection');
  const knownFrequency = await prepareCallContext(owner, '我平时很少说喜欢你。', [], new AbortController().signal);
  check(await knownFrequency.reviewSpeech!('你很少说喜欢我。') === '你很少说喜欢我。', 'actual user frequency evidence is respected by the shared review');
  check(await reviewed.reviewSpeech!('我昨天在湖边看书。') === '', 'earlier generated biography cannot support a dated character episode');
  check(await reviewed.reviewSpeech!('湖面的树影很好看。') === '', 'dependent details after an unsupported episode remain suppressed across streamed sentences');
  const preference = await prepareCallContext(owner, '你喜欢什么？', [], new AbortController().signal);
  check(await preference.reviewSpeech!('我喜欢读诗。') === '我喜欢读诗。', 'ordinary character preferences remain playable');
  const unsourcedHabit = await prepareCallContext(owner, '今天休息一会儿', [], new AbortController().signal);
  check(await unsourcedHabit.reviewSpeech!('你总是熬夜。今晚早点睡也好。') === '今晚早点睡也好。', 'unsupported recurring user habits are removed without replacing independent advice');
  const actualHabit = await prepareCallContext(owner, '我总是熬夜。', [], new AbortController().signal);
  check(await actualHabit.reviewSpeech!('你总是熬夜。') === '你总是熬夜。', 'current user evidence supports a repeated habit');
  const originalSource = (await db.messages.get('old-user'))!;
  const beforeEdit = await prepareCallContext(owner, '聊聊过去', [], new AbortController().signal);
  await db.messages.update('old-user', { content: '我已经更正了', revision: 2 });
  try { await beforeEdit.reviewSpeech!('你好。'); throw new Error('edited source accepted'); } catch (error) { check((error as Error).message === 'voice:context_changed', 'editing source while generation runs invalidates pending speech review'); }
  await db.messages.put(originalSource);
  const beforeDelete = await prepareCallContext(owner, '接着说', [], new AbortController().signal);
  await db.messages.delete('old-user');
  try { await beforeDelete.reviewSpeech!('你好。'); throw new Error('deleted source accepted'); } catch (error) { check((error as Error).message === 'voice:context_changed', 'deleted source cannot continue certifying speech'); }
  await db.messages.put(originalSource);
  const aborted = new AbortController(); aborted.abort();
  try { await buildCallContext(owner, '你好', [], aborted.signal); throw new Error('abort ignored'); } catch (error) { check((error as Error).name === 'AbortError', 'aborted context is rejected'); }
  useAuthStore.setState({ userId: 'other-owner' });
  try { await reviewed.reviewSpeech!('你好。'); throw new Error('late review accepted'); } catch (error) { check((error as Error).message === 'voice:account_changed', 'late speech review rechecks current account before synthesis'); }
  try { await buildCallContext(owner, '你好', [], new AbortController().signal); throw new Error('owner ignored'); } catch (error) { check((error as Error).message === 'voice:account_changed', 'account switch rejects private context'); }
  useAuthStore.setState({ userId: 'voice-owner' });
  await db.sessions.update('voice-session', { characterId: 'other-role' });
  try { await buildCallContext(owner, '你好', [], new AbortController().signal); throw new Error('session ignored'); } catch (error) { check((error as Error).message === 'voice:context_changed', 'role/session mismatch is rejected'); }
  return { checks, realApiCalls: 0, modelTokens: 0, mode: 'browser-context', deviceTested: false };
}
main().then(result => { (window as any).voiceProfileResult = result; }).catch(error => { (window as any).voiceProfileResult = { error: String(error) }; });
