import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-startup-padding-20261016/final';mkdirSync(dir,{recursive:true});
const files=['android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java',
 'android/app/src/main/java/com/virtugene/app/plugins/AudioStartupPadding.java',
 'src/lib/voice-call/controller.ts','src/lib/voice-call/native-audio.ts','src/lib/voice-call/trace.ts','src/lib/voice-call/playback-buffer-policy.ts',
 'scripts/verify/voice-startup-padding.mjs','scripts/verify/voice-call-controller.ts','scripts/verify/voice-clock-route-native.mjs',
 'package.json','android/app/build.gradle'];
const hashes=()=>files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const start=hashes(),results=[];
const suites=[['legacy-red',['scripts/verify/voice-startup-padding.mjs','--before'],1],
 ['startup-padding',['scripts/verify/voice-startup-padding.mjs'],0],['native-clock',['scripts/verify/voice-clock-route-native.mjs'],0],
 ['timeline',['scripts/verify/voice-call-timeline.mjs'],0],['buffer-integration',['scripts/verify/voice-buffer-integration.mjs'],0],
 ['buffer-native',['scripts/verify/voice-buffer-native.mjs'],0],['short-threshold',['scripts/verify/voice-short-tail.mjs'],0],
 ['segment-drain',['scripts/verify/voice-segment-native.mjs'],0],['headset-and-call-regressions',['scripts/verify/voice-headset-final.mjs'],0]];
for(const [name,args,expected] of suites){
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
 const output=(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):'');writeFileSync(`${dir}/${name}.txt`,output);
 const passed=r.status===expected&&(name!=='legacy-red'||output.includes('minimum-clamped complete short voice must reach genuine playback progress'));
 results.push({name,exitCode:r.status,expectedExitCode:expected,passed,evidence:`${dir}/${name}.txt`});console.log(JSON.stringify(results.at(-1)));if(!passed)break;
}
if(results.length===suites.length&&results.every(r=>r.passed)){
 const r=spawnSync('cmd.exe',['/d','/c','gradlew.bat :app:compileDebugJavaWithJavac --offline'],{cwd:'android',encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,windowsHide:true});
 writeFileSync(`${dir}/java-compile.txt`,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));
 results.push({name:'java-compile-only',exitCode:r.status,passed:r.status===0,evidence:`${dir}/java-compile.txt`});console.log(JSON.stringify(results.at(-1)));
}
const end=hashes();const report={date:new Date().toISOString(),workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',
 passed:results.length===suites.length+1&&results.every(r=>r.passed)&&JSON.stringify(start)===JSON.stringify(end),sourceUnchangedDuringRun:JSON.stringify(start)===JSON.stringify(end),
 sourceHashes:end,results,actualProviderCalls:0,providerTokens:0,microphone:false,androidRuntime:false,physicalAudio:false,versionChanged:false,apkBuilt:false,installed:false,published:false,overallPlanComplete:false,
 primaryPaddingCases:720,paddingChecks:7207,scope:'Actual Java queued fallback/voice-frame mapping and production controller/bridge with constrained doubles, plus compile and Web build; not hardware/acoustic evidence.',
 limitations:['Bounded initial legacy fallback can insert a silence interval; running-track short-tail starvation is not addressed.',
 'Unreadable or >3s effective device buffers remain unsupported by this fallback.',
 'Physical sound/OEM/provider timing and quality remain unverified. Remaining original-plan requirements must be audited separately.']};
writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2));assert.equal(report.passed,true,'Inspect regression, compile or concurrent source mutation in final report');
