import type { TodoWorkFields, TodoEvent } from './index';
export const WORK_FIELDS = ['workStatus','focusDate','projectId','waitingSince','waitingFor','followupDate','blockedReason','dueDate','dueTime'] as const;
export function validWorkDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const [y,m,d]=value.split('-').map(Number), date=new Date(y,m-1,d);
  return date.getFullYear()===y && date.getMonth()===m-1 && date.getDate()===d;
}
export function validateWorkFields(row: TodoWorkFields) {
  if (row.workStatus !== undefined && !['todo','doing','waiting','blocked'].includes(row.workStatus)) throw new Error('工作状态无效。');
  for (const field of ['focusDate','waitingSince','followupDate'] as const) if(row[field]!=null&&!validWorkDate(row[field])) throw new Error('请选择真实日期。');
  for (const field of ['projectId','waitingFor','blockedReason'] as const) if(row[field]!=null&&(typeof row[field]!=='string'||row[field]!.length>(field==='blockedReason'?1000:120))) throw new Error('工作信息过长或格式无效。');
  if (row.workRevisions && (typeof row.workRevisions!=='object'||Object.entries(row.workRevisions).some(([key,v])=>!WORK_FIELDS.includes(key as any)||typeof v!=='number'||!Number.isFinite(v)||v<0))) throw new Error('字段版本无效。');
  const scheduled=row as TodoWorkFields&{dueDate?:string;dueTime?:string};
  if(scheduled.dueDate!=null&&scheduled.dueDate!==''&&!validWorkDate(scheduled.dueDate)||scheduled.dueTime!=null&&scheduled.dueTime!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduled.dueTime))throw new Error('截止日期或时间无效。');
}
/** Field-level LWW; absence in an old export is not an instruction to clear. */
export function mergeTodoWork<T extends TodoWorkFields>(existing: T | undefined, incoming: T): T {
  validateWorkFields(incoming);
  for(const key of WORK_FIELDS)if(incoming.workRevisions?.[key]!==undefined&&(incoming as any)[key]===undefined)throw new Error('字段版本必须带显式值。');
  if(!existing)return incoming;
  const result={...((existing as any).updatedAt>(incoming as any).updatedAt?existing:incoming)}, revisions={...existing.workRevisions};
  for(const key of WORK_FIELDS) {
    const localRevision=existing.workRevisions?.[key], remoteRevision=incoming.workRevisions?.[key];
    // Schedule fields are preserved only when an instance override has a revision.
    const schedule=key==='dueDate'||key==='dueTime';
    if(schedule&&localRevision===undefined&&remoteRevision===undefined)continue;
    const local=(existing as any)[key], remote=(incoming as any)[key];
    if(remoteRevision===undefined&&localRevision===undefined&&remote!==undefined){(result as any)[key]=(existing as any).updatedAt>(incoming as any).updatedAt&&local!==undefined?local:remote;continue;}
    if(remoteRevision===undefined || localRevision!==undefined&&localRevision>=remoteRevision) {
      if(local!==undefined)(result as any)[key]=local; else delete (result as any)[key];
    } else {
      if(remote===undefined)throw new Error('清空字段必须显式保存。');
      (result as any)[key]=remote;
      revisions[key]=remoteRevision;
    }
  }
  result.workRevisions=revisions;
  return result;
}
export function validateTodoEvent(event: TodoEvent) {
  if(!event || typeof event.id!=='string'||!event.id || !event.userId || !event.todoId || !event.occurrenceId
    || !['completed','followup-planned','followup-recorded'].includes(event.kind)
    || !['user-confirmed','legacy-completion'].includes(event.source) || event.actor!==event.userId
    || !validWorkDate(event.occurredDate) || typeof event.title!=='string' || typeof event.timezone!=='string'
    || !event.occurrenceId.startsWith(`todo-occ:${event.todoId}:`) || !validWorkDate(event.occurrenceId.slice(`todo-occ:${event.todoId}:`.length))
    || ![event.recordedAt,event.createdAt,event.updatedAt,event.sourceRevision].every(v=>typeof v==='number'&&Number.isFinite(v))) throw new Error('行动事件无效，未导入。');
  if(event.kind==='followup-recorded'&&(!['phone','message','email','meeting','other'].includes(event.method??'')||!event.note?.trim()||event.note.length>2000
    || event.method==='other'&&(!event.methodDetail?.trim()||event.methodDetail.length>40)
    || event.method!=='other'&&event.methodDetail || event.taskCreatedDate&&event.occurredDate<event.taskCreatedDate))throw new Error('跟进事实无效，未导入。');
  if(event.source==='legacy-completion'&&event.kind!=='completed')throw new Error('旧记录不能迁移为跟进事实。');
  if([event.voidedAt,event.deletedAt].some(v=>v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)||v<0)))throw new Error('作废标识无效。');
  if(event.kind==='followup-planned')for(const field of ['previousFollowup','followup'] as const)if(event[field]!=null&&!validWorkDate(event[field]))throw new Error('跟进安排日期无效。');
}
