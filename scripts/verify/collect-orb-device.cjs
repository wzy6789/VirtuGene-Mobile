// Read-only Android evidence collection. Does not install, launch, reset stats,
// alter settings or claim a performance pass from a missing/unsupported sample.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const label=option('--label')||'orb';
if(!/^[a-z0-9-]{1,64}$/.test(label))throw Error('Use a short lowercase label containing letters, numbers and hyphens.');
const candidates=[option('--adb'),process.env.ANDROID_HOME&&path.join(process.env.ANDROID_HOME,'platform-tools','adb.exe'),process.env.ANDROID_SDK_ROOT&&path.join(process.env.ANDROID_SDK_ROOT,'platform-tools','adb.exe'),process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe')].filter(Boolean);
const adb=candidates.find(file=>fs.existsSync(file))||'adb';
const output=path.resolve('.tmp-preview/orb-device',`${new Date().toISOString().replace(/[:.]/g,'-')}-${label}`);
fs.mkdirSync(output,{recursive:true});
const report={recordedAt:new Date().toISOString(),label,package:'com.virtugene.app',status:'not-measured',buildMatch:'unverified',gpuFrameTime:'not-measured',warnings:[]};
const save=()=>{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(`${report.status}: ${report.reason||'Raw evidence captured; validate build identity and inspect the trace before evaluating.'}\n${output}`);};
const run=command=>execFileSync(adb,command,{encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024,windowsHide:true});
let devices;
try{devices=run(['devices','-l']);fs.writeFileSync(path.join(output,'devices.txt'),devices);}catch(error){report.reason=`ADB unavailable: ${error.message}`;save();process.exit(0);}
const rows=devices.split(/\r?\n/).map(line=>line.match(/^(\S+)\s+(device|offline|unauthorized)\b/)).filter(Boolean);
const serial=option('--serial'),ready=rows.filter(row=>row[2]==='device'&&(!serial||row[1]===serial));
if(ready.length!==1){report.reason=ready.length>1?'Multiple authorized devices; select one with --serial.':'No matching authorized Android device connected.';save();process.exit(0);}
const selected=ready[0][1],shell=command=>run(['-s',selected,'shell',...command]);
const capture=(name,command)=>{try{const text=shell(command);fs.writeFileSync(path.join(output,`${name}.txt`),text);return text.trim();}catch(error){report.warnings.push(`${name}: ${error.message}`);return undefined;}};
report.deviceModel=capture('model',['getprop','ro.product.model']);
report.androidVersion=capture('android',['getprop','ro.build.version.release']);
report.deviceKind=capture('emulator',['getprop','ro.kernel.qemu'])==='1'||selected.startsWith('emulator-')?'emulator':'physical';
capture('package',['dumpsys','package',report.package]);
capture('webview',['dumpsys','webviewupdate']);
const processId=capture('pid',['pidof',report.package]);
if(!processId){report.reason='App process could not be confirmed; no app frame sample was collected.';save();process.exit(0);}
const graphics=capture('gfxinfo',['dumpsys','gfxinfo',report.package,'framestats']);
capture('memory',['dumpsys','meminfo',report.package]);
capture('battery',['dumpsys','battery']);
capture('thermal',['dumpsys','thermalservice']);
report.status=graphics?'raw-evidence-captured':'not-measured';
report.reason=graphics?'App-window frame evidence collected; build match and WebView/GPU profiling remain unverified.':'No usable gfxinfo output was returned.';
save();
