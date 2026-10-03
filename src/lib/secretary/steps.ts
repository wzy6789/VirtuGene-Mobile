import type { Todo } from '../../db';

export function validateStepTitles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20 || value.some(s => typeof s !== 'string' || !s.trim() || s.trim().length > 80)) throw new Error('步骤需要是1到80字的名称，一次最多20项。');
  return value.map(s => (s as string).trim());
}

const key = (title: string) => title.normalize('NFKC').toLowerCase().replace(/\s/gu, '');
export function appendTodoSteps(current: Todo['subtasks'], titles: string[]): NonNullable<Todo['subtasks']> {
  const steps = [...(current ?? [])];
  const existing = new Set(steps.map(s => key(s.title)));
  for (const title of titles) {
    if (existing.has(key(title))) continue;
    if (steps.length >= 20) throw new Error('这件待办已有较多步骤，请先在待办页整理，最多保留20项。');
    steps.push({ id: crypto.randomUUID(), title, completed: false }); existing.add(key(title));
  }
  return steps;
}

export function stepProgress(todo: Pick<Todo, 'subtasks'>): string {
  const steps = todo.subtasks ?? [];
  return `步骤进度 ${steps.filter(s => s.completed).length}/${steps.length}`;
}
