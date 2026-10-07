import { db, type Character, type Message } from '../../db';
import { messageRepo } from '../../db/message-repo';
import { sessionRepo } from '../../db/session-repo';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { sendMessage } from '../ai/deepseek';
import { safeParseAIResponse } from '../ai/safe-json';
import { ChatReplyStream } from '../chat-stream';
import { sendRoleChatReply, type ChatRequest } from '../chat/send-service';
import { withChatSessionLock } from '../chat/request-coordinator';
import { conversationChoice, conversationControl, nonFieldAnswer } from './conversation';
import { secretaryPersonality } from './personality';
import type { SecretaryTask, SecretaryResult } from './types';
import { DISPATCH_LABELS } from './dispatch-status';
import { canUseAi } from '../ai/availability';
import { resolveModel } from '../ai/llm';
import { lightConversation } from './context-policy';
import { memorySourceTombstoneRepo } from '../../db/memory-source-tombstone-repo';

export type DispatchState = 'needs-recipient' | 'needs-content' | 'draft' | 'needs-model' | 'queued' | 'generating' | 'replied' | 'reply-failed' | 'reply-unavailable' | 'interrupted' | 'paused' | 'cancelled' | 'invalid';
export interface CharacterDispatch {
  /** Stable operation: follow-up receipts reference this canonical task. */
  taskId: string;
  state: DispatchState;
  recipientId?: string;
  recipientName?: string;
  recipientVersion?: string;
  targetSessionId?: string;
  outboundMessageId?: string;
  replyMessageIds: string[];
  bodyOrigin: 'literal' | 'composed' | 'edited';
  draftRevision: number;
  approvedRevision?: number;
  resumeState?: DispatchState;
  /** Every human field/approval source is checked before commit and each reply write. */
  sources: { messageId: string; sessionId: string; revision: number; content: string }[];
  receiptTaskIds?: string[];
  candidates?: { id: string; name: string; avatar: string; version: string; signature?: string }[];
  attemptId?: string;
  leaseUntil?: number;
  error?: string;
  stopRequested?: boolean;
}

const running = new Map<string, { userId: string; controller: AbortController; promise: Promise<SecretaryTask> }>();
const recipientVersion = (character: Character) => JSON.stringify([character.id, character.name, character.createdBy, character.agentProfile, character.systemPrompt]);
const mutations = new Map<string, Promise<unknown>>();
async function exclusive<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = mutations.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  mutations.set(id, next);
  try { return await next; } finally { if (mutations.get(id) === next) mutations.delete(id); }
}
useAuthStore.subscribe((state, previous) => {
  if (state.userId === previous.userId) return;
  running.forEach(request => { if (request.userId !== state.userId) request.controller.abort(); });
});

