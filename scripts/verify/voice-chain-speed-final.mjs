import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-chain-speed-20261016/final';mkdirSync(dir,{recursive:true});
const files=['src/lib/character-memory.ts','src/lib/chat-history-index.ts','src/db/selected-private-session.ts',
 'src/lib/voice-call/context.ts','src/lib/voice-call/controller.ts','src/lib/voice-call/utterance.ts','src/lib/voice-call/mimo.ts','src/lib/voice-call/native-audio.ts',
 'src/db/memory-source-tombstone-repo.ts','package.json','android/app/build.gradle'];
const hashes=()=>files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const before=hashes(),results=[];
const suites=[['memory',['scripts/verify/character-memory.mjs']],['context',['scripts/verify/voice-call-profile.mjs','--context']],
 ['selected-key-correctness',['scripts/verify/voice-session-key-scope.mjs']],['transmission',['scripts/verify/voice-call-transmission-guard.mjs']],
 ['controller',['scripts/verify/voice-call-controller.mjs']],['segment',['scripts/verify/voice-segment-playback.mjs']],
 ['typescript',['node_modules/typescript/bin/tsc','--noEmit']],['web-build',['node_modules/vite/bin/vite.js','build']]];
for(const [name,args] of suites){
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
 writeFileSync(`${dir}/${name}.txt`,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));
 results.push({name,exitCode:r.status,evidence:`${dir}/${name}.txt`});console.log(JSON.stringify(results.at(-1)));if(r.status!==0)break;
}
const after=hashes();
const comparison=JSON.parse(readFileSync('.tmp-preview/voice-chain-speed-20261016/chain/sessions-128/comparison.json','utf8'));
assert.equal(comparison.passed,true);assert.ok(comparison.summary.every(r=>r.rounds===30));
const report={date:new Date().toISOString(),workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',
 passed:results.length===suites.length&&results.every(r=>r.exitCode===0)&&JSON.stringify(before)===JSON.stringify(after),
 sourceUnchangedDuringRun:JSON.stringify(before)===JSON.stringify(after),sourceHashes:after,results,comparisonSummary:comparison.summary,
 actualProviderCalls:0,providerTokens:0,microphone:false,androidRuntime:false,versionChanged:false,apkBuilt:false,installed:false,published:false,overallGoalComplete:false,
 scope:'Actual memory/context/controller, populated isolated IndexedDB and mocked transport/frame sink; not a provider or Android physical-audio speed guarantee.'};
writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2));assert.equal(report.passed,true,'Inspect failing regression logs');
