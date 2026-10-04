import { db, type Todo, type TodoOccurrence, type TodoWorkFields } from '../../db';
import { expandOccurrenceDates, addLocalDays, localDateKey, occurrenceId, type TodoWithOccurrence } from '../../db/todo-repo';

export const UNPLANNED_DATE='9999-12-31';
export function scheduleDate(row: TodoOccurrence) { return row.id.slice(`todo-occ:${row.todoId}:`.length); }
export function effectiveWork({todo,occurrence}: TodoWithOccurrence): TodoWorkFields {
  const value:TodoWorkFields={workStatus:'todo'};
  for(const field of ['workStatus','waitingSince','waitingFor','followupDate','blockedReason'] as const) (value as any)[field]=occurrence[field]!==undefined?occurrence[field]:todo[field];
  value.workStatus??='todo';
  // Focus belongs to one occurrence, never automatically to recurring templates.
  value.focusDate=occurrence.focusDate!==undefined?occurrence.focusDate:todo.recurrence.kind==='none'?todo.focusDate:undefined;
  value.projectId=todo.projectId;
  return value;
}
export function isOverdue(row:TodoWithOccurrence, now=new Date(), today=localDateKey(now)) {
  const date=row.occurrence.dueDate;
  return row.occurrence.status==='todo'&&date!==UNPLANNED_DATE&&(date<today||date===today&&!!row.occurrence.dueTime&&new Date(`${date}T${row.occurrence.dueTime}:00`).getTime()<now.getTime());
}

/** Read-only virtual instances, existing overrides win. No fixed historical lookback.
 * Date batches bound recurrence expansion, reads use owner indexes, no startup backfill writes. */
export async function readTodoInstances(userId:string, until:string, audience?:string[]):Promise<TodoWithOccurrence[]> {
  return db.transaction('r',db.todos,db.todoOccurrences,async()=>{
    const todos=(await db.todos.where('userId').equals(userId).toArray()).filter(t=>!['deleted','cancelled'].includes(t.status)
      && (audience===undefined || audience.length>0&&t.visibility==='selected'&&audience.every(id=>t.visibleTo?.includes(id))));
    const byTodo=new Map(todos.map(t=>[t.id,t]));
    const stored=(await db.todoOccurrences.where('userId').equals(userId).toArray()).filter(o=>byTodo.has(o.todoId));
    const byId=new Map(stored.map(o=>[o.id,o])), rows=new Map<string,TodoWithOccurrence>();
    const single=new Map<string,TodoOccurrence>();
    for(const o of stored)if(!['skipped','cancelled'].includes(o.status)&&!single.has(o.todoId))single.set(o.todoId,o);
    for(const todo of todos) {
      const dates:string[]=[];
      if(todo.recurrence.kind==='none') {
        // Existing one-off identity survives template rescheduling.
        const existing=single.get(todo.id);
        if(existing){rows.set(existing.id,{todo,occurrence:existing});continue;}
        if(!todo.dueDate)dates.push(UNPLANNED_DATE);
        else dates.push(todo.dueDate);
      } else if(todo.dueDate) {
        for(let from=todo.dueDate;from<=until;from=addLocalDays(from,128)) {
          const end=addLocalDays(from,127);
          dates.push(...expandOccurrenceDates(todo,from,end<until?end:until));
        }
      }
      for(const date of dates) {
        const id=occurrenceId(todo.id,date), actual=byId.get(id);
        const occurrence:TodoOccurrence=actual??{id,userId,todoId:todo.id,dueDate:date,dueTime:todo.dueTime,scheduledDate:date,originalDueDate:todo.dueDate??date,
          status:todo.recurrence.kind==='none'&&todo.status==='completed'?'completed':'todo',completedAt:todo.completedAt,createdAt:todo.createdAt,updatedAt:0};
        rows.set(id,{todo,occurrence});
      }
    }
    // Include still-open overrides even after a schedule edit, and completed
    // instances whose scheduled date differs from their completion day.
    for(const occurrence of stored) if(!rows.has(occurrence.id))rows.set(occurrence.id,{todo:byTodo.get(occurrence.todoId)!,occurrence});
    return [...rows.values()].filter(({occurrence})=>!['skipped','cancelled'].includes(occurrence.status));
  });
}
export async function readActionDay(userId:string,now=new Date(),audience?:string[]) {
  const day=localDateKey(now), rows=await readTodoInstances(userId,day,audience);
  const pending=rows.filter(r=>r.occurrence.status==='todo');
  const today=pending.filter(r=>r.occurrence.dueDate===day);
  const overdue=pending.filter(r=>isOverdue(r,now,day));
  const dueOrOverdue=[...new Map([...today,...overdue].map(r=>[r.occurrence.id,r])).values()];
  const completed=rows.filter(r=>r.occurrence.status==='completed'&&r.occurrence.completedAt!=null&&localDateKey(new Date(r.occurrence.completedAt))===day);
  const waiting=pending.filter(r=>effectiveWork(r).workStatus==='waiting');
  const followup=waiting.filter(r=>{const w=effectiveWork(r);return w.followupDate?w.followupDate<=day:!!w.waitingSince&&addLocalDays(w.waitingSince,3)<=day;});
  const expiredFocus=pending.filter(r=>{const d=effectiveWork(r).focusDate;return !!d&&d<day;});
  const overdueIds=new Set(overdue.map(r=>r.occurrence.id));
  const rank=(r:TodoWithOccurrence)=>overdueIds.has(r.occurrence.id)&&r.todo.priority!=='normal'?0:r.occurrence.dueDate===day&&r.todo.priority!=='normal'?1:r.occurrence.dueDate===day?2:effectiveWork(r).focusDate===day?3:4;
  const focus:{row:TodoWithOccurrence;rank:number}[]=[];
  const compare=(a:typeof focus[number],b:typeof focus[number])=>a.rank-b.rank||a.row.occurrence.dueDate.localeCompare(b.row.occurrence.dueDate)||(a.row.occurrence.dueTime??'23:59').localeCompare(b.row.occurrence.dueTime??'23:59')||a.row.occurrence.id.localeCompare(b.row.occurrence.id);
  // Selecting three priorities is linear; no full-history sort on every refresh.
  for(const row of pending){const candidate={row,rank:rank(row)};let index=0;while(index<focus.length&&compare(focus[index],candidate)<=0)index++;if(index<3){focus.splice(index,0,candidate);if(focus.length>3)focus.pop();}}
  return {day,now:now.getTime(),pending,today,overdue,dueOrOverdue,completed,waiting,followup,expiredFocus,focus:focus.map(item=>item.row)};
}
