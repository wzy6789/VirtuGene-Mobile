import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-coverage-fix-20261018/';
const text=path=>readFileSync(path,'utf8');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const count=(path,pattern)=>{const found=text(root+path).match(pattern);if(!found)throw Error('Missing pass evidence '+path);return Number(found[1]);};
const checks={coverage:count('green.log',/"checks":(\d+)/u),expression:count('expression-final.log',/PASS chat-expression: (\d+) checks/u),stream:count('stream.log',/PASS chat-stream: (\d+) checks/u),summaryEntry:count('summary-final.log',/PASS chat-summary-entry: (\d+) checks/u)};
if(!text(root+'gateway-stream.log').includes('ALL PASS'))throw Error('Gateway stream evidence missing');
if(text(root+'types-accepted.log').trim())throw Error('Type output needs review');
const perfPath=JSON.parse(text(root+'performance-final.log').trim().split(/\r?\n/u).at(-1)).evidence;
const performance=JSON.parse(text(perfPath));if(!performance.complete)throw Error('Incomplete performance comparison');
const trace='release/chat-continuity-trace-2026-10-18T11-23-44-296Z/baseline.json';
const boundary='release/chat-continuity-boundary-2026-10-18T11-23-10-682Z/boundary.json';
const b=JSON.parse(text(boundary));
if(b.knownFailures.longCorrectionMissing||b.knownFailures.separateBatchTurnSourcesMissing||b.remainingBoundaryGaps.length)throw Error('Coverage regression still open');
const files=['server/chat-history-policy.mjs','server/chat-history-policy.d.mts','server/gateway.mjs','src/lib/chat-history-window.ts','src/lib/chat/send-service.ts','src/lib/ai/deepseek.ts','src/lib/character-memory.ts','src/db/index.ts'];
const report={date:'2026-10-18',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',
 plan:'C:/Users/34568/Desktop/VirtuGene-Mobile-聊天连续性与人味优化详细方案-2026-10-18.md',
 stage:'T1/T2 primary coverage repairs, not completion of all task cards',
 changedFiles:files.map(path=>({path,sha256:hash(path)})),
 changes:['Private history selected by six user turns, retaining separately linked batches; legacy group-count API remains for existing callers.','Long rendered items preserve original prefix and suffix, with explicit source intervals; omitted middle can be supplied by the bridge.','Bridge differences computed from actual historical intervals and exact summary source revision/offset, not a fixed eighteen-message boundary.','Browser/gateway share six-turn, 1200-per-item and 14000-total character budget; 64-item safety cap replaces bubble-count assumptions.','Already-covered history is not negated by the additional-retrieval no-match wording.','Absent source deletion is an idempotent no-op in the derived-index hook.'],
 invariants:{historyChars:14000,systemBudgetChars:24000,bridgeBudgetChars:6000,changedThinking:false,newModelCallsInProduction:0,newAuthorizationCache:false,sourceChecksRetained:true,schemaVersionChanged:false},
 checks:{...checks,gatewayStream:'passed',pagination:'17 checks; 1k/10k/50k synthetic same-timestamp stock',tombstone:JSON.parse(text(root+'tombstone.json')),typeCheck:'exit 0, recorded in this run',diffWhitespace:'passed'},
 evidence:{red:root+'red.log',deleteRed:root+'delete-red.log',retrievalScopeRed:root+'retrieval-scope-red.log',trace,boundary,gateway:'release/chat-continuity-gateway-2026-10-18T11-15-59-334Z/gateway.json',performance:perfPath},
 performance:{scope:performance.scope,fixture:performance.phases[0].fixture,phases:performance.phases.map(p=>({phase:p.phase,samples:p.samples.map(s=>({prepareMs:s.prepareMs,endMs:s.endMs,inputChars:s.inputChars,inputSha256:s.inputSha256,latestCorrectionKept:s.latestCorrectionKept,auxiliaryRequests:s.auxiliaryRequests,tombstoneReads:s.reads['memorySourceTombstones.query']}))})),interpretation:'Four sequential desktop synthetic samples per condition; changed input is expected. This is coverage preservation with scoped reads, not a phone speed or model-quality guarantee. Saved selector/send/client before source used; the source-delete guard and retrieval-status clarification are held current in both conditions.'},
 testRulings:['Summary test now examines the full final payload: the old source is already present at history index 11, so a duplicate system copy is not required.','Summary relevance is tested explicitly on relevant and unrelated current topics; named negative topic overlap is a separate T4 issue and not declared fixed.','Legacy pagination migration assertion preserves every original field plus independently checks the new source-evidence projection.'],
 discardedEvidence:[{path:root+'performance-1792322320578.json',reason:'First fixture seeded IndexedDB but not the active store page; its success flag does not validate stock-history behavior. In addition a background voice-sample response overwrote the main request capture.'},{path:root+'performance-1792322359996.json',reason:'Fixture assertion failed; data was not appended before the check.'},{path:root+'performance-1792322385760.json',reason:'Captures auxiliary voice-sample request as the first final request; diagnostic only, not main-response timing.'}],
 paidCalls:0,inputTokens:0,outputTokens:0,android:false,realModelQuality:false,uiDecodedTiming:false,sameConditionBeforeAfterMedia:false,
 rollback:'Per-file snapshots in '+root+'before; do not overwrite concurrent edits or delete original data.',
 remaining:['T1/T2 full interrupted/regenerated and long-budget pressure matrix still requires expansion; legacy APIs have not all moved to the new selector.','Background summarization remains existing implementation; incremental scan/late-write costs and complete-source cursor acceptance still need T2/T5 work.','T3/T4 current scoped corrections and persistent topic outcomes, including named negative-topic relevance, remain unimplemented.','T5/T6 source mutation races, account switching, import/restore and branch consistency need dedicated acceptance.','T7/T8 real component preview, all trajectories human assessment and optional bounded live-model study remain pending.'],
 allPlanRequirementsMet:false,goalComplete:false,versionChanged:false,apkBuilt:false,installed:false,deployed:false,
};
writeFileSync('docs/CHAT-CONTINUITY-COVERAGE-FIX-2026-10-18.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks,paidCalls:0,goalComplete:false,evidence:'docs/CHAT-CONTINUITY-COVERAGE-FIX-2026-10-18.json'}));
