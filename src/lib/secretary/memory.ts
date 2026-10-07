import { db, type MemoryItem, type Message } from '../../db';
import { memoryRepo } from '../../db/memory-repo';
import { memorySourceTombstoneId, memorySourceTombstoneRepo } from '../../db/memory-source-tombstone-repo';
import { useAuthStore } from '../../store/auth-store';
import { rankConversationMemories } from '../memory-engine';
import { localDateKey, occurrenceId } from '../../db/todo-repo';
import type { SecretaryTask } from './types';
import { searchHistoryCandidates, secretaryTaskSearchText } from './retrieval';
import { diaryProtectedTask } from './privacy';
import { secretaryRecallQuery, secretaryRecallScore, secretaryWorkOverview } from './recall-query';

export interface SecretaryMemoryProposal {
  kind: 'fact' | 'preference';
  /** Verbatim evidence from the current user message, never model-authored facts. */
  quote: string;
  replacesId?: string;
}
export type SecretaryMemoryCommand = { kind: 'remember' | 'forget'; text: string } | { kind: 'list' };
export interface SecretaryMemoryReferences {
  memoryIds: string[]; messageIds: string[]; taskIds: string[];
  memoryVersions?: Record<string, number>; messageVersions?: Record<string, number>; taskVersions?: Record<string, number>;
  taskSourceVersions?: Record<string, number>;
  recordVersions?: { kind: 'todo' | 'todoOccurrence' | 'moment' | 'diary'; id: string; version: number | null }[];
  requiresDiaryUnlocked?: boolean;
}
const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s，。！？、:：,.!?]/gu, '');
const correction = /其实|更正|纠正|改成|改为|不再|现在|以前|不是/u;

async function owner(userId: string, characterId: string) {
  if (!userId || useAuthStore.getState().userId !== userId) throw new Error('账号已切换，请重新打开助理记忆。');
  const [character, binding] = await Promise.all([db.characters.get(characterId), db.secretaryBindings.get(userId)]);
  if (!character || character.createdBy !== userId || character.isPreset || character.agentProfile !== 'secretary'
    || binding && binding.characterId !== characterId) throw new Error('只能查看你自己的助理记忆。');
  return binding;
}

/** The account's assistant workspace survives renaming, new sessions and re-hiring. */
export async function readSecretaryMemories(userId: string, characterId: string): Promise<MemoryItem[]> {
  await owner(userId, characterId);
  const sessions = await db.sessions.where('[characterId+userId]').equals([characterId, userId]).filter(s => s.type !== 'group').toArray();
  const sessionIds = new Set(sessions.map(s => s.id));
  const rows = await db.memories.where('characterId').equals(characterId)
    .filter(m => m.userId === userId && (m.status ?? 'active') === 'active' && !m.importedFromMemoryId && m.type === 'auto').toArray();
  // Batch evidence reads: one shared source need not be read once per remembered fact.
  const ids = [...new Set(rows.flatMap(row => row.sourceMessageIds ?? []))];
  const [sourceRows, tombstones] = await Promise.all([
    db.messages.bulkGet(ids), db.memorySourceTombstones.bulkGet([
      ...rows.map(row => memorySourceTombstoneId(userId, 'memory', row.id)),
      ...ids.map(id => memorySourceTombstoneId(userId, 'message', id)),
    ]),
  ]);
  const sources = new Map(sourceRows.filter((m): m is Message => !!m).map(m => [m.id, m]));
  const revoked = new Map(tombstones.filter((row): row is NonNullable<typeof row> => !!row).map(row => [`${row.sourceType}:${row.sourceId}`, row]));
  const blocked = (kind: 'memory' | 'message', id: string, revision: number) => {
    const row = revoked.get(`${kind}:${id}`);
    return !!row && (row.status === 'deleted' || revision <= row.sourceRevision);
  };
  const valid: MemoryItem[] = [];
  for (const row of rows) {
    if (!row.sourceSessionId || !sessionIds.has(row.sourceSessionId) || !row.sourceMessageIds?.length) continue;
    if (blocked('memory', row.id, row.updatedAt ?? row.createdAt)) continue;
    let live = false;
    for (const sourceId of row.sourceMessageIds) {
      const source = sources.get(sourceId);
      if (!source || source.role !== 'user' || source.failed || !sessionIds.has(source.sessionId)
        || (row.sourceMessageRevisions?.[source.id] ?? 1) !== (source.revision ?? 1)) continue;
      if (!blocked('message', source.id, source.revision ?? 1)) { live = true; break; }
    }
    if (live) valid.push(row);
  }
  await owner(userId, characterId);
  return valid.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || a.id.localeCompare(b.id));
}

