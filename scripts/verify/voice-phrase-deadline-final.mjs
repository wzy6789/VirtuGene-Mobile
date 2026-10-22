import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-phrase-deadline-20261016/final';mkdirSync(dir,{recursive:true});
const files=['src/lib/voice-call/utterance.ts','src/lib/voice-call/speech-deadline.ts','src/lib/voice-call/controller.ts','src/lib/voice-call/native-audio.ts','package.json','android/app/build.gradle'];
const hashes=()=>files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const start=hashes(),results=[];
for(const [name,args] of [
 ['phrase',['scripts/verify/voice-phrase-deadline.mjs']],
 ['queue',['scripts/verify/voice-speech-deadline-queue.mjs']],
 ['controller',['scripts/verify/voice-phrase-deadline-controller.mjs']],
 ['utterance',['scripts/verify/voice-utterance-policy.mjs']],
 ['headset-and-call-regressions',['scripts/verify/voice-headset-final.mjs']],
]){
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
 writeFileSync(`${dir}/${name}.txt`,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));
 results.push({name,exitCode:r.status,evidence:`${dir}/${name}.txt`});console.log(JSON.stringify(results.at(-1)));if(r.status!==0)break;
}
const end=hashes();
const comparison=JSON.parse(readFileSync('.tmp-preview/voice-phrase-deadline-20261016/browser/comparison.json','utf8'));
assert.equal(comparison.completeInputPcmAndSpokenTextUnchanged,true);
assert.equal(comparison.dialogueRequestsUnchanged,true);
assert.equal(comparison.summary.length,2);for(const row of comparison.summary)assert.equal(row.rounds,30);
const report={date:new Date().toISOString(),passed:results.length===5&&results.every(r=>r.exitCode===0)&&JSON.stringify(start)===JSON.stringify(end),sourceHashes:end,sourceUnchangedDuringRun:JSON.stringify(start)===JSON.stringify(end),results,browserSummary:comparison.summary,
 browserEvidence:'.tmp-preview/voice-phrase-deadline-20261016/browser/comparison.json',
 workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',apiCalls:0,microphone:false,androidRuntime:false,physicalAudio:false,versionChanged:false,apkBuilt:false,published:false,overallPlanComplete:false};
writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2));assert.equal(report.passed,true);