export async function messagingRecipients(userId: string): Promise<Character[]> {
  if (useAuthStore.getState().userId !== userId) return [];
  return db.characters.where('createdBy').equals(userId).filter(c => !c.isPreset && c.agentProfile !== 'secretary').toArray();
}
function sourceOf(message: Message) {
  return { messageId: message.id, sessionId: message.sessionId, revision: message.revision ?? 1, content: message.content };
}
function resultOf(task: SecretaryTask): SecretaryResult {
  const result = task.results.find(r => r.dispatch);
  if (!result?.dispatch || result.dispatch.taskId !== task.id) throw new Error('代发记录不可用，请重新提出请求。');
  return result;
}
async function assertSources(task: SecretaryTask): Promise<CharacterDispatch> {
  const dispatch = resultOf(task).dispatch!;
  if (!Array.isArray(dispatch.sources) || !dispatch.sources.some(ref => ref.messageId === task.messageId && ref.content === task.request)
    || !Number.isInteger(dispatch.draftRevision) || dispatch.draftRevision < 1) throw new Error('代发来源不完整，请重新提出请求。');
  if (useAuthStore.getState().userId !== task.userId) throw new Error('账号已切换，代发已停止。');
  const [assistant, binding, sourceSession] = await Promise.all([db.characters.get(task.characterId), db.secretaryBindings.get(task.userId), db.sessions.get(task.sessionId)]);
  if (!assistant || assistant.createdBy !== task.userId || assistant.agentProfile !== 'secretary' || assistant.secretaryStatus === 'dismissed'
    || !sourceSession || sourceSession.userId !== task.userId || sourceSession.characterId !== task.characterId || sourceSession.type === 'group'
    || binding?.status === 'dismissed' || binding && binding.characterId !== task.characterId
    || task.employmentId !== (binding?.employmentId ?? assistant.secretaryEmploymentId ?? `legacy:${task.characterId}`)) throw new Error('助理已更换或离职，原代发已停止。');
  for (const ref of dispatch.sources) {
    const [message, session] = await Promise.all([db.messages.get(ref.messageId), db.sessions.get(ref.sessionId)]);
    if (!message || message.role !== 'user' || message.failed || message.content !== ref.content || (message.revision ?? 1) !== ref.revision || message.sessionId !== ref.sessionId
      || !session || session.userId !== task.userId || session.characterId !== task.characterId || session.type === 'group') throw new Error('原请求已修改或撤回，代发已停止。');
    if (await memorySourceTombstoneRepo.blocksImport({ userId: task.userId, sourceType: 'message', sourceId: ref.messageId, sourceRevision: ref.revision })) throw new Error('原请求已撤回，代发已停止。');
  }
  if (useAuthStore.getState().userId !== task.userId) throw new Error('账号已切换，代发已停止。');
  return dispatch;
}
async function assertTarget(task: SecretaryTask, checkVersion = false): Promise<Character> {
  const dispatch = await assertSources(task);
  const character = dispatch.recipientId ? await db.characters.get(dispatch.recipientId) : undefined;
  if (!character || character.createdBy !== task.userId || character.isPreset || character.agentProfile === 'secretary') throw new Error('目标角色已不可用，请重新选择。');
  if (checkVersion && dispatch.recipientVersion !== recipientVersion(character)) throw new Error('角色资料已变化，请重新确认收件人。');
  if (dispatch.targetSessionId) {
    const session = await db.sessions.get(dispatch.targetSessionId);
    if (!session || session.userId !== task.userId || session.characterId !== character.id || session.type === 'group') throw new Error('目标会话已变化，代发已停止。');
  }
  return character;
}
export function dispatchReceipt(result: SecretaryResult, personality = 'balanced'): string {
  const d = result.dispatch!;
  if (d.state === 'needs-content') {
    const name = d.recipientName ?? '这个角色';
    return { professional: `请提供发给${name}的正文。`, balanced: `想跟${name}说什么？`, gentle: `你想对${name}说些什么？把想说的告诉我就好。`, energetic: `给${name}带哪句话？`, playful: `传话对象有了，想跟${name}说什么？` }[personality] ?? `想跟${name}说什么？`;
  }
  if (d.state === 'needs-recipient') return d.candidates?.length ? '要发给哪一个角色？请从卡片里选一下。' : '你想发给哪个已添加的角色？';
  if (d.state === 'draft') return { professional: '正文待确认。核对这一版后发送。', balanced: '文案在下面，确认这一版后再发送。', gentle: '先看看这样说合不合你的心意，你确认后再发。', energetic: '这一版先给你看看！点发送才会转交。', playful: '先过目，发送键交给你；没确认就不传话。' }[personality] ?? '文案在下面，确认这一版后再发送。';
  if (d.state === 'needs-model') return '先选择这个角色对话使用的模型，正文尚未发送。';
  if (d.state === 'paused') return '先保留这条消息。你说“继续刚才那条”时再接着办。';
  if (d.state === 'replied') return '角色的实际回复已带回，点开卡片可以查看原文。';
  if (d.state === 'interrupted') return d.replyMessageIds.length ? '已保留实际生成的部分回复，后续生成已中断。' : '消息已记录，回复生成已中断。';
  if (d.state === 'reply-failed') return '消息已经记录在目标聊天，回复未能生成；可以只重试回复。';
  if (d.state === 'reply-unavailable') return '消息已记录，角色的模型连接不可用；配置连接后可以只生成回复。';
  return DISPATCH_LABELS[d.state];
}
function syncResult(task: SecretaryTask): SecretaryTask {
  const result = resultOf(task), d = result.dispatch!;
  result.status = ['cancelled', 'invalid'].includes(d.state) ? 'undone' : d.state === 'replied' ? 'done' : ['reply-failed', 'reply-unavailable', 'interrupted'].includes(d.state) ? 'failed'
    : d.state === 'draft' ? 'draft' : ['queued', 'generating'].includes(d.state) ? 'pending' : 'needs-input';
  result.detail = dispatchReceipt(result, task.personality);
  task.status = 'finished';
  task.privacyScope = 'plain';
  task.updatedAt = Math.max(Date.now(), task.updatedAt + 1);
  return task;
}
async function persist(task: SecretaryTask): Promise<SecretaryTask> {
  // Canonical operation, mirrored continuation cards, and receipt wording commit together.
  await db.transaction('rw', [db.secretaryTasks, db.messages, db.sessions], async () => {
    const existing = await db.secretaryTasks.get(task.id);
    if (existing && existing.updatedAt > task.updatedAt) throw new Error('代发进展已变化，请查看最新卡片。');
    syncResult(task);
    await db.secretaryTasks.put(task);
    const siblings = await db.secretaryTasks.bulkGet(resultOf(task).dispatch!.receiptTaskIds ?? []);
    for (const receiptTask of [task, ...siblings.filter((t): t is SecretaryTask => !!t && t.userId === task.userId && t.id !== task.id && t.results.some(r => r.dispatch?.taskId === task.id))]) {
      if (receiptTask.id !== task.id) {
        receiptTask.results = [{ ...resultOf(task) }]; receiptTask.updatedAt = task.updatedAt;
        await db.secretaryTasks.put(receiptTask);
      }
      const id = `secretary-reply:${receiptTask.messageId}`;
      const old = await db.messages.get(id);
      const content = dispatchReceipt(resultOf(task), task.personality);
      if (!old) await db.messages.add({ id, sessionId: receiptTask.sessionId, role: 'assistant', content, createdAt: Date.now(), revision: 1, isProactive: false, secretaryTaskId: receiptTask.id });
      else if (old.secretaryTaskId === receiptTask.id && old.content !== content) await db.messages.update(id, { content, revision: (old.revision ?? 1) + 1 });
    }
  });
  for (const id of [task.id, ...(resultOf(task).dispatch!.receiptTaskIds ?? [])]) window.dispatchEvent(new CustomEvent('virtugene:secretary-updated', { detail: { userId: task.userId, taskId: id } }));
  return task;
}