export function parseSecretaryMemoryCommand(request: string): SecretaryMemoryCommand | undefined {
  const text = request.trim().replace(/[。！!]+$/u, '');
  if (/^(?:请|帮我)?(?:查看|看看|列出|显示)(?:一下)?(?:你|助理)?(?:记住的(?:内容|事情)|的?长期记忆|的?记忆)$/u.test(text)
    || /^(?:你)?(?:记住了什么|还记得我什么|知道我哪些事情)[？?]?$/u.test(text)) return { kind: 'list' };
  const remember = text.match(/^(?:请|帮我)?(?:记住|记牢)(?:这件事|这一点)?[：:,，\s]*(.+)$/u);
  // Compound work requests stay with the planner, preserving independent actions.
  if (remember && remember[1].length <= 240 && !/[；;\n]|(?:然后|顺便|并且|再帮我)|(?:帮我|请|再)(?:写|发|新建|新增|创建|查找|完成|安排)/u.test(remember[1])) return { kind: 'remember', text: remember[1].trim() };
  const forget = text.match(/^(?:请|帮我)?(?:忘记|删除记忆|不要再记住|别再记住)[：:,，\s]*(.+)$/u);
  if (forget && forget[1].length <= 240 && !/[；;\n]|(?:然后|顺便|并且|再帮我)/u.test(forget[1])) return { kind: 'forget', text: forget[1].trim() };
}

