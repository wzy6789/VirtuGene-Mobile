import {readFileSync,writeFileSync,readdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='release/chat-reply-source-question-20261019';
const read=p=>JSON.parse(readFileSync(p,'utf8')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const find=(pattern,predicate)=>readdirSync(root).filter(n=>pattern.test(n)).toSorted().reverse().map(n=>({path:root+'/'+n,data:read(root+'/'+n)})).find(r=>predicate(r.data));
const accepted=find(/^checks-\d+\.json$/,r=>r.complete&&r.checks.length===53);
const before=find(/^before-\d+\.json$/,r=>!r.complete&&r.checks.length===53);
const stock=find(/^stock-\d+\.json$/,r=>r.complete);
assert.ok(accepted&&before&&stock,'Current53, frozen53 and successful full stock evidence required');
assert.equal(before.data.failures.length,14);assert.equal(stock.data.checks.length,17);
const files=['src/lib/chat-humanizer.ts','src/lib/chat-turn-cues.ts'];
for(const path of files)assert.equal(hash(path),accepted.data.sourceHashesAfter[path]);
assert.ok(accepted.data.stableSources&&stock.data.stableSources);
const parity=accepted.data.native.map((row,i)=>{
 const a=before.data.native[i],b=row;
 const generation=body=>Object.fromEntries(Object.entries(body).filter(([k])=>k!=='messages'));
 const history=body=>body.messages.filter(m=>m.role!=='system');
 assert.deepEqual(generation(a.mainRequests[0]),generation(b.mainRequests[0]));
 assert.deepEqual(history(a.mainRequests[0]),history(b.mainRequests[0]));
 return {name:b.name,generationParametersUnchanged:true,nonSystemHistoryUnchanged:true,thinking:b.mainRequests[0].thinking,reasoningEffort:b.mainRequests[0].reasoning_effort};
});
const patches=[];
for(const p of files){
 const snapshot=root+'/accepted-'+p.split('/').at(-1);
 if(existsSync(snapshot))assert.equal(hash(snapshot),hash(p));else copyFileSync(p,snapshot);
 const diff=spawnSync('git',['-c','core.autocrlf=false','diff','--no-index','--ignore-cr-at-eol','--',root+'/before/'+p,p],{encoding:'utf8'});
 assert.equal(diff.status,1);patches.push(diff.stdout);
}
writeFileSync(root+'/production.patch',patches.join('\n'));
const attempts=readdirSync(root).filter(n=>/^(?:checks|before|stock)-\d+\.json$/.test(n)).map(n=>{const path=root+'/'+n,r=read(path);return {path,sha256:hash(path),complete:r.complete,checks:r.checks?.length??0,failures:r.failures?.length??null,error:r.error??null};});
const expressionLog=readFileSync(root+'/logs/expression.log','utf16le');assert.ok(expressionLog.includes('PASS chat-expression: 3854 checks'));
const dailyPath='release/chat-daily-style-20261019/checks-1792404127930.json';assert.ok(read(dailyPath).complete&&read(dailyPath).checks.length===262);
const report={date:'2026-10-19',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,
 scope:'Original T7: direct challenge to the actor\'s previous claim. Fix routing and contradictory mood hints, not a factuality guarantee or a new personality system.',
 precedingRealThinkingStudy:{path:'docs/CHAT-GU-THINKING-WULIN-2026-10-19.json',actualRequests:4,model:'deepseek-flash',thinking:'enabled',reasoningEffort:'low',wholeTrajectoryAccepted:false,observedFailure:'Unsupported flower in a garden, then incompatible explanation; all original output retained.'},
 rootCause:['The actual second thinking request had no experience-reconciliation block. The old cue required a direct 你 + past-time + interrogative form, and missed a deictic conditional challenge.','Its positive mood word instead produced a celebration instruction. A related opinion-invitation hint could even say the user was not questioning the character\'s judgment.','Existing common source instructions were already present and still failed in the real run; adding another generic prohibition cannot certify truthful output.'],
 changes:['Recognize a bounded direct provenance question independently of mood, before ordinary action selection. Retain quotation/report/translation/explicit creative exclusions.','Reuse the existing experience evidence block and source boundaries; current authored background and independent life hints remain usable. Old assistant self-report is not independent evidence.','On these challenge turns, suppress competing celebration/emotional guidance and the no-challenge opinion hint. Do not rewrite history, assert fabrication, erase preferences, or add a model judge/DB retrieval.'],
 production:files.map(path=>({path,sha256:hash(path),beforeSnapshot:root+'/before/'+path,beforeSha256:hash(root+'/before/'+path),acceptedSnapshot:root+'/accepted-'+path.split('/').at(-1)})),
 verificationFiles:['scripts/verify/chat-reply-source-question.ts','scripts/verify/chat-reply-source-question.mjs','scripts/verify/chat-reply-source-stock.mjs','scripts/verify/chat-reply-source-report.mjs','scripts/verify/chat-continuity-resume.ts'].map(path=>({path,sha256:hash(path)})),
 verification:{focused:{path:accepted.path,checks:53},frozenBefore:{path:before.path,checks:53,failures:14},parity,expression:{checks:3854,log:root+'/logs/expression.log'},daily:{path:dailyPath,checks:262},typecheck:{exitCode:0,log:root+'/logs/types.log'},stock:{path:stock.path,checks:17,counts:stock.data.fixture.counts,timing:stock.data.timing,readCountersIdentical:true,fixtureIssue:'Three failed preparation attempts retained. Adding plain messages to a serialized fixture bypassed native messageHistorySearch maintenance; fixed by writing the extra synthetic messages before native export. No production index disabled or hash check removed.'},attempts},
 newUsage:{paidModelRequests:0,promptTokens:0,completionTokens:0,costUSD:0},
 limitations:['The initial unsupported self-disclosure remains open. Prompt routing tests do not establish that a real model now repairs it truthfully.','This is a finite local cue with explicit source boundaries, not general semantic provenance recognition.','Stock transport replies are fixed local text. Preparation timings are desktop send-to-request observations, not TTFT, visible-frame or Android measurements.','No same-condition before/after UI recording. Existing preview and genuine four-turn transcript predate this fix and are not new-model acceptance.','No version, APK, install, publishing, microphone or audio changes. Sidebar project identity not newly confirmed; no Codex internal state edited.']};
writeFileSync('docs/CHAT-REPLY-SOURCE-QUESTION-2026-10-19.json',JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath),t7=progress.tasks?.find(t=>t.id==='T7')??progress.phases?.find(t=>t.id==='T7');
// The current progress document is intentionally updated only when its known
// original T7 record is found; never silently create a parallel task ledger.
assert.ok(t7,'Original T7 record missing');
t7.status='real-thinking-failure-observed-repair-routing-locally-fixed';
t7.remaining='Exact provenance challenge now reaches existing evidence reconciliation without contradictory mood hints. Initial unsupported self-disclosure and post-fix genuine-model repair remain unverified; full whole-dialogue human scoring still open.';
if(!t7.evidence.includes('docs/CHAT-REPLY-SOURCE-QUESTION-2026-10-19.json'))t7.evidence.push('docs/CHAT-REPLY-SOURCE-QUESTION-2026-10-19.json');
progress.fullPlanComplete=false;progress.next='Original T7 grounding and T8 whole-dialogue acceptance remain open. Preserve failed thinking originals and local repair evidence; no additional paid calls in this phase.';
progress.replySourceQuestion={path:'docs/CHAT-REPLY-SOURCE-QUESTION-2026-10-19.json',localChecks:53,newPaidCalls:0,realModelImprovementVerified:false};
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
console.log(JSON.stringify({path:'docs/CHAT-REPLY-SOURCE-QUESTION-2026-10-19.json',checks:53,frozenFailures:14,stockChecks:17,fullPlanComplete:false,newPaidCalls:0}));
