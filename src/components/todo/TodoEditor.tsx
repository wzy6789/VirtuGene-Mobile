import { Modal } from '../ui/Modal';
import { useEffect, useState } from 'react';
import { db, type Todo, type TodoPriority, type TodoRecurrence, type TodoVisibility, type TodoWorkStatus } from '../../db';
import { todoRepo, localDateKey, occurrenceId } from '../../db/todo-repo';
import { requestNotificationPermission } from '../../lib/notify';
import { useAuthStore } from '../../store/auth-store';

export function TodoEditor({ userId, todo, date, characters, onClose, onSaved }: { userId: string; todo?: Todo; date: string; characters: { id: string; name: string }[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [note, setNote] = useState(todo?.note ?? '');
  const [dueDate, setDueDate] = useState(todo ? todo.dueDate ?? '' : (date === '9999-12-31' ? '' : date));
  const [dueTime, setDueTime] = useState(todo?.dueTime ?? '');
  const [priority, setPriority] = useState<TodoPriority>(todo?.priority ?? 'normal');
  const [reminder, setReminder] = useState(String(todo?.reminderMinutes?.[0] ?? ''));
  const [repeat, setRepeat] = useState<TodoRecurrence>(todo?.recurrence ?? { kind: 'none' });
  const [repeatFromDate, setRepeatFromDate] = useState(!todo);
  const [visibility, setVisibility] = useState<TodoVisibility>(todo?.visibility ?? 'private');
  const [visibleTo, setVisibleTo] = useState(todo?.visibleTo ?? []);
  const [subtasks, setSubtasks] = useState(todo?.subtasks ?? []);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure,setFailure]=useState('');
  const [scope,setScope]=useState<'instance'|'future'>('instance');
  const [workStatus,setWorkStatus]=useState<TodoWorkStatus>('todo');
  const [focusDate,setFocusDate]=useState<string|null>(null);
  const [waitingSince,setWaitingSince]=useState<string|null>(null);
  const [waitingFor,setWaitingFor]=useState('');
  const [followupDate,setFollowupDate]=useState('');
  const [blockedReason,setBlockedReason]=useState('');
  const [version,setVersion]=useState<number>();
  const [loading,setLoading]=useState(!!todo);
  useEffect(()=>{
    let alive=true;
    if(todo)void (async()=>{
      const row=todo.recurrence.kind==='none'?await db.todoOccurrences.where('todoId').equals(todo.id).filter(o=>o.userId===userId&&o.status!=='skipped').first():await db.todoOccurrences.get(occurrenceId(todo.id,date));
      if(!alive||useAuthStore.getState().userId!==userId)return;
      setVersion(row?.updatedAt??0);setWorkStatus(row?.workStatus??todo.workStatus??'todo');
      setFocusDate(row?.focusDate!==undefined?row.focusDate:todo.recurrence.kind==='none'?todo.focusDate??null:null);
      setWaitingSince(row?.waitingSince!==undefined?row.waitingSince:todo.waitingSince??null);
      setWaitingFor((row?.waitingFor!==undefined?row.waitingFor:todo.waitingFor)??'');setFollowupDate((row?.followupDate!==undefined?row.followupDate:todo.followupDate)??'');setBlockedReason((row?.blockedReason!==undefined?row.blockedReason:todo.blockedReason)??'');
      const actualDate=row?.dueDate??(todo.recurrence.kind!=='none'?date:todo.dueDate??'');setDueDate(actualDate==='9999-12-31'?'':actualDate);setDueTime(row?row.dueTime??'':todo.dueTime??'');
      setLoading(false);
    })().catch(()=>{if(alive){setFailure('读取事项失败，请关闭后重试。');}});
    return()=>{alive=false;};
  },[userId,todo?.id,date]);
  const save = async () => {
    if (!title.trim() || saving || loading) return;
    setSaving(true);
    setFailure('');
    try {
    if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换。');
    if(visibility==='selected'&&!visibleTo.length)throw new Error('请选择知情角色，或改为仅自己。');
    if(repeat.kind!=='none'&&!dueDate)throw new Error('重复任务需要开始日期。');
    const minutes = reminder === '' ? [] : [Number(reminder)];
    const anchor = new Date(`${dueDate || localDateKey()}T12:00:00`);
    const recurrence = !repeatFromDate ? repeat : repeat.kind === 'weekly' ? { ...repeat, weekdays: [anchor.getDay()] } : repeat.kind === 'monthly' ? { ...repeat, day: anchor.getDate() } : repeat;
    const payload = { title: title.trim(), note: note.trim() || undefined, subtasks: subtasks.length ? subtasks : undefined, dueDate: dueDate || undefined, dueTime: dueTime || undefined, priority, reminderMinutes: minutes, recurrence, visibility, visibleTo: visibility === 'selected' ? visibleTo : undefined, source: todo?.source ?? 'manual' as const };
    const saved=await db.transaction('rw',[db.todos,db.todoOccurrences,db.todoEvents,db.memorySourceTombstones],async()=>{
      if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换。');
      if(todo&&(await db.todos.get(todo.id))?.updatedAt!==todo.updatedAt)throw new Error('事项已被修改，请重新打开后编辑。');
      const instance=!!todo&&(todo.recurrence.kind==='none'||scope==='instance');
      const {dueDate:plannedDate,dueTime:plannedTime,recurrence:plan,...basic}=payload;
      const saved=todo??await todoRepo.create({...payload,userId});
      await todoRepo.updateOccurrence(userId,saved.id,todo?date:dueDate||'9999-12-31',{
        workStatus,focusDate,waitingFor:waitingFor.trim()||null,followupDate:followupDate||null,
        waitingSince:workStatus==='waiting'?waitingSince??localDateKey():null,blockedReason:blockedReason.trim()||null,
        ...(instance?{dueDate:dueDate||'9999-12-31',dueTime:dueTime||''}:{})
      },todo?version:undefined);
      if(todo)await todoRepo.update(userId,todo.id,todo.recurrence.kind!=='none'&&scope==='instance'?basic:payload);
      return saved;
    });
    if (minutes.length && saved.dueDate && saved.dueTime) {
      try{await requestNotificationPermission();}catch{};
    }
    let reminderFailed=false;
    try{await todoRepo.rebuildReminders(userId);}catch{reminderFailed=true;}
    if(useAuthStore.getState().userId===userId)onSaved(reminderFailed?'待办已保存，提醒待重建。':'已保存到你的日程');
    } catch(error) {setFailure(error instanceof Error?error.message:'保存失败，输入已保留。');}
    finally{setSaving(false);}
  };

  return <Modal open onClose={onClose} title={todo ? '编辑行动' : '记下一件事'} canSnapshotOnExit={() => useAuthStore.getState().userId === userId}>
    <div className="vg-todo-sheet">
      <input aria-label="事项名称" className="vg-todo-title-input" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="要做什么？" maxLength={80} />
      <textarea aria-label="备注" value={note} onChange={e => setNote(e.target.value)} placeholder="备注（可选）" rows={2} maxLength={2000} />
      {todo&&todo.recurrence.kind!=='none'&&<label className="vg-todo-wide-field">日期修改范围<select value={scope} onChange={e=>setScope(e.target.value as typeof scope)}><option value="instance">只改本次截止日期</option><option value="future">修改后续重复安排</option></select><small>名称、备注和优先级影响整项任务；工作状态和重点只影响本次。后续安排不改写已有实例。</small></label>}
      <div className="vg-todo-fields"><label>截止日期<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} /></label><label>时间<input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)} /></label></div>
      <div className="vg-todo-fields"><label>提醒<select value={reminder} onChange={e=>setReminder(e.target.value)}><option value="">不提醒</option><option value="0">准时</option><option value="10">提前 10 分钟</option><option value="30">提前 30 分钟</option><option value="60">提前 1 小时</option><option value="1440">提前 1 天</option></select></label><label>优先级<select value={priority} onChange={e=>setPriority(e.target.value as TodoPriority)}><option value="normal">普通</option><option value="important">重点</option><option value="urgent">重要</option></select></label></div>
      <label className="vg-todo-wide-field">重复<select disabled={!!todo&&todo.recurrence.kind!=='none'&&scope==='instance'} value={repeat.kind} onChange={e=>{
        setRepeatFromDate(true);const anchor=new Date((dueDate||localDateKey())+'T12:00:00');
        setRepeat(e.target.value==='daily'?{kind:'daily'}:e.target.value==='weekdays'?{kind:'weekdays'}:e.target.value==='weekly'?{kind:'weekly',weekdays:[anchor.getDay()]}:e.target.value==='monthly'?{kind:'monthly',day:anchor.getDate()}:{kind:'none'});
      }}><option value="none">不重复</option><option value="daily">每天</option><option value="weekdays">工作日</option><option value="weekly">每周</option><option value="monthly">每月</option>{repeat.kind==='interval'&&<option value="interval">每 {repeat.days} 天</option>}</select></label>
      <label className="vg-todo-wide-field">工作状态<select value={workStatus} onChange={e=>setWorkStatus(e.target.value as TodoWorkStatus)}><option value="todo">待开始</option><option value="doing">进行中</option><option value="waiting">等待别人</option><option value="blocked">遇到阻塞</option></select></label>
      <label className="vg-todo-wide-field"><span><input type="checkbox" checked={focusDate===localDateKey()} onChange={e=>setFocusDate(e.target.checked?localDateKey():null)} /> 标为今日重点</span>{focusDate&&focusDate<localDateKey()&&<small>原重点日期：{focusDate} <button type="button" onClick={()=>setFocusDate(null)}>清除旧重点</button></small>}</label>
      {workStatus==='waiting'&&<><label className="vg-todo-wide-field">等待谁的反馈<input value={waitingFor} onChange={e=>setWaitingFor(e.target.value)} maxLength={120}/></label><label className="vg-todo-wide-field">下次跟进<input type="date" min={localDateKey()} value={followupDate} onChange={e=>setFollowupDate(e.target.value)}/></label><p className="text-xs text-sub">只调整跟进安排，没有向对方发送消息。</p></>}
      {workStatus==='blocked'&&<label className="vg-todo-wide-field">阻塞原因<textarea value={blockedReason} onChange={e=>setBlockedReason(e.target.value)} maxLength={1000}/></label>}
      <div className="vg-todo-subtasks"><div className="vg-todo-subtask-add"><input value={subtaskDraft} onChange={e=>setSubtaskDraft(e.target.value)} placeholder="添加一个步骤" maxLength={120} onKeyDown={e=>{if(e.key==='Enter'&&subtaskDraft.trim()){e.preventDefault();setSubtasks(old=>[...old,{id:crypto.randomUUID(),title:subtaskDraft.trim(),completed:false}]);setSubtaskDraft('');}}}/><button type="button" aria-label="添加步骤" onClick={()=>{if(subtaskDraft.trim()){setSubtasks(old=>[...old,{id:crypto.randomUUID(),title:subtaskDraft.trim(),completed:false}]);setSubtaskDraft('');}}}>＋</button></div>{subtasks.map(step=><label key={step.id}><input type="checkbox" checked={step.completed} onChange={e=>setSubtasks(old=>old.map(item=>item.id===step.id?{...item,completed:e.target.checked}:item))}/>{step.title}</label>)}</div>
      <fieldset className="vg-todo-share"><legend>世界里的知情范围</legend><label><input type="radio" checked={visibility==='private'} onChange={()=>setVisibility('private')}/> 仅自己</label><label><input type="radio" checked={visibility==='selected'} onChange={()=>setVisibility('selected')}/> 告诉指定角色</label>{visibility==='selected'&&<div className="vg-todo-character-list">{characters.map(character=><label key={character.id}><input type="checkbox" checked={visibleTo.includes(character.id)} onChange={e=>setVisibleTo(old=>e.target.checked?[...old,character.id]:old.filter(id=>id!==character.id))}/> {character.name}</label>)}</div>}</fieldset>
      {failure&&<p role="alert" className="text-red-400">{failure}</p>}
      {todo&&<button className="vg-todo-delete" disabled={saving||loading} onClick={async()=>{setSaving(true);try{if(useAuthStore.getState().userId!==userId)throw new Error('账号已切换');await todoRepo.remove(userId,todo.id);if(useAuthStore.getState().userId===userId)onSaved('已移入回收站');}catch(e){setFailure(e instanceof Error?e.message:'删除失败');}finally{setSaving(false);}}}>删除整项任务{todo.recurrence.kind!=='none'?'（含所有重复）':''}</button>}
      <button className="vg-todo-save" disabled={!title.trim()||saving||loading} onClick={()=>void save()}>{loading?'读取中…':saving?'保存中…':'保存行动'}</button>
    </div>
  </Modal>;
}