/** Local evidence extraction. Model prose never supplies permission for literal sending. */
export function parseDispatchRequest(request: string, recipientNames: readonly string[] = []): { recipient: string; body?: string; compose?: boolean; prompt?: string } | undefined {
  const text = request.trim();
  const addition = text.match(/^(?:(?:请|帮我)\s*)?再给([^：:,，\n]{1,80}?)补(?:一句|一句话|一条)(?:[：:，,\s]+)([\s\S]+)$/u);
  if (addition) return { recipient: addition[1].trim(), body: addition[2] };
  const draft = text.match(/^(?:(?:请|麻烦你?|帮我|请帮我)\s*)?(?:给|跟|向)([^：:,，\n]{1,80}?)(?:写|拟|起草)(?:一段|一条|一句|个)?([\s\S]+)$/u);
  if (draft) return { recipient: draft[1].trim(), compose: true, prompt: draft[2].trim() };
  // Already-added names establish a verifiable boundary even without punctuation.
  const head = text.match(/^(?:(?:请|麻烦你?|帮我|帮我们|请帮我)\s*)?(给|向|跟|对|告诉|通知)([\s\S]+)$/u);
  if (head) {
    const names = [...new Set(recipientNames)].filter(name => head[2].startsWith(name)).sort((a, b) => b.length - a.length);
    const name = names[0];
    if (name) {
      const tail = head[2].slice(name.length);
      if (head[1] === '告诉' || head[1] === '通知') return { recipient: name, body: tail.replace(/^[：:，,\s]+/u, '') || undefined };
      if (/^\s*(?:先|暂时)?(?:不要|不用|不必|别|不)(?:再)?发/u.test(tail)) return undefined;
      const body = tail.match(/^(?:发(?:送)?(?:个|一条)?(?:消息|信息|短信|一句话)?(?:说)?|说(?:一下)?|讲(?:一下)?|传(?:个|一句)?话)(?:[：:，,\s]*)([\s\S]*)$/u);
      if (body) return { recipient: name, body: /^[。！!\s]*$/u.test(body[1]) ? undefined : body[1] };
    }
  }
  // Only a top-level command is a send; quoted examples/negated commands do not match.
  const match = text.match(/^(?:(?:请|麻烦你?|帮我|帮我们|请帮我)\s*)?(?:给|向|跟|对)([^：:,，\n]{1,80}?)(?:发(?:送)?(?:一条)?(?:消息|信息|短信|一句话)?|说|讲|传(?:个|一句)?话)(?:[：:，,\s]+([\s\S]+))?[。！!]?$/u)
    ?? text.match(/^(?:(?:请|麻烦你?|帮我|帮我们|请帮我)\s*)?(?:告诉|通知)([^：:,，\n]{1,80}?)[：:，,]([\s\S]+)$/u);
  if (match) return { recipient: match[1].trim(), body: match[2] };
  return undefined;
}
function setRecipient(result: SecretaryResult, recipient: Character) {
  const d = result.dispatch!;
  d.recipientId = recipient.id; d.recipientName = recipient.name; d.recipientVersion = recipientVersion(recipient);
  d.candidates = undefined; d.targetSessionId = undefined; d.draftRevision++; d.approvedRevision = undefined; d.error = undefined;
}
async function findRecipient(result: SecretaryResult, userId: string, query: string) {
  const all = await messagingRecipients(userId);
  const clean = query.replace(/^(?:角色|名叫|叫)/u, '').replace(/^[“"「『]|[”"」』]$/gu, '').trim();
  const matches = all.filter(c => c.name === clean || c.id === clean);
  if (matches.length === 1) setRecipient(result, matches[0]);
  else result.dispatch!.candidates = (matches.length ? matches : all).slice(0, 30).map(c => ({ id: c.id, name: c.name, avatar: c.avatar, version: recipientVersion(c), signature: c.signature }));
}
function nextState(result: SecretaryResult): DispatchState {
  if (!result.dispatch!.recipientId) return 'needs-recipient';
  if (!result.action.content?.trim()) return 'needs-content';
  return result.dispatch!.approvedRevision === result.dispatch!.draftRevision ? 'queued' : 'draft';
}

/** Explicit changes apply to an unsent message only, and always require fresh approval. */
function dispatchEdit(text: string): { content?: string; append?: string; recipient?: string } | undefined {
  const correction = text.trim().match(/^(?:不是给[^：:,，\n]+[，,]\s*是给|(?:收件人|收件角色|对象)(?:改成|改为)|改发给|换成发给|换成给)([^：:,，\n]+?)[。！!]?$/u);
  if (correction) return { recipient: correction[1].trim() };
  const body = text.match(/^(?:正文(?:改成|改为|是)|内容(?:改成|改为|是)|改成|改为|就说|帮我说)[：:，,\s]*([\s\S]+)$/u);
  if (body) return { content: body[1] };
  const append = text.match(/^(?:正文|内容)?(?:再)?(?:加上|加一句|补一句)[：:，,\s]+([\s\S]+)$/u);
  if (append) return { append: append[1] };
  return undefined;
}

