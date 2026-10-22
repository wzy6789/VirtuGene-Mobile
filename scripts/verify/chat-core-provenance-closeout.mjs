/** Inventory only this plan's known product work and validate its saved evidence.
 * Absence from a narrow inventory never proves that a file was newly created. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';

const root='release/chat-core-implementation-20261021';
const json=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/u,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const probePath=process.argv[2];
if(!probePath||!probePath.startsWith(root+'/review/baseline-probe-'))throw Error('Pass a specific completed local baseline probe report');
const probe=json(probePath);
if(!probe.complete||probe.rows.length!==6||probe.providerCalls!==0)throw Error('Local baseline composition evidence is incomplete');
const planPath='release/chat-core-plan-final-20261021/final-plan.md';
const plan=readFileSync(planPath,'utf8');
const inventory=json('release/chat-core-plan-review-20261021/source-inventory.json');
const extras=[
  'src/db/diary-read-scope.ts','src/db/diary-repo.ts','src/db/message-evidence-key.ts','src/db/voice-call-repo.ts',
  'src/lib/chat/reviewed-prefix.ts','src/lib/chat/output-contract.ts','src/lib/chat/reply-delivery.ts',
  'src/lib/chat/proactive-visit.ts','src/lib/chat/topic-candidates.ts','src/lib/chat-topic-controls.ts',
  'src/db/session-summary-repo.ts','src/lib/chat-summary-evidence.ts','src/lib/ai/summary-batches.ts',
  'src/lib/chat-self-report-risk.ts','src/lib/chat-speaker-source-risk.ts',
];
const paths=[...new Set([...Object.keys(probe.authenticatedBefore),...extras])].sort();
const stageRoots=['before','topics/before','voice/continuity-before','candidates/before','delivery/projection-before','delivery/before'];
const files=paths.map(path=>{
  if(!existsSync(path))throw Error('Known product source missing: '+path);
  const bytes=readFileSync(path),currentSha256=sha(bytes),original=probe.authenticatedBefore[path];
  const stageCopies=stageRoots.map(stage=>join(root,stage,path)).filter(existsSync).map(copy=>({path:copy,sha256:sha(readFileSync(copy)),scope:copy.includes('delivery/before')?'before first-prefix integration; includes earlier implementation work':'per-stage archive; not independently proved original T0'}));
  const classification=inventory.sourceHashes[path]?'original-plan-module':original?'initial-implementation-extra':'known-implementation-module-outside-original-inventory';
  const artifact=join(root,'review/provenance-current',path);mkdirSync(dirname(artifact),{recursive:true});writeFileSync(artifact,bytes);
  return {path,currentSha256,bytes:bytes.length,artifact,classification,original:original?{sha256:original.sha256,artifact:original.artifact,source:original.source}:undefined,
    changedFromAuthenticatedOriginal:original?currentSha256!==original.sha256:undefined,stageCopies,
    initialFileCreation:original?'file existence proven at recorded original snapshot':'not inferred from absence; current integration and staged copies are the supported facts',
    proposedByFinalPlan:plan.includes('拟新增`'+path+'`')||plan.includes('拟新增 `'+path+'`')};
});
const evidencePaths=[
  'delivery/current-1792646833384.json','review/current-1792646822288.json','voice/continuity-1792645230499.json',
  'proactive-current-1792645375371.json','candidates/current-1792644580587.json','performance/stock-cold-warm-1792647456848.json',
  'review/recorded-replay-1792646883139/result.json',
];
const evidence=evidencePaths.map(relative=>{
  const path=join(root,relative),report=json(path);
  const sourceHashes=report.bundleEvidence?.dependencyHashes??report.dependencyHashes??report.sourceHashesAfter??{};
  const selected=Object.entries(sourceHashes).filter(([file])=>/^(?:src|server)\//u.test(file));
  const mismatches=selected.filter(([file,expected])=>!existsSync(file)||sha(readFileSync(file))!==(typeof expected==='string'?expected:expected.sha256)).map(([file])=>file);
  return {path,sha256:sha(readFileSync(path)),complete:report.complete,checks:report.checks?.length,failures:report.failures?.length,productSourceHashesChecked:selected.length,mismatches,
    scope:report.scope??'See individual native evidence; hash equality validates the recorded source, not unrelated outcomes'};
});
const accountingPaths=['live/initial-trial-budget-20261022.json','live/full-comparison/full-comparison-budget-20261022.json'];
const ledgers=accountingPaths.map(relative=>{const path=join(root,relative),data=json(path);return {path,sha256:sha(readFileSync(path)),requests:data.requests.length,limit:data.config.limit};});
if(ledgers[0].requests!==6||ledgers[1].requests!==72)throw Error('Actual accounting no longer matches the closed phase records');
const report={at:new Date().toISOString(),complete:evidence.every(item=>item.complete===true&&item.failures===0&&!item.mismatches.length),
  scope:'Known plan product modules only; not a claim to own all dirty-worktree changes. Copies are documentation evidence, never restored over current sources. Outside-inventory files are explicitly classified without inventing creation dates or complete initial dependency provenance.',
  version:json('package.json').version,plan:{path:planPath,sha256:sha(readFileSync(planPath))},files,evidence,ledgers,
  originalComposition:{path:probePath,sha256:sha(readFileSync(probePath)),authenticatedSourceFiles:Object.keys(probe.authenticatedBefore).length,actuallyReachedBeforeModules:Object.values(probe.builds.before.dependencies).filter(item=>item.provenance!=='shared-current-not-historical-closure').length,sharedCurrentProductDependencies:Object.entries(probe.builds.before.dependencies).filter(([path,item])=>/^(?:src|server)\//u.test(path)&&item.provenance==='shared-current-not-historical-closure').length,checks:probe.checks.length,turns:probe.rows.length},
  providerCalls:0,providerTokens:0,productionFilesRestored:0,codingModel:'未确认',codingReasoning:'未确认',
  limitations:['The46 original-plan modules and5 initial extras are authenticated. The probe reaches34 authenticated originals, but still shares188 product dependencies; it proves that composition runs, not a full old APK.','Source hashing cannot prove newly sampled model quality. Latest sender/source fixes have recorded-output/native replay only, not further paid sampling.','Historical staged copies are labelled as such, never relabelled as an initial whole-source freeze.','No actual Android or acoustic/route testing, no version bump/build/install/release.'],fullObjectiveAchieved:false};
const output=join(root,'review/provenance-closeout-20261022.json');writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,complete:report.complete,knownFiles:files.length,originalFiles:files.filter(item=>item.original).length,outsideOriginal:files.filter(item=>!item.original).length,evidence:evidence.map(({path,checks,productSourceHashesChecked,mismatches})=>({path,checks,productSourceHashesChecked,mismatches})),providerCalls:0},null,2));
if(!report.complete)process.exitCode=1;
