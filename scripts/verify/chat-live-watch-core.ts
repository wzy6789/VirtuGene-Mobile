import Dexie,{type Table,type ObservabilitySet} from 'dexie';
import {ChatLiveSourceWatch} from '../../src/lib/chat/live-source-watch';
import {ChatReplyStream} from '../../src/lib/chat-stream';

// Mechanism-only fixture: this database exists only in an isolated browser
// context. Actual sender/provenance validation is exercised separately.
type Source={id:string;revision:number;text:string};
const databaseName='VirtuGene-Isolated-Live-Watch-Core-20261019';
const fixture=new Dexie(databaseName);
fixture.version(1).stores({sources:'id'});
const sources=fixture.table('sources') as Table<Source,string>;
const api=window as any;
function deferred<T=void>(){let resolve!:(value:T)=>void;let reject!:(cause:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const ownParts=()=>({['idb://'+databaseName+'/sources/']: {}} as ObservabilitySet);
function makeHarness(validate:(full:boolean)=>Promise<void>){
  const stream=new ChatReplyStream('synthetic-live-watch-session',()=>undefined);
  const state={pauses:0,resumes:0,invalidations:0,error:'',publications:[] as string[][]};
  stream.subscribe(()=>state.publications.push([...stream.getSnapshot()]));
  const watch=new ChatLiveSourceWatch({databaseName,validate,
    pause:()=>{state.pauses++;stream.setPublicationPaused(true);},
    resume:()=>{state.resumes++;stream.setPublicationPaused(false);},
    invalid:error=>{state.invalidations++;state.error=error.message;stream.stop();},
  });
  return{watch,stream,state,dispose(){watch.dispose();stream.dispose();}};
}
api.runWatchCore=async()=>{
  await fixture.open();await sources.clear();
  const checks:string[]=[],details:unknown[]=[];
  const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);api.watchCoreProgress=label;};
  {
    let calls=0;const a=deferred(),aEntered=deferred(),b=deferred(),bEntered=deferred();
    const h=makeHarness(async()=>{calls++;if(calls===2){aEntered.resolve();await a.promise;}if(calls===3){bEntered.resolve();await b.promise;}});
    await h.watch.check(true);h.stream.push('先说一半。');
    const pending=h.watch.check(true);await aEntered.promise;
    h.stream.push('先说一半。\n---\n尚未核验的后半段。');
    Dexie.on.storagemutated.fire(ownParts());
    Dexie.on.storagemutated.fire(ownParts());
    check(h.stream.getSnapshot().join('')==='先说一半。','a pending check holds all newly received text');
    a.resolve();await bEntered.promise;
    check(h.state.resumes===1&&h.stream.getSnapshot().length===1,'older successful check cannot resume after a newer mutation');
    b.resolve();await pending;
    check(calls===3&&h.state.resumes===2,'multiple in-flight notifications coalesce into one fresh follow-up check');
    check(h.stream.getSnapshot().join('')==='先说一半。尚未核验的后半段。','latest accumulated text resumes once after the newest evidence passes');
    details.push({case:'coalescing',calls,...h.state});h.dispose();
  }
  {
    const stream=new ChatReplyStream('synthetic-pause-finish',()=>undefined);
    stream.push('已经显示。');stream.setPublicationPaused(true);
    let finished=false;const pending=stream.finish('已经显示。\n---\n等待核验。').then(()=>{finished=true;});
    await Promise.resolve();
    check(!finished&&stream.getSnapshot().join('')==='已经显示。','finish remains pending and never reveals queued text while paused');
    stream.setPublicationPaused(false);await pending;
    check(finished&&stream.getSnapshot().length===2,'resume flushes the final snapshot and resolves finish');stream.dispose();
  }
  {
    const stream=new ChatReplyStream('synthetic-stop-paused',()=>undefined);
    stream.push('保留可见部分。');stream.setPublicationPaused(true);
    let finished=false;const pending=stream.finish('保留可见部分。\n---\n不得泄漏。').then(()=>{finished=true;});
    stream.stop();await pending;stream.setPublicationPaused(false);stream.push('不得泄漏。');
    check(finished&&stream.getSnapshot().join('')==='保留可见部分。','stop resolves paused drain while permanently freezing the visible prefix');stream.dispose();
  }
  {
    const gate=deferred(),entered=deferred();let calls=0;
    const h=makeHarness(async()=>{calls++;entered.resolve();await gate.promise;});
    const pending=h.watch.check(true).then(()=>'',error=>error.message);await entered.promise;
    h.stream.push('未发布的等待结果。');const finish=h.stream.finish();
    h.dispose();gate.resolve();const error=await pending;await finish;
    Dexie.on.storagemutated.fire(ownParts());
    check(error==='chat:request_finished'&&h.state.resumes===0&&h.stream.getSnapshot().length===0,'disposed watcher never resumes a late successful check or its queued stream');
    check(calls===1,'dispose removes storage subscription and does not schedule another validation');
  }
  {
    const denied=Error('chat:history_changed');let calls=0;
    const h=makeHarness(async()=>{calls++;throw denied;});
    const first=await h.watch.check(true).then(()=>undefined,error=>error);
    const second=await h.watch.check(false).then(()=>undefined,error=>error);
    h.stream.push('失效草稿。');
    check(first===denied&&second===denied&&calls===1,'a failed check is sticky across later physical-request checks without regeneration');
    check(h.state.invalidations===1&&h.stream.getSnapshot().length===0,'invalid callback fires once and permanently prevents publication');h.dispose();
  }
  {
    let calls=0,fullFlags:boolean[]=[];const h=makeHarness(async full=>{calls++;fullFlags.push(full);});
    await h.watch.check(false);const before={calls,pauses:h.state.pauses};
    Dexie.on.storagemutated.fire({'idb://Another-Database/sources/':{}} as ObservabilitySet);
    await Promise.resolve();
    check(calls===before.calls&&h.state.pauses===before.pauses,'an unrelated database notification neither pauses nor reads sources');
    Dexie.on.storagemutated.fire({all:{}} as ObservabilitySet);await h.watch.check(false);
    check(calls===before.calls+1&&fullFlags.at(-1)===true,'global all invalidation requests full fresh evidence validation');
    const beforeRollback={calls,pauses:h.state.pauses};
    try{await fixture.transaction('rw',sources,async()=>{await sources.put({id:'rolled-back',revision:1,text:'synthetic'});throw Error('synthetic rollback');});}catch{}
    await sources.get('rolled-back');
    check(calls===beforeRollback.calls&&h.state.pauses===beforeRollback.pauses&&!await sources.get('rolled-back'),'an aborted real IndexedDB transaction emits no storage-mutation validation');
    details.push({case:'notification-scope',calls,fullFlags,...h.state});h.dispose();
  }
  {
    await sources.put({id:'selected',revision:1,text:'original'});
    const entered=deferred(),release=deferred();let hold=false,calls=0;
    const h=makeHarness(async()=>{calls++;if(hold){entered.resolve();await release.promise;}const row=await sources.get('selected');if(row?.revision!==1)throw Error('chat:history_changed');});
    await h.watch.check(true);h.stream.push('已见前段。');hold=true;
    await sources.update('selected',{revision:2,text:'edited'});await entered.promise;
    h.stream.push('已见前段。\n---\n修改后不能再出现的后段。');
    check(h.stream.getSnapshot().length===1,'a real same-page commit pauses before a following token publication');
    release.resolve();await h.watch.check(true).catch(()=>undefined);
    check(h.state.invalidations===1&&h.state.error==='chat:history_changed'&&h.stream.getSnapshot().length===1,'a real committed source edit permanently freezes the old stream');
    details.push({case:'same-page-source-edit',calls,...h.state});h.dispose();
  }
  return{complete:true,checks,details,paidCalls:0,scope:'ChatLiveSourceWatch and ChatReplyStream with deferred checks and isolated native IndexedDB; actual sender evidence checks are covered in a separate suite.'};
};

