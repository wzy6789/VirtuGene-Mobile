import Dexie from 'dexie';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { db, type Todo, type TodoOccurrence } from '../../src/db';
import { todoRepo, localDateKey, addLocalDays, occurrenceId } from '../../src/db/todo-repo';
import { readActionDay, readTodoInstances, effectiveWork, UNPLANNED_DATE } from '../../src/lib/action-cabin/query';
import { collectSyncData, importSyncData } from '../../src/lib/sync';
import { collectDailyReview } from '../../src/lib/secretary/daily-review';
import { readSecretaryWorkspace } from '../../src/lib/secretary/workspace';
import { useAuthStore } from '../../src/store/auth-store';
import { useUIStore } from '../../src/store/ui-store';
import { ActionCabinPage } from '../../src/components/todo/ActionCabinPage';
import { ActionCabinLauncher } from '../../src/components/todo/ActionCabinLauncher';
import { TodoPage } from '../../src/components/todo/TodoPage';
import { soulHandoffTo } from '../../src/lib/soul-handoff';
import { collectBackupData } from '../../src/lib/backup';

const user='cabin-test', day=localDateKey(), previous=addLocalDays(day,-1), next=addLocalDays(day,1);
const auth=(id=user)=>useAuthStore.setState({userId:id,username:'验收',isLoggedIn:true});
let assertions=0;
function check(value:unknown,message:string){if(!value)throw new Error(message);assertions++;}
async function rejects(work:()=>Promise<unknown>,message:string){let rejected=false;try{await work();}catch{rejected=true;}check(rejected,message);}
const make=(id:string,patch:Partial<Todo>={}):Todo=>({id,userId:user,title:id,status:'todo',priority:'normal',recurrence:{kind:'none'},visibility:'private',source:'manual',createdAt:new Date(`${previous}T09:00:00`).getTime(),updatedAt:100,...patch});
const occ=(todo:Todo,date:string,patch:Partial<TodoOccurrence>={}):TodoOccurrence=>({id:occurrenceId(todo.id,date),userId:todo.userId,todoId:todo.id,dueDate:date,scheduledDate:date,originalDueDate:date,status:'todo',createdAt:100,updatedAt:100,...patch});
async function clear(){await db.transaction('rw',[db.todos,db.todoOccurrences,db.todoEvents,db.todoReminders,db.memorySourceTombstones],async()=>{await Promise.all([db.todos.clear(),db.todoOccurrences.clear(),db.todoEvents.clear(),db.todoReminders.clear(),db.memorySourceTombstones.clear()]);});auth();}

async function migration(){
  // Build a real previous-version database from the production schema.
  db.close();await Dexie.delete(db.name);
  const schema:Record<string,string>={};
  for(const t of db.tables)if(t.name!=='todoEvents')schema[t.name]=[t.schema.primKey.src,...t.schema.indexes.map(i=>i.src).filter(i=>i!=='[userId+dueDate]'&&i!=='[userId+completedAt]')].join(',');
  const old=new Dexie(db.name);old.version(31).stores(schema);await old.open();
  const task=make('legacy-unplanned',{status:'completed',completedAt:Date.now()});
  const templateOnly=make('legacy-template-only',{status:'completed',completedAt:Date.now()});
  await old.table('todos').bulkPut([task,templateOnly]);await old.table('todoOccurrences').bulkPut([occ(task,UNPLANNED_DATE),occ(task,day,{status:'completed',completedAt:task.completedAt})]);old.close();
  await db.open();auth();
  const snapshot=await readActionDay(user);
  check(snapshot.completed.length===2,'unplanned legacy completion counted once per task');
  check(snapshot.pending.length===0,'unplanned legacy pending duplicate repaired');
  check(snapshot.completed.find(r=>r.todo.id===task.id)?.occurrence.id===occurrenceId(task.id,UNPLANNED_DATE),'canonical unplanned identity');
  check(snapshot.completed.find(r=>r.todo.id===task.id)?.occurrence.completedAt===task.completedAt,'actual legacy time retained');
  check((await db.todoEvents.toArray())[0].source==='legacy-completion','migration never invents confirmed contact');
  check(!!await db.todoEvents.get(`legacy-completed:${occurrenceId(templateOnly.id,UNPLANNED_DATE)}`),'legacy template-only completion retains actual known timestamp');
}

