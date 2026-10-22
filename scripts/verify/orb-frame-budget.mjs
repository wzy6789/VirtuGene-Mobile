import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.VG_ORB_BUDGET_OUT??'.tmp-preview/stage2-ui-20261018/S09-C2b/math';mkdirSync(out,{recursive:true});
const compiled=await build({entryPoints:['src/lib/soul-orb-motion.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const lib=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64')),report={checks:[]};
const check=(ok,name,data)=>{report.checks.push({pass:!!ok,name,data});assert(ok,name+' '+JSON.stringify(data??''));};
const feed=(budget,from,to,interval,blocked=false)=>{for(let t=from;t<=to+.001;t+=interval)budget.sample(t,blocked);};
try{
 check(typeof lib.createOrbFrameBudget==='function','shared clock exposes pure frame-budget policy');
 for(const hz of [60,120,165]){const b=lib.createOrbFrameBudget();feed(b,0,15000,1000/hz);check(b.state().mode==='full',hz+'Hz raw frames do not mistake30Hz painting for dropped frames',b.state());}
 const b=lib.createOrbFrameBudget();feed(b,0,2999,40);check(b.state().mode==='full','less than three complete bad windows cannot downgrade');b.sample(3000);check(b.state().mode==='static','three consecutive1s bad windows stop decoration',b.state());
 feed(b,3020,12000,20);check(b.state().mode==='static','nine seconds of recovery remain static');feed(b,12020,14040,20);check(b.state().mode==='gentle'&&b.state().recoveries===1,'ten continuous stable seconds restore only gentle motion',b.state());
 feed(b,14080,18080,40);check(b.state().mode==='static'&&b.state().locked,'second sustained overload locks decoration static');feed(b,18100,40000,20);check(b.state().mode==='static'&&b.state().recoveries===1,'recovery attempt is bounded for this app session');
 for(const blocker of ['call','drag']){const q=lib.createOrbFrameBudget();feed(q,0,3000,40);feed(q,3020,16000,20,true);check(q.state().mode==='static',blocker+' prevents recovery despite good frame times');feed(q,16020,25000,20);check(q.state().mode==='static',blocker+' release does not inherit blocked stable time');feed(q,25020,27060,20);check(q.state().mode==='gentle',blocker+' requires a fresh stable window before restoration');}
 const p=lib.createOrbFrameBudget();feed(p,0,2000,40);p.pause();feed(p,60000,62000,40);check(p.state().mode==='full','background pause breaks consecutive overload history');feed(p,62040,63100,40);check(p.state().mode==='static','fresh foreground overload can still downgrade');p.pause();feed(p,100000,109000,20);check(p.state().mode==='static','suspended wall time is not a recovery sample');feed(p,109020,110100,20);check(p.state().mode==='gentle','foreground recovery uses actual stable samples');
 const isolated=lib.createOrbFrameBudget();feed(isolated,0,1000,40);feed(isolated,1020,3020,20);feed(isolated,3060,5060,40);check(isolated.state().mode==='full','good window interrupts consecutive bad windows');isolated.sample(Infinity);isolated.sample(NaN);isolated.sample(-1);check(isolated.state().mode==='full','invalid timestamps do not invent overload');
 // Exercise the real shared clock with deterministic raw rAF. No DOM/audio/model.
 let next=1,time=0;const pending=new Map();globalThis.requestAnimationFrame=fn=>{const id=next++;pending.set(id,fn);return id;};globalThis.cancelAnimationFrame=id=>pending.delete(id);
 const attributes=new Map();globalThis.document={documentElement:{setAttribute:(key,value)=>attributes.set(key,value)}};
 const advance=(duration,interval)=>{const until=time+duration;while(time<until){time+=interval;const ready=[...pending.values()];pending.clear();for(const fn of ready)fn(time);}};
 let frames=0,changes=0;const removeBudget=lib.subscribeOrbFrameBudget(()=>changes++),stop=lib.subscribeSoulOrbFrame(()=>frames++);advance(10000,1000/60);check(lib.orbFrameBudgetState().mode==='full'&&frames>200,'actual throttled paint clock stays full on raw60Hz');advance(4000,40);check(lib.orbFrameBudgetState().mode==='static'&&changes===1,'actual clock publishes only a budget transition');
 const release=lib.holdOrbMotionRecovery();advance(12000,20);check(lib.orbFrameBudgetState().mode==='static','actual active-call hold blocks recovery');check(!lib.soulOrbMotionActivity().scheduled&&pending.size===0,'blocked recovery does not keep a probe RAF running');release();release();advance(12000,20);check(lib.orbFrameBudgetState().mode==='gentle','releasing the hold permits gentle recovery');advance(4000,40);check(lib.orbFrameBudgetState().locked&&!lib.soulOrbMotionActivity().scheduled&&pending.size===0,'locked fallback leaves no perpetual probe RAF');
 check(attributes.get('data-vg-orb-budget')==='static','CSS decoration sees the same budget mode');stop();removeBudget();check(lib.soulOrbMotionActivity().clients===0&&!lib.soulOrbMotionActivity().scheduled,'unmount releases shared driver');report.pass=true;
}catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,pass:report.pass,checks:report.checks.length,failure:report.failure}));
