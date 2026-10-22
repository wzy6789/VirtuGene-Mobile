import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-bluetooth-resume-20261018';mkdirSync(dir,{recursive:true});
const files=['src/lib/voice-call/native-audio.ts','android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java',
 'android/app/src/main/java/com/virtugene/app/plugins/AudioDefaultRoute.java','package.json','android/app/build.gradle'];
const hashes=()=>files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const before=hashes(),results=[];
for(const [name,args] of [['headset-call-regressions',['scripts/verify/voice-headset-final.mjs']],
 ['explicit-and-default-privacy',['scripts/verify/voice-headset-preference-bridge.mjs','--label','bluetooth-resume-final-20261018']]]){
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
 writeFileSync(`${dir}/${name}.txt`,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));
 results.push({name,exitCode:r.status});console.log(JSON.stringify(results.at(-1)));if(r.status!==0)break;
}
if(results.every(r=>r.exitCode===0)){
 const r=spawnSync('cmd.exe',['/d','/c','gradlew.bat :app:compileDebugJavaWithJavac --offline'],{cwd:'android',encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,windowsHide:true});
 writeFileSync(`${dir}/java-compile-only.txt`,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));results.push({name:'java-compile-only',exitCode:r.status});console.log(JSON.stringify(results.at(-1)));
}
for(const [src,dest] of [
 ['.tmp-preview/voice-default-headset-20261016/after.json','native-after.json'],
 ['.tmp-preview/voice-default-headset-20261016/bridge/bluetooth-resume-final-20261018.json','bridge-after.json'],
 ['.tmp-preview/voice-default-headset-20261016/final/report.json','call-regression-report.json']]){if(existsSync(src))copyFileSync(src,`${dir}/${dest}`);}
const child=existsSync(`${dir}/call-regression-report.json`)?JSON.parse(readFileSync(`${dir}/call-regression-report.json`,'utf8')):{passed:false,results:[]};
mkdirSync(`${dir}/call-regressions`,{recursive:true});
for(const result of child.results){
 const target=`${dir}/call-regressions/${result.name}.txt`;
 copyFileSync(result.evidence,target);result.evidence=target;
}
writeFileSync(`${dir}/call-regression-report.json`,JSON.stringify(child,null,2));
const after=hashes();
const report={date:new Date().toISOString(),workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',
 passed:child.passed===true&&results.length===3&&results.every(r=>r.exitCode===0)&&JSON.stringify(before)===JSON.stringify(after),
 sourceUnchangedDuringRun:JSON.stringify(before)===JSON.stringify(after),sourceHashes:after,results,
 actualProviderCalls:0,microphone:false,androidRuntime:false,physicalAudio:false,apkBuilt:false,installed:false,versionChanged:false,published:false,
 limitations:['Reproduces bounded asynchronous resume, cancellation, private-route recovery and mode/focus ordering; does not establish the cause of the user installed build without runtime evidence.',
 'Local Node/JVM substitutes and Java/Web compilation do not prove Bluetooth acoustic stability or installed APK effectiveness.']};
writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2));assert.equal(report.passed,true,'Inspect saved regression logs');
