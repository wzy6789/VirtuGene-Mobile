import { db } from '../../db';
import { messageRepo } from '../../db/message-repo';
import { stateRepo } from '../../db/state-repo';
import { buildCharacterMemoryContext, renderMemoryRetrievalStatus } from '../character-memory';
import { buildRelationshipContext, buildLifeContext, buildStoryRelationContext, buildSceneTimeContext, buildTimeContext, buildUserEmotionContext } from '../chat-context';
import { compileChatContext } from '../chat-context-compiler';
import { buildHumanConversationSections } from '../chat-humanizer';
import { collectRecentReplyTurns } from '../chat-expression-guidance';
import { luXueQiRelationshipForTurn, omitLuXueQiFamilyRisk } from '../lu-xue-qi-runtime';
import { omitUnsupportedAffectionHistory } from '../chat-affection-history-risk';
import { omitUnsupportedSelfReportEpisodes } from '../chat-self-report-risk';
import { omitDomesticReferences } from '../chat-domestic-reference-risk';
import { omitUnsupportedUserHabits } from '../chat-user-habit-risk';
import { readRecalledUserHabitSources } from '../chat-user-habit-sources';
import { guYueNaPromptForTurn, guYueNaRelationshipForTurn } from '../gu-yue-na-runtime';
import { readVoiceSampleCharacter } from '../chat/voice-sample-cache';
import { voiceIdentityWithoutExamples } from '../character-voice';
import { buildChatHistoryWindow } from '../chat-history-window';
import type { CallMessage } from './mimo';
import type { CallExchange, PreparedCallContext } from './controller';
import { useAuthStore } from '../../store/auth-store';
import { memorySourceTombstoneRepo } from '../../db/memory-source-tombstone-repo';
import { worldRepo } from '../../db/world-repo';
import { worldFactRepo } from '../../db/world-fact-repo';
import { knowledgeRepo } from '../../db/knowledge-repo';
import { isMentionableDiaryEvent } from '../../db/world-event-repo';
import { isVisibleToCharacter } from '../world/visibility';
import { confirmedCallSpeech } from './record';

export interface CallContextOwner { userId: string; characterId: string; sessionId: string; worldId?: string; callId?: string }

/** Validate before opening native audio as well as before each model turn. */
export async function assertCallContextOwner(owner: CallContextOwner, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (useAuthStore.getState().userId !== owner.userId) throw new Error('voice:account_changed');
  const [character, session] = await Promise.all([db.characters.get(owner.characterId), db.sessions.get(owner.sessionId)]);
  if (!owner.userId || !character || character.createdBy !== owner.userId || character.agentProfile === 'secretary'
    || !session || session.userId !== owner.userId || session.characterId !== character.id || session.type === 'group') throw new Error('voice:context_changed');
  if (owner.worldId && (await db.worlds.get(owner.worldId))?.userId !== owner.userId) throw new Error('voice:world_changed');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (useAuthStore.getState().userId !== owner.userId) throw new Error('voice:account_changed');
  return { character, session };
}

export const CALL_SPEECH_RULES = `[当前交流方式：实时语音通话]
只输出真正说出口的台词，不输出动作、旁白、标签、音色指令或分析过程。保留人物本来的性格、关系边界和措辞，不转成客服。
通常每次一到三句，按对方的问题决定长短。自然承接，不机械复述、不每轮追问，不为热情而热情。允许犹豫、简短回应和人物自己的观点。
语音识别可能有误；明显听不清时简短确认，不猜测用户未说的事实。只根据提供的台词回应，不声称从录音听出了哭泣、语气或背景环境。
历史中的角色台词仅包含播放完整的句子。缺失的回答或被打断的部分不能当作对方已听到的交流；不知道的经历、约定和关系不要编造。`;

