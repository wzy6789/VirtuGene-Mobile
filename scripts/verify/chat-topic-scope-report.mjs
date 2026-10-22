import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-topic-scope-20261018/';
const read=path=>readFileSync(path,'utf8');
const extract=(path,pattern)=>{const match=read(root+path).match(pattern);if(!match)throw Error('Missing passing evidence '+path);return Number(match[1]);};
const integration=JSON.parse(read(root+'integration.json'));
if(!integration.complete||integration.turns.length!==6)throw Error('Integration acceptance incomplete');
const performancePath=JSON.parse(read(root+'performance.log').trim().split(/\r?\n/u).at(-1)).evidence;
const performance=JSON.parse(read(performancePath));if(!performance.complete)throw Error('Incomplete synthetic performance comparison');
if(read(root+'types.log').trim())throw Error('Type check needs review');
const report={date:'2026-10-18',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',
 stage:'T4 focus-control and subject-listening substep; not a substitute for sourced persistent topic outcomes',
 files:['src/lib/chat-turn-cues.ts','src/lib/chat-conversation-state.ts'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),
 changes:['Declined named-topic clauses no longer make the old subject relevant; later affirmative clauses are preserved.','Quoted/hypothetical/writing/reported material cannot issue this control; a later independent speaker-owned sentence may do so.','A current no-analysis/no-advice directive uses topicAdvice, while explicitly enduring preferences remain persistent.','Style-only interjections retain the underlying subject, and later substantive content is compared against that subject rather than against the interjection.'],
 checks:{local:JSON.parse(read(root+'checks.json')).checks,expression:extract('expression-final.log',/PASS chat-expression: (\d+) checks/u),summaryEntry:extract('summary.log',/PASS chat-summary-entry: (\d+) checks/u),stream:extract('stream.log',/PASS chat-stream: (\d+) checks/u),typeCheck:'recorded process exit 0',actualComponentTurns:6},
 evidence:{root,integration:root+'integration.json',red:[root+'red.log',root+'reported-red.log',root+'anchor-red.log'],performance:performancePath},
 observedRequestConfiguration:integration.turns[0].generation,actualUpstreamModel:'none: synthetic transport, no model invoked',paidCalls:0,inputTokens:0,outputTokens:0,
 performance:{scope:performance.scope,fixture:performance.phases[0].fixture,phases:performance.phases.map(p=>({phase:p.phase,samples:p.samples.map(s=>({prepareMs:s.prepareMs,endMs:s.endMs,inputSha256:s.inputSha256,tombstoneReads:s.reads['memorySourceTombstones.query']}))})),sameInputHashEachPair:performance.phases[0].samples.map((s,i)=>s.inputSha256===performance.phases[1].samples[i].inputSha256),limit:'Four sequential desktop mock samples, not Android or decoded UI latency and not a general speed guarantee.'},
 rulings:['Old tests treated bare current no-advice directives as permanent preferences; updated to subject scope and retained a separate explicit enduring preference fixture. Stored older preferences are not silently erased.','The named-negative-summary failure from the prior stage is now restored to real final-payload acceptance, alongside relevant and unrelated summary cases.'],
 invariants:{newDbQueries:0,newModelCalls:0,authorizationCache:false,recordsDeletedByFocusControl:false,thinkingChanged:false,microphoneUsed:false,versionChanged:false,apkBuilt:false,deployed:false},
 remaining:['T3 sourced date/time/place corrections and exact old-claim filtering remain pending.','T4 answered/resolved/cancelled/deferred topic records, known slots, explicit reopening and cross-session lifetime are not implemented by this focus patch.','T5/T6 source-version/CAS protection and deletion, competing writes, account and branch acceptance remain pending.','T7/T8 full character differences, right-panel styled preview at all widths and human/model quality acceptance remain pending.'],
 android:false,fullApplicationRestart:false,sameConditionBeforeAfterMedia:false,allPlanRequirementsMet:false,goalComplete:false,
};
writeFileSync('docs/CHAT-TOPIC-SCOPE-2026-10-18.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:report.checks,paidCalls:0,sameInputs:report.performance.sameInputHashEachPair,goalComplete:false}));
