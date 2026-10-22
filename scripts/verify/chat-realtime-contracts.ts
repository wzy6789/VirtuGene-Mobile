import assert from 'node:assert/strict';
import {createRealtimeClock,createRealtimeFrameMeter,realtimeBudgetBytes} from '../../src/lib/chat-scene/realtime-policy';
import {createScenePerformanceGuard} from '../../src/lib/chat-scene/scene-performance';
import {reserveRealtimeBytes,inspectRealtimeResources} from '../../src/lib/chat-scene/realtime-budget';
import {acquireSceneModel,inspectRealtimeModelResources} from '../../src/lib/chat-scene/realtime-model-assets';
let checks=0;const check=(name:string,fn:()=>void)=>{fn();checks++;console.log('PASS',name);};
const clock=createRealtimeClock();clock.step(100);clock.step(116);clock.suspend();
check('resume excludes the full hidden wall interval',()=>{clock.step(100000);assert.equal(clock.seconds,.016);clock.step(100016);assert.equal(clock.seconds,.032);});
check('stalled active render cannot inject an unbounded animation jump',()=>{clock.step(101000);assert(clock.seconds<.12);});
const meter=createRealtimeFrameMeter();meter.frame(100);meter.frame(1100);
check('performance measures real rendered time rather than the clamped animation clock',()=>assert.equal(meter.fps,1));
const slowGuard=createScenePerformanceGuard();for(let i=0;i<8;i++)slowGuard.sample(meter.fps,slowGuard.level>=2?18:24,4000);
check('sustained slow actual rendering can reach every fallback tier',()=>assert.equal(slowGuard.level,4));
meter.suspend();meter.frame(100000);meter.frame(100050);
check('frame meter excludes the paused wall interval on resume',()=>assert.equal(meter.fps,20));
const cost=realtimeBudgetBytes(390,844,3,'balanced',1080,2400,812368);
check('actual poster plus one real scene fits auto budget',()=>assert(cost+1080*2400*4<48*1024*1024));
const first=reserveRealtimeBytes(cost,1080*2400*4,48*1024*1024)!;
check('a different fully decoded preview cannot exceed the merged cap',()=>assert.equal(reserveRealtimeBytes(cost,2*1080*2400*4,48*1024*1024),undefined));
first.release();first.release();check('budget lease releases idempotently',()=>assert.equal(inspectRealtimeResources().realtimeHosts,0));
const nativeFetch=globalThis.fetch;let calls=0,resolveResponse:((response:Response)=>void)|undefined,sharedSignal:AbortSignal|undefined;
globalThis.fetch=async(_input,options)=>{calls++;sharedSignal=options?.signal??undefined;return new Promise(resolve=>{resolveResponse=resolve;});};
try{
 const leaving=new AbortController(),staying=new AbortController();
 const a=acquireSceneModel('local-model',3,leaving.signal).catch(error=>error.name),b=acquireSceneModel('local-model',3,staying.signal);
 leaving.abort();check('cancelled preview does not cancel the shared model fetch',()=>{assert.equal(calls,1);assert.equal(sharedSignal?.aborted,false);assert.equal(inspectRealtimeModelResources().modelReferences,1);});
 resolveResponse!(new Response(new Uint8Array([1,2,3])));const lease=await b;await a;
 check('remaining model consumer receives complete immutable data',()=>assert.deepEqual([...new Uint8Array(lease.buffer)],[1,2,3]));
 lease.release();lease.release();check('final model consumer retires its entry',()=>assert.equal(inspectRealtimeModelResources().modelEntries,0));
 const cancel=new AbortController(),late=acquireSceneModel('late-model',1,cancel.signal).catch(error=>error.name);cancel.abort();resolveResponse!(new Response(new Uint8Array([4])));assert.equal(await late,'AbortError');await new Promise(resolve=>setTimeout(resolve,0));
 check('uncancellable late response keeps no retired model references',()=>assert.equal(inspectRealtimeModelResources().modelReferences,0));
 globalThis.fetch=async()=>new Response('broken',{status:503});let failed=false;try{await acquireSceneModel('failed-model',1,new AbortController().signal);}catch{failed=true;}
 check('HTTP model failure rolls back its entry',()=>{assert(failed);assert.equal(inspectRealtimeModelResources().modelEntries,0);});
}finally{globalThis.fetch=nativeFetch;}
console.log(JSON.stringify({status:'pass',checks}));
