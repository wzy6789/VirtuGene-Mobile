import { addLocalDays } from '../../db/todo-repo';
import type { SecretaryAction, SecretaryResult, SecretaryTask } from './types';

/** Exact standalone edits of the last single todo receipt. Quoted prose is not a command. */
export function parseTodoEditCommand(request: string, today: string): Partial<SecretaryAction> | undefined {
  const raw = request.trim().replace(/[。！!]+$/gu, '').replace(/^(?:帮我|请)?(?:把|将)?(?:刚才(?:那项|的)?待办|这项待办|那个|这件事|它)?/u, '').trim();
  const text = raw.replace(/\s/gu, '');
  const recurrence = text.match(/^(?:不是(?:每天|工作日|单次|不重复)[，,])?(?:重复)?(?:改为|改成)(每天|工作日|单次|不重复)$/u);
  if (recurrence) return { recurrence: { 每天: 'daily', 工作日: 'weekdays', 单次: 'none', 不重复: 'none' }[recurrence[1]] as SecretaryAction['recurrence'] };
  const step = text.match(/^(完成|划掉|勾掉|恢复|重新打开)?第([一二两三四五六七八九十\d]+)(?:步|个步骤|项子任务)(完成了|做完了|完成|划掉|勾掉|恢复|重新打开)?$/u);
  if (step && (step[1] || step[3]) && number(step[2]) >= 1 && number(step[2]) <= 20) return { kind: 'todo.steps', stepMode: /恢复|重新打开/u.test((step[1] ?? '') + (step[3] ?? '')) ? 'reopen' : 'complete', stepIndex: number(step[2]) };
  const priority = text.match(/^(?:优先级)?(?:改为|改成|设为|设置为)(普通|重要|紧急)$/u);
  if (priority) return { priority: { 普通: 'normal', 重要: 'important', 紧急: 'urgent' }[priority[1]] as SecretaryAction['priority'] };
  if (/^(?:关闭|关掉|取消)提醒$/u.test(text)) return { reminder: false };
  const offset = text.match(/^(?:提醒)?(?:改为|改成|设为)?提前(\d{1,5}|[零一二两三四五六七八九十]{1,3})分钟(?:提醒)?$/u);
  if (offset && Number.isInteger(number(offset[1])) && number(offset[1]) <= 10080) return { reminder: true, reminderMinutes: [number(offset[1])] };
  if (/^(?:提醒)?(?:改为|改成|设为)?准时提醒$/u.test(text)) return { reminder: true, reminderMinutes: [0] };
  const title = raw.match(/^(?:改名为|改名成|名称改为|名称改成)(.+)$/u);
  if (title && title[1].trim() && title[1].length <= 120) return { title: title[1].trim() };
  if (/^(?:清空|删除|去掉)备注$/u.test(text)) return { content: '' };
  const note = raw.match(/^备注(?:改为|改成|写成)(.+)$/u);
  if (note && note[1].trim() && note[1].length <= 6000) return { content: note[1].trim() };
  if (/^(?:改到|改成|挪到|安排在)/u.test(text)) return parseScheduleAnswer(text.replace(/^挪到/u, '改到'), today);
  return undefined;
}

export function explicitStepIndex(request: string): number | undefined {
  const ordinal = request.match(/第([一二两三四五六七八九十\d]+)(?:步|个步骤|项子任务)/u);
  return ordinal ? number(ordinal[1]) : undefined;
}

function number(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.includes('十')) { const [a, b] = value.split('十'); return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0); }
  return digits[value];
}

