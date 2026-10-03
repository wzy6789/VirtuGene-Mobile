import { db, type Message } from '../../db';
import type { SecretaryAction, SecretaryTask, SecretaryResult } from './types';
import type { SecretaryMissingField } from './planning-contract';
import { parseScheduleAnswer, parseTodoEditCommand, resolveSecretaryFollowup } from './followup';
import { addLocalDays, localDateKey } from '../../db/todo-repo';
import { conversationControl, conversationChoice, conversationOperationAnswer, nonFieldAnswer } from './conversation';
import { SECRETARY_DESTINATIONS } from './capabilities';
import { memorySourceTombstoneRepo } from '../../db/memory-source-tombstone-repo';

export interface SecretaryPendingContext {
  state: 'waiting' | 'paused' | 'ready' | 'finished' | 'invalid' | 'cancelled';
  /** Relative answers are interpreted against this saved date, including after midnight. */
  referenceDate?: string;
  conflict?: { field: 'date' | 'time'; choices: string[] };
  /** Local ambiguity prompt only; never model-supplied instructions. */
  answerNotice?: string;
  resultIndex?: number;
  expectedTargetVersion?: number;
  candidates?: SecretaryResult['candidates'];
  confirmation?: boolean;
  publicationApproved?: boolean;
  targetQueryMissing?: boolean;
  operationChoices?: { index: number; label: string }[];
  originTaskId: string;
  employmentId?: string;
  knownAction: SecretaryAction;
  purpose?: 'todo' | 'diary';
  body: string;
  awaitingFields: SecretaryMissingField[];
  sources: { taskId: string; messageId: string; sessionId: string; revision: number }[];
}

export { ambiguousRecordRequest } from './intent';
import { ambiguousRecordRequest } from './intent';

function sourceRef(task: SecretaryTask, message: Message) {
  return { taskId: task.id, messageId: message.id, sessionId: message.sessionId, revision: message.revision ?? 1 };
}

/** Only explicit settings of the held todo, with every clause recognised locally. */
function pendingTodoSettings(text: string, referenceDate: string): Partial<SecretaryAction> | undefined {
  const settings = (value: string) => /^(?:(?:不用|不要|别|不|关闭|取消|关掉)提醒(?:我)?(?:了)?(?:[，,]?(?:只|仅)(?:记录|记(?:成|为)?待办|保存))?|(?:只|仅)(?:记录|记(?:成|为)?待办|保存)(?:[，,]?(?:不用|不要|别|不)提醒(?:我)?(?:了)?)?)$/u.test(value)
    ? { reminder: false, reminderMinutes: [] } : parseTodoEditCommand(value, referenceDate);
  const permitted = (patch: Partial<SecretaryAction> | undefined) => patch && !patch.kind && Object.keys(patch).every(field => ['recurrence', 'reminder', 'reminderMinutes', 'priority', 'intervalDays'].includes(field));
  const whole = settings(text);
  if (permitted(whole)) return whole;
  const clauses = text.split(/[，,；;]/u).map(clause => clause.trim());
  if (clauses.length < 2 || clauses.length > 4 || clauses.some(clause => !clause)) return;
  let changedSetting = false;
  const merged: Partial<SecretaryAction> = {};
  for (const clause of clauses) {
    const setting = settings(clause);
    const patch: Partial<SecretaryAction> | undefined = permitted(setting) ? setting : parseScheduleAnswer(clause, referenceDate);
    if (!patch) return;
    changedSetting ||= !!permitted(setting);
    for (const field of Object.keys(patch) as (keyof SecretaryAction)[]) {
      if (field in merged && JSON.stringify(merged[field]) !== JSON.stringify(patch[field])) return;
    }
    Object.assign(merged, patch);
  }
  return changedSetting ? merged : undefined;
}

