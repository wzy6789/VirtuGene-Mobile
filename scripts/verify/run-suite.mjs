/**
 * 单套件运行器（与 world-stream.mjs 同一套被验证过的启动参数）：
 *   node scripts/verify/run-suite.mjs worldF [worldA ...]
 * 前置：scripts/verify/serve.cjs 已在 17899 端口运行。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const suites = process.argv.slice(2);
if (suites.length === 0) {
  console.log('usage: node scripts/verify/run-suite.mjs <suite> [suite...]');
  process.exit(2);
}

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const results = [];

for (const suite of suites) {
  const resultFile = join(root, 'scripts/verify', `.last-result-${suite}.txt`);
  if (existsSync(resultFile)) rmSync(resultFile);
  const profile = join(root, '.tmp-preview', `run-${suite}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });

  const start = Date.now();
  const browser = spawn(EDGE, [
    '--headless', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${profile}`,
    'http://127.0.0.1:17899/' + suite + '.html',
  ], { windowsHide: true, stdio: 'ignore' });

  let waited = 0;
  let text = '';
  const timeoutMs = 150_000;
  while (waited < timeoutMs) {
    if (existsSync(resultFile)) {
      const probe = readFileSync(resultFile, 'utf8');
      if (/(ALL PASS|\d+ FAILED)\s*$/.test(probe)) { text = probe; break; }
    }
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  if (!text && existsSync(resultFile)) text = readFileSync(resultFile, 'utf8');
  browser.kill();

  const okCount = (text.match(/^ok /gm) ?? []).length;
  const failCount = (text.match(/^FAIL /gm) ?? []).length;
  const verdict = /ALL PASS\s*$/.test(text) ? 'PASS' : text ? 'FAIL' : 'TIMEOUT';
  results.push({ suite, verdict, ok: okCount, fail: failCount, seconds: ((Date.now() - start) / 1000).toFixed(1) });
  console.log(`${suite.padEnd(10)} ${verdict.padEnd(7)} ok=${okCount} fail=${failCount}`);
  if (verdict !== 'PASS') console.log(text.split('\n').filter((l) => l.startsWith('FAIL') || l.startsWith('PAGE') || l.startsWith('UNHANDLED')).map((l) => '    ' + l).join('\n'));
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked profile files on Windows are fine to leave */ }
}

const totalFail = results.reduce((n, r) => n + r.fail, 0);
console.log(`\n套件 ${results.length} 个：PASS ${results.filter((r) => r.verdict === 'PASS').length}，FAIL ${results.filter((r) => r.verdict === 'FAIL').length}，TIMEOUT ${results.filter((r) => r.verdict === 'TIMEOUT').length}；断言 fail=${totalFail}`);
process.exitCode = results.every((r) => r.verdict === 'PASS') ? 0 : 1;
