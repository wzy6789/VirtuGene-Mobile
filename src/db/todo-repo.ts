import { db, type Todo, type TodoOccurrence, type TodoRecurrence, type TodoReminder, type TodoWorkFields, type TodoEvent } from './index';
import { validateWorkFields, validWorkDate, WORK_FIELDS } from './todo-work';
import { useAuthStore } from '../store/auth-store';
import Dexie, { type Transaction } from 'dexie';
import { cancelReminderRows, reconcileTodoReminders } from '../lib/todo-reminders';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';

export type TodoWithOccurrence = { todo: Todo; occurrence: TodoOccurrence };

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addLocalDays(dateKey: string, amount: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const value = new Date(y, m - 1, d);
  value.setDate(value.getDate() + amount);
  return localDateKey(value);
}

export function dateDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function dateLabel(dateKey: string): string {
  const today = localDateKey();
  if (dateKey === today) return '今天';
  if (dateKey === addLocalDays(today, 1)) return '明天';
  if (dateKey === addLocalDays(today, -1)) return '昨天';
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${m}月${d}日` + (y === new Date().getFullYear() ? '' : ` · ${y}`);
}

export function occurrenceId(todoId: string, date: string): string {
  return `todo-occ:${todoId}:${date}`;
}

function matchesRecurrence(recurrence: TodoRecurrence, original: string, date: string): boolean {
  const distance = dateDiff(original, date);
  if (distance < 0) return false;
  if (recurrence.kind === 'none') return distance === 0;
  if (recurrence.kind === 'daily') return distance % Math.max(1, recurrence.interval ?? 1) === 0;
  const dayOfWeek = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8))).getDay();
  if (recurrence.kind === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
  if (recurrence.kind === 'weekly') {
    const configured = Array.isArray(recurrence.weekdays) ? recurrence.weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [];
    const weekdays = configured.length ? configured : [new Date(`${original}T12:00:00`).getDay()];
    return weekdays.includes(dayOfWeek) && Math.floor(distance / 7) % Math.max(1, recurrence.interval ?? 1) === 0;
  }
  if (recurrence.kind === 'interval') return distance % Math.max(1, recurrence.days) === 0;
  const [oy, om] = original.split('-').map(Number);
  const [y, m] = date.split('-').map(Number);
  const months = (y - oy) * 12 + (m - om);
  return months % Math.max(1, recurrence.interval ?? 1) === 0 && Number(date.slice(8)) === Math.min(recurrence.day, new Date(y, m, 0).getDate());
}

export function expandOccurrenceDates(todo: Pick<Todo, 'dueDate' | 'status' | 'recurrence'>, from: string, to: string): string[] {
  if (!todo.dueDate || todo.status === 'deleted' || todo.status === 'cancelled') return [];
  const start = todo.dueDate > from ? todo.dueDate : from;
  const result: string[] = [];
  for (let date = start; date <= to; date = addLocalDays(date, 1)) {
    if (matchesRecurrence(todo.recurrence, todo.dueDate, date)) result.push(date);
  }
  return result;
}

/** Recurring schedules remain valid when today's reminder time has passed. */
export function hasFutureTodoReminder(todo: Pick<Todo, 'dueDate' | 'dueTime' | 'status' | 'recurrence'>, offsets: number[], now = Date.now()): boolean {
  if (!todo.dueDate || !todo.dueTime || !offsets.length) return false;
  const today = localDateKey(new Date(now));
  const start = todo.dueDate > today ? todo.dueDate : today;
  const dates = todo.recurrence.kind === 'none' ? [todo.dueDate] : expandOccurrenceDates(todo, start, addLocalDays(start, 366));
  return dates.some(date => offsets.every(minutes => new Date(`${date}T${todo.dueTime}:00`).getTime() - minutes * 60000 > now));
}

async function ensureOccurrence(todo: Todo, date: string): Promise<TodoOccurrence> {
  if(!todo.dueDate) date='9999-12-31';
  if(todo.recurrence.kind==='none') {
    const existing=await db.todoOccurrences.where('todoId').equals(todo.id).filter(o=>o.userId===todo.userId&&o.status!=='skipped').first();
    if(existing)return existing;
    date=todo.dueDate??'9999-12-31';
  }
  const id = occurrenceId(todo.id, date);
  if(!validWorkDate(date))throw new Error('实例日期无效，请重新打开事项。');
  const existing = await db.todoOccurrences.get(id);
  if (existing) return existing;
  const now = Date.now();
  const row: TodoOccurrence = {
    id, userId: todo.userId, todoId: todo.id, dueDate: date, dueTime: todo.dueTime,
    status: todo.status === 'completed' && todo.recurrence.kind === 'none' ? 'completed' : 'todo',
    originalDueDate: todo.dueDate ?? date, scheduledDate:date, completedAt:todo.status==='completed'?todo.completedAt:undefined,createdAt: now, updatedAt: now,
  };
  await db.todoOccurrences.put(row);
  return row;
}

function eventFor(todo:Todo,row:TodoOccurrence,kind:TodoEvent['kind'],now:number):TodoEvent {
  return {id:crypto.randomUUID(),userId:todo.userId,todoId:todo.id,occurrenceId:row.id,kind,source:'user-confirmed',actor:todo.userId,title:todo.title,
    occurredDate:localDateKey(new Date(now)),timezone:todo.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone,
    recordedAt:now,sourceRevision:todo.updatedAt,createdAt:now,updatedAt:now};
}
const pendingNotifications=new WeakMap<Transaction,Set<string>>();
function notifyTodo(userId:string) {
  if(typeof window==='undefined')return;
  const dispatch=(id:string)=>Dexie.ignoreTransaction(()=>window.dispatchEvent(new CustomEvent('virtugene:todos-updated',{detail:{userId:id}})));
  let transaction=Dexie.currentTransaction;
  if(!transaction){dispatch(userId);return;}
  while(transaction.parent)transaction=transaction.parent;
  let users=pendingNotifications.get(transaction);
  if(!users){users=new Set();pendingNotifications.set(transaction,users);transaction.on('complete',()=>{for(const id of users!)dispatch(id);});}
  users.add(userId);
}
export const todoRepo = {
  async list(userId: string, from: string, to: string, includeUnplanned = true): Promise<TodoWithOccurrence[]> {
    const todos = await db.todos.where('userId').equals(userId).filter((todo) => todo.status !== 'deleted' && todo.status !== 'cancelled').toArray();
    const rows: TodoWithOccurrence[] = [];
    for (const todo of todos) {
      if (!todo.dueDate) {
        if (includeUnplanned) rows.push({ todo, occurrence: await ensureOccurrence(todo, '9999-12-31') });
        continue;
      }
      for (const date of expandOccurrenceDates(todo, from, to)) rows.push({ todo, occurrence: await ensureOccurrence(todo, date) });
    }
    return rows.sort((a, b) => {
      const ad = a.occurrence.dueDate.localeCompare(b.occurrence.dueDate);
      if (ad) return ad;
      if (!!a.todo.dueTime !== !!b.todo.dueTime) return a.todo.dueTime ? 1 : -1;
      return (a.todo.dueTime ?? '').localeCompare(b.todo.dueTime ?? '') || (b.todo.priority === 'urgent' ? 1 : 0) - (a.todo.priority === 'urgent' ? 1 : 0);
    });
  },
  async get(userId: string, id: string) {
    const row = await db.todos.get(id);
    return row?.userId === userId ? row : undefined;
  },
  async create(input: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: Todo['status'] }): Promise<Todo> {
    validateWorkFields(input);
    if(input.dueDate&&!validWorkDate(input.dueDate))throw new Error('请选择真实日期。');
    const now = Date.now();
    const todo: Todo = { ...input, id: crypto.randomUUID(), status: input.status ?? 'todo', createdAt: now, updatedAt: now };
    await db.todos.put(todo);
    notifyTodo(todo.userId);
    return todo;
  },
  async update(userId: string, id: string, patch: Partial<Todo>): Promise<Todo> {
    validateWorkFields(patch);
    if(patch.dueDate&&!validWorkDate(patch.dueDate))throw new Error('请选择真实日期。');
    const current = await this.get(userId, id);
    if (!current) throw new Error('todo:not-found');
    const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
    const revisions={...current.workRevisions};
    for(const key of WORK_FIELDS)if(key in patch&&key!=='dueDate'&&key!=='dueTime')revisions[key]=updatedAt;
    const todo = { ...current, ...patch, id, userId, updatedAt,workRevisions:revisions };
    const sharingChanged = ('visibility' in patch && patch.visibility !== current.visibility)
      || ('visibleTo' in patch && JSON.stringify([...(patch.visibleTo ?? [])].sort()) !== JSON.stringify([...(current.visibleTo ?? [])].sort()));
    const todoContentChanged = ['title', 'note', 'dueDate', 'dueTime'].some((key) => key in patch && patch[key as keyof Todo] !== current[key as keyof Todo]);
    await db.transaction('rw', [db.todos, db.todoOccurrences, db.memorySourceTombstones], async () => {
      if (patch.status === 'cancelled' && current.status !== 'cancelled') {
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'todo', sourceId: id, sourceRevision: current.updatedAt, status: 'withdrawn' });
      } else if (patch.status === 'deleted' && current.status !== 'deleted') {
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'todo', sourceId: id, sourceRevision: current.updatedAt, status: 'deleted' });
      }
      if (sharingChanged || todoContentChanged || (patch.status === 'cancelled' && current.status !== 'cancelled') || (patch.status === 'deleted' && current.status !== 'deleted')) {
        const occurrences = await db.todoOccurrences.where('todoId').equals(id).filter((row) => row.userId === userId).toArray();
        for (const occurrence of occurrences) {
          await memorySourceTombstoneRepo.record({
            userId,
            sourceType: 'todoOccurrence',
            sourceId: occurrence.id,
            sourceRevision: occurrence.updatedAt,
            status: patch.status === 'deleted' ? 'deleted' : sharingChanged ? 'withdrawn' : 'superseded',
          });
          if (sharingChanged || todoContentChanged) await db.todoOccurrences.update(occurrence.id, {
            updatedAt: Math.max(updatedAt, occurrence.updatedAt + 1),
            ...(todo.recurrence.kind==='none' && 'dueDate' in patch ? {dueDate:todo.dueDate??'9999-12-31'} : {}),
            ...(todo.recurrence.kind==='none' && 'dueTime' in patch ? {dueTime:todo.dueTime??''} : {}),
            ...(todo.recurrence.kind==='none' && ('dueDate' in patch||'dueTime' in patch) ? {workRevisions:{...occurrence.workRevisions,...('dueDate' in patch?{dueDate:updatedAt}:{}),...('dueTime' in patch?{dueTime:updatedAt}:{})}} : {}),
          });
        }
      }
      await db.todos.put(todo);
    });
    notifyTodo(userId);
    return todo;
  },
  async complete(userId: string, todoId: string, date: string, expectedVersion?:number) {
    const receipt=await db.transaction('rw',[db.todos,db.todoOccurrences,db.todoEvents,db.todoReminders,db.memorySourceTombstones],async()=>{
      if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换。');
      const todo=await this.get(userId,todoId);if(!todo||['deleted','cancelled'].includes(todo.status))throw new Error('待办已不可用。');
      const prior=todo.recurrence.kind==='none'?await db.todoOccurrences.where('todoId').equals(todoId).filter(o=>o.userId===userId&&o.status!=='skipped').first():await db.todoOccurrences.get(occurrenceId(todoId,date));
      if(expectedVersion!==undefined&&(prior?.updatedAt??0)!==expectedVersion)throw new Error('事项已变化，请重新查看。');
      const row=await ensureOccurrence(todo,date);
      if(row.status==='completed')return undefined;
      if(row.status!=='todo')throw new Error('事项已跳过或取消。');
      const now=Math.max(Date.now(),row.updatedAt+1);
      const event=eventFor(todo,row,'completed',now);
      await db.todoOccurrences.update(row.id,{status:'completed',completedAt:now,updatedAt:now});
      if(todo.recurrence.kind==='none')await this.update(userId,todoId,{status:'completed',completedAt:now});
      await db.todoEvents.add(event);
      await db.todoReminders.where('occurrenceId').equals(row.id).filter(r=>r.userId===userId&&!['cancelled','expired','fired'].includes(r.status)).modify({status:'cancel-pending',updatedAt:now});
      return {occurrenceId:row.id,date:row.scheduledDate??date,version:now,eventId:event.id};
    });
    notifyTodo(userId);return receipt;
  },
  async reopen(userId: string, todoId: string, date: string, undo?:{version:number;eventId:string}): Promise<void> {
    await db.transaction('rw',[db.todos,db.todoOccurrences,db.todoEvents,db.memorySourceTombstones],async()=>{
      if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换。');
      const todo=await this.get(userId,todoId);if(!todo||['deleted','cancelled'].includes(todo.status))throw new Error('待办已不可用。');
      const row=await ensureOccurrence(todo,date);
      if(undo&&row.updatedAt!==undo.version)throw new Error('事项已再次变化，不能撤销旧操作。');
      const now=Math.max(Date.now(),row.updatedAt+1);
      await db.todoOccurrences.update(row.id,{status:'todo',completedAt:undefined,updatedAt:now});
      if(todo.recurrence.kind==='none')await this.update(userId,todoId,{status:'todo',completedAt:undefined});
      if(undo){const event=await db.todoEvents.get(undo.eventId);if(event?.userId!==userId||event.occurrenceId!==row.id)throw new Error('撤销记录不匹配。');await db.todoEvents.update(event.id,{voidedAt:now,updatedAt:now});}
    });
    notifyTodo(userId);
  },
  async updateOccurrence(userId:string,todoId:string,date:string,patch:TodoWorkFields&{dueDate?:string;dueTime?:string},expectedVersion?:number) {
    validateWorkFields(patch);
    if(patch.dueDate&&!validWorkDate(patch.dueDate)||patch.dueTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.dueTime))throw new Error('截止日期或时间无效。');
    const receipt=await db.transaction('rw',db.todos,db.todoOccurrences,db.todoEvents,async()=>{
      if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换。');
      const todo=await this.get(userId,todoId);if(!todo||['deleted','cancelled'].includes(todo.status))throw new Error('待办已不可用。');
      const prior=todo.recurrence.kind==='none'?await db.todoOccurrences.where('todoId').equals(todoId).filter(o=>o.userId===userId&&o.status!=='skipped').first():await db.todoOccurrences.get(occurrenceId(todoId,date));
      const row=await ensureOccurrence(todo,date);
      if(expectedVersion!==undefined&&(prior?.updatedAt??0)!==expectedVersion)throw new Error('事项已变化，请重新查看。');
      const before={...row}, revisions={...row.workRevisions}, changed:Record<string,unknown>={};
      for(const key of WORK_FIELDS) {
        if(!(key in patch))continue;
        const value=(patch as any)[key];
        if(value===undefined)throw new Error('清空字段必须显式选择。');
        const previous=(row as any)[key]!==undefined?(row as any)[key]:key==='focusDate'&&todo.recurrence.kind!=='none'?null:(todo as any)[key]??(key==='workStatus'?'todo':null);
        if(value!==previous)changed[key]=value;
      }
      if(!Object.keys(changed).length)return undefined;
      if('followupDate' in changed&&patch.followupDate&&patch.followupDate<localDateKey())throw new Error('下次跟进不能设在过去。');
      const now=Math.max(Date.now(),row.updatedAt+1);for(const key of Object.keys(changed))revisions[key]=now;
      const eventIds:string[]=[];
      if('followupDate' in changed||'waitingFor' in changed) {
        const oldFollowup=row.followupDate!==undefined?row.followupDate:todo.followupDate??null,oldWaiting=row.waitingFor!==undefined?row.waitingFor:todo.waitingFor??null;
        const event={...eventFor(todo,row,'followup-planned',now),previousFollowup:oldFollowup,followup:'followupDate' in changed?patch.followupDate:oldFollowup,
          previousWaitingFor:oldWaiting,waitingFor:'waitingFor' in changed?patch.waitingFor:oldWaiting};
        await db.todoEvents.add(event);eventIds.push(event.id);
      }
      await db.todoOccurrences.update(row.id,{...changed,workRevisions:revisions,updatedAt:now});
      const effectiveBefore={...before};
      for(const key of Object.keys(changed))if((effectiveBefore as any)[key]===undefined)(effectiveBefore as any)[key]=key==='focusDate'&&todo.recurrence.kind!=='none'?null:(todo as any)[key]??(key==='workStatus'?'todo':null);
      return {before:effectiveBefore,version:now,eventIds};
    });
    notifyTodo(userId);return receipt;
  },
  async undoOccurrence(userId:string,receipt:{before:TodoOccurrence;version:number;eventIds:string[]}) {
    await db.transaction('rw',db.todoOccurrences,db.todoEvents,async()=>{
      if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换。');
      const current=await db.todoOccurrences.get(receipt.before.id);
      if(current?.userId!==userId||current.updatedAt!==receipt.version)throw new Error('事项已再次变化，不能撤销旧操作。');
      const now=Math.max(Date.now(),current.updatedAt+1),restored={...current},revisions={...current.workRevisions};
      for(const key of WORK_FIELDS)if(current.workRevisions?.[key]===receipt.version){(restored as any)[key]=(receipt.before as any)[key]??(key==='workStatus'?'todo':null);revisions[key]=now;}
      await db.todoOccurrences.put({...restored,workRevisions:revisions,updatedAt:now});
      for(const id of receipt.eventIds){const e=await db.todoEvents.get(id);if(e?.userId!==userId)throw new Error('事件归属不匹配。');await db.todoEvents.update(id,{voidedAt:now,updatedAt:now});}
    });notifyTodo(userId);
  },
  async recordFollowup(userId:string,todoId:string,date:string,input:{occurredDate:string;method:NonNullable<TodoEvent['method']>;methodDetail?:string;note:string}) {
    if(!validWorkDate(input.occurredDate)||input.occurredDate>localDateKey()||!input.note.trim()||input.note.length>2000||!['phone','message','email','meeting','other'].includes(input.method)
      ||input.method==='other'&&(!input.methodDetail?.trim()||input.methodDetail.length>40)||input.method!=='other'&&input.methodDetail)throw new Error('请填写真实日期、方式和反馈。');
    const event=await db.transaction('rw',db.todos,db.todoOccurrences,db.todoEvents,async()=>{
      if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换。');
      const todo=await this.get(userId,todoId);if(!todo||['deleted','cancelled'].includes(todo.status))throw new Error('待办已不可用。');
      const created=todo.createdAt?localDateKey(new Date(todo.createdAt)):undefined;
      if(created&&input.occurredDate<created)throw new Error('发生日不能早于任务创建日期。');
      const row=await ensureOccurrence(todo,date),now=Date.now();
      const event={...eventFor(todo,row,'followup-recorded',now),...input,note:input.note.trim(),taskCreatedDate:created,waitingFor:row.waitingFor!==undefined?row.waitingFor:todo.waitingFor??null};
      await db.todoEvents.add(event);return event;
    });notifyTodo(userId);return event;
  },
  async voidEvent(userId:string,id:string) {
    await db.transaction('rw',db.todoEvents,async()=>{
      if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换。');
      const event=await db.todoEvents.get(id);
      if(event?.userId!==userId||event.kind!=='followup-recorded')throw new Error('跟进记录不存在。');
      if(!event.voidedAt)await db.todoEvents.update(id,{voidedAt:Math.max(Date.now(),event.updatedAt+1),updatedAt:Math.max(Date.now(),event.updatedAt+1)});
    });notifyTodo(userId);
  },
  async remove(userId: string, id: string): Promise<void> {
    const todo = await this.get(userId, id);
    if (!todo) return;
    await this.update(userId, id, { status: 'deleted', deletedAt: Date.now() });
    const reminders = await db.todoReminders.where('todoId').equals(id).filter((item) => item.userId === userId).toArray();
    await cancelReminderRows(userId, reminders);
  },
  async visibleForCharacter(userId: string, characterId: string, limit = 5, includeUnplanned = false): Promise<Todo[]> {
    return (await this.visibleOccurrencesForCharacter(userId, characterId, limit, includeUnplanned)).map(({ todo }) => todo);
  },
  async visibleOccurrencesForCharacter(userId: string, characterId: string, limit = 5, includeUnplanned = false): Promise<TodoWithOccurrence[]> {
    const today = localDateKey();
    const rows = await this.list(userId, today, addLocalDays(today, 30), includeUnplanned);
    const seen = new Set<string>();
    return rows.filter(({ todo, occurrence }) => {
      if (todo.visibility !== 'selected' || !todo.visibleTo?.includes(characterId) || occurrence.status !== 'todo' || seen.has(todo.id)) return false;
      seen.add(todo.id);
      return true;
    }).slice(0, limit);
  },
  async completedVisibleForAudience(userId: string, audienceIds: string[], limit = 8, includeOlderHistory = false): Promise<{ todo: Todo; occurrence?: TodoOccurrence; completedAt: number }[]> {
    const audience = [...new Set(audienceIds)];
    if (!audience.length) return [];
    const todos = (await db.todos.where('userId').equals(userId).toArray()).filter((todo) =>
      todo.visibility === 'selected' && audience.every((id) => todo.visibleTo?.includes(id)) && todo.status !== 'deleted' && todo.status !== 'cancelled',
    );
    if (!todos.length) return [];
    const todoById = new Map(todos.map((todo) => [todo.id, todo]));
    const cutoff = Date.now() - 90 * 86400000;
    const occurrences = await db.todoOccurrences.where('todoId').anyOf(todos.map((todo) => todo.id)).toArray();
    const results: { todo: Todo; occurrence?: TodoOccurrence; completedAt: number }[] = occurrences
      .filter((occurrence) => occurrence.userId === userId && occurrence.status === 'completed' && (includeOlderHistory || (occurrence.completedAt ?? 0) >= cutoff))
      .flatMap((occurrence) => {
        const todo = todoById.get(occurrence.todoId);
        return todo ? [{ todo, occurrence, completedAt: occurrence.completedAt ?? occurrence.updatedAt }] : [];
      });
    for (const todo of todos) {
      if (todo.status === 'completed' && todo.completedAt && (includeOlderHistory || todo.completedAt >= cutoff) && !occurrences.some((occurrence) => occurrence.todoId === todo.id && occurrence.status === 'completed')) {
        results.push({ todo, completedAt: todo.completedAt });
      }
    }
    return results.sort((a, b) => b.completedAt - a.completedAt).slice(0, Math.max(0, limit));
  },
  async reminders(userId: string, todoId?: string): Promise<TodoReminder[]> {
    return db.todoReminders.where('userId').equals(userId).filter((r) => !todoId || r.todoId === todoId).toArray();
  },
  /** 打开待办页时重建未来 60 天的本地提醒；系统通知丢失后也能恢复。 */
  async rebuildReminders(userId: string): Promise<void> {
    const from = localDateKey();
    const {readTodoInstances}=await import('../lib/action-cabin/query');
    const rows = await readTodoInstances(userId,addLocalDays(from,60));
    const future:TodoWithOccurrence[]=[];
    for(const row of rows) {
      if(useAuthStore.getState().userId!==userId)return;
      if(row.occurrence.status!=='todo'||!row.occurrence.dueTime||!row.todo.reminderMinutes?.length)continue;
      const dueAt=new Date(`${row.occurrence.dueDate}T${row.occurrence.dueTime}:00`).getTime();
      if(!Number.isFinite(dueAt)||!row.todo.reminderMinutes.some(m=>dueAt-m*60000>Date.now()))continue;
      future.push({...row,occurrence:row.occurrence.updatedAt?row.occurrence:await ensureOccurrence(row.todo,row.occurrence.scheduledDate??row.occurrence.dueDate)});
    }
    await reconcileTodoReminders(userId, future);
  },
};
