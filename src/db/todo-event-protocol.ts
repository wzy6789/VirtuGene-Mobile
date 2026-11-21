import type { MemorySourceTombstone, Todo, TodoEvent } from './index';
import { validateTodoEvent } from './todo-work';

function deletedSource(
  row: MemorySourceTombstone | undefined,
  userId: string,
  sourceType: 'todo' | 'todoOccurrence',
  sourceId: string,
): row is MemorySourceTombstone {
  return !!row && row.userId === userId && row.sourceType === sourceType && row.sourceId === sourceId
    && row.status === 'deleted' && Number.isFinite(row.sourceRevision) && row.sourceRevision >= 0;
}

/** A deleted parent's facts remain history, never authority to restore that parent.
 * Collection and import use the same account, identity and revision boundary. */
export function assertTodoEventSource(
  userId: string,
  event: TodoEvent,
  parent: Todo | undefined,
  deletion?: MemorySourceTombstone,
  occurrenceDeletion?: MemorySourceTombstone,
): void {
  validateTodoEvent(event);
  if (event.userId !== userId || parent && (parent.id !== event.todoId || parent.userId !== userId)) {
    throw new Error('事件来源归属无效。');
  }
  const deleted = deletedSource(deletion, userId, 'todo', event.todoId);
  if (parent && parent.status !== 'deleted' && !deleted) return;
  if (!deleted) throw new Error('事件来源归属无效。');
  // Migration v32 used the occurrence revision for legacy completion facts.
  // Only that source may use an exact occurrence deletion to cover its revision;
  // a matching task deletion is still required to prove the retired parent.
  const covered = event.sourceRevision >= 0 && (event.sourceRevision <= deletion.sourceRevision
    || event.source === 'legacy-completion'
      && deletedSource(occurrenceDeletion, userId, 'todoOccurrence', event.occurrenceId)
      && event.sourceRevision <= occurrenceDeletion.sourceRevision);
  if (!covered) throw new Error('事件来源版本超出删除范围。');
}