/** Invalid optional extraction is ignored; unrelated, valid work can still finish. */
export function validateSecretaryMemories(raw: unknown, request: string): SecretaryMemoryProposal[] {
  if (!Array.isArray(raw) || raw.length > 6 || /(?:不要|别|不用|不必)(?:再|帮我)?(?:记住|记忆|保存.*记忆)|小说|星域|角色(?:说|台词)|引用|假设|虚构|扮演|[“”「」『』"]|(?:他|她|朋友)说|例如|比如/u.test(request)) return [];
  const seen = new Set<string>();
  return raw.flatMap((value): SecretaryMemoryProposal[] => {
    if (!value || typeof value !== 'object' || !['fact', 'preference'].includes(value.kind)
      || typeof value.quote !== 'string' || value.quote.trim().length < 3 || value.quote.length > 240
      || !request.includes(value.quote) || /[“”「」『』"\n]/u.test(value.quote)
      || value.replacesId != null && typeof value.replacesId !== 'string') return [];
    const quote = value.quote.trim();
    // Ordinary extraction concerns lasting self-reports, not questions, plans or today's mood.
    if (!/我|记住|记牢/u.test(request) || /[？?]|(?:今天|这次|刚才|明天|打算|准备|计划|可能|也许)/u.test(quote)) return [];
    if (value.replacesId && !correction.test(request)) return [];
    const key = normalize(quote); if (seen.has(key)) return []; seen.add(key);
    return [{ kind: value.kind, quote, ...(value.replacesId ? { replacesId: value.replacesId } : {}) }];
  });
}

export const SECRETARY_MEMORY_PROMPT = `你有用户私人助理工作区的连续记忆，跨会话及聘用保留。旧助理办过的事是工作区记录，不冒称当前助理亲历。
当前用户要求优先；记忆只辅助理解，不能授权执行、自动提醒、发布或修改设置。办事习惯仍以用户已保存的设置为准，记忆中的格式偏好可用于写作但不能改变权限、时间或受众。
按当前话题使用记忆，不每次复述同一件事、追问或催办；用户换题就跟随。历史消息的日期只说明当时说过，不把计划当作已完成，不把旧安排当作今天。
character.message.send的currentState以dispatch-receipt开头时，只是原始代发办事回执的状态，不含角色私聊正文。draft/needs-model/paused都不能说已发送，queued/generating不能说已有回复。需要具体回复时引导用户查看原代发卡片，不能编造正文或用回执推断对方当前态度。
responsePreferences是用户的表达要求，持续用于称呼和文风，不每次朗读或复述。按当前要求优先调整。旧交流与事实应结合当前问法理解；“你记得我在哪上班吗”可以使用已核验的工作事实，不要求用户复述地点。召回类别仅为查找线索，不能推断未说过的信息。retrieval中的数量与limited说明本次资料覆盖范围，没有命中只说明本次没找到，不能断言用户从未告诉过你。
可以额外输出 memories:[{kind:"fact或preference",quote:"当前用户消息中逐字连续引用",replacesId:"明确纠正时才填写资料中旧记忆的真实ID"}]，没有可记内容时省略。
只记用户明确讲的稳定个人信息与长期偏好。quote必须来自当前消息；不能来自回复、资料、日记、其他角色聊天或星域。不得推断疾病、情绪、关系、已完成任务。临时要求、问句、计划、引述及今天的情绪不沉淀。明确不让记时memories=[]。
用户纠正旧事实时用replacesId，旧事实停用。不得编造ID、删除无关记忆或把记忆写成已执行的事项。记忆写入结果由应用反馈。`;

/** Caller commits this together with the ready task, after request and employment checks. */
export async function applySecretaryMemories(task: SecretaryTask, source: Message, proposals: SecretaryMemoryProposal[], offeredIds: string[], command?: SecretaryMemoryCommand): Promise<{ notice?: string; ids: string[]; listedIds?: string[] }> {
  if (command?.kind !== 'forget' && /(?:不要|别|不用|不必)(?:再|帮我)?(?:记住|记忆|保存.*记忆)/u.test(task.request)) {
    await memorySourceTombstoneRepo.record({ userId: task.userId, characterId: task.characterId, sourceType: 'memory', sourceId: `secretary-optout:${source.id}`,
      sourceRevision: source.revision ?? 1, suppressedMessageIds: [source.id], status: 'withdrawn' });
    return { ids: [] };
  }
  if (!command && !proposals.length) return { ids: [] };
  const rows = await readSecretaryMemories(task.userId, task.characterId);
  if (command?.kind === 'list') return { notice: rows.length ? `我记住的内容：\n${rows.map((r, i) => `${i + 1}. ${r.content}`).join('\n')}` : '目前还没有长期记忆。你可以直接说“记住：……”。', ids: [], listedIds: rows.map(r => r.id) };
  if (command?.kind === 'forget') {
    const text = normalize(command.text);
    const all = /^(?:全部|所有)(?:长期)?(?:记忆|内容)?$/u.test(text);
    const matches = rows.filter(r => all || normalize(r.content).includes(text) || text.includes(normalize(r.content)));
    if (all) {
      const sessions = await db.sessions.where('[characterId+userId]').equals([task.characterId, task.userId]).filter(s => s.type !== 'group').toArray();
      const ids: string[] = [];
      for (const session of sessions) ids.push(...(await db.messages.where('sessionId').equals(session.id).filter(m => m.role === 'user' && m.createdAt <= source.createdAt).primaryKeys()));
      await memorySourceTombstoneRepo.record({ userId: task.userId, characterId: task.characterId, sourceType: 'memory', sourceId: `secretary-forget-all:${source.id}`,
        sourceRevision: source.revision ?? 1, suppressedMessageIds: ids, status: 'withdrawn' });
    }
    if (!matches.length) return { notice: all ? '已忘记以往交流中的长期信息，原聊天和办事记录保留。' : '没有找到这条记忆。可以在“助理记忆”里查看并选择要忘记的内容。', ids: [] };
    if (!all && matches.length !== 1) return { notice: '有多条相近的记忆，请在“助理记忆”里选择，或说完整一些。', ids: [] };
    for (const row of matches) await memoryRepo.deleteById(row.id);
    return { notice: all ? '已忘记全部长期记忆，原聊天和办事记录保留。' : '已忘记这条内容，原聊天保留。', ids: [] };
  }
  const changes = command?.kind === 'remember' ? [{ kind: /喜欢|偏好|习惯|称呼|叫我|回复/u.test(command.text) ? 'preference' as const : 'fact' as const, quote: command.text }] : proposals;
  const ids: string[] = [];
  for (const proposal of changes) {
    const old = proposal.replacesId ? rows.find(r => r.id === proposal.replacesId && offeredIds.includes(r.id)) : undefined;
    if (proposal.replacesId && !old) continue;
    const offset = source.content.indexOf(proposal.quote);
    if (offset < 0) continue;
    const existing = rows.find(r => normalize(r.content) === normalize(proposal.quote));
    // A retry of the same source never creates a second entry or evidence confirmation.
    if (existing?.sourceMessageIds?.includes(source.id)) { ids.push(existing.id); continue; }
    const now = Math.max(Date.now(), (old?.updatedAt ?? old?.createdAt ?? 0) + 1);
    const id = await memoryRepo.create({ id: crypto.randomUUID(), characterId: task.characterId, userId: task.userId,
      content: proposal.quote, type: 'auto', memoryKind: proposal.kind, status: 'active', stability: 'stable', confidence: 1,
      sourceSessionId: source.sessionId, sourceMessageIds: [source.id], sourceEvidenceMode: 'independent',
      sourceMessageRevisions: { [source.id]: source.revision ?? 1 }, sourceMessageOffsets: { [source.id]: offset },
      sourceMessageEndOffsets: { [source.id]: offset + proposal.quote.length }, createdAt: now, updatedAt: now });
    if (old && old.id !== id) await memoryRepo.supersede(old.id, id);
    ids.push(id);
  }
  return { ids, ...(command?.kind === 'remember' ? { notice: ids.length ? `已记住：${command.text}` : '这条内容没有记入，请重新说完整一些。' } : {}) };
}

export async function editSecretaryMemory(userId: string, characterId: string, id: string, content: string | null, expectedVersion: number): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await owner(userId, characterId);
    const row = (await readSecretaryMemories(userId, characterId)).find(r => r.id === id);
    if (!row || (row.updatedAt ?? row.createdAt) !== expectedVersion) throw new Error('这条记忆已变化，请重新打开后修改。');
    if (content === null) await memoryRepo.deleteById(id);
    else {
      if (!content.trim() || content.trim().length > 240) throw new Error('记忆需要1至240个字。');
      await memoryRepo.correctContent(id, content.trim(), userId);
    }
    await owner(userId, characterId);
  });
}

