import { db } from '../../db';
import { addLocalDays, localDateKey, occurrenceId, expandOccurrenceDates } from '../../db/todo-repo';
import { useAuthStore } from '../../store/auth-store';
import type { DailyReviewOptions, DailyReviewOutput, DailyReviewSources, SecretaryAction, SecretaryTask } from './types';

export const DAILY_REVIEW_OUTPUTS: { id: DailyReviewOutput; label: string; suggestion: string }[] = [
  { id: 'diary', label: '日记整理建议', suggestion: '日记整理建议' },
  { id: 'moment', label: '朋友圈草稿', suggestion: '朋友圈草稿' },
  { id: 'todos', label: '次日待办建议', suggestion: '次日待办建议' },
];
export const reviewOutputs = (options: DailyReviewOptions): DailyReviewOutput[] => options.outputs ?? DAILY_REVIEW_OUTPUTS.map(o => o.id);
export function reviewActionSelected(action: SecretaryAction, options: DailyReviewOptions): boolean {
  const output = action.kind === 'diary.save' ? 'diary' : ['moment.draft', 'moment.publish'].includes(action.kind) ? 'moment' : action.kind === 'todo.create' ? 'todos' : undefined;
  return !!output && reviewOutputs(options).includes(output);
}

export interface DailyReviewTodoRow {
  id: string; title: string; date?: string; time?: string;
  state: 'completed-that-day' | 'pending' | 'next-day'; occurrenceId?: string;
  /** Current checklist status has no per-step completion timestamp. Never a daily fact. */
  currentSteps?: { title: string; completed: boolean }[];
  currentStepProgress?: { completed: number; total: number };
  recurring?: boolean;
  priority?: 'normal' | 'important' | 'urgent';
}