async function run(){
  await migration();await clear();
  const now=new Date(`${day}T12:00:00`);
  const a=make('today-one',{dueDate:day,dueTime:'09:00'}),b=make('today-two',{dueDate:day}),c=make('old',{dueDate:previous,priority:'urgent'});
  await db.todos.bulkPut([a,b,c]);
  let snapshot=await readActionDay(user,now);
  check(snapshot.today.length===2&&snapshot.overdue.length===2&&snapshot.dueOrOverdue.length===3,'today and overdue union is deduplicated 2+1=3');
  check(await db.todoOccurrences.count()===0,'dashboard is read-only');
  check(snapshot.focus[0].todo.id===c.id,'overdue high priority first');
  check((await readActionDay(user,now,[])).pending.length===0,'empty actor audience has no access');
  await db.todos.put(make('shared',{dueDate:day,visibility:'selected',visibleTo:['actor-a','actor-b']}));
  check((await readActionDay(user,now,['actor-a','actor-b'])).today.length===1,'actor permissions use intersection');
  check((await readActionDay(user,now,['actor-a','actor-c'])).today.length===0,'one unauthorised participant excludes task');
  await db.todos.put(make('foreign',{userId:'someone-else',dueDate:day}));
  check(!(await readActionDay(user,now)).pending.some(r=>r.todo.id==='foreign'),'other accounts excluded');
  const fail=()=>{throw new Error('injected event write failure');};db.todoEvents.hook('creating',fail);
  await rejects(()=>todoRepo.complete(user,a.id,day,0),'event failure rejects completion');db.todoEvents.hook('creating').unsubscribe(fail);
  check((await db.todos.get(a.id))?.status==='todo'&&!await db.todoOccurrences.get(occurrenceId(a.id,day)),'failed completion is atomic');
  const receipt=await todoRepo.complete(user,a.id,day,0);check(!!receipt,'first completion receipt');
  check((await readActionDay(user)).completed.length===1,'completion counted by actual day');
  check(await db.todoEvents.count()===1,'one completion event');
  await rejects(()=>todoRepo.complete(user,a.id,day,0),'stale virtual instance rejected');
  await todoRepo.reopen(user,a.id,day,receipt!);
  check(!!(await db.todoEvents.get(receipt!.eventId))?.voidedAt,'undo invalidates the completion fact');
  check((await readActionDay(user)).completed.length===0,'undo clears daily completion');
  await clear();
  const repeated=make('daily',{dueDate:addLocalDays(day,-450),recurrence:{kind:'daily'}});await db.todos.put(repeated);
  snapshot=await readActionDay(user,now);check(snapshot.pending.length===451,'repeat expansion has no hidden history window');
  check(snapshot.overdue.length===450,'old recurring overdue instances retained');
  await todoRepo.complete(user,repeated.id,day,0);
  check((await db.todos.get(repeated.id))?.status==='todo','completing one repeat keeps future template active');
  check((await readTodoInstances(user,next)).some(r=>r.occurrence.dueDate===next&&r.occurrence.status==='todo'),'future repeat still present');
  const work=await todoRepo.updateOccurrence(user,repeated.id,previous,{workStatus:'waiting',waitingSince:addLocalDays(day,-4),waitingFor:'客户',focusDate:previous});
  check(!!work,'instance override saved');
  const current=await db.todoOccurrences.get(occurrenceId(repeated.id,previous));
  const count=await db.todoEvents.count();await todoRepo.updateOccurrence(user,repeated.id,previous,{waitingFor:'客户'},current!.updatedAt);
  check(await db.todoEvents.count()===count,'unchanged followup does not create a fact');
  snapshot=await readActionDay(user,now);check(snapshot.followup.length===1&&snapshot.expiredFocus.length===1,'waiting fallback and expired focus use real instances');
  check(effectiveWork((await readTodoInstances(user,next)).find(r=>r.occurrence.dueDate===next)!).workStatus==='todo','instance work never leaks into the next repeat');
  const plan=await todoRepo.updateOccurrence(user,repeated.id,previous,{followupDate:next});
  check((await readActionDay(user,now)).followup.length===0,'future followup overrides old waiting fallback');
  check((await db.todoEvents.get(plan!.eventIds[0]))?.kind==='followup-planned','planning differs from contact');
  await todoRepo.undoOccurrence(user,plan!);check((await readActionDay(user,now)).followup.length===1,'undo restores inherited waiting semantics');
  await rejects(()=>todoRepo.undoOccurrence(user,plan!),'second undo rejected on revision conflict');
  await rejects(()=>todoRepo.recordFollowup(user,repeated.id,previous,{occurredDate:next,method:'phone',note:'已联系'}),'future actual contact rejected');
  await rejects(()=>todoRepo.recordFollowup(user,repeated.id,previous,{occurredDate:addLocalDays(previous,-1),method:'phone',note:'已联系'}),'contact before known creation rejected');
  const actual=await todoRepo.recordFollowup(user,repeated.id,previous,{occurredDate:previous,method:'phone',note:'客户下周回复'});
  check(actual.kind==='followup-recorded'&&actual.occurredDate!==localDateKey(new Date(actual.recordedAt)),'actual and recording dates separate');
  await todoRepo.voidEvent(user,actual.id);check(!!(await db.todoEvents.get(actual.id))?.voidedAt,'correction invalidates rather than overwrites');
  const before=await db.todoOccurrences.get(occurrenceId(repeated.id,previous));
  await todoRepo.updateOccurrence(user,repeated.id,previous,{focusDate:null});
  let packet=await collectSyncData(user,'验收');
  const oldPacket=JSON.parse(JSON.stringify(packet));delete oldPacket.todoEvents;
  for(const o of oldPacket.todoOccurrences){delete o.workStatus;delete o.focusDate;delete o.waitingSince;delete o.waitingFor;delete o.followupDate;delete o.blockedReason;delete o.workRevisions;o.updatedAt+=10000;}
  check((await importSyncData(oldPacket)).ok,'old client packet accepted');
  const merged=await db.todoOccurrences.get(before!.id);check(merged?.focusDate===null&&merged.workStatus==='waiting','old roundtrip preserves explicit clearing and work status');
  check(await db.todoEvents.count()===packet.todoEvents!.length,'old packet never erases events');
  packet=await collectSyncData(user,'验收');check((await importSyncData(packet)).ok&&(await importSyncData(packet)).ok,'stable event ids make replays idempotent');
  check(await db.todoEvents.count()===packet.todoEvents!.length,'replays do not duplicate facts');
  const rewritten=JSON.parse(JSON.stringify(packet));rewritten.todoEvents[0].title='rewritten history';check(!(await importSyncData(rewritten)).ok,'sync rejects rewriting an immutable fact');
  const backup=await collectBackupData(user,'验收');check(backup.todoEvents?.length===packet.todoEvents!.length,'production backup includes action facts');
  await clear();check((await importSyncData({...backup,__meta__:{...backup.__meta__,kind:'sync'}})).ok,'backup payload restores events through production importer');check(await db.todoEvents.count()===packet.todoEvents!.length,'events survive clearing and full restore');
  const invalid=JSON.parse(JSON.stringify(packet));invalid.todos[0].title='MUST ROLL BACK';invalid.todos[0].updatedAt+=20000;invalid.todoEvents.push({...actual,id:'unknown',kind:'ai-confirmed'});
  check(!(await importSyncData(invalid)).ok,'unknown event type rejects full packet');check((await db.todos.get(repeated.id))?.title!=='MUST ROLL BACK','invalid import rolls back all life changes');
  await clear();
  const loose=make('unplanned');await db.todos.put(loose);
  const looseReceipt=await todoRepo.complete(user,loose.id,day,0);await todoRepo.reopen(user,loose.id,UNPLANNED_DATE,looseReceipt!);
  check(await db.todoOccurrences.count()===1,'two entry paths share unplanned identity');
  await todoRepo.updateOccurrence(user,loose.id,UNPLANNED_DATE,{dueDate:day,dueTime:'23:50'});
  check((await readActionDay(user)).today.length===1,'unplanned instance can be scheduled without changing identity');
  await todoRepo.update(user,loose.id,{dueDate:day,dueTime:'23:50',reminderMinutes:[0]});await todoRepo.rebuildReminders(user);
  check((await db.todoReminders.where('userId').equals(user).toArray()).some(r=>r.occurrenceId===occurrenceId(loose.id,UNPLANNED_DATE)&&r.status==='unsupported'),'reminders use rescheduled occurrence identity and honest platform state');
  const review=await collectDailyReview(user,{date:day,includeDiary:false,includeTodos:true,notes:''},false);
  check(JSON.stringify(review).includes('unplanned'),'daily review sees the same rescheduled real instance');
  await todoRepo.update(user,loose.id,{dueDate:next,dueTime:undefined});
  const rescheduled=(await readActionDay(user)).pending[0];check(rescheduled.occurrence.dueDate===next&&!rescheduled.occurrence.dueTime,'later legacy/assistant one-off reschedule updates the existing override');
  check((await importSyncData(await collectSyncData(user,'验收'))).ok,'cleared occurrence time roundtrips with an explicit field value');
  await seed();return {assertions};
}
async function benchmark(){
  await clear();
  await db.todos.bulkPut(Array.from({length:120},(_,i)=>make(`load-${i}`,{dueDate:addLocalDays(day,-365),recurrence:i<30?{kind:'daily'}:{kind:'none'}})));
  const times:number[]=[];
  for(let i=0;i<12;i++){const start=performance.now();const data=await readActionDay(user);times.push(performance.now()-start);if(i===0)check(data.pending.length===11070,'large history counts all 10980 repeats and 90 single tasks');}
  times.sort((a,b)=>a-b);await seed();return {templates:120,instances:11070,median:times[6],p95:times[11],note:'Chrome browser wall time; not Android WebView/GPU frame time'};
}
async function seed(){
  await clear();
  const tasks=[make('交付项目方案',{title:'交付项目方案',dueDate:previous,priority:'urgent'}),make('确认发布清单',{title:'确认发布清单',dueDate:day,priority:'important'}),make('整理本周会议纪要',{title:'整理本周会议纪要',dueDate:day}),make('等待客户反馈',{title:'等待客户反馈',dueDate:next,workStatus:'waiting',waitingSince:addLocalDays(day,-5),waitingFor:'陈经理',focusDate:previous}),make('临时想法',{title:'临时想法：优化首页入口'}),make('完成项',{title:'已完成的接口联调',dueDate:previous,status:'completed',completedAt:Date.now()})];
  await db.todos.bulkPut(tasks);return tasks;
}
const root=createRoot(document.getElementById('root')!);
function Host(){const view=useUIStore(s=>s.activeView);useEffect(()=>{return useAuthStore.subscribe(s=>{if(!s.userId)useUIStore.getState().setActiveView('chat');});},[]);return view==='actionCabin'?<ActionCabinPage/>:view==='todo'?<TodoPage/>:<div style={{padding:20}}><ActionCabinLauncher from="chat"/></div>;}
Object.assign(window,{cabinTest:{run,seed,benchmark,db,auth,user,day,next,readActionDay,readSecretaryWorkspace,collectDailyReview,soulHandoffTo,mount:()=>{auth();useUIStore.getState().setActiveView('actionCabin');root.render(<Host/>);},home:()=>{auth();useUIStore.getState().setActiveView('chat');root.render(<Host/>);},legacyTodo:()=>{auth();useUIStore.getState().setActiveView('todo');root.render(<Host/>);},switchUser:()=>auth('second-account'),injectSaveFailure:()=>{const fn=()=>{throw new Error('模拟存储失败');};db.todos.hook('creating',fn);return fn;}}});