/** Discard a late planner reply if the facts it saw were corrected or forgotten meanwhile. */
export async function assertSecretaryMemoryReferences(task: SecretaryTask, diaryUnlocked = true): Promise<void> {
  const refs = task.memoryReferences;
  if (!refs) return;
  if (refs.requiresDiaryUnlocked && !diaryUnlocked) throw new Error('日记已重新锁定，请解锁后再查询。');
  const live = new Map((await readSecretaryMemories(task.userId, task.characterId)).map(row => [row.id, row]));
  for (const id of refs.memoryIds) {
    const row = live.get(id);
    if (!row || refs.memoryVersions?.[id] !== (row.updatedAt ?? row.createdAt)) throw new Error('记忆已修改或忘记，请重新发送这次请求。');
  }
  const suppressed = await memorySourceTombstoneRepo.suppressedMessages(task.userId, task.characterId);
  const sessions = new Set((await db.sessions.where('[characterId+userId]').equals([task.characterId, task.userId]).filter(s => s.type !== 'group').primaryKeys()));
  for (const id of refs.messageIds) {
    const row = await db.messages.get(id);
    if (!row || row.failed || !sessions.has(row.sessionId) || suppressed.has(id) || suppressed.has(id.replace(/^secretary-reply:/u, ''))
      || refs.messageVersions?.[id] !== (row.revision ?? 1)) throw new Error('旧交流资料已变化，请重新发送这次请求。');
  }
  for (const id of refs.taskIds) {
    const row = await db.secretaryTasks.get(id);
    const source = row ? await db.messages.get(row.messageId) : undefined;
    if (!row || row.userId !== task.userId || row.characterId !== task.characterId || row.updatedAt !== refs.taskVersions?.[id]
      || !source || source.role !== 'user' || source.failed || source.content !== row.request || suppressed.has(source.id)
      || source.sessionId !== row.sessionId || refs.taskSourceVersions?.[id] !== (source.revision ?? 1)) throw new Error('任务进展已变化，请重新查询后继续。');
  }
  for (const ref of refs.recordVersions ?? []) {
    const row = ref.kind === 'todo' ? await db.todos.get(ref.id) : ref.kind === 'todoOccurrence' ? await db.todoOccurrences.get(ref.id)
      : ref.kind === 'moment' ? await db.moments.get(ref.id) : await db.diaries.get(ref.id);
    if (ref.version === null && ref.kind === 'todoOccurrence' && !row) continue;
    if (!row || row.userId !== task.userId || row.updatedAt !== ref.version) throw new Error('办事记录已更新，请重新查询当前进度。');
  }
}

