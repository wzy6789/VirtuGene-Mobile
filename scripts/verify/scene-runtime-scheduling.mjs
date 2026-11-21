import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const out = resolve('.tmp-preview/device-full-20261025/scheduling-' + Date.now());
mkdirSync(out, { recursive: true });
const source = 'src/lib/chat-scene/scene-runtime.ts';
const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import {createSceneRuntime,inspectSceneRuntimeResources} from './src/lib/chat-scene/scene-runtime';
const room=document.querySelector('.chat-room') as HTMLElement;
const runtime=createSceneRuntime(document.getElementById('host')!,{id:'quiet-room',quality:'auto',motionEnabled:true,parallaxEnabled:false,renderer:'layered'},'balanced',()=>{});
(window as any).probe={runtime,room,resources:inspectSceneRuntimeResources};
` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
const html = '<!doctype html><html><style>.chat-room{position:fixed;inset:0}#host{height:100px}.vg-modal-overlay{position:fixed;inset:0;z-index:20}</style><body><div class="chat-room"><div id="host"></div><textarea></textarea></div><script src="/fixture.js"></script></body></html>';
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
  checks = await page.evaluate(async () => {
    const { runtime, room, resources } = window.probe;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await frame(); await frame();
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass, detail });
    const initial = JSON.stringify(runtime.inspect().policy);
    const computed = window.getComputedStyle;
    let modalReads = 0;
    window.getComputedStyle = function (element, ...rest) { if (element.matches?.('.vg-modal-overlay,.vg-modal-exit')) modalReads++; return computed.call(this, element, ...rest); };
    const modal = document.createElement('div'); modal.className = 'vg-modal-overlay';
    try {
      document.body.append(modal);
      for (let i = 0; i < 40; i++) room.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await Promise.resolve();
      check('portal and focus burst performs no eager style scans before the shared frame', modalReads === 0, { modalReads });
      await frame();
      check('one frame resolves the full covering modal policy with one scan', modalReads === 1 && runtime.inspect().signals.modalOpen && runtime.inspect().policy.mode === 'paused', { modalReads, mode: runtime.inspect().policy.mode });
      modal.remove();
      for (let i = 0; i < 40; i++) room.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await Promise.resolve(); await frame();
      check('closing and focus restoration return the exact original motion policy', JSON.stringify(runtime.inspect().policy) === initial);
      const input = room.querySelector('textarea'); input.focus(); await frame();
      check('input focus is reflected before the next presentation', runtime.inspect().signals.inputFocused);
      document.dispatchEvent(new Event('pause'));
      check('native background pause remains synchronous', !runtime.inspect().signals.appActive && runtime.inspect().policy.reason === 'background');
      document.dispatchEvent(new Event('resume')); await frame();
      check('native resume refreshes the active policy', runtime.inspect().signals.appActive);
      room.dataset.chatPhase = 'streaming'; await Promise.resolve(); runtime.sync();
      check('explicit sync remains immediate for a changed signal', runtime.inspect().signals.phase === 'streaming');
      room.dataset.chatPhase = 'waiting'; await Promise.resolve();
      runtime.dispose();
      const before = JSON.stringify([room.dataset.chatAmbient, room.dataset.chatAvatar, room.dataset.chatParticles]);
      await frame(); await frame();
      check('disposing cancels pending frame work and releases subscriptions', resources().runtimes === 0 && resources().subscriptions === 0 && before === JSON.stringify([room.dataset.chatAmbient, room.dataset.chatAvatar, room.dataset.chatParticles]));
    } finally { window.getComputedStyle = computed; modal.remove(); runtime.dispose(); }
    return checks;
  });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const result = { at: new Date().toISOString(), checks, errors, sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'), scope: 'Real runtime, portals, focus and animation frames; synthetic local DOM; no Android timing or model/audio calls.' };
writeFileSync(out + '/result.json', JSON.stringify(result, null, 2));
for (const row of checks) console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.name}${row.detail ? ' ' + JSON.stringify(row.detail) : ''}`);
console.log(JSON.stringify({ evidence: out + '/result.json', passed: checks.filter(c => c.pass).length, total: checks.length, errors }));
if (errors.length || checks.length !== 8 || checks.some(c => !c.pass)) process.exitCode = 1;
