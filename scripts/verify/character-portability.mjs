import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const evidence = resolve('.tmp-preview/character-portability-20261015');
const currentOnly = process.argv.includes('--current');
const output = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? join(evidence, currentOnly ? 'current.json' : 'comparison.json');
if (existsSync(output)) throw Error('Do not overwrite verification evidence: ' + output);
const before = currentOnly ? {} : JSON.parse(readFileSync(join(evidence, 'before-source.json'), 'utf8').replace(/^\uFEFF/u, ''));
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { date: '2026-10-15', workdir: process.cwd(), complete: false, versions: [], errors: [], model: '未确认', reasoning: '未确认' };
try {
  for (const label of currentOnly ? ['after'] : ['before', 'after']) {
    const bundle = await build({ entryPoints: ['scripts/verify/character-portability.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' },
      plugins: label === 'before' ? [{ name: 'frozen-before-source', setup(b) { b.onLoad({ filter: /\.ts$/ }, args => { const key = relative(process.cwd(), args.path).replaceAll('\\', '/'); return before[key] == null ? undefined : { contents: before[key], loader: 'ts', resolveDir: dirname(args.path) }; }); } }] : [] });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8'); res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><script src="/test.js"></script>'); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.waitForFunction(() => !!window.characterPortability);
      const data = await page.evaluate(() => window.characterPortability());
      report.versions.push({ label, ...data });
      console.log(JSON.stringify({ label, complete: data.complete, checks: data.checks.length, failed: data.checks.filter(c => !c.pass), send: data.send }));
      writeFileSync(output, JSON.stringify(report, null, 2));
    } finally { await context.close(); await new Promise(r => server.close(r)); }
  }
  if (currentOnly) report.complete = report.versions[0].complete;
  else {
    const [baseline, current] = report.versions;
    const stable = v => v.performanceSamples.filter(s => s.topic === '枫桥预约在什么时候' || s.topic === '没有匹配的主题').map(s => s.payloadHash);
    report.stablePromptUnchanged = JSON.stringify(stable(baseline)) === JSON.stringify(stable(current));
    report.complete = current.complete && report.stablePromptUnchanged && baseline.checks.some(c => !c.pass);
  }
} catch (error) { report.errors.push(error.stack || error.message); }
finally { await browser.close(); writeFileSync(output, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ complete: report.complete, stablePromptUnchanged: report.stablePromptUnchanged, evidence: output, errors: report.errors }));
if (!report.complete) process.exitCode = 1;