const relevance = secretaryRecallScore;
const memoryRelevance = secretaryRecallScore;
function expressionPreference(row: MemoryItem): boolean {
  return row.memoryKind === 'preference' && /回复|回应|称呼|叫我|表情|文风|语气|说话|简短|少问|不要催/u.test(row.content);
}

/** Remove only known fact spans; a second detail in the same turn must stay searchable. */
function remainingEvidence(message: Message, memories: MemoryItem[]): string {
  const spans: { start: number; end: number }[] = [];
  for (const row of memories) {
    if (!row.sourceMessageIds?.includes(message.id) || (row.sourceMessageRevisions?.[message.id] ?? 1) !== (message.revision ?? 1)) continue;
    const start = row.sourceMessageOffsets?.[message.id] ?? message.content.indexOf(row.content);
    const end = row.sourceMessageEndOffsets?.[message.id] ?? start + row.content.length;
    // Legacy evidence lacking a usable segment stays out rather than bypassing cooldown.
    if (start < 0 || end <= start || end > message.content.length) return '';
    spans.push({ start, end });
  }
  let result = message.content;
  for (const { start, end } of spans.sort((a, b) => b.start - a.start)) result = result.slice(0, start) + ' '.repeat(end - start) + result.slice(end);
  return result.trim();
}

/** Keep the matching passage of a long source, not always its opening paragraph. */
function evidenceExcerpt(text: string, query: string, limit = 900): string {
  if (text.length <= limit) return text;
  let bestAt = 0, bestScore = -1;
  for (let start = 0; start < text.length; start += 300) {
    const score = relevance(text.slice(start, start + 600), query);
    if (score > bestScore) { bestScore = score; bestAt = start; }
  }
  const start = Math.max(0, Math.min(text.length - limit, bestAt - 150));
  return text.slice(start, start + limit);
}