function changeBody(result: SecretaryResult, content: string, origin: CharacterDispatch['bodyOrigin']) {
  if (content.length > 6000) throw new Error('消息正文最多6000字。');
  result.action.content = content;
  const d = result.dispatch!;
  d.bodyOrigin = origin; d.draftRevision++; d.approvedRevision = undefined; d.error = undefined;
}
async function draftBody(task: SecretaryTask, assistant: Character, prompt: string) {
  const d = resultOf(task).dispatch!;
  const session = await db.sessions.get(task.sessionId);
  await assertSources(task);
  const output = await sendMessage({ apiKey: useAuthStore.getState().apiKey ?? '', character: assistant, sessionModel: session?.model,
    systemPrompt: '你是生活助理，只拟写用户要发给软件内角色的一条文字消息。不要执行任何操作、假装已发送、读取私密资料或编造用户经历。按用户要求的文风，输出严格 JSON：{"content":"拟稿正文"}。',
    message: JSON.stringify({ recipient: d.recipientName, requirement: prompt }), history: [], structuredOutput: true, temperature: 0.6, maxTokens: 1800 });
  await assertSources(task);
  const parsed = safeParseAIResponse(output.content).value as { content?: unknown } | undefined;
  if (output.truncated || typeof parsed?.content !== 'string' || !parsed.content.trim() || parsed.content.length > 6000) throw new Error('拟稿没有完整返回，请再试一次。');
  resultOf(task).action.content = parsed.content.trim();
  d.bodyOrigin = 'composed'; d.approvedRevision = undefined;
}

