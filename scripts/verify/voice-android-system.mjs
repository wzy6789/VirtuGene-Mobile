import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const run=process.argv.includes('--run');
const target='com.virtugene.app',testPackage=target+'.test';
const testClass=target+'.plugins.VoiceCallServiceInstrumentationTest';
const plan={mode:'dry-run',requires:'Separately authorized dependency/emulator setup and test APK installation; this script never builds, installs or downloads',
 scenarios:[{permission:'granted',selection:testClass,expectedTests:2},
 {permission:'denied',selection:testClass+'#textServiceSurvivesConfiguredNotificationPermissionWithoutMicrophone',expectedTests:1}],
 boundaries:{emulatorOnly:true,minimumApi:33,microphonePermission:'denied',webView:false,modelCalls:0,physicalAudio:false},
 note:'Not coverage for real microphone permission dialogs, capture, OEM Bluetooth, Activity process restoration or SystemUI drawer appearance.'};
if(!run){console.log(JSON.stringify(plan,null,2));}
else {
 assert.equal(process.env.VIRTUGENE_VOICE_SYSTEM_ACCEPTANCE,'1','Explicitly authorized OS acceptance required; default is dry-run');
 const serial=process.argv[process.argv.indexOf('--serial')+1];
 assert.match(serial??'',/^emulator-\d+$/,'A designated emulator serial is mandatory; never select a phone automatically');
 const expectedHashes=['--target-sha256','--test-sha256'].map(flag=>process.argv[process.argv.indexOf(flag)+1]);
 for(const hash of expectedHashes)assert.match(hash??'',/^[a-f0-9]{64}$/i,'Expected hashes of separately authorized installed APKs are mandatory');
 const sdk=process.env.ANDROID_SDK_ROOT??process.env.ANDROID_HOME??join(process.env.LOCALAPPDATA??'','Android','Sdk');
 const adb=join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb');assert.ok(existsSync(adb),'ADB not found');
 const dir='.tmp-preview/voice-plan-current-audit-20261016/android-system';mkdirSync(dir,{recursive:true});
 const steps=[];
 function command(args,name){
  const result=spawnSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});
  const text=(result.stdout??'')+(result.stderr??'');writeFileSync(`${dir}/${name}.txt`,text+(result.error?String(result.error):''));
  steps.push({name,args,exitCode:result.status});assert.equal(result.status,0,`ADB ${name} failed`);return text.trim();
 }
 const completed=[],installedBinaries=[];let cleanupPassed=true;
 try {
  assert.equal(command(['get-state'],'state'),'device');
  assert.match(command(['shell','getprop','ro.hardware'],'hardware'),/^(ranchu|goldfish|cutf_cvm)$/);
  const api=Number(command(['shell','getprop','ro.build.version.sdk'],'api'));assert.ok(Number.isInteger(api)&&api>=33);
  // Record the installed binaries, not merely current source or a local APK name.
  for(const [i,pkg] of [target,testPackage].entries()){
   const installed=command(['shell','pm','path',pkg],`package-${i}`);
   const base=installed.split(/\r?\n/).find(line=>line.endsWith('/base.apk'))?.slice('package:'.length);
   assert.match(base??'',/^\/data\/app\/[A-Za-z0-9_~+/.=\-]+\/base\.apk$/,'An installed base APK must be identified');
   const digest=command(['shell','sha256sum',base],`installed-hash-${i}`).split(/\s+/)[0];
   assert.match(digest,/^[a-f0-9]{64}$/);
   assert.equal(digest,expectedHashes[i].toLowerCase(),'Installed APK must match the supplied local artifact');
   installedBinaries.push({package:pkg,sha256:digest});
  }
  for(const [i,row] of plan.scenarios.entries()){
   command(['shell','am','force-stop',target],`stop-${i}`);
   command(['shell','pm','revoke',target,'android.permission.RECORD_AUDIO'],`microphone-denied-${i}`);
   command(['shell','pm',row.permission==='granted'?'grant':'revoke',target,'android.permission.POST_NOTIFICATIONS'],`notifications-${i}`);
   const output=command(['shell','am','instrument','-w','-r','-e','class',row.selection,'-e','voiceSystemAcceptance','1',
    '-e','notificationPermission',row.permission,`${testPackage}/androidx.test.runner.AndroidJUnitRunner`],`instrumentation-${i}`);
   assert.ok(!/FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed|shortMsg=/.test(output),'Inspect actual instrumentation failure');
   assert.match(output,new RegExp(`OK \\(${row.expectedTests} tests?\\)`),'Do not accept a skipped/empty instrumentation run');
   assert.match(output,/INSTRUMENTATION_CODE:\s*-1/,'The runner must actually finish');
   completed.push({permission:row.permission,tests:row.expectedTests});
  }
 } finally {
  // Only reached after the emulator identity checks, never used on a real phone.
  if(steps.some(step=>step.name==='api'&&step.exitCode===0)){
   try{command(['shell','am','force-stop',target],'cleanup');}catch{cleanupPassed=false;}
  }
  writeFileSync(`${dir}/report.json`,JSON.stringify({completed,steps,installedBinaries,cleanupPassed,passed:completed.length===plan.scenarios.length&&cleanupPassed,
   model:'unconfirmed',reasoningEffort:'unconfirmed',actualProviderCalls:0,microphone:false,
   instrumentationAttempted:steps.some(step=>step.name.startsWith('instrumentation-')),androidRuntimeValidated:completed.length>0,
   apkBuilt:false,installedByThisScript:false,published:false,scope:plan.note},null,2));
 }
 assert.equal(cleanupPassed,true,'Emulator call-service cleanup failed; inspect evidence');
 console.log(JSON.stringify({passed:true,completed,evidence:`${dir}/report.json`}));
}