export function validateDailyReview(raw: unknown): DailyReviewOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('每日整理设置不完整。');
  const value = raw as Record<string, unknown>;
  const date = typeof value.date === 'string' ? value.date : '';
  const parsed = new Date(`${date}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || localDateKey(parsed) !== date || date < '1900-01-01' || date > localDateKey()) throw new Error('请选择今天或过去的真实日期。');
  if (typeof value.includeDiary !== 'boolean' || typeof value.includeTodos !== 'boolean' || typeof value.notes !== 'string' || value.notes.length > 2000) throw new Error('请选择资料范围，补充事实最多2000字。');
  let outputs: DailyReviewOutput[] | undefined;
  if (value.outputs != null) {
    if (Array.isArray(value.outputs) && !value.outputs.length) throw new Error('请至少选择一种整理建议。');
    if (!Array.isArray(value.outputs) || value.outputs.length > 3 || value.outputs.some(o => !DAILY_REVIEW_OUTPUTS.some(choice => choice.id === o)) || new Set(value.outputs).size !== value.outputs.length) throw new Error('整理类型不正确，请重新选择。');
    outputs = DAILY_REVIEW_OUTPUTS.filter(o => (value.outputs as unknown[]).includes(o.id)).map(o => o.id);
  }
  return { date, includeDiary: value.includeDiary, includeTodos: value.includeTodos, notes: value.notes.trim(), ...(outputs ? { outputs } : {}) };
}

export function dailyReviewRequest(options: DailyReviewOptions): string {
  const outputs = options.outputs ? DAILY_REVIEW_OUTPUTS.filter(o => options.outputs!.includes(o.id)).map(o => o.suggestion).join('、') : '日记整理建议、朋友圈草稿和次日待办建议';
  return `每日整理 ${options.date}。使用资料：${[options.includeDiary ? '当日日记' : '', options.includeTodos ? '真实待办' : ''].filter(Boolean).join('、') || '仅补充事实'}。请给出${outputs}，先不保存日记、不创建待办、不发布朋友圈。${options.notes ? `\n我补充的当日事实：${options.notes}` : ''}`;
}

/** No todoRepo.list(): a preview must not create missing occurrence records. */
export async function collectDailyReview(userId: string, options: DailyReviewOptions, diaryUnlocked: boolean) {
  options = validateDailyReview(options);
  if (useAuthStore.getState().userId !== userId) throw new Error('账号已切换，整理已停止。');
  if (options.includeDiary && !diaryUnlocked) throw new Error('请先到日记页解锁，或取消使用日记。');
  return db.transaction('r', db.diaries, db.todos, db.todoOccurrences, async () => {
    const diaries = options.includeDiary ? await db.diaries.where('[userId+date]').equals([userId, options.date])
      .filter(d => !d.deletedAt && !d.characterId && d.visibility !== 'world').toArray() : [];
    if (diaries.length > 20) throw new Error('这一天的日记较多，请先整理日记，或只使用补充事实。');
    const todos = options.includeTodos ? await db.todos.where('userId').equals(userId).filter(t => t.status !== 'deleted' && t.status !== 'cancelled').toArray() : [];
    const occurrences = options.includeTodos ? await db.todoOccurrences.where('userId').equals(userId).toArray() : [];
    const byId = new Map(occurrences.map(o => [o.id, o]));
    const nextDate = addLocalDays(options.date, 1);
    const rows: DailyReviewTodoRow[] = [];
    const sources: DailyReviewSources = { diaries: diaries.map(d => ({ id: d.id, version: d.updatedAt })), todos: [] };
    for (const todo of todos) {
      const completed = occurrences.filter(o => o.todoId === todo.id && o.status === 'completed' && o.completedAt != null && localDateKey(new Date(o.completedAt)) === options.date);
      for (const o of completed) {
        rows.push({ id: todo.id, title: todo.title, date: o.dueDate, time: o.dueTime, state: 'completed-that-day', occurrenceId: o.id });
        sources.todos.push({ id: todo.id, version: todo.updatedAt, occurrenceId: o.id, occurrenceVersion: o.updatedAt });
      }
      if (!completed.length && todo.recurrence.kind === 'none' && todo.status === 'completed' && todo.completedAt != null && localDateKey(new Date(todo.completedAt)) === options.date) {
        rows.push({ id: todo.id, title: todo.title, date: todo.dueDate, time: todo.dueTime, state: 'completed-that-day' });
        sources.todos.push({ id: todo.id, version: todo.updatedAt });
      }
      if (todo.status === 'completed' && todo.recurrence.kind === 'none') continue;
      const dates = !todo.dueDate ? [undefined] : todo.recurrence.kind === 'none' ? todo.dueDate <= nextDate ? [todo.dueDate] : [] : expandOccurrenceDates(todo, options.date, nextDate);
      for (const date of dates) {
        const o = byId.get(occurrenceId(todo.id, date ?? '9999-12-31'));
        if (o && o.status !== 'todo') continue;
        rows.push({ id: todo.id, title: todo.title, date, time: todo.dueTime, state: date === nextDate ? 'next-day' : 'pending', occurrenceId: o?.id });
        sources.todos.push({ id: todo.id, version: todo.updatedAt, occurrenceId: occurrenceId(todo.id, date ?? '9999-12-31'), occurrenceVersion: o?.updatedAt });
      }
    }
    if (rows.length > 120) throw new Error('待办资料较多，请缩小范围，或取消使用待办。');
    const byTodoId = new Map(todos.map(todo => [todo.id, todo]));
    for (const row of rows) {
      const todo = byTodoId.get(row.id)!;
      row.recurring = todo.recurrence.kind !== 'none';
      row.priority = todo.priority;
      if (options.date === localDateKey() && !row.recurring && todo.subtasks?.length) {
        row.currentSteps = todo.subtasks.slice(0, 20).map(step => ({ title: step.title, completed: step.completed }));
        row.currentStepProgress = { completed: todo.subtasks.filter(step => step.completed).length, total: todo.subtasks.length };
      }
    }
    const priority = { urgent: 0, important: 1, normal: 2 };
    rows.sort((a, b) => (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31')
      || priority[a.priority ?? 'normal'] - priority[b.priority ?? 'normal']
      || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
    if (!diaries.length && !rows.length && !options.notes) throw new Error('这一天还没有可整理的真实资料，请补充发生的事情。');
    if (useAuthStore.getState().userId !== userId) throw new Error('账号已切换，整理已停止。');
    return { date: options.date, nextDate, notes: options.notes,
      diaries: diaries.map(d => ({ id: d.id, title: d.title, content: d.content.slice(0, 4000) })), todos: rows, sources };
  });
}

export async function assertReviewSources(task: SecretaryTask, diaryUnlocked: boolean): Promise<void> {
  if (!task.dailyReview) return;
  if (task.dailyReview.includeDiary && !diaryUnlocked) throw new Error('这份整理使用了日记，请先解锁再继续。');
  if (!task.reviewSources) throw new Error('整理依据不完整，请重新发起每日整理。');
  for (const ref of task.reviewSources.diaries) {
    const row = await db.diaries.get(ref.id);
    if (!row || row.userId !== task.userId || row.deletedAt || row.updatedAt !== ref.version) throw new Error('整理使用的日记已修改或删除，请重新整理。');
  }
  for (const ref of task.reviewSources.todos) {
    const row = await db.todos.get(ref.id);
    const occurrence = ref.occurrenceId ? await db.todoOccurrences.get(ref.occurrenceId) : undefined;
    if (!row || row.userId !== task.userId || ['deleted', 'cancelled'].includes(row.status) || row.updatedAt !== ref.version
      || ref.occurrenceId && ((ref.occurrenceVersion != null ? occurrence?.updatedAt !== ref.occurrenceVersion : occurrence && occurrence.status !== 'todo')
        || occurrence && (occurrence.userId !== task.userId || occurrence.todoId !== ref.id))) throw new Error('整理使用的待办已变化，请重新整理。');
  }
}

/** Suggestions are restricted to new content. Existing tasks are never changed by a review. */
export function validateReviewActions(actions: SecretaryAction[], options: DailyReviewOptions): SecretaryAction[] {
  return actions.flatMap<SecretaryAction>(action => {
    if (!['diary.save', 'moment.draft', 'todo.create'].includes(action.kind) || action.targetId) throw new Error('每日整理只能生成日记、朋友圈草稿和新待办建议。');
    if (!reviewActionSelected(action, options)) return [];
    if (action.kind === 'diary.save') return [{ kind: action.kind, title: action.title, content: action.content, date: options.date }];
    if (action.kind === 'moment.draft') return [{ kind: action.kind, content: action.content }];
    return [{ kind: action.kind, title: action.title, content: action.content, date: addLocalDays(options.date, 1), recurrence: 'none' as const, reminder: false }];
  });
}