function missing(context: SecretaryPendingContext): SecretaryMissingField[] {
  if (context.resultIndex != null) {
    const a = context.knownAction;
    if (a.kind === 'app.open') return a.destination ? [] : ['destination'];
    if ((a.kind === 'todo.create' || a.kind === 'todo.update') && a.recurrence === 'interval' && !a.intervalDays) return ['intervalDays'];
    if (context.candidates?.length && !a.targetId) return ['target'];
    if (context.targetQueryMissing) return ['query'];
    if (['diary.save', 'moment.draft', 'moment.publish'].includes(a.kind) && !a.content) return ['content'];
    if (a.kind === 'moment.publish' && !a.visibility) return ['audience'];
    if (a.kind === 'todo.reschedule') return a.date ? [] : ['date'];
    if (a.kind.endsWith('.search') && !a.query) return ['query'];
    if (a.kind.startsWith('todo.') && a.kind !== 'todo.create') return a.kind === 'todo.update' && a.reminder ? [...(!a.date ? ['date' as const] : []), ...(!a.time ? ['time' as const] : [])] : [];
  }
  if (!context.purpose) return ['purpose'];
  if (context.purpose === 'diary') return context.knownAction.content ? [] : ['content'];
  const action = context.knownAction;
  const needsDate = action.reminder || action.time || action.recurrence && action.recurrence !== 'none';
  return [...(!action.title ? ['title' as const] : []), ...(needsDate && !action.date ? ['date' as const] : []), ...(action.reminder && !action.time ? ['time' as const] : [])];
}

/** Capture the execution-generated question, not an unvalidated model's missing-field guess. */
export function contextFromResult(task: SecretaryTask, message: Message, index: number): SecretaryPendingContext {
  const result = task.results[index];
  const context: SecretaryPendingContext = { state: 'waiting', originTaskId: task.id, employmentId: task.employmentId,
    knownAction: { ...result.action, ...(result.candidates?.length ? { targetId: undefined } : {}) }, resultIndex: index,
    purpose: result.action.kind.startsWith('todo.') ? 'todo' : 'diary', body: '', referenceDate: localDateKey(new Date(message.createdAt)),
    awaitingFields: [], sources: [sourceRef(task, message)], candidates: result.candidates,
    expectedTargetVersion: result.expectedTargetVersion, confirmation: result.status === 'draft', publicationApproved: result.publicationApproved,
    targetQueryMissing: result.action.kind.startsWith('todo.') && result.action.kind !== 'todo.create' && result.detail === '没找到对应待办，请告诉我待办里的名称。' };
  context.awaitingFields = missing(context);
  if (/时间已经过去/u.test(result.detail ?? '')) context.awaitingFields = ['date', 'time'];
  return context;
}

export function contextFromOperations(task: SecretaryTask, message: Message, indices: number[]): SecretaryPendingContext | undefined {
  const choices = indices.map(index => ({ index, context: contextFromResult(task, message, index) }))
    .filter(choice => choice.context.awaitingFields.length || choice.context.confirmation);
  if (!choices.length) return;
  if (choices.length === 1) return choices[0].context;
  return { ...choices[0].context, resultIndex: undefined, confirmation: false, awaitingFields: ['operation'],
    operationChoices: choices.map(({ index }) => ({ index, label: `${task.results[index].label} · ${task.results[index].action.title ?? task.results[index].action.query ?? '待补充内容'}` })) };
}

