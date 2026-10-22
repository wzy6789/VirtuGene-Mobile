import { readFileSync,writeFileSync,mkdirSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const dir='.tmp-preview/voice-plan-current-audit-20261016';mkdirSync(dir,{recursive:true});
const files=[...readdirSync('src/lib/voice-call').filter(p=>p.endsWith('.ts')).map(p=>'src/lib/voice-call/'+p),
 ...readdirSync('android/app/src/main/java/com/virtugene/app/plugins').filter(p=>/^(?:VoiceCall|Audio|LegacySco|MimoStream).*\.java$/.test(p)).map(p=>'android/app/src/main/java/com/virtugene/app/plugins/'+p),
 'src/store/voice-call-store.ts','src/components/chat/VoiceCallDialog.tsx','src/db/memory-source-tombstone-repo.ts','src/db/knowledge-repo.ts','src/lib/character-memory.ts','android/app/src/main/AndroidManifest.xml','package.json','android/app/build.gradle'];
const hashes=()=>files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const before=hashes(),results=[];
const suites=[
 ['core',['scripts/verify/voice-call-core.mjs']],['latency',['scripts/verify/voice-call-latency.mjs']],
 ['transmission',['scripts/verify/voice-call-transmission-guard.mjs']],['boundaries',['scripts/verify/voice-call-boundary-audit.mjs']],
 ['usage',['scripts/verify/voice-call-usage.mjs']],['local-protocol',['scripts/verify/voice-local-protocol.mjs']],
 ['timeline',['scripts/verify/voice-call-timeline.mjs']],['clock-bridge',['scripts/verify/voice-clock-route.mjs']],
 ['clock-native',['scripts/verify/voice-clock-route-native.mjs']],['native-input',['scripts/verify/voice-call-native-input.mjs']],
 ['input-contract',['scripts/verify/voice-call-native-input-contract.mjs']],['speaker-echo',['scripts/verify/voice-segment-echo.mjs']],
 ['speaker-recovery',['scripts/verify/voice-output-recovery.mjs']],['buffer-bridge',['scripts/verify/voice-buffer-integration.mjs']],
 ['buffer-native',['scripts/verify/voice-buffer-native.mjs']],['padding',['scripts/verify/voice-startup-padding.mjs']],
 ['native-drain',['scripts/verify/voice-segment-native.mjs']],['evidence',['scripts/verify/voice-call-evidence.mjs']],
 ['actual-ui',['scripts/verify/voice-call-ui.mjs']],
];
for(const [name,args] of suites){
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
 writeFileSync(`${dir}/${name}.txt`,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));
 results.push({name,args,exitCode:r.status,evidence:`${dir}/${name}.txt`});console.log(JSON.stringify(results.at(-1)));if(r.status!==0)break;
}
const after=hashes();
const report={at:new Date().toISOString(),workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',
 passed:results.length===suites.length&&results.every(r=>r.exitCode===0)&&JSON.stringify(before)===JSON.stringify(after),
 sourceUnchangedDuringRun:JSON.stringify(before)===JSON.stringify(after),sourceHashes:after,results,
 actualProviderCalls:0,microphone:false,androidRuntime:false,apkBuilt:false,installed:false,published:false,versionChanged:false,
 goalComplete:false,scope:'Supplementary regression for current-plan audit; Node/browser/JVM/local HTTP substitutes do not establish Android system, MiMo service or physical audio acceptance.'};
writeFileSync(`${dir}/regression.json`,JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
