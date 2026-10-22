import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-default-headset-20261016/final';mkdirSync(dir,{recursive:true});
const files=['src/lib/voice-call/controller.ts','src/lib/voice-call/native-audio.ts','src/lib/voice-call/trace.ts',
 'src/components/chat/VoiceCallDialog.tsx','src/styles/voice-call.css','src/store/voice-call-store.ts',
 'android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java','android/app/src/main/java/com/virtugene/app/plugins/AudioDefaultRoute.java','package.json','android/app/build.gradle'];
const hashes=()=>files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const start=hashes(),results=[];
const suites=[['default-headset','scripts/verify/voice-default-headset.mjs'],['permission-lifecycle','scripts/verify/voice-native-lifecycle.mjs'],
 ['preference-bridge','scripts/verify/voice-headset-preference-bridge.mjs','--label','final'],['cancel-controller','scripts/verify/voice-route-recovery.mjs'],
 ['cancel-native','scripts/verify/voice-route-recovery-native.mjs'],['controller','scripts/verify/voice-call-controller.mjs'],
 ['existing-route','scripts/verify/voice-route-bridge.mjs'],['existing-native-route','scripts/verify/voice-route-continuity.mjs'],
 ['segment','scripts/verify/voice-segment-playback.mjs'],['typescript','node_modules/typescript/bin/tsc','--noEmit'],['web-build','node_modules/vite/bin/vite.js','build']];
for(const [name,...args] of suites){
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,windowsHide:true});
 writeFileSync(`${dir}/${name}.txt`,(r.stdout??'')+(r.stderr??'')+(r.error?String(r.error):''));
 results.push({name,exitCode:r.status,evidence:`${dir}/${name}.txt`});console.log(JSON.stringify(results.at(-1)));
 if(r.status!==0)break;
}
const end=hashes(),report={date:new Date().toISOString(),workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',
 passed:results.length===suites.length&&results.every(r=>r.exitCode===0)&&JSON.stringify(start)===JSON.stringify(end),
 sourceUnchangedDuringRun:JSON.stringify(start)===JSON.stringify(end),sourceHashes:end,results,overallPlanComplete:false,
 actualProviderCalls:0,providerTokens:0,microphone:false,androidRuntime:false,versionChanged:false,apkBuilt:false,published:false};
writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2));
assert.equal(report.passed,true,'Inspect final reports; not all checks passed');
if(process.argv.includes('--log')){
 const path='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-16.md',heading='## 耳机默认选路修复与实时通话续做';
 const json=p=>JSON.parse(readFileSync(p,'utf8'));
 const headset=json('.tmp-preview/voice-default-headset-20261016/after.json'), lifecycle=json('.tmp-preview/voice-native-lifecycle-20261016/after.json');
 const note=`\n\n${heading}\n\n- 用户报告“连耳机却用听筒”，复现根因为begin仅设置通信mode且resume盲adopt系统当前听筒，没有默认耳机选择。本轮新call默认保留已选耳机，否则按真实通信可选列表选择wired/USB/SCO/LE/助听器；已连媒体耳机但无通话通道时等待最多8s且不开手机麦克风，失败不降级播放。API<=30主动连接SCO并确认后才8k采集。\n- 用户明确选手机保持显式意图；同逻辑call的native死会话重建透传已确认id/type，新call重置；现代只在有效setRoute结果确认，旧SCO仅有效连接回调确认。测试发现现代passive routes会污染失败/取消选择，修后630项全过。取消带call+native session+request身份，旧成功/失败不能暂停新恢复；4秒后可取消等待或明确改选手机，仍需手动继续。\n- 权限launcher异常清理pending；权限弹窗onPause延迟到前台，仅有效授权继续；真正onStop/挂断取消，迟到授权不复活。耳机默认JVM ${headset.checks}项/26分层每层30轮、权限生命周期${lifecycle.checks}项/18层每层30轮；实际方法用OS替身，不是Android声学。初始等待3s/7.9s确认时刷新heartbeat，防首批误判bridge stalled。\n- 最终${results.length}个命令均exit0且运行前后生产hash一致：默认耳机/权限、偏好630、取消控制器360/原生690、控制器327、路由392/原生1231、连续播放2397、tsc与Web构建。原生仅compileDebugJavaWithJavac --offline exit0，未assemble；既有弃用、chunk/混合引用告警保留。UI38/原UI151与时钟Java2432/JS1923、输入49及源契约19亦本轮执行通过，范围见各目录。\n- 自适应缓冲纯策略实验21569项/2880行通过完整音频hash，但稳定首声反而60→78ms，故未接生产阈值；不把欠载下降当普遍提速。700ms判停等上轮边界未更改。\n- 工作目录F:/VirtuGene-Mobile，可见模型GPT-6，推理强度未确认。业务API/token/麦克风0；无版本修改，进入本轮工作副本已6.1.5，不冒称本轮升级；无APK/安装/发布。SDK无emulator/system-image/AVD、ADB无设备，未要求用户真机。Android通知/系统权限、实际蓝牙/OEM双向声音与物理首声/功耗未验证；整体方案未宣称完成。\n- 生产文件AudioDefaultRoute/VoiceCallAudioPlugin、native-audio/controller/trace、VoiceCallDialog/store/CSS；证据${dir}/report.json、voice-default-headset-20261016与voice-route-recovery-20261016、voice-native-lifecycle-20261016。新增JVM夹具Java字符串初次转义失败保留在工具输出，修正后执行；旧route夹具缺新增expectedLegacyOutputType字段补齐不削弱断言。\n- 实际组件隔离预览http://127.0.0.1:4196/after?virtugene-preview=mobile，需node scripts/verify/voice-route-recovery-ui.mjs --serve --port 4196本地服务；只演示UI等待/取消、模型/麦克风/声音隔离，不代表Android耳机效果。UI前后4.2s同条件截图在route证据ui目录；本轮没有真实手机前后录屏、无Library保存。\n`;
 if(!existsSync(path)||!readFileSync(path,'utf8').includes(heading)){
  appendFileSync(path,(existsSync(path)?'':'# 手机版开发日志 · 2026-10-16\n')+note);
  appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- [[开发日志/2026-10-16#耳机默认选路修复与实时通话续做|耳机默认选路修复]]：默认优先真实耳机通话路径，未就绪不退手机；手动偏好/取消/权限迟到回归通过，未付费/打包，真实硬件仍未验证。\n');
 }
 const statusPath='.tmp-preview/voice-realtime-plan-20261015/status.json';
 const status=json(statusPath);status.goalComplete=false;status.phase='resumed: default headset selection and route recovery locally verified; full plan active';status.latestEvidence=`${dir}/report.json`;
 status.remaining=['Real provider/hardware/acoustic/system verification outside current authorization remains unverified','Adaptive buffer experiment regresses stable first sound; production threshold unchanged','General safe unpunctuated latency and energy-only endpoint limits remain','P3 background continuous calling remains conditional, not implemented'];writeFileSync(statusPath,JSON.stringify(status,null,2));
}