/** Only stand-alone answers to the latest question; unrelated prose stays with the planner. */
export function parseScheduleAnswer(request: string, today: string): { date?: string; time?: string } | undefined {
  let text = request.trim().replace(/[，,。！!\s]/gu, '').replace(/^(?:就|安排在|改到|改成|定在|时间是|那就)/u, '');
  const patch: { date?: string; time?: string } = {};
  const date = text.match(/^(\d{4}-\d{2}-\d{2}|今天|明天|后天|大后天)/u);
  if (date) { patch.date = /^\d/u.test(date[1]) ? date[1] : addLocalDays(today, { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[date[1]]!); text = text.slice(date[0].length); }
  if (!date) {
    const weekday = text.match(/^(本|这|下)?(?:周|星期)([一二三四五六日天])/u);
    if (weekday) {
      const current = new Date(`${today}T12:00:00`).getDay() || 7;
      const target = '一二三四五六日'.indexOf(weekday[2].replace('天', '日')) + 1;
      const offset = weekday[1] === '下' ? 7 - current + target : weekday[1] ? target - current : (target - current + 7) % 7;
      patch.date = addLocalDays(today, offset); text = text.slice(weekday[0].length);
    }
  }
  if (text) {
    const time = text.match(/^(凌晨|早上|上午|中午|下午|晚上)?(\d{1,2}|[一二两三四五六七八九十]{1,3})(?::(\d{2})|[点时](半|一刻|三刻|(?:\d{1,2}|[零一二两三四五六七八九十]{1,3})分?)?)$/u);
    if (!time) return undefined;
    let hour = number(time[2]);
    const minute = time[3] ? Number(time[3]) : time[4] === '半' ? 30 : time[4] === '一刻' ? 15 : time[4] === '三刻' ? 45 : time[4] ? number(time[4].replace(/分$/u, '')) : 0;
    // Bare “三点” is ambiguous; ask through the normal planner rather than assume AM.
    if (!time[1] && !time[3] && hour > 0 && hour <= 12) return undefined;
    if (time[1] && (hour < 1 || hour > 12)) return undefined;
    if (['下午', '晚上'].includes(time[1]) && hour < 12 || time[1] === '中午' && hour < 11) hour += 12;
    if (time[1] === '晚上' && hour === 12 || ['早上', '上午'].includes(time[1]) && hour === 12) return undefined;
    if (time[1] === '凌晨' && hour === 12) hour = 0;
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
    patch.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  return Object.keys(patch).length ? patch : undefined;
}

export function resolveSecretaryFollowup(prior: SecretaryTask | undefined, request: string, today: string): SecretaryResult[] | undefined {
  if (!prior || prior.status !== 'finished') return undefined;
  const text = request.trim().replace(/[。！!\s]/gu, '');
  const link = (index: number) => ({ sourceTaskId: prior.id, sourceResultIndex: index, sourceMode: 'continue' as const, sourceUpdatedAt: prior.updatedAt,
    operationId: prior.results[index].operationId ?? `${prior.id}:${index}`,
    authorizationMessageId: prior.results[index].authorizationMessageId ?? prior.messageId,
    authorizationRequest: prior.results[index].authorizationRequest ?? prior.request });
  const clauses = request.trim().replace(/[。！!]+$/u, '').split(/[，,；;]/u).map(s => s.trim());
  const listEdits: SecretaryResult[] = [];
  let listEditRequest = false;
  for (const clause of clauses) {
    if (clause === '其他不动' || clause === '其余不动') continue;
    const edit = clause.match(/^(?:把|将)?第([一二两三四五六七八九十\d]+)(?:个|项|条)(划掉|勾掉|完成|挪到.+|改到.+|改成.+)$/u);
    if (!edit) { listEdits.length = 0; break; }
    listEditRequest = true;
    const lists = prior.results.map((r, index) => ({ r, index })).filter(({ r }) => r.status === 'done' && r.action.kind === 'todo.list' && r.todoRows?.length);
    if (lists.length !== 1) return undefined;
    const { r, index } = lists[0], row = r.todoRows![number(edit[1]) - 1];
    if (!row || row.completed || listEdits.some(result => result.action.targetId === row.id)) return [];
    const patch = /划掉|勾掉|完成/u.test(edit[2]) ? { kind: 'todo.complete' as const, ...(row.date !== '9999-12-31' ? { date: row.date } : {}) } : parseScheduleAnswer(edit[2].replace(/^挪到/u, '改到'), today);
    if (!patch || !('kind' in patch) && !patch.date && !patch.time) return undefined;
    listEdits.push({ ...link(index), operationId: undefined, sourceMode: 'list-item', sourceTargetDate: row.date,
      selectionApproved: true, expectedTargetVersion: row.version, status: 'pending', label: 'kind' in patch ? '完成待办' : '修改待办',
      action: { kind: 'kind' in patch ? 'todo.complete' : 'todo.update', targetId: row.id, query: row.title, ...patch } });
  }
  if (listEdits.length && listEditRequest) return listEdits;
  const ordinal = text.match(/^(?:把|将|选|选择|就)?第([一二两三四五六七八九十\d]+)(?:个|项|条)(?:划掉|勾掉|标记完成|完成)?$/u);
  if (ordinal) {
    const rowIndex = number(ordinal[1]) - 1;
    const stepChoices = prior.results.map((r, index) => ({ r, index })).filter(({ r }) => r.status === 'needs-input' && r.stepCandidates?.length);
    if (stepChoices.length === 1) {
      const { r, index } = stepChoices[0]; const chosen = r.stepCandidates![rowIndex];
      if (!chosen) return [];
      return [{ ...r, ...link(index), status: 'pending', stepCandidates: undefined, stepSelectionApproved: true, action: { ...r.action, stepIndex: chosen.index } }];
    }
    const candidates = prior.results.map((r, index) => ({ r, index })).filter(({ r }) => r.status === 'needs-input' && r.candidates?.length);
    if (candidates.length === 1) {
      const { r, index } = candidates[0]; const candidate = r.candidates![rowIndex];
      if (!candidate) return [];
      return [{ ...r, ...link(index), status: 'pending', candidates: undefined, selectionApproved: true, expectedTargetVersion: candidate.version,
        action: { ...r.action, targetId: candidate.id } }];
    }
    if (/划掉|勾掉|标记完成|完成$/u.test(text)) {
      const lists = prior.results.map((r, index) => ({ r, index })).filter(({ r }) => r.status === 'done' && r.action.kind === 'todo.list' && r.todoRows?.length);
      if (lists.length !== 1) return undefined;
      const { r, index } = lists[0]; const row = r.todoRows![rowIndex];
      if (!row || row.completed) return [];
      return [{ ...link(index), operationId: undefined, sourceMode: 'list-item', selectionApproved: true, expectedTargetVersion: row.version,
        status: 'pending', label: '完成待办', action: { kind: 'todo.complete', targetId: row.id, query: row.title, ...(row.date !== '9999-12-31' ? { date: row.date } : {}) } }];
    }
  }
  const drafts = prior.results.map((r, index) => ({ r, index })).filter(({ r }) => r.status === 'draft' && r.action.kind === 'moment.draft');
  if (/^(?:请|帮我|直接|就)?(?:把)?(?:刚才(?:那条|这条|的)?(?:朋友圈|文案)?|这条|它)?(?:发出去|发布|发朋友圈|发到朋友圈)$/u.test(text) && drafts.length === 1) {
    const { r, index } = drafts[0];
    return [{ ...r, ...link(index), action: { ...r.action, kind: 'moment.publish' }, status: 'pending', publicationApproved: true }];
  }
  const waiting = prior.results.map((r, index) => ({ r, index })).filter(({ r }) => r.status === 'needs-input');
  if (!waiting.length) {
    const patch = parseTodoEditCommand(request, today);
    const todos = prior.results.map((r, index) => ({ r, index })).filter(({ r }) => r.status === 'done' && r.targetId
      && ['todo.create', 'todo.update', 'todo.reschedule', 'todo.complete', 'todo.reopen', 'todo.steps'].includes(r.action.kind) && Number.isFinite(r.afterTodoVersion ?? r.afterVersion));
    if (patch && todos.length === 1) {
      const { r, index } = todos[0];
      return [{ sourceTaskId: prior.id, sourceResultIndex: index, sourceMode: 'todo-edit', sourceUpdatedAt: prior.updatedAt,
        selectionApproved: true, expectedTargetVersion: r.afterTodoVersion ?? r.afterVersion, status: 'pending', label: '修改待办',
        action: { kind: patch.kind ?? 'todo.update', targetId: r.targetId, ...patch } }];
    }
  }
  if (waiting.length !== 1) return undefined;
  const { r, index } = waiting[0];
  if (r.action.kind === 'todo.create' || r.action.kind === 'todo.reschedule' || r.action.kind === 'todo.update') {
    const schedule = parseScheduleAnswer(request, today);
    if (schedule) return [{ ...r, ...link(index), action: { ...r.action, ...schedule }, status: 'pending' }];
    if (/^(?:\d{1,2}|[一二两三四五六七八九十]{1,3})点(?:半)?$/u.test(text) && !r.action.time) {
      return [{ ...r, ...link(index), status: 'pending' }];
    }
  }
  if (r.action.kind === 'moment.publish' && /^(?:仅自己可见|只给自己看|私密|全部角色可见|所有角色可见)$/u.test(text)) {
    return [{ ...r, ...link(index), action: { ...r.action, visibility: /自己|私密/u.test(text) ? 'private' : 'all' }, status: 'pending' }];
  }
  return undefined;
}