export async function tryRunCharacterMessaging(userId: string, assistant: Character, message: Message): Promise<SecretaryTask | undefined> {
  const parsed = parseDispatchRequest(message.content, (await messagingRecipients(userId)).map(c => c.name));
  const binding = await db.secretaryBindings.get(userId);
  const focus = binding?.dispatchFocusTaskId ? await db.secretaryTasks.get(binding.dispatchFocusTaskId) : undefined;
  const focused = focus?.userId === userId && focus.characterId === assistant.id && focus.results[0]?.dispatch;
  const control = conversationControl(message.content)
    ?? (/^(?:算了[，,]\s*)?(?:不发了|别发了|不用发了|取消发送|取消代发|取消这条消息)[。！!]?$/u.test(message.content.trim()) ? 'cancel'
      : /^(?:先不发|先别发|暂停发送|暂停代发)[。！!]?$/u.test(message.content.trim()) ? 'pause'
        : /^(?:继续|恢复|接着弄)(?:刚才)?(?:那条|这条)(?:消息)?[。！!]?$/u.test(message.content.trim()) ? 'resume' : undefined);
  const confirm = /^(?:确认(?:发送)?|发送(?:这条|这一版)?|就发(?:这条|这一版)?|发吧|就这样发)[。！!]?$/u.test(message.content.trim());
  const edit = dispatchEdit(message.content);
  const retry = /^(?:请|帮我)?(?:只)?(?:重试|重新生成)(?:一下)?(?:刚才的|这条的|角色的)?回复[。！!]?$/u.test(message.content.trim());
  const readReply = /^(?:(?:她|他|这个角色)(?:回(?:复)?我(?:什么(?:了)?)?|回(?:复)?了(?:吗)?)|查看(?:刚才|这条|角色)?回复|(?:这条消息)?(?:发出去|发送|发)了(?:吗|没有)|(?:这条消息的)?发送(?:情况|进度)(?:怎么样)?)[。！？!?]?$/u.test(message.content.trim());
  const awaiting = focused && ['needs-recipient', 'needs-content', 'draft', 'needs-model'].includes(focus.results[0].dispatch!.state);
  const editable = focused && !focus.results[0].dispatch!.outboundMessageId && ['needs-recipient', 'needs-content', 'draft', 'needs-model', 'paused'].includes(focus.results[0].dispatch!.state);
  const retryable = focused && ['reply-failed', 'reply-unavailable', 'interrupted'].includes(focus.results[0].dispatch!.state);
  if (!parsed && awaiting && !control && !confirm && !readReply && !edit && (lightConversation(message.content)
    || /^(?:请|帮我|给我|替我|麻烦)?(?:记上|记一下|添加|新增|创建|写|查|找|打开|带我|修改|取消|完成).*(?:待办|日记|手账|朋友圈|提醒|日程|记忆|页面)|^(?:帮我|替我|给我)(?:记上|记下来)/u.test(message.content))) {
    const current = (await db.secretaryTasks.get(focus!.id))!;
    const d = resultOf(current).dispatch!;
    d.resumeState = d.state; d.state = 'paused'; d.approvedRevision = undefined;
    await persist(current);
    return undefined;
  }
  const activeControl = control && focused && !['replied', 'cancelled', 'invalid'].includes(focus.results[0].dispatch!.state);
  const isFollowup = !parsed && focused && (activeControl || readReply || retry && retryable || edit && editable || confirm && awaiting || awaiting && !nonFieldAnswer(message.content));
  if (!parsed && !isFollowup) return undefined;
  const taskId = `secretary-task:${userId}:${message.id}`;
  const outcome = await exclusive(`request:${taskId}`, async () => {
    const existing = await db.secretaryTasks.get(taskId);
    if (existing) {
      if (existing.request !== message.content) throw new Error('原请求已修改，请作为新消息发送。');
      return existing; // A repeated UI submission never repeats the operation.
    }
    if (isFollowup && focus && focused) {
      return exclusive(focus.id, async () => {
        const current = (await db.secretaryTasks.get(focus.id))!;
        const d = await assertSources(current), result = resultOf(current);
        if (control === 'cancel') {
          if (d.outboundMessageId) { if (d.state !== 'replied') { running.get(current.id)?.controller.abort(); if (running.has(current.id)) d.stopRequested = true; else d.state = 'interrupted'; } }
          else { d.state = 'cancelled'; d.approvedRevision = undefined; running.get(current.id)?.controller.abort(); }
        } else if (control === 'pause') {
          if (d.outboundMessageId) { if (d.state !== 'replied') { running.get(current.id)?.controller.abort(); if (running.has(current.id)) d.stopRequested = true; else d.state = 'interrupted'; } }
          else { d.resumeState = d.state; d.state = 'paused'; d.approvedRevision = undefined; }
        } else if (control === 'resume' && d.state === 'paused') {
          d.state = nextState(result);
        } else if (readReply) {
          // Read only. No model call and no resend.
        } else if (retry && d.outboundMessageId) {
          // A partial real reply must remain intact. Never create another outbound.
          if (!d.replyMessageIds.length) { d.state = 'queued'; d.error = undefined; }
        } else if (edit && !d.outboundMessageId) {
          const paused = d.state === 'paused';
          if (edit.recipient) {
            d.recipientId = undefined; d.recipientName = undefined; d.recipientVersion = undefined;
            d.targetSessionId = undefined; d.approvedRevision = undefined; d.draftRevision++; d.error = undefined;
            await findRecipient(result, userId, edit.recipient);
          } else changeBody(result, edit.content ?? [result.action.content, edit.append].filter(Boolean).join('\n'), 'edited');
          d.state = paused ? 'paused' : nextState(result);
        } else if (d.state === 'needs-recipient') {
          const choice = conversationChoice(message.content, d.candidates?.length ?? 0);
          const candidate = choice ? d.candidates?.[choice - 1] : undefined;
          await findRecipient(result, userId, candidate?.id ?? message.content);
          if (d.recipientId && d.bodyOrigin === 'literal' && result.action.content) d.approvedRevision = d.draftRevision;
          d.state = nextState(result);
        } else if (d.state === 'needs-content') {
          const body = message.content.match(/^(?:正文|内容)(?:是)?[：:，,\s]+([\s\S]+)$/u)?.[1] ?? message.content;
          changeBody(result, body, 'literal'); d.approvedRevision = d.draftRevision;
          d.state = nextState(result);
        } else if (d.state === 'draft' && confirm) {
          d.approvedRevision = d.draftRevision; d.state = nextState(result);
        } else if (d.state === 'draft') return undefined;
        d.sources.push(sourceOf(message));
        d.receiptTaskIds = [...(d.receiptTaskIds ?? []), taskId];
        await persist(current);
        const receiptTask: SecretaryTask = { ...current, id: taskId, sessionId: message.sessionId, messageId: message.id, request: message.content, createdAt: Date.now(), updatedAt: Date.now() };
        await db.secretaryTasks.put(receiptTask);
        await persist(current);
        return (await db.secretaryTasks.get(taskId))!;
      });
    }
    if (!parsed) return undefined;
    if ((parsed.body?.length ?? 0) > 6000) throw new Error('消息正文最多6000字。');
    const now = Date.now();
    const task: SecretaryTask = { id: taskId, userId, characterId: assistant.id, sessionId: message.sessionId, messageId: message.id, request: message.content,
      employmentId: binding?.employmentId ?? assistant.secretaryEmploymentId ?? `legacy:${assistant.id}`, assistantName: assistant.name,
      personality: secretaryPersonality(assistant.secretaryPersonality), privacyScope: 'plain', status: 'finished', createdAt: now, updatedAt: now, results: [{ action: { kind: 'character.message.send', content: parsed.body }, status: 'needs-input', label: '角色代发消息',
        dispatch: { taskId, state: 'needs-recipient', bodyOrigin: parsed.compose ? 'composed' : 'literal', draftRevision: 1, replyMessageIds: [], sources: [sourceOf(message)] } }] };
    const result = resultOf(task), d = result.dispatch!;
    // A pronoun may refer only to this assistant's explicit dispatch focus.
    const recipient = /^[她他]$/u.test(parsed.recipient) && focused ? focus.results[0].dispatch!.recipientId ?? parsed.recipient : parsed.recipient;
    await findRecipient(result, userId, recipient);
    if (result.action.content && d.recipientId) d.approvedRevision = d.draftRevision;
    d.state = nextState(result);
    if (parsed.compose && d.recipientId) d.state = 'draft';
    await persist(task);
    await db.transaction('rw', [db.secretaryBindings, db.secretaryTasks], async () => {
      const currentBinding = await db.secretaryBindings.get(userId);
      const pending = currentBinding?.pendingFocusTaskId ? await db.secretaryTasks.get(currentBinding.pendingFocusTaskId) : undefined;
      if (pending?.userId === userId && pending.characterId === assistant.id && pending.pendingContext?.state === 'waiting') {
        await db.secretaryTasks.update(pending.id, { pendingContext: { ...pending.pendingContext, state: 'paused' }, updatedAt: Math.max(Date.now(), pending.updatedAt + 1) });
      }
      await db.secretaryBindings.update(userId, { dispatchFocusTaskId: taskId });
    });
    if (parsed.compose) {
      try {
        await draftBody(task, assistant, parsed.prompt ?? message.content);
        const fresh = await db.secretaryTasks.get(taskId);
        if (!fresh || fresh.updatedAt !== task.updatedAt) return fresh;
        d.state = nextState(result); await persist(task);
      } catch (cause) {
        const fresh = await db.secretaryTasks.get(taskId);
        if (!fresh || fresh.updatedAt !== task.updatedAt) return fresh;
        const sourceChanged = cause instanceof Error && /原请求已|账号已|助理已/u.test(cause.message);
        d.state = sourceChanged ? 'invalid' : 'draft'; d.error = sourceChanged ? '原请求或助理任期已变化，拟稿已停止。' : '拟稿未能生成，请编辑正文后发送。'; await persist(task);
      }
    }
    if (d.state === 'queued') await deliverCharacterMessage(userId, taskId);
    return (await db.secretaryTasks.get(taskId))!;
  });
  if (outcome?.results[0]?.dispatch?.state === 'queued') {
    await deliverCharacterMessage(userId, outcome.results[0].dispatch.taskId);
    return (await db.secretaryTasks.get(taskId))!;
  }
  return outcome;
}

