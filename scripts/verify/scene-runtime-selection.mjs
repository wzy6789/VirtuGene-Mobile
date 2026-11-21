import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Real Selection and real runtime; no application account, media or transport.
const out = resolve('.tmp-preview/device-full-20261025/selection-' + Date.now());
mkdirSync(out, { recursive: true });
const source = 'src/lib/chat-scene/scene-runtime.ts';
const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import { createSceneRuntime, inspectSceneRuntimeResources } from './src/lib/chat-scene/scene-runtime';
const host = document.getElementById('host')!;
const runtime = createSceneRuntime(host, {id:'quiet-room',quality:'auto',motionEnabled:true,parallaxEnabled:false,renderer:'layered'}, 'balanced', () => {});
(window as any).probe = { runtime, resources:inspectSceneRuntimeResources };
` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const html = `<!doctype html><html><head><style>.chat-room{position:fixed;inset:0}#host{height:100px}#hidden{display:none}</style></head>
<body><main class="chat-room"><div id="host"></div><p id="inside">清楚可见的文字</p><p id="hidden">不可见的文字</p></main><aside id="outside">别处的文字</aside><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/fixture.js' ? 'application/javascript' : 'text/html;charset=utf-8');
  response.end(request.url === '/fixture.js' ? built.outputFiles[0].contents : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let checks = [];
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.probe?.runtime.inspect()?.signals.visible);
  checks = await page.evaluate(() => {
    const { runtime, resources } = window.probe;
    const selection = document.getSelection();
    const original = Selection.prototype.toString;
    let reads = 0;
    Selection.prototype.toString = function () { reads++; return original.call(this); };
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass, detail });
    const select = id => { selection.removeAllRanges(); const range = document.createRange(); range.selectNodeContents(document.getElementById(id)); selection.addRange(range); return range; };
    try {
      selection.removeAllRanges(); reads = 0;
      for (let i = 0; i < 20; i++) runtime.sync();
      check('empty selection does not request rendered text during repeated policy sync', reads === 0, { renderedSelectionReads: reads });
      check('empty selection keeps ambient motion available', !runtime.inspect().signals.selectingText && runtime.inspect().policy.mode === 'idle');
      select('inside'); runtime.sync();
      check('a real selected room passage pauses motion', runtime.inspect().signals.selectingText && runtime.inspect().policy.reason === 'selection');
      check('the selected fixture contains visible text', original.call(selection) === '清楚可见的文字');
      selection.collapseToEnd(); reads = 0; runtime.sync();
      check('collapsed caret restores motion without rendered text lookup', !runtime.inspect().signals.selectingText && runtime.inspect().policy.mode === 'idle' && reads === 0, { renderedSelectionReads: reads });
      select('outside'); reads = 0; runtime.sync();
      check('selection outside this room does not serialize or pause it', !runtime.inspect().signals.selectingText && reads === 0, { renderedSelectionReads: reads });
      select('hidden'); runtime.sync();
      check('hidden room text does not become a visible reading selection', !runtime.inspect().signals.selectingText);
      selection.removeAllRanges(); runtime.sync();
      runtime.dispose();
      check('selection checks release all runtime subscriptions', resources().runtimes === 0 && resources().subscriptions === 0);
    } finally { Selection.prototype.toString = original; selection.removeAllRanges(); runtime.dispose(); }
    return checks;
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const result = { at: new Date().toISOString(), checks, errors, sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'), scope: 'Real runtime and browser Selection; isolated local fixture; no Android timing or model/audio calls.' };
writeFileSync(out + '/result.json', JSON.stringify(result, null, 2));
for (const row of checks) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? ' ' + JSON.stringify(row.detail) : ''}`);
console.log(JSON.stringify({ evidence: out + '/result.json', passed: checks.filter(c => c.pass).length, total: checks.length, errors }));
if (errors.length || checks.length !== 8 || checks.some(c => !c.pass)) process.exitCode = 1;
