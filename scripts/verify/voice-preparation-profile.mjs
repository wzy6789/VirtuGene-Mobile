import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const evidence = '.tmp-preview/voice-preparation-20261015-r2'; mkdirSync(evidence, { recursive: true });
const baseline = process.argv.includes('--baseline');
const labels = baseline ? ['before'] : ['before', 'after'];
const report = { results: [], errors: [], apiCalls: 0 };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const label of labels) {
    const bundle = await build({ entryPoints: ['scripts/verify/voice-context-latency.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' }, plugins: [{ name: 'profile', setup(b) {
      b.onLoad({ filter: /[\\/]scripts[\\/]verify[\\/]voice-context-latency\.ts$/ }, args => {
        let contents = readFileSync(args.path, 'utf8');
        contents = `import {memorySourceTombstoneRepo as profileTombstones} from '../../src/db/memory-source-tombstone-repo';\nimport {diaryRepo as profileDiaries} from '../../src/db/diary-repo';\nimport {continuityRepo as profileContinuity} from '../../src/db/continuity-repo';\n` + contents;
        contents = contents.replace('Object.assign(window,', `
for (const [label, object, key] of [['suppressed',profileTombstones,'suppressedMessages'],['selectedSuppressed',profileTombstones,'selectedSuppressedMessages'],['known',knowledgeRepo,'listKnownBy'],['visibleDiary',profileDiaries,'listVisibleFor'],['openContinuity',profileContinuity,'getOpenByCharacter']] as const) {
  const original=(object as any)[key];
  (object as any)[key]=async function(...args:any[]) {
    const log={label,scope:args.slice(0,2),stack:new Error().stack?.split('\\n').slice(2,5).join('\\n'),ms:0};
    ((counts as any).methodCalls??=[]).push(log);const start=performance.now();
    try{return await original.apply(this,args);}finally{log.ms=performance.now()-start;}
  };
}
Object.assign(window,`);
        return { contents, loader: 'ts', resolveDir: dirname(args.path) };
      });
      if (label === 'before') b.onLoad({ filter: /[\\/](?:voice-call[\\/]context|character-memory|knowledge-repo|diary-repo|reviewed-speech)\.ts$/ }, args => ({ contents: readFileSync(join(evidence, 'before', basename(args.path)), 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
    } }] });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8'); res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<script src="/test.js"></script>'); });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); const context = await browser.newContext();
    try {
      const page = await context.newPage(); await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
      const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => !!window.voiceContextLatency);
      const result = await page.evaluate(async () => { try { return await window.voiceContextLatency(true, true); } catch (error) { throw Error(error.name + ': ' + error.message); } });
      report.results.push({ label, ...result }); console.log(JSON.stringify({ label, samples: result.samples.length, preparationMs: result.samples.map(s => s.prepareMs), preparation: result.samples[0].preparation }));
    } finally { await context.close(); await new Promise(r => server.close(r)); }
  }
  report.promptUnchanged = new Set(report.results.flatMap(r => r.samples.map(s => s.promptHash))).size === 1;
  if (!report.promptUnchanged) throw Error('actual model input changed');
} catch (error) { report.errors.push(error.message); process.exitCode = 1; }
finally { await browser.close(); writeFileSync(join(evidence, baseline ? 'baseline.json' : 'comparison.json'), JSON.stringify(report, null, 2)); }