/** Read-only, query-driven recall. Live records remain the authority for task progress. */
export async function buildSecretaryMemoryContext(task: SecretaryTask, recent: Message[], diaryUnlocked: boolean, light = false) {
  await owner(task.userId, task.characterId);
  const all = await readSecretaryMemories(task.userId, task.characterId);
  const byId = new Map(all.map(m => [m.id, m]));
  const suppressed = await memorySourceTombstoneRepo.suppressedMessages(task.userId, task.characterId);
  const sessions = await db.sessions.where('[characterId+userId]').equals([task.characterId, task.userId]).filter(s => s.type !== 'group').toArray();
  const owned = new Set(sessions.map(s => s.id));
  const cutoff = (await db.messages.get(task.messageId))?.createdAt ?? task.createdAt;
  const safeRecent = recent.filter(m => owned.has(m.sessionId) && m.id !== task.messageId && !m.failed && !suppressed.has(m.id)
    && m.createdAt <= cutoff && !suppressed.has(m.id.replace(/^secretary-reply:/u, ''))
    && !(m.role === 'user' && parseSecretaryMemoryCommand(m.content)?.kind === 'forget')
    && !(m.contextTrace?.memoryIds ?? []).some(id => !byId.has(id) || (byId.get(id)!.updatedAt ?? 0) > m.contextTrace!.at));
  const recentTasks = (await db.secretaryTasks.bulkGet(recent.map(m => `secretary-task:${task.userId}:${m.id.replace(/^secretary-reply:/u, '')}`))).filter((t): t is SecretaryTask => !!t && t.userId === task.userId && t.characterId === task.characterId);
  const lockedTopics = new Set(diaryUnlocked ? [] : recentTasks.filter(diaryProtectedTask).map(t => t.messageId));
  const query = secretaryRecallQuery(task.request, [...safeRecent].reverse().find(m => m.role === 'user' && !lockedTopics.has(m.id))?.content);
  const overview = secretaryWorkOverview(task.request);
  const mentioned = new Set(safeRecent.filter(m => m.role === 'assistant').flatMap(m => m.contextTrace?.spokenMemoryIds ?? []));
  const relevant = all.filter(row => memoryRelevance(row.content, query) > 0 || expressionPreference(row));
  // An explicit return to the subject reopens it; style preferences alone do not.
  const cooled = new Set([...mentioned].filter(id => !memoryRelevance(byId.get(id)?.content ?? '', query)));
  const memories = rankConversationMemories([...relevant].sort((a, b) => memoryRelevance(b.content, query) - memoryRelevance(a.content, query)), query, cooled, 12);
  const recentIds = new Set(recent.map(m => m.id));
  // Keep verified stable memories and recent conversation, including lock checks.
  // A clearly casual turn need not flush/backfill/search the whole work history.
  const candidates = light ? { messages: [], tasks: recentTasks, incomplete: true }
    : await searchHistoryCandidates(task.userId, task.characterId, query);
  const historic: Message[] = [];
  const messages = candidates.messages.filter(m => owned.has(m.sessionId) && m.role === 'user' && !m.failed && m.id !== task.messageId && m.createdAt <= cutoff
    && !recentIds.has(m.id) && !suppressed.has(m.id) && parseSecretaryMemoryCommand(m.content)?.kind !== 'forget');
  for (const message of messages) {
    const content = remainingEvidence(message, all);
    if (relevance(content, query) > 0 && !await memorySourceTombstoneRepo.blocksImport({ userId: task.userId, sourceType: 'message', sourceId: message.id, sourceRevision: message.revision ?? 1 })) historic.push({ ...message, content });
  }
  historic.sort((a, b) => relevance(b.content, query) - relevance(a.content, query) || b.createdAt - a.createdAt);
  const tasks = candidates.tasks.filter(t => t.userId === task.userId && t.characterId === task.characterId && t.status === 'finished' && owned.has(t.sessionId) && t.id !== task.id && t.createdAt < task.createdAt && !suppressed.has(t.messageId));
  const taskEvidence = new Map<string, { sourceVersion: number; records: NonNullable<SecretaryMemoryReferences['recordVersions']>; diary: boolean }>();
  const seenRecords = new Set<string>();
  const receipts: { id: string; date: string; previousEmployment: boolean; results: { kind: string; status: string; title?: string; content?: string; targetId?: string; currentState?: string; date?: string; steps?: { title: string; completed: boolean }[] }[] }[] = [];
  for (const previous of tasks.sort((a, b) => (overview ? 0 : relevance(secretaryTaskSearchText(b), query) - relevance(secretaryTaskSearchText(a), query)) || b.updatedAt - a.updatedAt)) {
    if (receipts.length >= 4) break;
    if (!diaryUnlocked && diaryProtectedTask(previous)) continue;
    const source = await db.messages.get(previous.messageId);
    if (!source || source.role !== 'user' || source.failed || source.content !== previous.request || source.sessionId !== previous.sessionId
      || !overview && !relevance(secretaryTaskSearchText(previous), query) || await memorySourceTombstoneRepo.blocksImport({ userId: task.userId, sourceType: 'message', sourceId: source.id, sourceRevision: source.revision ?? 1 })) continue;
    const results: typeof receipts[number]['results'] = [];
    const records: NonNullable<SecretaryMemoryReferences['recordVersions']> = [];
    let usesDiary = diaryProtectedTask(previous);
    for (const r of previous.results) {
      if (r.action.kind === 'character.message.send' && r.dispatch) {
        // Canonical receipts only: mirrored continuation cards must not duplicate work.
        if (r.dispatch.taskId !== previous.id || seenRecords.has(`dispatch:${r.dispatch.taskId}`)) continue;
        seenRecords.add(`dispatch:${r.dispatch.taskId}`);
        results.push({ kind: r.action.kind, status: r.status, title: r.dispatch.recipientName, currentState: `dispatch-receipt:${r.dispatch.state}` });
        continue;
      }
      if (r.action.kind.startsWith('moment.') && (overview || /朋友圈|动态|文案|草稿|发布/u.test(task.request))
        && (!previous.dailyReview?.includeDiary || diaryUnlocked)) {
        if (r.status === 'draft') {
          const key = `draft:${r.operationId ?? `${previous.id}:${previous.results.indexOf(r)}`}`;
          if (seenRecords.has(key)) continue;
          seenRecords.add(key);
          results.push({ kind: r.action.kind, status: r.status, currentState: 'draft; not published', ...(overview ? {} : { content: r.action.content?.slice(0, 1600) }) });
          usesDiary ||= !!previous.dailyReview?.includeDiary;
        }
        else if (r.targetId) {
          const moment = await db.moments.get(r.targetId);
          if (moment?.userId === task.userId && !moment.authorCharacterId && !seenRecords.has(`moment:${moment.id}`)) {
            seenRecords.add(`moment:${moment.id}`);
            records.push({ kind: 'moment', id: moment.id, version: moment.updatedAt });
            usesDiary ||= !!previous.dailyReview?.includeDiary;
            results.push({ kind: r.action.kind, status: r.status, targetId: moment.id,
              currentState: moment.deleted ? 'withdrawn' : 'published', ...(moment.deleted || overview ? {} : { content: moment.text.slice(0, 1600) }) });
          }
        }
        continue;
      }
      if (r.action.kind === 'diary.save' && (overview || /日记|手账/u.test(task.request)) && diaryUnlocked && r.targetId) {
        const diary = await db.diaries.get(r.targetId);
        if (diary?.userId === task.userId && !diary.deletedAt && !diary.characterId && diary.visibility !== 'world' && !seenRecords.has(`diary:${diary.id}`)) {
          seenRecords.add(`diary:${diary.id}`);
          records.push({ kind: 'diary', id: diary.id, version: diary.updatedAt }); usesDiary = true;
          results.push({ kind: r.action.kind, status: r.status,
            targetId: diary.id, title: diary.title, date: diary.date, currentState: 'saved; content available only by explicit diary query' });
        }
        continue;
      }
      if (!r.action.kind.startsWith('todo.') || !r.targetId) continue;
      const todo = await db.todos.get(r.targetId);
      if (!todo || todo.userId !== task.userId || todo.status === 'deleted') continue;
      const date = r.targetDate ?? r.action.date;
      const key = `todo:${todo.id}:${date ?? ''}`;
      if (seenRecords.has(key)) continue;
      seenRecords.add(key);
      const occurrence = date ? await db.todoOccurrences.get(occurrenceId(todo.id, date)) : undefined;
      records.push({ kind: 'todo', id: todo.id, version: todo.updatedAt });
      if (date) records.push({ kind: 'todoOccurrence', id: occurrenceId(todo.id, date), version: occurrence?.updatedAt ?? null });
      results.push({ kind: r.action.kind, status: r.status, title: todo.title, targetId: todo.id, date,
        currentState: todo.status === 'cancelled' ? 'cancelled' : occurrence?.status ?? (todo.recurrence.kind === 'none' ? todo.status : 'series; specific occurrence required'),
        ...(todo.recurrence.kind === 'none' ? { steps: todo.subtasks?.map(s => ({ title: s.title, completed: s.completed })) } : {}) });
    }
    if (results.length) {
      receipts.push({ id: previous.id, date: localDateKey(new Date(previous.createdAt)), previousEmployment: previous.employmentId !== task.employmentId, results });
      taskEvidence.set(previous.id, { sourceVersion: source.revision ?? 1, records, diary: usesDiary });
    }
  }
  // One bounded payload, with only complete selected entries referenced in the receipt.
  const refs: SecretaryMemoryReferences = { memoryIds: [], messageIds: [], taskIds: [], memoryVersions: {}, messageVersions: {}, taskVersions: {}, taskSourceVersions: {}, recordVersions: [] };
  const data: { memories: { id: string; kind?: string; content: string }[]; responsePreferences: { id: string; content: string }[]; previousUserMessages: { id: string; date: string; content: string }[]; taskProgress: typeof receipts } = { memories: [], responsePreferences: [], previousUserMessages: [], taskProgress: [] };
  let budget = 5000;
  const add = (value: unknown) => { const size = JSON.stringify(value).length; if (size > budget) return false; budget -= size; return true; };
  for (const row of memories) { const value = { id: row.id, kind: row.memoryKind, content: row.content }; if (add(value)) { data.memories.push(value); refs.memoryIds.push(row.id); refs.memoryVersions![row.id] = row.updatedAt ?? row.createdAt; } }
  // A spoken preference cools down as a topic, but keeps guiding the user's work style.
  for (const row of all.filter(expressionPreference).slice(0, 4)) {
    if (refs.memoryIds.includes(row.id)) continue;
    const value = { id: row.id, content: row.content };
    if (add(value)) { data.responsePreferences.push(value); refs.memoryIds.push(row.id); refs.memoryVersions![row.id] = row.updatedAt ?? row.createdAt; }
  }
  for (const row of receipts) {
    if (!add(row)) continue;
    data.taskProgress.push(row); refs.taskIds.push(row.id); refs.taskVersions![row.id] = tasks.find(t => t.id === row.id)!.updatedAt;
    const evidence = taskEvidence.get(row.id)!;
    refs.taskSourceVersions![row.id] = evidence.sourceVersion;
    refs.recordVersions!.push(...evidence.records);
    refs.requiresDiaryUnlocked ||= evidence.diary;
  }
  const historicTasks = (await db.secretaryTasks.bulkGet(historic.map(m => `secretary-task:${task.userId}:${m.id}`))).filter((t): t is SecretaryTask => !!t && t.userId === task.userId && t.characterId === task.characterId);
  // Recent privacy cannot depend on a relevance-filtered history query finding
  // the task. Derived drafts and pending requests need the same lock as diaries.
  const diaryTaskIds = new Set([...tasks, ...recentTasks, ...historicTasks].filter(diaryProtectedTask).map(t => t.messageId));
  if (diaryUnlocked && safeRecent.some(m => diaryTaskIds.has(m.id.replace(/^secretary-reply:/u, '')))) refs.requiresDiaryUnlocked = true;
  for (const row of historic) {
    if (!diaryUnlocked && diaryTaskIds.has(row.id) || data.previousUserMessages.length >= 4) continue;
    const value = { id: row.id, date: localDateKey(new Date(row.createdAt)), content: evidenceExcerpt(row.content, query) };
    if (add(value)) {
      data.previousUserMessages.push(value); refs.messageIds.push(row.id); refs.messageVersions![row.id] = row.revision ?? 1;
      refs.requiresDiaryUnlocked ||= diaryTaskIds.has(row.id);
    }
  }
  const visibleRecent = safeRecent.filter(m => diaryUnlocked || !diaryTaskIds.has(m.id.replace(/^secretary-reply:/u, '')));
  // Recent dialogue is also evidence: editing it while generating must cancel the late answer.
  for (const row of visibleRecent) {
    if (!refs.messageIds.includes(row.id)) refs.messageIds.push(row.id);
    refs.messageVersions![row.id] = row.revision ?? 1;
  }
  await owner(task.userId, task.characterId);
  return { data: { ...data, retrieval: { limited: true, indexBuilding: candidates.incomplete, matchingFacts: relevant.length, includedFacts: data.memories.length, factsLimited: relevant.length > data.memories.length } }, references: refs, recent: visibleRecent.map(m => ({ ...m, content: evidenceExcerpt(m.content, query, 1200) })) };
}
