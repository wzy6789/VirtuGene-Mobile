import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-running-tail-20261016', base='.tmp-preview/voice-playback-buffer-policy-20261016';
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function method(source,marker){const a=source.indexOf(marker);assert.ok(a>=0,marker);let i=source.indexOf('{',a),depth=1;for(let end=i+1;end<source.length;end++){if(source[end]==='{')depth++;if(source[end]==='}'&&!--depth)return source.slice(a,end+1);}throw Error(marker);}
const sources=[];
for(const tag of ['android-7.0.0_r1','android-11.0.0_r1','android-12.0.0_r1','android-16.0.0_r1']){
 const path=`${dir}/aosp/${tag}-Tracks.cpp`, source=readFileSync(path,'utf8');
 const ready=method(source,'Track::isReady()'),disable=method(source,'Track::disable()').replace(/\/\/[^\n]*/g,'');
 assert.match(ready,/mFilling(?:Up)?Status != FS_FILLING/);assert.match(ready,/return true/);
 assert.match(disable,/signalClientFlag\(CBLK_DISABLED\)/);assert.doesNotMatch(disable,/mFilling(?:Up)?Status\s*=/);
 sources.push({tag,path,sha256:sha(path),url:`https://android.googlesource.com/platform/frameworks/av/+/refs/tags/${tag}/services/audioflinger/Tracks.cpp`,
  finding:'Inspected normal-mixer isReady bypasses initial fill when already filled; disable does not assign filling status. Source inference only, not full platform execution.'});
}
const clientPath=`${dir}/aosp/android-12.0.0_r1-AudioTrack.cpp`,client=readFileSync(clientPath,'utf8');
const restart=method(client,'void AudioTrack::restartIfDisabled()');assert.match(restart,/STATE_ACTIVE/);assert.match(restart,/CBLK_DISABLED/);assert.match(restart,/mAudioTrack->start/);
sources.push({path:clientPath,sha256:sha(clientPath),url:'https://android.googlesource.com/platform/frameworks/av/+/refs/tags/android-12.0.0_r1/media/libaudioclient/AudioTrack.cpp',
 finding:'Client releaseBuffer can restart an active track disabled after underrun. This inspection does not reproduce fast-mixer/OEM behavior.'});
const reference=json(`${base}/aosp-startup-only/report.json`),stress=json(`${base}/report.json`),running=json(`${dir}/after/report.json`),counterfactual=json(`${dir}/counterfactual/report.json`);
assert.equal(reference.refillModel,'AOSP-normal-mixer-startup-only-reference-model');assert.equal(stress.refillModel,'threshold-after-every-underrun-stress-model');
assert.equal(running.exitCode,0);assert.equal(running.runningTailCases,2880);assert.equal(running.checks,18727);assert.equal(counterfactual.exitCode,1);
assert.match(readFileSync(`${dir}/counterfactual/run.txt`,'utf8'),/short tails must drain without padding again/);
assert.equal(running.sourceHash,sha('android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java'));
assert.equal(running.helperHash,sha('android/app/src/main/java/com/virtugene/app/plugins/AudioStartupPadding.java'));
assert.equal(reference.rows.length,2880);assert.equal(stress.rows.length,2880);
let paired=0;
for(let i=0;i<reference.rows.length;i++){
 const a=reference.rows[i],b=stress.rows[i];
 for(const field of ['scenario','rate','capacityMs','round','mode','seed','scheduleHash','pcmHash','renderedHash','tailHex','writtenFrames','renderedFrames'])assert.deepEqual(a[field],b[field],`${i}:${field}`);
 paired++;
}
const prior=json('.tmp-preview/voice-startup-padding-20261016/final/report.json');
const production=prior.sourceHashes.filter(row=>row.path.startsWith('src/')||row.path.startsWith('android/'));
for(const row of production)assert.equal(sha(row.path),row.sha256,`Changed production since last Web/Java checks: ${row.path}`);
const report={date:new Date().toISOString(),workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',
 productionChanged:false,productionHashes:production,sources,runningTailCases:2880,runningChecks:18727,counterfactualFailedAsExpected:true,
 policyRowsPerModel:2880,pairedInputsAndCompletePcm:paired,policyChecksPerModel:21571,
 referenceModel:reference.refillModel,stressModel:stress.refillModel,
 summary:reference.summary.filter(row=>row.rate===24000&&row.capacityMs===100),
 actualProviderCalls:0,providerTokens:0,microphone:false,androidRuntime:false,physicalAudio:false,versionChanged:false,apkBuilt:false,installed:false,published:false,goalComplete:false,
 finding:'No running-short-tail stall reproduced in the inspected normal-mixer model. Do not add repeated padding solely to fix a counterfactual refill model. Hardware/fast-mixer/OEM paths remain unverified.',
 limitations:['AOSP source excerpts and a matching double are indirect evidence, not Android runtime execution.',
 'Historical stress-model underrun counts cannot be transferred to normal-mixer results or real headphones.',
 'Original-plan controlled unpunctuated wait and endpoint quality work remain; physical/provider measurements are evidence limits, not a request for user phone testing.']};
writeFileSync(`${dir}/audit.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({evidence:`${dir}/audit.json`,runningTailCases:2880,checks:18727,pairedPolicyRows:paired,productionChanged:false,goalComplete:false}));
