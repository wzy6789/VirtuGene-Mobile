import { readFileSync, writeFileSync, appendFileSync, existsSync, copyFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = '.tmp-preview/voice-context-overlap-20261015';
const corrected = JSON.parse(readFileSync(`${dir}/browser-comparison.json`, 'utf8'));
const raw = readFileSync(`${dir}/browser-utf8-rerun.txt`, 'utf8').replaceAll('\0', '');
assert.equal(corrected.actualReadsUnchanged, true);
assert.equal(corrected.fullInputHashesUnchanged, true);
assert.equal(corrected.modelRequestCountsUnchanged, true);
assert.ok(corrected.guards.every(guards => guards.length === 7));
assert.ok(raw.includes('"mode":"before","rounds":30') && raw.includes('"mode":"after","rounds":30'));
const runner = readFileSync('scripts/verify/voice-context-overlap-browser.mjs', 'utf8');
assert.ok(runner.includes("document.characterSet), 'UTF-8'"));
const auditPath = `${dir}/audit.json`, archive = `${dir}/browser-pre-utf8/audit-before-correction.json`;
if (existsSync(auditPath)) {
  if (!existsSync(archive)) copyFileSync(auditPath, archive);
  const old = JSON.parse(readFileSync(auditPath, 'utf8'));
  old.browserEvidenceStatus = 'withdrawn: missing UTF-8 in original browser harness; use utf8-correction.json';
  old.supersededBy = `${dir}/utf8-correction.json`;
  writeFileSync(auditPath, JSON.stringify(old, null, 2));
}
const report = { date: new Date().toISOString(), oldBrowserEvidenceWithdrawn: true,
  reason: 'HTML/JavaScript without explicit UTF-8 were decoded under the browser fallback encoding; Chinese segmentation and DB fixture text differed from production.',
  oldEvidence: `${dir}/browser-pre-utf8/`, correctedCommand: 'node scripts/verify/voice-context-overlap-browser.mjs',
  encoding: 'UTF-8 asserted at runtime; same complete Unicode fixture before/after', corrected,
  apiCalls: 0, microphone: false, physicalAudio: false,
  limitation: 'Synthetic MiMo and playback with actual isolated IndexedDB in 4x CPU desktop Chrome; no Android/provider latency claim.' };
writeFileSync(`${dir}/utf8-correction.json`, JSON.stringify(report, null, 2));
if (process.argv.includes('--log')) {
  const path = 'D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md';
  const title = '## 实时通话证据更正：UTF-8浏览器夹具重跑';
  if (!readFileSync(path, 'utf8').includes(title)) {
    const [before, after] = corrected.summary;
    appendFileSync(path, `\n\n${title}\n\n- 工作目录F:/VirtuGene-Mobile，可见编码模型GPT-6，推理强度未确认；业务模型API请求/token均0，无麦克风/手机/版本/安装包/发布。\n- 发现此前上下文重叠浏览器页未显式指定UTF-8，导致中文在浏览器中被错误解码。撤回原1593.5→1253.6ms及其相关浏览器耗时结论；旧证据保留browser-pre-utf8/，原audit已标withdrawn，历史日志不抹除。Node确定性测试不受此HTML编码问题影响。\n- 统一HTML meta与HTTP HTML/JS charset=utf-8，并在运行时断言UTF-8后，完整重跑每版本30轮。更正后的软件首播P50 ${before.softwarePlaybackFromSpeech.p50.toFixed(1)}→${after.softwarePlaybackFromSpeech.p50.toFixed(1)}ms，P95 ${before.softwarePlaybackFromSpeech.p95.toFixed(1)}→${after.softwarePlaybackFromSpeech.p95.toFixed(1)}ms；最终残余准备P50 ${before.residualPreparationWaitMs.p50.toFixed(1)}→${after.residualPreparationWaitMs.p50.toFixed(1)}ms。不是Android或真实MiMo速度。\n- 完整模型输入hash、WAV、模型请求、真实每表读取/DB请求/事务逐轮相同；7个DB保护项每版本通过。UTF-8有效夹具的正常台账写入为36次，早准备0写入，最终确认后与正常路径一致；此前32次只属于旧错误编码夹具，不能当正式数量契约。取消/撤权仍拒绝提前写入。\n- 证据${dir}/utf8-correction.json、browser-utf8-rerun.txt、browser-before/after.json。无本轮同条件前后录屏，不把模拟音频作为真实听感达标。\n`);
    appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md', `\n- [[开发日志/2026-10-15#实时通话证据更正：UTF-8浏览器夹具重跑|实时通话UTF-8证据更正]]：撤回旧浏览器对照；UTF-8运行断言后每版本30轮软件首播P50 ${before.softwarePlaybackFromSpeech.p50.toFixed(0)}→${after.softwarePlaybackFromSpeech.p50.toFixed(0)}ms，完整输入与实际读取一致；非手机/真实服务数据。\n`);
  }
}
console.log(JSON.stringify({ evidence: `${dir}/utf8-correction.json`, oldBrowserEvidenceWithdrawn: true, corrected: corrected.summary }));