/** Explicit UI approval is bound to the currently displayed revision. */
export async function updateCharacterDispatch(userId: string, taskId: string, expectedVersion: number,
  patch: { recipientId?: string; content?: string; send?: boolean; cancel?: boolean; pause?: boolean; resume?: boolean; model?: { provider: string; model: string } | null }): Promise<SecretaryTask> {
  const updated = await exclusive(taskId, async () => {
    const task = await db.secretaryTasks.get(taskId);
    if (!task || task.userId !== userId || task.updatedAt !== expectedVersion) throw new Error('卡片已变化，请查看最新内容再操作。');
    const d = await assertSources(task), result = resultOf(task);
    if (patch.cancel || patch.pause && (d.outboundMessageId || d.state === 'queued')) {
      if (['replied', 'cancelled', 'invalid'].includes(d.state)) return task;
      running.get(taskId)?.controller.abort();
      if (d.outboundMessageId) { if (running.has(taskId)) d.stopRequested = true; else d.state = 'interrupted'; }
      else { d.resumeState = d.state; d.state = patch.cancel ? 'cancelled' : 'paused'; d.approvedRevision = undefined; }
      return persist(task);
    }
    if (['replied', 'queued', 'generating', 'cancelled', 'invalid'].includes(d.state)) throw new Error('这条消息已经处理，请查看最新进展。');
    if (d.outboundMessageId && (patch.content != null || patch.recipientId != null)) throw new Error('已记录的消息不能在重试时更改或重复发送。');
    if (patch.recipientId != null) {
      if (!patch.recipientId && !patch.send) {
        d.recipientId = undefined; d.recipientName = undefined; d.recipientVersion = undefined;
        d.targetSessionId = undefined; d.candidates = undefined; d.draftRevision++; d.approvedRevision = undefined;
      } else {
        const recipient = (await messagingRecipients(userId)).find(c => c.id === patch.recipientId);
        if (!recipient) throw new Error('请选择你已添加的普通角色。');
        if (d.recipientId !== recipient.id || d.recipientVersion !== recipientVersion(recipient)) setRecipient(result, recipient);
      }
    }
    if (patch.content != null && patch.content !== result.action.content) {
      changeBody(result, patch.content, 'edited');
    }
    if (patch.pause) { d.resumeState = nextState(result); d.state = 'paused'; d.approvedRevision = undefined; return persist(task); }
    if (patch.send) {
      if (d.outboundMessageId && d.replyMessageIds.length) throw new Error('已有实际回复，补充内容请发新消息；不会覆盖已有回复。');
      if (d.outboundMessageId) { d.state = 'queued'; }
      else { if (!result.action.content?.trim()) throw new Error('请先填写要发送的正文。'); await assertTarget(task); d.approvedRevision = d.draftRevision; d.state = nextState(result); }
    } else if (!d.outboundMessageId && (d.state !== 'paused' || patch.resume)) {
      // Saving and resuming are not approvals, even when the original text was literal.
      d.approvedRevision = undefined; d.state = nextState(result);
    }
    if (patch.model !== undefined) {
      // Recipient edits and explicit model selection refer to the same final target.
      // Save model and approval together; a stale card must not change either one.
      return db.transaction('rw', db.tables, async () => {
        const fresh = await db.secretaryTasks.get(taskId);
        if (!fresh || fresh.updatedAt !== expectedVersion) throw new Error('卡片已变化，请查看最新内容再操作。');
        const target = await assertTarget(task);
        if (!d.targetSessionId) {
          const existing = (await sessionRepo.getByCharacter(target.id, userId)).find(s => s.type !== 'group');
          d.targetSessionId = existing?.id ?? crypto.randomUUID();
          if (!existing) await db.sessions.add({ id: d.targetSessionId, userId, characterId: target.id, title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0, modelAsked: false });
        }
        await sessionRepo.update(d.targetSessionId, { model: patch.model ?? undefined, modelAsked: true });
        const saved = await persist(task);
        if (useAuthStore.getState().userId !== userId) throw new Error('账号已切换，代发已停止。');
        return saved;
      });
    }
    return persist(task);
  });
  if (resultOf(updated).dispatch!.state === 'queued') return deliverCharacterMessage(userId, taskId);
  return updated;
}