let cross:ReturnType<typeof makeHarness>|undefined,crossListener:((parts:ObservabilitySet)=>void)|undefined;
api.setupCrossWatch=async(mode:'selected-edit'|'unrelated-edit')=>{
  cross?.dispose();if(crossListener)Dexie.on.storagemutated.unsubscribe(crossListener);
  await fixture.open();await sources.bulkPut([{id:'selected',revision:1,text:'original'},{id:'unrelated',revision:1,text:'irrelevant'}]);
  const state={mode,notifications:0,notificationKeys:[] as string[],validated:0,observedText:''};api.crossWatchState=state;
  cross=makeHarness(async()=>{const row=await sources.get('selected');state.validated++;if(row?.revision!==1)throw Error('chat:history_changed');});
  await cross.watch.check(true);cross.stream.push('跨页前段。');
  crossListener=parts=>{
    const keys=Object.keys(parts).filter(key=>key.startsWith('idb://'+databaseName+'/'));
    if(!keys.length)return;state.notifications++;state.notificationKeys.push(...keys);
    // Registered after the production watcher: a text chunk that arrives in
    // this same notification turn must already be paused.
    cross!.stream.push('跨页前段。\n---\n跨页通知后的后段。');
    state.observedText=cross!.stream.getSnapshot().join('');
  };
  Dexie.on.storagemutated.subscribe(crossListener);
  return api.crossWatchSnapshot();
};
api.crossWatchSnapshot=()=>({...api.crossWatchState,...cross?.state,snapshot:cross?.stream.getSnapshot()});
api.writeCrossSource=async(id:'selected'|'unrelated')=>{await fixture.open();await sources.update(id,{revision:2,text:'second-page-only synthetic mutation'});return await sources.get(id);};
api.disposeCrossWatch=()=>{cross?.dispose();if(crossListener)Dexie.on.storagemutated.unsubscribe(crossListener);crossListener=undefined;};