/** Read-only composition of the original role, memory and relationship services. No model calls. */
export async function prepareCallContext(owner: CallContextOwner, text: string, exchanges: readonly CallExchange[], signal: AbortSignal): Promise<PreparedCallContext> {
  const live = () => assertCallContextOwner(owner, signal);
  const { character, session } = await live();
  if (!text.trim() || text.length > 4096) throw new Error('voice:utterance');
  // Ordinary text chat selects the account's default world too; absence is not permission to mix worlds.
  const world = owner.worldId ? await db.worlds.get(owner.worldId) : await worldRepo.ensureDefaultWorld(owner.userId);
  if (!world || world.userId !== owner.userId) throw new Error('voice:world_changed');
  const [rows, state, characters, voiceCharacter, suppressed, snapshots, worldFacts] = await Promise.all([
    messageRepo.getPage(owner.sessionId, { limit: 80 }), stateRepo.getOrCreate(character.id, owner.userId),
    db.characters.where('createdBy').equals(owner.userId).toArray(), readVoiceSampleCharacter(character, owner.userId),
    memorySourceTombstoneRepo.suppressedMessages(owner.userId, character.id),
    db.emotionSnapshots.where('sessionId').equals(owner.sessionId).toArray(),
    worldFactRepo.listForCharacter(world.id, character.id, 12, owner.userId),
  ]);
  const validRows = rows.filter(row => !row.failed && !row.secretaryDispatch && !suppressed.has(row.id)
    && !(owner.callId && row.id.startsWith(`voice:${owner.callId}:`)));
  const callSources = owner.callId ? exchanges.flatMap(exchange => {
    if (!exchange.userText.trim()) return [];
    const prefix = `voice:${owner.callId}:${exchange.turnId}`;
    const heard = confirmedCallSpeech(exchange);
    return [{ id: `${prefix}:user`, role: 'user' as const, content: exchange.userText.trim() },
      ...(heard ? [{ id: `${prefix}:assistant`, role: 'assistant' as const, content: heard }] : [])];
  }) : [];
  const capturedCallRows = await db.messages.bulkGet(callSources.map(source => source.id));
  const assertCallSources = async () => {
    if (!callSources.length) return;
    const [current, withdrawn] = await Promise.all([
      db.messages.bulkGet(callSources.map(source => source.id)),
      memorySourceTombstoneRepo.blocksImports(callSources.map(source => ({ userId: owner.userId,
        sourceType: 'message', sourceId: source.id, sourceRevision: 1 }))),
    ]);
    if (current.some((row, index) => withdrawn[index] || (!row && !!capturedCallRows[index])
      || !!row && (row.sessionId !== owner.sessionId || row.role !== callSources[index].role || row.failed || row.secretaryDispatch
        || row.content !== callSources[index].content || (row.revision ?? 1) !== (capturedCallRows[index]?.revision ?? 1)))) throw new Error('voice:source_withdrawn');
  };
  // A missing projection may still be waiting for the host's checkpoint. A
  // tombstone or a changed committed row is never treated as that benign gap.
  await assertCallSources();
  const snapshot = snapshots.filter(row => row.characterId === character.id).sort((a, b) => b.createdAt - a.createdAt)[0];
  const history: CallMessage[] = buildChatHistoryWindow(validRows, '', 8, 1000)
    .map(row => ({ role: row.role, content: row.content }));
  for (const exchange of exchanges.slice(-6)) {
    if (exchange.userText) history.push({ role: 'user', content: exchange.userText.slice(0, 1000) });
    const heard = confirmedCallSpeech(exchange);
    if (heard) history.push({ role: 'assistant', content: heard.slice(0, 1000) });
  }
  const recent = history.slice(-12);
  const userSources = validRows.filter(row => row.role === 'user').map(row => row.content)
    .concat(exchanges.filter(exchange => exchange.userText).map(exchange => exchange.userText));
  const luTurn = luXueQiRelationshipForTurn(voiceCharacter, text, userSources);
  const guTurn = guYueNaRelationshipForTurn(character, text, userSources);
  const scopedCharacter = { ...luTurn.character, systemPrompt: guYueNaPromptForTurn(luTurn.character, text,
    recent.filter(row => row.role === 'user').slice(-2).map(row => row.content), guTurn.recognized) };
  const memory = await buildCharacterMemoryContext({
    userId: owner.userId, characterId: character.id, topic: text, mode: 'private-chat', budget: 2400,
    excludeSessionId: owner.sessionId, excludeMessageIds: rows.map(row => row.id),
    includePrivateCharacterLifeEvents: true,
    withCatalog: true,
    recentConversation: recent.map(row => ({ kind: row.role === 'user' ? 'user_input' : 'dialogue', content: row.content })),
    scene: { worldId: world.id },
  });
  const compiled = compileChatContext(voiceIdentityWithoutExamples(scopedCharacter.systemPrompt).slice(0, 12000), [
    ...buildHumanConversationSections(text, recent, scopedCharacter, {
      recentReplyTurns: collectRecentReplyTurns(recent),
      interpersonalBoundary: (luTurn.context && luTurn.recognized !== true || guTurn.context && guTurn.recognized !== true) ? 'distant' : undefined,
      compactOrdinaryReaction: !!luTurn.context,
    }),
    { key: 'original-lu-relationship', text: luTurn.context, priority: 100, placement: 'tail', tailOrder: 2, requireComplete: true },
    { key: 'original-gu-relationship', text: guTurn.context, priority: 100, placement: 'tail', tailOrder: 2, requireComplete: true },
    { key: 'call-mode', text: CALL_SPEECH_RULES, priority: 100, placement: 'tail', tailOrder: 10, requireComplete: true },
    { key: 'relationship', text: buildRelationshipContext(state.affinity, state.mood, state.tierNames, character), priority: 100, requireComplete: true },
    { key: 'story-relations', text: buildStoryRelationContext(state, characters), priority: 98, requireComplete: true },
    { key: 'world-setting-mode', text: worldFacts.length ? '【世界设定的使用范围】以下是当前世界中授权给你的设定。设定不代表本次通话现场，不证明某次交流或事件已经发生；当前通话场景沿用会话记录。' : '', priority: 99, requireComplete: true },
    ...worldFacts.map(fact => ({ key: `world-fact:${fact.id}`, text: `【世界${fact.category === 'rule' ? '规则' : '设定'}】${fact.content.slice(0, 400)}`, priority: fact.category === 'rule' ? 98 : 92, requireComplete: true })),
    { key: 'memory', text: memory.text, priority: 99 },
    { key: 'memory-retrieval-status', text: renderMemoryRetrievalStatus(memory), priority: 100, requireComplete:true },
    { key: 'life', text: buildLifeContext(state), priority: 90 },
    { key: 'emotion', text: buildUserEmotionContext(snapshot?.userEmotion), priority: 90 },
    { key: 'scene', text: buildSceneTimeContext(session.sceneTimeOfDay, session.scenePlace, session.sceneAtmosphere), priority: 95 },
    { key: 'time', text: buildTimeContext(validRows[validRows.length - 1]?.createdAt), priority: 90 },
  ], 18000);
  // Only complete recalled references retained in the actual prompt qualify.
  const presentedIds = new Set(memory.references.filter(reference => reference.source === 'chat' && compiled.prompt.includes(reference.text)).map(reference => reference.id));
  const selectedMemories = (memory.catalog?.memories ?? []).filter(row => presentedIds.has(row.id));
  const presentedEventIds = [...new Set(memory.references.filter(reference => reference.source === 'world'
    && compiled.prompt.includes(reference.text)).map(reference => reference.id))];
  const presentedEvents = (await db.worldEvents.bulkGet(presentedEventIds))
    .filter((event): event is NonNullable<typeof event> => !!event && event.userId === owner.userId && event.worldId === world.id);
  // Do not certify a newer row as the source of an older rendered reference.
  if (presentedEvents.some(event => !memory.references.some(reference => {
    if (reference.source !== 'world' || reference.id !== event.id || reference.at !== event.timestamp) return false;
    const rendered = reference.text.replace(/^\[world [^\]]+\] /, '');
    const summary = event.summary ? `：${event.summary}` : '';
    const normalize = (value: string) => value.trim().replace(/\s+/g, ' ');
    return rendered === normalize(`你知道的星域事件「${event.title}」${summary}`)
      || rendered.startsWith('星域旧事：') && rendered.endsWith(normalize(`${event.title}${summary}`));
  }))) throw new Error('voice:context_changed');
  const recalledUserSources = compiled.included.includes('memory')
    ? await readRecalledUserHabitSources(owner.userId, character.id, selectedMemories, suppressed) : [];
  const habitSources = [...recalledUserSources.map(row => row.content), ...userSources, text];
  const lifeText = buildLifeContext(state);
  const independentLife = lifeText && compiled.prompt.includes(lifeText)
    ? (state.lifeEvents ?? []).slice(0, 3).map(event => `${event.title}${event.detail ? `：${event.detail}` : ''}`) : [];
  await live();
  if ((await db.worlds.get(world.id))?.userId !== owner.userId) throw new Error('voice:world_changed');
  if (signal.aborted || useAuthStore.getState().userId !== owner.userId) throw new DOMException('Aborted', 'AbortError');
  let selfReportInput = '', selfReportSafe = '';
  const userRows = validRows.filter(row => row.role === 'user');
  const sourceSignature = (rows: typeof recalledUserSources) => JSON.stringify(rows.map(row => [row.id, row.revision ?? 1, row.content]));
  const recalledSignature = sourceSignature(recalledUserSources);
  const presentedWorldFacts = worldFacts.filter(fact => compiled.included.includes(`world-fact:${fact.id}`));
  const assertCurrent = async () => {
      await assertCallSources();
      const currentOwner = await live();
      if (currentOwner.character.systemPrompt !== character.systemPrompt || currentOwner.character.sourcePresetId !== character.sourcePresetId) throw new Error('voice:context_changed');
      const [currentRows, currentSuppressed, currentState, currentWorld, currentFacts, currentEvents, currentKnowledge] = await Promise.all([
        db.messages.bulkGet(userRows.map(row => row.id)),
        memorySourceTombstoneRepo.suppressedMessages(owner.userId, character.id),
        db.characterStates.get([character.id, owner.userId]),
        db.worlds.get(world.id),
        db.worldFacts.bulkGet(presentedWorldFacts.map(fact => fact.id)),
        db.worldEvents.bulkGet(presentedEvents.map(event => event.id)),
        knowledgeRepo.getScopedForEvents(owner.userId, world.id, character.id, presentedEvents.map(event => event.id)),
      ]);
      if (currentWorld?.userId !== owner.userId) throw new Error('voice:world_changed');
      if (currentFacts.some((fact, index) => !fact || fact.userId !== owner.userId || fact.worldId !== world.id
        || !fact.active || !isVisibleToCharacter(fact, character.id)
        || fact.content !== presentedWorldFacts[index].content || fact.category !== presentedWorldFacts[index].category
        || fact.updatedAt !== presentedWorldFacts[index].updatedAt)) throw new Error('voice:context_changed');
      for (let index = 0; index < currentEvents.length; index++) {
        const event = currentEvents[index], previous = presentedEvents[index];
        if (!event || event.userId !== owner.userId || event.worldId !== world.id || !isVisibleToCharacter(event, character.id)
          || event.title !== previous.title || event.summary !== previous.summary || event.timestamp !== previous.timestamp
          || event.sourceType !== previous.sourceType || event.sourceId !== previous.sourceId || event.updatedAt !== previous.updatedAt
          || !currentKnowledge.some(row => row.eventId === event.id && row.canMention && row.knowledgeLevel === 'full')) throw new Error('voice:context_changed');
        if (event.sourceType === 'diary' && !await isMentionableDiaryEvent(event, character.id, owner.userId)) throw new Error('voice:context_changed');
      }
      if (currentRows.some((row, index) => !row || row.role !== 'user' || row.failed || row.secretaryDispatch
        || row.sessionId !== owner.sessionId || currentSuppressed.has(row.id)
        || (row.revision ?? 1) !== (userRows[index].revision ?? 1) || row.content !== userRows[index].content)
        || independentLife.length > 0 && (!currentState || buildLifeContext(currentState) !== lifeText)) throw new Error('voice:context_changed');
      if (recalledUserSources.length > 0) {
        const currentEvidence = await readRecalledUserHabitSources(owner.userId, character.id, selectedMemories, currentSuppressed);
        if (sourceSignature(currentEvidence) !== recalledSignature) throw new Error('voice:context_changed');
      }
      await live();
  };
  return { messages: [{ role: 'system', content: compiled.prompt }, ...recent, { role: 'user', content: text }],
    assertCurrent,
    reviewSpeech: async sentence => {
      await assertCurrent();
      const familySafe = omitLuXueQiFamilyRisk(character, sentence, [...userSources, text], luTurn.recognized);
      let safe = omitUnsupportedAffectionHistory(familySafe, text, habitSources, character.systemPrompt);
      safe = omitUnsupportedUserHabits(safe, habitSources);
      selfReportInput += safe;
      if (selfReportInput.length > 12000) throw new Error('voice:reply_filtered');
      const reviewed = omitUnsupportedSelfReportEpisodes(selfReportInput, character.systemPrompt, independentLife);
      // Preserve the original whole-bubble rule for details following an
      // unsupported dated episode. Never retrospectively certify spoken text.
      safe = reviewed.startsWith(selfReportSafe) ? reviewed.slice(selfReportSafe.length).trim() : '';
      selfReportSafe = reviewed;
      return omitDomesticReferences(safe, character.systemPrompt, independentLife, habitSources);
    },
  };
}

/** Read-only prompt projection for existing callers; the host uses the source-aware preparation. */
export async function buildCallContext(owner: CallContextOwner, text: string, exchanges: readonly CallExchange[], signal: AbortSignal): Promise<CallMessage[]> {
  return (await prepareCallContext(owner, text, exchanges, signal)).messages;
}
