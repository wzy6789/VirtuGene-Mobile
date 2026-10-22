import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const base = '.tmp-preview/voice-playback-buffer-policy-20261016', dir = `${base}/recovery-gated`;
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const before = json(`${dir}/before-run/report.json`), after = json(`${base}/report.json`);
assert.equal(before.variant, 'frozen-before-underrun-gate'); assert.equal(after.variant, 'underrun-gated-candidate');
assert.equal(after.sourceHashes['src/lib/voice-call/playback-buffer-policy.ts'], createHash('sha256').update(readFileSync(after.policySource)).digest('hex'));
assert.equal(before.rows.length, 2880); assert.equal(after.rows.length, 2880);
for (let i = 0; i < after.rows.length; i++) {
  const a = before.rows[i], b = after.rows[i];
  for (const field of ['scenario','rate','capacityMs','round','mode','seed','scheduleHash','pcmHash','renderedHash','tailHex','writtenFrames','renderedFrames']) {
    assert.deepEqual(a[field], b[field], `same fixture and full audio required: ${field}/${i}`);
  }
  if (b.mode !== 'adaptive') {
    assert.equal(a.firstProgressAtMs,b.firstProgressAtMs); assert.equal(a.underruns,b.underruns);
  }
}
const summary = after.summary.filter(row => row.rate === 24000 && row.capacityMs === 100 && row.mode !== 'fixed-80');
for (const scenario of ['stable', 'tiny-fragments', 'large-callbacks', 'short-eof']) {
  const a=summary.find(row=>row.scenario===scenario&&row.mode==='fixed-40'), b=summary.find(row=>row.scenario===scenario&&row.mode==='adaptive');
  assert.equal(a.firstProgressP50Ms,b.firstProgressP50Ms); assert.equal(a.firstProgressP95Ms,b.firstProgressP95Ms); assert.equal(b.underrunTotal,0);
}
const native=json('.tmp-preview/voice-route-recovery-20261016/native/report.json');
assert.equal(native.checks,780);
assert.equal(native.sourceHash,createHash('sha256').update(readFileSync('android/app/src/main/java/com/virtugene/app/plugins/VoiceCallAudioPlugin.java')).digest('hex'));
const report={date:new Date().toISOString(),workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',
  goalComplete:false,productionIntegration:false,rowsPerVariant:2880,roundsPerStratum:30,checks:after.checks,
  fixtureAndCompleteAudioUnchanged:true,unchangedFixedControlResults:true,summary,
  nativeBusySelectionChecks:780,actualProviderCalls:0,microphone:false,androidRuntime:false,versionChanged:false,apkBuilt:false,
  limitations:['Gate adjustment is still a pure-policy/software-sink experiment; it does not change production AudioTrack thresholds.',
    'Known jitter recovery still delays startup; persistent supply slower than realtime remains unresolved.',
    'Real API/Android/hardware/acoustic results were not measured. Original approved plan remains incomplete.']};
writeFileSync(`${dir}/comparison.json`,JSON.stringify(report,null,2));
if(process.argv.includes('--log')){
 const path='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-16.md', heading='## 实时通话继续：并发选路所有权与缓冲候选对照';
 if(!readFileSync(path,'utf8').includes(heading)){
  appendFileSync(path,`\n\n${heading}\n\n- 当前工作目录F:/VirtuGene-Mobile，可见模型GPT-6、推理强度未确认；业务API/token0，真实麦克风/设备/付费服务0。工作副本6.1.5不改，未APK/安装/发布。上轮是实际代码进展，本轮继续原方案，不将局部通过标整个目标完成。\n- 查到真实原生竞态：setRoute先claim递增高水位再拒绝pending，第二个请求即使route_pending失败，仍会使第一个确认poll失效。新增真实方法JVM红→绿；改为先拒绝busy再claim，30轮每类共780项（此前690+新增90）通过；Java compileDebugJavaWithJavac --offline明确exit0。只改VoiceCallAudioPlugin方法内判断顺序，不动耳机默认/用户显式偏好/后台权限边界。红证据voice-route-recovery-20261016/native/busy-owner-red.txt。\n- 缓冲仍为隔离候选，未接生产：原公式40+P90缺口+本地服务，轻微耗时无欠载也抬高阈值；新增稳定与未知counter两条失败测试后，将估计提高限制为实际active-supply欠载已证实的恢复窗口，保留同call/route<=16数值样本、30s过期、8clean迟滞、40–160ms与容量限制、取消不训练。不是授权缓存，不预读未来样本，不改生产40ms阈值。\n- 冻结真实旧策略与新策略同夹具各2880行、30轮/分层，${after.checks}项通过；逐行同seed/到达schedule/PCM帧数/hash/尾样本，固定40/80对照结果完全不变。24k/100ms稳定首frame P50/P95新候选与固定40相同60/62ms，修正前候选78/81ms；tiny/大回调/短EOF同样无稳定回退。局限不掩盖：有界抖动固定40欠载6→候选3，但首frame52/92→82/122ms；持续慢供给809→240次欠载，累计29300ms仍未解决。只有软件sink帧推进，不是物理首声；本轮不据此开启生产自适应。\n- 改动playback-buffer-policy.ts、对应测试/runner，新增voice-buffer-recovery-compare.mjs；冻结旧源码和旧summary在${dir}/before/，配对重跑before-run/report.json，最终${dir}/comparison.json。比较不覆盖原日志，初版稳定退速结论仍保留为旧候选。类型检查exit0。没有本轮同条件前后截图或录屏，纯音频/策略数据路径无新增UI。\n- 剩余实际工作：生产缓冲接入和EOF尾包策略仍未实施，需要保留语音/撤权/取消语义后验证；通用无标点时限、能量VAD轻声/电视边界仍在；真实MiMo与Android系统/蓝牙/物理时延不在已验证范围。继续active，不声称“真实打电话速度已达标”或“方案完成”。\n`);
  appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- [[开发日志/2026-10-16#实时通话继续：并发选路所有权与缓冲候选对照|通话并发选路与缓冲候选]]：修复被拒绝的并发请求抢占当前选路，780项及Java编译通过；新缓冲候选消除稳定首声退速，仍未接生产。\n');
 }
 const statusPath='.tmp-preview/voice-realtime-plan-20261015/status.json';const status=json(statusPath);
 status.goalComplete=false;status.phase='active: native route busy-claim race fixed; gated buffering experiment not production integrated';status.latestEvidence=`${dir}/comparison.json`;
 status.remaining=['Production adaptive buffering and content-preserving EOF path remain unimplemented','General safe unpunctuated deadline and energy-only VAD limitations remain','Real provider/Android/hardware/acoustic results remain unverified within no-paid/no-package constraints','P3 background calling is conditional and not implemented'];writeFileSync(statusPath,JSON.stringify(status,null,2));
}
console.log(JSON.stringify({evidence:`${dir}/comparison.json`,checks:after.checks,rowsPerVariant:2880,productionIntegration:false,goalComplete:false}));