export async function deliverCharacterMessage(userId: string, taskId: string): Promise<SecretaryTask> {
  const ongoing = running.get(taskId);
  if (ongoing) return ongoing.promise;
  const controller = new AbortController();
  const promise = Promise.resolve().then(async () => {
    let task = (await db.secretaryTasks.get(taskId))!;
    if (!task || task.userId !== userId) throw new Error('没有找到代发记录。');
    const d = await assertSources(task), result = resultOf(task);
    if (d.state !== 'queued') return task;
    try {
      let recipient = await assertTarget(task, !d.outboundMessageId);
      if (!d.targetSessionId) {
        await db.transaction('rw', [db.sessions, db.secretaryTasks], async () => {
          const fresh = await db.secretaryTasks.get(taskId);
          if (!fresh || fresh.updatedAt !== task.updatedAt || resultOf(fresh).dispatch!.state !== 'queued') throw new Error('代发进展已变化。');
          const sessions = await sessionRepo.getByCharacter(recipient.id, userId);
          const existing = sessions.find(s => s.type !== 'group');
          if (existing) d.targetSessionId = existing.id;
          else {
            const id = crypto.randomUUID();
            await db.sessions.add({ id, userId, characterId: recipient.id, title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0, modelAsked: false });
            d.targetSessionId = id;
          }
          await db.secretaryTasks.put(task);
          if (useAuthStore.getState().userId !== userId || controller.signal.aborted) throw new Error('代发已停止。');
        });
      }
      const session = (await db.sessions.get(d.targetSessionId!))!;
      if (!session.modelAsked && !session.model) { d.state = 'needs-model'; return persist(task); }
      await persist(task);
      await withChatSessionLock(session.id, async () => {
        // Reread after waiting: a cancelled queue item must not create even one message.
        task = (await db.secretaryTasks.get(taskId))!;
        let current = resultOf(task).dispatch!;
        if (controller.signal.aborted || current.state !== 'queued') return;
        recipient = await assertTarget(task, !current.outboundMessageId);
        if (current.outboundMessageId && current.replyMessageIds.length) throw new Error('已有实际回复，请查看原文；补充内容请发新消息。');
        if (!current.outboundMessageId && current.approvedRevision !== current.draftRevision) throw new Error('文案或收件人已经变化，请重新确认。');
        const messageId = current.outboundMessageId ?? `secretary-dispatch:${taskId}`;
        let claimed = false;
        await db.transaction('rw', db.tables, async () => {
          task = (await db.secretaryTasks.get(taskId))!; current = resultOf(task).dispatch!;
          await assertTarget(task, !current.outboundMessageId);
          if (controller.signal.aborted || current.state !== 'queued') return;
          if (!current.outboundMessageId) {
            if (!resultOf(task).action.content?.trim()) throw new Error('正文还没有填写。');
          await messageRepo.create({ id: messageId, sessionId: session.id, role: 'user', content: resultOf(task).action.content!, createdAt: Date.now(), isProactive: false,
              secretaryDispatch: { taskId, assistantName: task.assistantName ?? '助理', bodyOrigin: current.bodyOrigin } });
            current.outboundMessageId = messageId;
          }
          const outbound = await db.messages.get(messageId);
          if (!outbound || outbound.sessionId !== session.id || outbound.secretaryDispatch?.taskId !== taskId || outbound.content !== resultOf(task).action.content) throw new Error('原消息已修改或删除，不能重试。');
          current.attemptId = crypto.randomUUID(); current.leaseUntil = Date.now() + 180_000; current.state = 'generating'; current.error = undefined; current.stopRequested = false;
          claimed = true;
          await db.secretaryTasks.put(task);
          if (useAuthStore.getState().userId !== userId || controller.signal.aborted) throw new Error('代发已停止。');
        });
        if (!claimed || controller.signal.aborted || (current.state as DispatchState) !== 'generating') return;
        await persist(task);
        const attemptId = current.attemptId;
        const userMessage = (await db.messages.get(messageId))!;
        const validate = async () => {
          const fresh = await db.secretaryTasks.get(taskId);
          if (!fresh || fresh.userId !== userId || resultOf(fresh).dispatch!.attemptId !== attemptId || resultOf(fresh).dispatch!.state !== 'generating') throw new Error('代发进展已变化，旧回复已停止。');
          await assertTarget(fresh);
          const actual = await db.messages.get(messageId);
          if (!actual || actual.content !== userMessage.content || (actual.revision ?? 1) !== (userMessage.revision ?? 1)) throw new Error('消息已修改或删除，旧回复已停止。');
        };
        const activeSession = await db.sessions.get(session.id);
        if (!canUseAi(resolveModel(recipient, activeSession?.model))) throw new Error('model:unavailable');
        const request: ChatRequest = { controller, userId, stopped: false, completed: false, stream: new ChatReplyStream(session.id, () => undefined) };
        try { await sendRoleChatReply(recipient, userMessage, request, { userId, text: userMessage.content, validate }); }
        finally { request.stream.dispose(); }
        const fresh = await db.secretaryTasks.get(taskId);
        if (!fresh || fresh.userId !== userId) return;
        task = fresh; current = resultOf(task).dispatch!;
        if (current.attemptId !== attemptId) return;
        const replies = (await db.messages.where('replyToUserMessageId').equals(messageId).sortBy('createdAt')).filter(m => m.sessionId === session.id && m.role === 'assistant' && m.secretaryDispatch?.taskId === taskId);
        current.replyMessageIds = replies.map(m => m.id);
        current.leaseUntil = undefined;
        current.state = replies.length ? replies.some(m => m.interrupted) || controller.signal.aborted ? 'interrupted' : 'replied' : controller.signal.aborted ? 'interrupted' : 'reply-failed';
        // Reading the relay card must not clear target-chat unread.
        if (replies.length && useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId !== session.id) {
          const s = await db.sessions.get(session.id);
          if (s) await db.sessions.update(session.id, { unreadCount: (s.unreadCount ?? 0) + replies.length, updatedAt: Date.now() });
        }
        await persist(task);
        if (useAuthStore.getState().userId === userId) void useChatStore.getState().refreshPreviews();
      });
      return (await db.secretaryTasks.get(taskId))!;
    } catch (cause) {
      const fresh = await db.secretaryTasks.get(taskId);
      if (!fresh || fresh.userId !== userId) return task;
      task = fresh; const current = resultOf(task).dispatch!;
      // Never overwrite an explicit cancel/pause or newer completed state.
      if (['queued', 'generating'].includes(current.state)) {
        const reason = cause instanceof Error ? cause.message : '';
        const sourceChanged = /原请求已|账号已|助理已|消息已修改或删除|原消息已修改或删除|代发来源不完整/u.test(reason);
        current.state = sourceChanged ? 'invalid' : current.outboundMessageId ? reason === 'model:unavailable' ? 'reply-unavailable' : 'reply-failed'
          : /角色资料已变化/u.test(reason) ? 'draft' : /目标角色已不可用/u.test(reason) ? 'needs-recipient' : 'invalid';
        if (current.outboundMessageId && current.targetSessionId) current.replyMessageIds = (await db.messages.where('replyToUserMessageId').equals(current.outboundMessageId).toArray())
          .filter(m => m.sessionId === current.targetSessionId && m.role === 'assistant' && m.secretaryDispatch?.taskId === taskId).map(m => m.id);
        if (current.state === 'needs-recipient') { current.recipientId = undefined; current.recipientVersion = undefined; current.targetSessionId = undefined; current.approvedRevision = undefined; }
        if (current.state === 'draft') current.approvedRevision = undefined;
        current.leaseUntil = undefined;
        current.error = current.state === 'draft' || current.state === 'needs-recipient' ? '请重新核对收件角色和正文，原内容仍保留。' : '办理未能继续，请检查角色、原请求和模型连接。';
        await persist(task);
      }
      return task;
    }
  });
  running.set(taskId, { userId, controller, promise });
  try { return await promise; } finally { if (running.get(taskId)?.promise === promise) running.delete(taskId); }
}

