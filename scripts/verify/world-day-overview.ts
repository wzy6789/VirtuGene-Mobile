import {db,type Todo,type TodoOccurrence} from '../../src/db';
import {occurrenceId} from '../../src/db/todo-repo';
import {readWorldDayOverview,useWorldDayOverview} from '@world-overview';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {useAuthStore} from '../../src/store/auth-store';

const day='2026-10-22',now=new Date(`${day}T12:00:00`);
const UNPLANNED_DATE='9999-12-31';
const until=async(test:()=>boolean)=>{for(let i=0;i<100;i++){if(test())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Hook state timeout: '+document.body.textContent);};
Object.assign(window,{worldOverviewChecks:async()=>{
  const checks:string[]=[];const check=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
  await db.delete();await db.open();
  const todo=(id:string,patch:Partial<Todo>={}):Todo=>({id,userId:'u',title:id,status:'todo',priority:'normal',visibility:'private',recurrence:{kind:'none'},createdAt:1,updatedAt:1,...patch});
  const daily=(id:string,patch:Partial<Todo>={})=>todo(id,{dueDate:'2015-01-01',recurrence:{kind:'daily'},...patch});
  const rows:Todo[]=[daily('daily-valid'),daily('daily-out'),daily('daily-completed'),daily('daily-cancelled'),daily('daily-skipped'),daily('daily-in',{dueDate:'2030-01-01'}),daily('daily-foreign'),
    todo('single-plain',{dueDate:day}),todo('single-out',{dueDate:day}),todo('single-completed',{dueDate:day}),todo('single-in',{dueDate:'2030-01-01'}),todo('single-foreign',{dueDate:day}),
    todo('unplanned-fresh'),todo('unplanned-active'),todo('unplanned-completed'),todo('unplanned-out'),todo('unplanned-cancelled'),todo('unplanned-template-completed',{status:'completed'}),
    daily('deleted',{status:'deleted'}),daily('cancelled-template',{status:'cancelled'}),todo('foreign-template',{userId:'v',dueDate:day}),daily('history-only',{dueDate:'2035-01-01'}),daily('recurring-without-date',{dueDate:undefined})];
  const occurrence=(id:string,scheduled:string,dueDate=scheduled,status:TodoOccurrence['status']='todo',userId='u'):TodoOccurrence=>({id:occurrenceId(id,scheduled),todoId:id,userId,dueDate,status,scheduledDate:scheduled,originalDueDate:scheduled,createdAt:1,updatedAt:1});
  const initial:TodoOccurrence[]=[occurrence('daily-out',day,'2026-10-23'),occurrence('daily-completed',day,day,'completed'),occurrence('daily-cancelled',day,day,'cancelled'),occurrence('daily-skipped',day,day,'skipped'),occurrence('daily-in','2020-01-01',day),occurrence('daily-foreign',day,day,'todo','v'),
    occurrence('single-out','2020-01-01','2026-10-23'),occurrence('single-completed','2020-01-01',day,'completed'),occurrence('single-in','2020-01-01',day),occurrence('single-foreign',day,day,'todo','v'),
    occurrence('unplanned-active',UNPLANNED_DATE),occurrence('unplanned-completed',UNPLANNED_DATE,UNPLANNED_DATE,'completed'),occurrence('unplanned-out',UNPLANNED_DATE,'2026-10-23'),occurrence('unplanned-cancelled',UNPLANNED_DATE,UNPLANNED_DATE,'cancelled'),
    occurrence('deleted',day),occurrence('cancelled-template',day),occurrence('foreign-template',day),occurrence('missing-template',day)];
  const history=(from:number,count:number)=>Array.from({length:count},(_,offset)=>{const i=from+offset,date=new Date(1900,0,1+i),key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;return occurrence('history-only',key,key,'completed');});
  await db.todos.bulkPut(rows);await db.todoOccurrences.bulkPut([...initial,...history(0,10000)]);
  const sample=async()=>{
    const metrics={templates:0,occurrences:0,indexes:[] as string[]};const restore:(()=>void)[]=[];
    for(const name of ['todos','todoOccurrences']){const core=db.table(name).core,key=name==='todos'?'templates':'occurrences';
      const query=core.query.bind(core),get=core.getMany.bind(core),open=core.openCursor.bind(core);
      core.query=async request=>{const result=await query(request);if(request.values){metrics[key]+=result.result.length;metrics.indexes.push(`${name}:${request.query.index.name}`);}return result;};
      core.getMany=async request=>{const result=await get(request);metrics[key]+=result.filter(Boolean).length;return result;};
      core.openCursor=async request=>{const result=await open(request);if(result&&request.values){metrics.indexes.push(`${name}:${request.query.index.name}`);const start=result.start.bind(result);result.start=callback=>start(()=>{metrics[key]++;callback();});}return result;};
      restore.push(()=>{core.query=query;core.getMany=get;core.openCursor=open;});}
    try{return {result:await readWorldDayOverview('u',now),metrics};}finally{restore.forEach(fn=>fn());}
  };
  const small=await sample();(window as any).worldOverviewCost=small;
  check(small.metrics.occurrences<=80,`bounded occurrence reads: expected <=80, got ${small.metrics.occurrences}`);
  check(small.result.today===4&&small.result.unplanned===2,'today overrides, rescheduling, completed/cancelled/deleted and foreign rows are counted correctly');
  check(!small.metrics.indexes.includes('todoOccurrences:userId'),'overview never reads account-wide occurrence history');
  await db.todoOccurrences.bulkPut(history(10000,20000));
  const large=await sample();
  check(large.metrics.occurrences===small.metrics.occurrences&&large.metrics.templates===small.metrics.templates,'adding 20000 unrelated historical occurrences does not increase materialized reads');
  check(large.result.today===4&&large.result.unplanned===2,'counts remain correct with 30000 historical occurrences');
  await db.todoOccurrences.update(occurrenceId('daily-out',day),{dueDate:day});
  check((await readWorldDayOverview('u',now)).today===5,'rescheduled original returns to today exactly once');
  await db.todos.update('daily-valid',{userId:'v'});
  check((await readWorldDayOverview('u',now)).today===4,'template ownership transfer is rechecked without cache');
  await db.todos.update('unplanned-fresh',{status:'deleted'});
  check((await readWorldDayOverview('u',now)).unplanned===1,'deleted unplanned template disappears');
  check((await readWorldDayOverview('u',new Date('2026-10-23T12:00:00'))).day==='2026-10-23','next-day query uses current local day');
  const RealDate=Date,realSetTimeout=window.setTimeout.bind(window);let clock=now.getTime(),midnightWake:(()=>void)|undefined,intervalCalls=0;
  const realSetInterval=window.setInterval;
  (window as any).Date=class extends RealDate{constructor(...args:any[]){super(0);return Reflect.construct(RealDate,args.length?args:[clock],new.target);}static now(){return clock;}};
  window.setTimeout=((handler:TimerHandler,delay?:number,...args:any[])=>{if(typeof handler==='function'&&(delay??0)>1000){midnightWake=()=>handler(...args);return 2147480000;}return realSetTimeout(handler,delay,...args);}) as typeof window.setTimeout;
  window.setInterval=((...args:any[])=>{intervalCalls++;return (realSetInterval as any)(...args);}) as typeof window.setInterval;
  useAuthStore.setState({userId:'u'});
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  function Overview(){const owner=useAuthStore(state=>state.userId);const data=useWorldDayOverview(owner,true);return React.createElement('div',{'data-owner':owner},JSON.stringify(data));}
  root.render(React.createElement(Overview));
  await until(()=>host.textContent?.includes(day)===true);
  check(!!midnightWake,'production overview hook schedules a single next-local-midnight refresh');
  clock=new RealDate('2026-10-23T00:00:01').getTime();midnightWake!();
  await until(()=>host.textContent?.includes('2026-10-23')===true);
  check(true,'midnight wake replaces yesterday counts using the new local day');
  clock=new RealDate('2026-10-24T12:00:00').getTime();document.dispatchEvent(new Event('visibilitychange'));
  await until(()=>host.textContent?.includes('2026-10-24')===true);
  check(true,'visibility restoration invalidates old day without periodic history recomputation');
  clock=new RealDate('2026-10-25T12:00:00').getTime();window.dispatchEvent(new Event('focus'));
  await until(()=>host.textContent?.includes('2026-10-25')===true);
  check(true,'focus restoration handles changed clock/day');
  check(intervalCalls===0,'production overview hook installs no polling interval');
  useAuthStore.setState({userId:'v'});
  await until(()=>host.querySelector('[data-owner="v"]')!==null&&host.textContent?.includes('"unplanned":0')===true);
  check(true,'auth change replaces old owner summary without leaking prior counts');
  root.unmount();window.Date=RealDate;window.setTimeout=realSetTimeout;window.setInterval=realSetInterval;
  await db.delete();return {complete:true,scope:'Synthetic isolated desktop Chrome IndexedDB; no Android/private DB/model timing',small,large,checks};
}});