/** A zero-tool clarification becomes data, never a guessed write operation. */
export function createPendingContext(task: SecretaryTask, message: Message): SecretaryPendingContext | undefined {
  const referenceDate = localDateKey(new Date(message.createdAt));
  const purposeMissing = ambiguousRecordRequest(task.request);
  const reminder = /(?:提醒我|记得叫我(?:一声)?)/u.test(task.request) && !/[“”「」]|不要|不用|不必|别叫|先不|不提醒|只记录|不是|转述|小说|他说|她说/u.test(task.request);
  if (!purposeMissing && !reminder) return undefined;
  let body = purposeMissing ? task.request.trim().replace(/^(?:请|帮我|给我|替我|麻烦)?(?:给我|帮我)?记一[笔筆][：:，,\s]*/u, '') : task.request.trim().replace(/[，,]?\s*(?:记得叫我(?:一声)?|(?:帮我)?提醒我)[。！!]?$/u, '');
  body = body.replace(/^(?:请|帮我)?提醒我[：:，,\s]*/u, '').replace(/[。！!]+$/u, '').trim();
  if (body === task.request && /[“”「」]/u.test(body)) return undefined;
  const datePrefix = body.match(/^(今天|明天|后天|大后天)/u);
  const date = datePrefix && !/之前|以前|截止/u.test(body) && (body.match(/今天|明天|大?后天/gu)?.length ?? 0) === 1 ? addLocalDays(referenceDate, { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[datePrefix[1]]!) : undefined;
  const timePrefix = body.replace(/^(今天|明天|后天|大后天)/u, '').match(/^(?:凌晨|早上|上午|中午|下午|晚上)(?:\d{1,2}|[一二两三四五六七八九十]{1,3})(?::\d{2}|[点时](?:半|一刻|三刻|(?:\d{1,2}|[零一二两三四五六七八九十]{1,3})分?)?)/u);
  const time = timePrefix ? parseScheduleAnswer(timePrefix[0], referenceDate)?.time : undefined;
  let title = body.replace(/^(今天|明天|后天|大后天)/u, '');
  if (timePrefix) title = title.slice(timePrefix[0].length);
  title = title.replace(/^[的，,\s]+/u, '').trim();
  const context: SecretaryPendingContext = { state: 'waiting', originTaskId: task.id, employmentId: task.employmentId,
    knownAction: { kind: 'todo.create', ...(title ? { title: title.slice(0, 120) } : {}), ...(date ? { date } : {}), ...(time ? { time } : {}), ...(reminder ? { reminder: true } : {}) },
    purpose: purposeMissing ? undefined : 'todo', body, awaitingFields: [], sources: [sourceRef(task, message)] };
  context.referenceDate = referenceDate;
  context.awaitingFields = missing(context);
  // Only hold genuinely missing fields; never invent a clarification for complete requests.
  return context.awaitingFields.length ? context : undefined;
}

export async function assertPendingSources(task: SecretaryTask): Promise<void> {
  const context = task.pendingContext;
  if (!context) return;
  if (context.employmentId !== task.employmentId) throw new Error('助理已更换，请从原记录手动接续这件事。');
  if (!Array.isArray(context.sources) || context.sources.length > 12) throw new Error('补充信息较多，请重新整理这次安排。');
  const suppressed = await memorySourceTombstoneRepo.suppressedMessages(task.userId, task.characterId);
  for (const ref of context.sources) {
    if (suppressed.has(ref.messageId)) throw new Error('这件事的来源已被忘记，请重新告诉我。');
    const [source, origin, session] = await Promise.all([db.messages.get(ref.messageId), db.secretaryTasks.get(ref.taskId), db.sessions.get(ref.sessionId)]);
    if (!origin || origin.userId !== task.userId || origin.characterId !== task.characterId || origin.messageId !== ref.messageId
      || !source || source.role !== 'user' || source.failed || source.sessionId !== ref.sessionId || source.content !== origin.request || (source.revision ?? 1) !== ref.revision
      || session?.userId !== task.userId || session.characterId !== task.characterId || session.type === 'group') throw new Error('原请求或补充信息已修改、删除或撤回，请重新告诉我。');
    if (await memorySourceTombstoneRepo.blocksImport({ userId: task.userId, sourceType: 'message', sourceId: source.id, sourceRevision: ref.revision })) throw new Error('原请求的来源已撤回，请重新告诉我。');
  }
}

export async function answerPendingContext(prior: SecretaryTask, task: SecretaryTask, message: Message): Promise<SecretaryPendingContext | undefined> {
  const current = prior.pendingContext;
  if (!current || !['waiting', 'paused'].includes(current.state)) return undefined;
  const receivedText = message.content.trim().replace(/[。！!]+$/u, '');
  const inlineResume = receivedText.match(/^(?:继续|接着|恢复)(?:处理|弄|办)?(?:刚才(?:那个|那件事))?[，,:：\s]+(.+)$/u);
  const text = inlineResume?.[1] ?? receivedText;
  const control = conversationControl(text) ?? (inlineResume ? 'resume' : undefined);
  if (control === 'cancel') return { ...current, state: 'cancelled', conflict: undefined, sources: [...current.sources, sourceRef(task, message)] };
  if (control === 'pause') return { ...current, state: 'paused', sources: [...current.sources, sourceRef(task, message)] };
  if (current.state === 'paused' && control !== 'resume') return undefined;
  const context: SecretaryPendingContext = { ...current, answerNotice: undefined, knownAction: { ...current.knownAction }, sources: [...current.sources, sourceRef(task, message)] };
  if (current.state === 'paused') { context.state = 'waiting'; if (!inlineResume) return context; }
  if (control === 'resume' && !inlineResume || nonFieldAnswer(text)) return { ...context, sources: current.sources };
  if (current.knownAction.kind === 'todo.create' && !current.awaitingFields.includes('operation')) {
    const edit = pendingTodoSettings(text, current.referenceDate ?? localDateKey());
    if (edit) {
      context.knownAction = { ...context.knownAction, ...edit };
      context.awaitingFields = missing(context);
      if (context.conflict && (edit[context.conflict.field] != null || context.conflict.field === 'time' && edit.reminder === false && !context.knownAction.time)) context.conflict = undefined;
      context.state = context.awaitingFields.length || context.conflict ? 'waiting' : 'ready';
      return context;
    }
  }
  // A negative directive may be a cancellation or a literal title. Holding it is
  // safer than treating every unrecognised short reply as permission to write.
  if (current.awaitingFields.some(f => f === 'title' || f === 'content') && /^(?:不用|不要|不必|不需要|别|先别|先不|暂时不)/u.test(text)) {
    // A separate work instruction still belongs to normal planning, including
    // its denial checks. Do not swallow it as an answer to the earlier title.
    if (/待办|日记|朋友圈|提醒|记上|记一[笔篇]|保存|发布|删除|改期/u.test(text)) return undefined;
    return { ...context, sources: current.sources, answerNotice: current.awaitingFields.includes('title')
      ? '这是要取消这件事，还是待办的名称？可以说“取消这件事”，或“标题是……”再写名称。'
      : '这是要取消记录，还是想保存的正文？可以说“取消这件事”，或“正文是……”再写内容。' };
  }
  if (current.conflict) {
    const selected = conversationChoice(text, current.conflict.choices.length);
    if (selected != null) {
      context.knownAction[current.conflict.field] = current.conflict.choices[selected - 1];
      context.conflict = undefined;
      context.awaitingFields = missing(context);
      context.state = context.awaitingFields.length ? 'waiting' : 'ready';
      return context;
    }
    if (/^(?:选|选择|就|用|要)?第?[一二两三四五六七八九十\d]+(?:个|项|条|种)?(?:那个)?[。！!]?$/u.test(text)) return context;
  }
  if (current.awaitingFields.includes('operation')) {
    const combined = conversationOperationAnswer(text, current.operationChoices?.length ?? 0);
    const n = combined?.choice ?? 0;
    const selected = current.operationChoices?.[n - 1];
    if (combined && !selected) return { ...context, sources: current.sources, answerNotice: '请从当前显示的事项中选择，其他事项不会被修改。' };
    if (!selected && (pendingTodoSettings(text, current.referenceDate ?? localDateKey()) || parseScheduleAnswer(text, current.referenceDate ?? localDateKey())))
      return { ...context, sources: current.sources, answerNotice: '这几件事都还缺信息，先选要补充哪一项。也可以说“第二个，下午三点”。' };
    if (!selected && /^(?:选|选择|就|用|要)?第?[一二两三四五六七八九十\d]+(?:个|项|条|种)?(?:那个)?$/u.test(text)) return context;
    const origin = prior.id === current.originTaskId ? prior : await db.secretaryTasks.get(current.originTaskId);
    const result = selected && origin?.userId === task.userId && origin.characterId === task.characterId ? origin.results[selected.index] : undefined;
    if (!selected || !result || !['needs-input', 'draft'].includes(result.status)) return undefined;
    const choice = { ...context, resultIndex: selected.index, operationChoices: undefined, knownAction: { ...result.action },
      candidates: result.candidates, expectedTargetVersion: result.expectedTargetVersion, confirmation: result.status === 'draft', publicationApproved: result.publicationApproved,
      targetQueryMissing: result.detail === '没找到对应待办，请告诉我待办里的名称。' };
    choice.awaitingFields = missing(choice); choice.state = choice.awaitingFields.length || choice.confirmation ? 'waiting' : 'ready';
    if (combined?.answer) {
      const answered = await answerPendingContext({ ...prior, pendingContext: { ...choice, sources: current.sources } }, task, { ...message, content: combined.answer });
      return answered ?? { ...choice, answerNotice: `已选中${choice.knownAction.title ?? result.label}。${pendingQuestion(choice)}` };
    }
    return choice;
  }
  if (current.resultIndex != null && prior.sessionId === task.sessionId && resolveSecretaryFollowup(prior, message.content, current.referenceDate ?? localDateKey())) return undefined;
  if (current.confirmation) {
    if (!/^(?:请|帮我|直接|就)?(?:把)?(?:刚才那条|这条|它)?(?:发出去|发布|发朋友圈|发到朋友圈)$/u.test(text)) return undefined;
    // Existing same-session draft receipts already provide the publication link and card.
    if (prior.sessionId === task.sessionId) return undefined;
    context.knownAction.kind = 'moment.publish'; context.confirmation = false; context.publicationApproved = true;
    context.awaitingFields = missing(context); context.state = context.awaitingFields.length ? 'waiting' : 'ready'; return context;
  }
  if (current.awaitingFields.includes('destination')) {
    const destination = Object.entries(SECRETARY_DESTINATIONS).find(([id, label]) => text === id || text === label || text === `${label}页`)?.[0];
    if (!destination) return undefined;
    context.knownAction.destination = destination as SecretaryAction['destination'];
  } else if (current.awaitingFields.includes('intervalDays')) {
    const value = text.match(/^(?:每隔)?(\d{1,3})(?:天)?$/u);
    if (!value || Number(value[1]) < 1 || Number(value[1]) > 365) return undefined;
    context.knownAction.intervalDays = Number(value[1]);
  } else if (current.awaitingFields.includes('target')) {
    const number = conversationChoice(text, current.candidates?.length ?? 0) ?? 0;
    const selected = current.candidates?.[number - 1]; if (!selected) return undefined;
    context.knownAction.targetId = selected.id; context.expectedTargetVersion = selected.version; context.candidates = undefined;
  } else if (current.awaitingFields.includes('audience')) {
    if (!/^(?:仅自己可见|只给自己看|私密|全部角色可见|所有角色可见)$/u.test(text)) return undefined;
    context.knownAction.visibility = /自己|私密/u.test(text) ? 'private' : 'all';
  } else if (current.awaitingFields.includes('content') || current.awaitingFields.includes('query')) {
    if (/^(?:你好|谢谢|聊聊|换个|帮我|请)/u.test(text) || text.length > 6000) return undefined;
    const explicitValue = /^(?:内容|正文|素材|关键词|名称|标题)(?:是|为|：|:)/u.test(text);
    const value = text.replace(/^(?:内容|正文|素材|关键词|名称|标题)(?:是|为|：|:)/u, '').trim(); if (!value) return undefined;
    // An actual owned name is sufficient evidence for a local object answer. Other
    // unlabelled prose goes through normal understanding, including a new command.
    if (current.targetQueryMissing && !explicitValue) {
      const named = await db.todos.where('userId').equals(task.userId).filter(todo => !['deleted', 'cancelled'].includes(todo.status) && todo.title.trim() === value).first();
      if (!named) return undefined;
    }
    if (!current.targetQueryMissing && !explicitValue && (/^(?:把|将).*(?:改|挪|移|划掉|勾掉|完成|取消|恢复|删除|发布)/u.test(text)
      || /^(?:添加|新建|创建|保存|发布|打开|查询|查找|列出|记上|记得|提醒我|写(?:一篇|一条)?(?:日记|朋友圈))/u.test(text))) return undefined;
    if (current.awaitingFields.includes('query')) { context.knownAction.query = value; context.knownAction.targetId = undefined; context.targetQueryMissing = false; }
    else context.knownAction.content = value;
  } else
  if (current.awaitingFields.includes('purpose')) {
    if (!/^(?:记成|记到|选)?(?:待办|日记)$/u.test(text)) return undefined;
    context.purpose = text.endsWith('待办') ? 'todo' : 'diary';
    context.knownAction = context.purpose === 'todo' ? { ...context.knownAction, kind: 'todo.create' } : { kind: 'diary.save', ...(context.body ? { content: context.body } : {}) };
  } else if (current.awaitingFields.includes('title')) {
    // Treat an explicit short answer as content only, never as a different tool command.
    const explicit = text.match(/^(?:标题|名称|待办名称|名字)(?:是|为|叫|：|:)\s*(.+)$/u);
    const value = explicit ? explicit[1].replace(/^[“「"](.+)[”」"]$/u, '$1').trim() : text;
    if (!value || value.length > 120 || !explicit && /[“”「」]|^(?:你好|谢谢|先不|换个|帮我|请)|朋友圈|发布|删除|取消|打开|聊聊|好累|心情|天气|提醒|记得|待办|日记|记一[笔筆]/u.test(value)) return undefined;
    if (context.purpose === 'diary') context.knownAction.content = value;
    else context.knownAction.title = value;
    context.body = value;
  } else {
    const correction = text.match(/^不是(.+?)[，,]?(?:是|改(?:到|成|为))(.+)$/u);
    const answer = correction ? correction[2] : text;
    const bareTime = answer.match(/^(\d{4}-\d{2}-\d{2}|今天|明天|后天|大后天)?(\d{1,2}|[一二两三四五六七八九十]{1,3})点(半)?$/u);
    if (bareTime && current.awaitingFields.includes('time')) {
      const basis = current.referenceDate ?? localDateKey(new Date(prior.createdAt));
      const raw = `${bareTime[2]}点${bareTime[3] ?? ''}`;
      const early = parseScheduleAnswer(`凌晨${raw}`, basis), late = parseScheduleAnswer(`下午${raw}`, basis);
      if (early?.time && late?.time) {
        if (bareTime[1]) context.knownAction = { ...context.knownAction, ...parseScheduleAnswer(bareTime[1], basis) };
        return { ...context, state: 'waiting', conflict: { field: 'time', choices: [early.time, late.time] } };
      }
    }
    const alternatives = answer.split(/(?:还是|或者|或)/u);
    if (alternatives.length === 2) {
      const choices = alternatives.map(s => parseScheduleAnswer(s, current.referenceDate ?? localDateKey(new Date(prior.createdAt))));
      const field = choices.every(s => s?.time) ? 'time' : choices.every(s => s?.date) ? 'date' : undefined;
      if (field) return { ...context, state: 'waiting', conflict: { field, choices: choices.map(s => s![field]!) } };
    }
    const schedule = parseScheduleAnswer(answer, current.referenceDate ?? localDateKey(new Date(prior.createdAt)));
    if (!schedule) return undefined;
    context.knownAction = { ...context.knownAction, ...schedule };
    context.conflict = undefined;
  }
  context.awaitingFields = missing(context);
  context.state = context.awaitingFields.length ? 'waiting' : 'ready';
  return context;
}

export function pendingQuestion(context: SecretaryPendingContext): string {
  if (context.state === 'cancelled') return '好，这件尚未执行的安排已取消，没有新增生活记录。';
  if (context.state === 'paused') return '好，这件事先暂停。想继续时告诉我。';
  if (context.answerNotice) return context.answerNotice;
  if (context.confirmation) return '草稿已准备好，确认发布时告诉我。';
  if (context.conflict) return `你想采用哪个${context.conflict.field === 'time' ? '时间' : '日期'}：${context.conflict.choices.join('还是')}？`;
  const fields = context.awaitingFields;
  if (fields.includes('operation')) return '这几件事都还缺信息，先继续哪一项？';
  if (fields.includes('destination')) return '想打开哪个页面？';
  if (fields.includes('intervalDays')) return '每隔几天重复？';
  if (fields.includes('target')) return '你指的是哪一项？请选择候选。';
  if (fields.includes('content')) return context.knownAction.kind === 'diary.save' ? '想记下什么？' : '想写什么内容？';
  if (fields.includes('query')) return context.targetQueryMissing ? '你指的是待办里的哪一项？告诉我名称就好。' : '想找什么关键词？';
  if (fields.includes('audience')) return '这条朋友圈想给谁看？';
  if (fields.includes('purpose')) return '记成待办还是日记？';
  if (fields.includes('title')) return context.purpose === 'diary' ? '想记下什么？' : '要记哪件事？';
  if (fields.includes('date') && fields.includes('time')) return '哪一天、几点提醒你？';
  if (fields.includes('date')) return context.knownAction.reminder ? '哪一天提醒你？' : context.knownAction.recurrence && context.knownAction.recurrence !== 'none' ? '重复安排从哪一天开始？' : '这件事安排在哪一天？';
  return '几点提醒你？';
}
