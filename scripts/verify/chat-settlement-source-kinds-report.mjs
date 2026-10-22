import {readFileSync,writeFileSync,readdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='release/chat-settlement-source-kinds-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8')),hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const find=(prefix,predicate)=>readdirSync(root).filter(n=>new RegExp('^'+prefix+'-\\d+\\.json$').test(n)).toSorted().reverse().map(n=>({path:root+'/'+n,data:read(root+'/'+n)})).find(r=>predicate(r.data));
const after=find('checks',r=>r.complete&&r.checks.length===66),before=find('before',r=>!r.complete&&r.checks.length===66);
assert.ok(after&&before);assert.equal(before.data.failures.length,19);
const files=['src/store/emotion-store.ts','src/lib/ai/context-consolidator.ts'];
const patches=[];
for(const path of files){
 assert.equal(hash(path),after.data.sourceHashesAfter[path]);
 const snapshot=root+'/accepted-'+path.split('/').at(-1);if(existsSync(snapshot))assert.equal(hash(snapshot),hash(path));else copyFileSync(path,snapshot);
 const diff=spawnSync('git',['-c','core.autocrlf=false','diff','--no-index','--ignore-cr-at-eol','--',root+'/before/'+path,path],{encoding:'utf8'});assert.equal(diff.status,1);patches.push(diff.stdout);
}
writeFileSync(root+'/production.patch',patches.join('\n'));
const settlementPath='release/chat-settlement-guard-20261018/live-1792404905775.json',settlement=read(settlementPath);assert.ok(settlement.complete&&settlement.checks.length===70);
const stock=settlement.rows.find(r=>r.scenario==='stock-guard-only');assert.equal(stock.reads['messages.getMany'].returned,96);assert.equal(stock.reads['messages.count'].calls,2);
const memoryPath=root+'/memory-regressions/memory-regressions.json',memory=read(memoryPath);assert.deepEqual(memory.map(r=>[r.suite,r.passed,r.checks]),[['memory-continuity',true,77],['memory-final',true,48],['character-memory',true,415]]);
const withoutMessages=body=>Object.fromEntries(Object.entries(body).filter(([key])=>key!=='messages'));
assert.deepEqual(withoutMessages(before.data.wire),withoutMessages(after.data.wire));assert.ok(after.data.stableSources);
const report={date:'2026-10-19',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,
 scope:'Original dual-source responsibility and T7 grounded continuity: prevent assistant-generated premises from being salvaged into user facts or matters during existing background settlement.',
 rootCause:['The settlement store filtered mixed evidence indexes instead of rejecting the candidate. A source list containing an assistant claim and a user question lost the assistant premise but still created the alleged fact and a matter.','The real response parser silently dropped out-of-range/fractional values and coerced strings, null and booleans into indexes. Invalid evidence could become a valid-looking remainder before storage.','The local settlement prompt explicitly requested AI character autobiography/promises as memories, contradicting the existing user-only source/storage contract.'],
 changes:['Reject a memory/matter evidence list in its entirety if any cited item is not a JSON integer index pointing to a user message. Normalize duplicate valid user indexes only.','Apply that rule both in the actual client response parser and at the store write boundary. Preserve valid independent outputs in the same transaction; normal explicit completions still work.','Replace the contradictory memory instruction with user-confirmed facts/agreements and user-only numbered evidence. Character speech still supports existing emotional analysis, not independently verified events.','No additional query, generation, judge, table, schema or main-reply parameter introduced. This is finite source eligibility, not semantic truth verification of every user-only paraphrase.'],
 production:files.map(path=>({path,sha256:hash(path),before:root+'/before/'+path,beforeSha256:hash(root+'/before/'+path),accepted:root+'/accepted-'+path.split('/').at(-1)})),
 verificationFiles:['scripts/verify/chat-settlement-source-kinds.ts','scripts/verify/chat-settlement-source-kinds.mjs','scripts/verify/chat-settlement-source-kinds-report.mjs','scripts/verify/chat-settlement-memory-regressions.mjs'].map(path=>({path,sha256:hash(path)})),
 tests:{accepted:{path:after.path,checks:66},before:{path:before.path,checks:66,failures:19},settlement:{path:settlementPath,checks:70},memory:{path:memoryPath,results:memory},types:{exitCode:0,log:root+'/logs/types.log'},stock:{fixture:stock.fixture,reads:stock.reads,scope:'Existing guard-only preflight+commit revalidation; not full sender/settlement timings or Android. Two selected48-message batches, no unrelated body scan.'},generationParametersUnchanged:true,localBackgroundWire:withoutMessages(after.data.wire),attempts:readdirSync(root).filter(n=>/^(checks|before)-\d+\.json$/.test(n)).map(n=>{const path=root+'/'+n,r=read(path);return {path,sha256:hash(path),complete:r.complete,checks:r.checks?.length??0,failures:r.failures?.length??null,error:r.error??null};})},
 usage:{newPaidRequests:0,newPromptTokens:0,newCompletionTokens:0,newCostUSD:0},
 limitations:['This does not fix the first generated unsupported life detail or prove post-fix naturalness. Prior four genuine thinking replies remain a failed quality trajectory.','A malicious/incorrect model can still cite only eligible user messages while paraphrasing them incorrectly. Valid message provenance is not semantic proof.','Tests use synthetic Tang Wulin/Gu Yue Na input and local replacement model output. No new real-model/phone/UI measurement.','Fixture failures retained: create() returns void rather than an ID; a manually maintained item requires an explicit completion command, not merely a narrative of a visit. Corrected the fixtures without weakening those production rules.','Background extraction already requested thinking disabled/temperature0.3; that configuration is unchanged. User-facing main-chat thinking mode remains unchanged.','No same-condition before/after screenshots, audio/microphone, app build/version/APK/install or publication in this phase. Sidebar project identity not newly verified.']};
writeFileSync('docs/CHAT-SETTLEMENT-SOURCE-KINDS-2026-10-19.json',JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const id of ['T3','T7']){const task=progress.tasks.find(t=>t.id===id);assert.ok(task);task.evidence??=[];if(!task.evidence.includes('docs/CHAT-SETTLEMENT-SOURCE-KINDS-2026-10-19.json'))task.evidence.push('docs/CHAT-SETTLEMENT-SOURCE-KINDS-2026-10-19.json');}
progress.settlementSourceKinds={path:'docs/CHAT-SETTLEMENT-SOURCE-KINDS-2026-10-19.json',localChecks:66,sourceSalvageBugFixed:true,newPaidCalls:0,semanticAccuracyProven:false};
progress.fullPlanComplete=false;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
console.log(JSON.stringify({path:'docs/CHAT-SETTLEMENT-SOURCE-KINDS-2026-10-19.json',focused:66,frozenFailures:19,settlement:70,memory:540,newPaidCalls:0,fullPlanComplete:false}));
