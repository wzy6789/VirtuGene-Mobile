// Current-state addendum; preserve the earlier audit and its historical limits.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='release/chat-current-closeout-20261019';mkdirSync(root,{recursive:true});
const read=p=>JSON.parse(readFileSync(p,'utf8')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const oldPath='docs/CHAT-PLAN-CLOSEOUT-AUDIT-2026-10-19.json',old=read(oldPath),planPath=old.plan.path;
assert.equal(hash(planPath),old.plan.sha256,'Original plan identity changed');
const oldRefs=[...new Map(old.requirements.flatMap(r=>r.evidence).map(e=>[e.path,e])).values()];
for(const ref of oldRefs)assert.equal(hash(ref.path),ref.sha256,'Historical evidence changed: '+ref.path);
const stagePaths=['CHAT-REPLY-SOURCE-QUESTION','CHAT-SETTLEMENT-SOURCE-KINDS','CHAT-OPEN-WORDS','CHAT-RUNTIME-VOICE-ECHO'].map(n=>'docs/'+n+'-2026-10-19.json');
const currentStages=stagePaths.map(path=>{const report=read(path),production=Array.isArray(report.production)?report.production:[report.production];for(const src of production)assert.equal(hash(src.path),src.sha256,'Latest production source changed: '+src.path);return {path,sha256:hash(path),production};});
const tracePath='release/chat-continuity-trace-2026-10-19T10-39-43-619Z/baseline.json',trace=read(tracePath),traceAuditPath='release/chat-continuity-plan-audit-20261019/audit-1792406400510.json',traceAudit=read(traceAuditPath);
assert.ok(trace.complete&&trace.rows.length===24&&traceAudit.complete&&traceAudit.checks.length===66&&traceAudit.input===tracePath);
const ledger=[];let turnCount=0;
for(const row of trace.rows)for(const turn of row.turns){
 turnCount++;const sources=new Map(turn.databaseSources.map(s=>[s.id,s]));
 assert.equal(sources.get(turn.current.messageId)?.content,turn.input);assert.equal(turn.current.revision,sources.get(turn.current.messageId)?.revision??1);
 for(const request of turn.attempts){
  assert.equal(request.messages.at(-1)?.role,'user');assert.equal(request.messages.at(-1)?.content,turn.input);
  assert.equal(request.messages.filter(m=>m.role==='user'&&m.content===turn.input).length,1);
  for(const ref of request.coverage){const source=sources.get(ref.messageId);assert.ok(source);
   assert.ok((ref.provenRanges??[]).every(r=>r.messageId===source.id&&r.revision===(source.revision??1)&&r.start>=0&&r.end>r.start&&r.end<=source.content.length));
   assert.ok((ref.gaps??[]).every(g=>typeof g.reason==='string'&&g.reason.length>0));
   ledger.push({trajectory:row.id,character:row.character,turn:turnCount,messageId:source.id,revision:source.revision??1,provenRanges:ref.provenRanges,gaps:ref.gaps});
  }
 }
}
assert.equal(turnCount,172);assert.equal(ledger.length,1100);
writeFileSync(root+'/coverage-ledger.json',JSON.stringify({trace:tracePath,traceSha256:hash(tracePath),scope:'Source existence and literal interval availability, not model semantic use.',entries:ledger},null,2)+'\n');
const gatewayPath='release/chat-continuity-gateway-2026-10-19T10-48-16-201Z/gateway.json',gateway=read(gatewayPath);assert.ok(gateway.complete&&gateway.rows.length===26&&gateway.rows.slice(0,24).every(r=>r.historyUnchanged));
const uiPath='release/chat-continuity-mobile-1792407049152/report.json',ui=read(uiPath),framePath='release/chat-continuity-mobile-1792407049152/decoded-frames.json',frames=read(framePath);
assert.ok(ui.complete&&ui.checks.length===30&&frames.decodedFramesVerified&&frames.visualContentsVerified&&frames.frames[0].mediaTime===30&&frames.frames[1].mediaTime===30.52);
for(const src of ui.sources)assert.equal(hash(src.path),src.sha256);assert.equal(hash(frames.video),frames.videoSha256);
const studyPath='docs/CHAT-CONTINUITY-LIVE-STUDY-2026-10-19.json',study=read(studyPath),thinkingPath='docs/CHAT-GU-THINKING-WULIN-2026-10-19.json',thinking=read(thinkingPath);
assert.equal(study.actualRequests,8);assert.equal(study.successfulResponses,8);assert.ok(study.originalEightCallBudgetExhausted&&study.credentials.proxyClosed&&study.credentials.secretPurged);
assert.equal(thinking.accounting.providerRequests,4);assert.equal(thinking.wholeTrajectoryAccepted,false);assert.ok(thinking.credentials.proxyClosed&&thinking.credentials.secretPurged);
const connection=read(root+'/connection-state.json');assert.ok(connection.knownThinkingRelayReferenceCleared&&connection.knownPrototypeRelayReferenceCleared&&!connection.knownThinkingBrowserConnected&&!connection.knownThinkingServerListening);
const directPath=root+'/direct-preview-isolation.json',direct=read(directPath),visiblePath=root+'/visible-preview-conversation.json',visible=read(visiblePath);
const toolJson=capture=>JSON.parse(capture.content.find(c=>c.type==='text'&&c.text.includes('```json')).text.match(/```json\s*([\s\S]*?)\s*```/u)[1]);
const directState=toolJson(direct.finalCapture),visibleState=toolJson(visible.capture);
assert.ok(directState.ready&&directState.width===390&&directState.micGuarded&&directState.mediaGuarded&&directState.audioContextGuarded&&directState.speechGuarded);
assert.ok(visibleState.complete&&visibleState.lastAboveComposer&&visibleState.syntheticOnly&&visibleState.blockedWrapperCalls===0);
const presence={DEEPSEEK_API_KEY:!!process.env.DEEPSEEK_API_KEY,AI_GATEWAY_TOKEN:!!process.env.AI_GATEWAY_TOKEN,API_KEY:!!process.env.API_KEY,knownServerEnvExists:existsSync('server/.env')};
const fresh=[tracePath,traceAuditPath,gatewayPath,uiPath,framePath,...stagePaths].map(path=>({path,sha256:hash(path)}));
const requirements=old.requirements.map(r=>{
 let status='historical-bounded-local-evidence-plus-listed-current-regressions';
 if(r.stage==='T7')status='local-mechanism-tested-post-fix-genuine-quality-unverified';
 if(r.id==='T7.5')status='prior-genuine-output-failed-post-fix-effect-unverified';
 if(r.id==='T8.1')status='24x172-local-orchestration-proven-current-model-acceptance-unverified';
 if(['T8.4','T8.5','T8.6'].includes(r.id))status='current-actual-component-fixture-and-visual-recording-proven';
 if(r.id==='T8.7')status='optional-android-not-a-blocker-no-package-performed';
 const certified=r.stage!=='T7'&&r.id!=='T8.1'||r.id==='T7.6';
 return {id:r.id,stage:r.stage,sourceLine:r.sourceLine,text:r.text,status,historicalEvidence:r.evidence,scope:r.basis,currentEvidence:['T0','T8'].includes(r.stage)?fresh.slice(0,5):['T3','T5','T7'].includes(r.stage)?fresh.slice(5):[fresh[0],fresh[1]],evidenceVerdict:certified?'supports-the-listed-local-or-compliance-requirement':'incomplete-or-insufficient-for-current-output-acceptance',completionCertifiedWithinListedScope:certified};
});
assert.equal(requirements.length,47);
const report={date:'2026-10-19',at:new Date().toISOString(),workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',previousGoalTurn:'progress: runtime duplicate coverage fixed; full native stock and24x172 regression completed',
 plan:old.plan,requirements,originalTaskIndexUnchanged:true,fullPlanComplete:false,completionProven:false,
 evidenceIntegrity:{historicalDocumentsChecked:oldRefs.length,allHistoricalDocumentHashesMatch:true,currentStages,liveTrace:{path:tracePath,trajectories:24,turns:172,sourceEntries:1100,ledger:root+'/coverage-ledger.json'},freshGateway:{path:gatewayPath,localRequests:26,normalHistoriesUnchanged:true},freshUi:{path:uiPath,checks:30,views:ui.views.map(v=>({width:v.width,font:v.font})),frames:framePath,visuallyVerifiedMediaTimes:[30,30.52],failedColdLoad:'release/chat-continuity-mobile-1792406788592/report.json',wrongSelectionsPreserved:frames.visualAudit.initialMismatchPreserved},requiredCommands:old.requiredCommands.map(c=>({...c,scopeNote:'Retained earlier successful execution; no automatic rerun when the corresponding unchanged selector/transport source and new native regression suffice.'}))},
 research:{originalSection10:{path:studyPath,status:'executed-bounded-eight-call-study',actualRequests:8,usage:study.usage,limits:study.limitations},userRequestedThinking:{path:thinkingPath,actualRequests:4,configuration:thinking.configuration,usage:thinking.accounting,wholeTrajectoryAccepted:false,limits:thinking.notes},totalKnownPlanRequests:12,totalKnownPromptTokens:study.usage.promptTokens+thinking.accounting.promptTokens,totalKnownCompletionTokens:study.usage.completionTokens+thinking.accounting.completionTokens,totalKnownTokens:study.usage.totalTokens+thinking.accounting.totalTokens,actualBillQueried:false,note:'Earlier audit saying section10 was unexecuted is historical and superseded only by these saved real runs. Current post-fix genuine output is not available.'},
 outstanding:[{id:'T7-output',status:'unverified-after-local-fixes',requirement:'Whole trajectories more natural and distinct without fabricated experience; source/relationship facts correct.',evidence:'The genuine four-turn thinking run failed grounding before the fixes. Local routing/source/dedup tests do not prove new generated behavior.'},{id:'T8-human',status:'missing',requirement:'Full-trajectory semantic/naturalness assessment with original quotes and test conditions; no best-sentence assembly.',evidence:'No passing current post-fix genuine full trajectory or human scores available.'}],
 continuationBoundary:{condition:'Required next evidence is current post-fix genuine generated dialogue and full-trajectory assessment. The bounded original study is spent; both known real-test relays are closed/purged and no current confirmed environment entry is present.',firstAuditOfThisBoundary:true,consecutiveAudits:1,eligibleToSetBlockedNow:false,presence,connectionState:root+'/connection-state.json',noPrivateStorageOrHistoricalCredentialSearch:true,noNewPaidCalls:true,noSpeculativeProductEditToReplaceMissingEvidence:true},
 preview:{url:ui.url,requiresLocalService:true,liveAsOf:connection.at,httpStatus:connection.preview.httpStatus,execSession:79790,processId:39872,start:"& 'C:/Users/34568/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' scripts/verify/chat-continuity-mobile-preview.mjs --serve",workingDirectory:'F:/VirtuGene-Mobile',stop:'Stop-Process -Id 39872 (only while it is still the verified preview process)',managedBrowserPage:2,isolatedContext:'virtugene-continuity-current-20261019',directIsolation:{path:directPath,state:directState,scope:'Standalone generated QA HTML now includes same-origin CSP and microphone/media/WebAudio/speech guards. Two saved denial probes do not open hardware or play sound.'},visibleMockConversation:{path:visiblePath,state:visibleState},verificationOnlySource:{path:'scripts/verify/chat-continuity-mobile-preview.mjs',sha256:hash('scripts/verify/chat-continuity-mobile-preview.mjs')},scope:'Current actual ChatWindow with synthetic data/fixed manually fed transport. No real model, external traffic or microphone/audio. Viewport resize is not an Android IME test.'},
 currentProductionSnapshot:[...new Map([...old.currentProductionSnapshot,...currentStages.flatMap(s=>s.production)].map(s=>[s.path,s])).keys()].map(path=>({path,sha256:hash(path)})),
 limitations:['Historical local fixtures remain finite and are not re-certified as universal behavior. Current source/interval checks prove availability, not semantic utilization.','Fresh preview has a cold-load timeout and two visually rejected extraction attempts, all retained. Decoded-frame positions are not model/phone latency; current send-before/after images are not a code before/after comparison.','Android, group/voice production certification, a new dirty cursor, unrelated feature additions and publishing are not newly imposed completion gates.','The exposed credential was not revived or copied. Environment checks record presence only; no values or browser/private storage read.','Coding model/effort and Codex sidebar project identity remain unconfirmed; no internal Codex state edited.'],
 thisTurn:{productionEdits:0,verificationOnlyEdits:['scripts/verify/chat-continuity-mobile-preview.mjs','scripts/verify/chat-continuity-current-closeout.mjs'],paidModelRequests:0,promptTokens:0,completionTokens:0,costUSD:0,appVersionBuildPackageInstallPublish:false,automaticUiMediaAttempts:0,directBlockingProbesRecorded:2,actualHardwareVoiceTest:false,actualMicrophoneOpens:0,audioPlayed:false}};
const path='docs/CHAT-CONTINUITY-CURRENT-CLOSEOUT-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
progress.fullPlanComplete=false;progress.currentCompletionAudit={path,sha256:hash(path),requirements:47,fullPlanComplete:false,outstanding:report.outstanding.map(r=>r.id)};
progress.currentPreview={path:uiPath,url:ui.url,frameEvidence:framePath,checks:30,realModel:false,processId:39872,execSession:79790};
progress.currentBlocker={evidence:path,previousConnectionBlockerResolvedForActualTesting:true,remaining:report.outstanding.map(r=>r.id),condition:report.continuationBoundary.condition,consecutiveAudits:1,eligibleToSetBlockedNow:false};
progress.next='Current local/native/visual evidence refreshed. Remaining original T7/T8 requires post-fix real dialogue and whole-trajectory assessment; do not add speculative style rules, repeat unchanged green suites or expand paid calls as a substitute.';
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
console.log(JSON.stringify({path,requirements:47,currentUiChecks:30,coverageEntries:1100,gatewayRequests:26,knownHistoricalModelRequests:12,newPaidCalls:0,fullPlanComplete:false,remaining:report.outstanding.map(r=>r.id)}));