/** Restart recovery is data-only: never sends or calls a model on its own. */
export async function recoverCharacterDispatches(userId: string, characterId: string): Promise<number | undefined> {
  if (useAuthStore.getState().userId !== userId) return;
  const tasks = await db.secretaryTasks.where('[userId+characterId+createdAt]').between([userId, characterId, 0], [userId, characterId, Infinity]).toArray();
  let nextLease: number | undefined;
  for (const task of tasks) {
    const d = task.results[0]?.dispatch;
    if (!d || d.taskId !== task.id || running.has(task.id) || !['queued', 'generating'].includes(d.state)) continue;
    if (d.state === 'generating' && (d.leaseUntil ?? 0) > Date.now()) { nextLease = Math.min(nextLease ?? Infinity, d.leaseUntil!); continue; }
    if (d.outboundMessageId && d.targetSessionId) {
      const rows = (await db.messages.where('replyToUserMessageId').equals(d.outboundMessageId).sortBy('createdAt')).filter(m => m.sessionId === d.targetSessionId && m.role === 'assistant' && m.secretaryDispatch?.taskId === task.id);
      d.replyMessageIds = rows.map(m => m.id);
      d.state = rows.length && !rows.some(m => m.interrupted) ? 'replied' : 'interrupted';
    } else { d.state = 'paused'; d.approvedRevision = undefined; }
    d.leaseUntil = undefined; await persist(task);
  }
  return nextLease;
}

/** Cards display only currently owned persisted reply rows, not model-supplied snapshots. */
export async function readCharacterDispatchReplies(userId: string, taskId: string): Promise<Message[]> {
  const task = await db.secretaryTasks.get(taskId);
  if (!task || task.userId !== userId || useAuthStore.getState().userId !== userId) return [];
  const d = task.results[0]?.dispatch;
  if (!d?.targetSessionId || !d.outboundMessageId) return [];
  const [session, character, rows] = await Promise.all([db.sessions.get(d.targetSessionId), d.recipientId ? db.characters.get(d.recipientId) : undefined, db.messages.bulkGet(d.replyMessageIds)]);
  if (!session || session.userId !== userId || session.characterId !== d.recipientId || !character || character.createdBy !== userId || character.agentProfile === 'secretary') return [];
  return rows.filter((m): m is Message => !!m && m.sessionId === session.id && m.role === 'assistant' && m.replyToUserMessageId === d.outboundMessageId && m.secretaryDispatch?.taskId === taskId);
}

/** Employment changes stop local workers and invalidate approval; sent history stays intact. */
export async function stopCharacterDispatches(userId: string, characterId: string): Promise<void> {
  running.forEach(request => { if (request.userId === userId) request.controller.abort(); });
  const tasks = await db.secretaryTasks.where('[userId+characterId+createdAt]').between([userId, characterId, 0], [userId, characterId, Infinity]).toArray();
  for (const task of tasks) {
    const d = task.results[0]?.dispatch;
    if (!d || d.taskId !== task.id || ['replied', 'cancelled', 'invalid'].includes(d.state)) continue;
    d.approvedRevision = undefined; d.leaseUntil = undefined;
    d.state = d.outboundMessageId ? 'interrupted' : 'paused';
    await persist(task);
  }
}
