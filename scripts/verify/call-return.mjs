import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const before = process.argv.includes('--before');
const output = `.tmp-preview/ui-overhaul-20261017/call-return/${before ? 'before' : 'after'}`;
mkdirSync(output, { recursive: true });
const bundle = await build({ stdin: { contents: `
import './scripts/verify/voice-chat-integration';
import {useAuthStore} from './src/store/auth-store';
import {useChatStore} from './src/store/chat-store';
import {useVoiceCallStore} from './src/store/voice-call-store';
import {useVoiceCallUIStore} from './src/store/voice-call-ui-store';
let starts=0;
useVoiceCallStore.setState({start:async()=>{starts++;throw Error('No call start allowed in return verification')}});
const nativeAnimate=Element.prototype.animate;
window.returnFlights=[];
Element.prototype.animate=function(...args){
  const animation=nativeAnimate.apply(this,args);
  if(this.classList.contains('vg-soul-ghost'))window.returnFlights.push({
    frames:animation.effect.getKeyframes(),duration:animation.effect.getTiming().duration,
    text:this.textContent,ariaHidden:this.getAttribute('aria-hidden'),inert:this.inert,
    orbOnly:this.children.length===1&&this.firstElementChild.matches('.vg-soul-orb'),controls:this.querySelectorAll('button,input,textarea,[role="button"]').length,
    destinationHidden:document.querySelector('.chat-header [data-soul-orb-host]')?.hasAttribute('data-soul-hidden'),
    sourceBox:{width:this.getBoundingClientRect().width,height:this.getBoundingClientRect().height},
  });
  return animation;
};
window.callReturn={
  async setup(){window.voiceChatIntegration.resetCall();await window.voiceChatIntegration.setup();window.returnFlights=[];},
  clear(){window.returnFlights=[];},
  snapshot(){return {target:!!useVoiceCallUIStore.getState().target,flights:window.returnFlights,
    ghosts:document.querySelectorAll('.vg-soul-ghost').length,hidden:document.querySelectorAll('[data-soul-hidden]').length,
    starts,selected:useChatStore.getState().selectedCharacterId,session:useChatStore.getState().currentSessionId}},
  session(){useChatStore.setState({currentSessionId:'voice-chat-other-session'})},
  account(){useAuthStore.setState({userId:'another-isolated-owner'})},
  reduced(on){document.documentElement.dataset.vgReducedMotion=String(on);window.dispatchEvent(new Event('vg:motion-preference'));},
};`, resolveDir: process.cwd(), sourcefile: 'call-return-fixture.ts', loader: 'ts' }, outfile: 'return.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{"DEV":true}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"test"' },
  plugins: [{ name: 'isolated-call-controller-and-before-source', setup(builder) {
    builder.onLoad({ filter: /voice-call[\\/]controller\.ts$/ }, () => ({ contents: readFileSync('scripts/verify/voice-chat-integration.controller.ts', 'utf8'), loader: 'ts' }));
    if (before) builder.onLoad({ filter: /[\\/](VoiceCallHost|VoiceCallDialog)\.tsx$/ }, args => ({ contents: readFileSync(`.tmp-preview/ui-overhaul-20261017/call-return/source-before/${args.path.split(/[\\/]/).at(-1)}`, 'utf8'), loader: 'tsx', resolveDir: dirname(args.path) }));
  } }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = readdirSync('dist/renderer/assets').filter(name => name.endsWith('.css')).map(name => readFileSync(`dist/renderer/assets/${name}`, 'utf8')).join('\n') + '\n' + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const assets = 'dist/renderer/assets';
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://127.0.0.1').pathname.split('/').pop();
  if (/^[\w.-]+\.woff2$/.test(name) && readdirSync(assets).includes(name)) { response.setHeader('Content-Type', 'font/woff2'); response.end(readFileSync(`${assets}/${name}`)); return; }
  response.setHeader('Content-Type', request.url === '/test.js' ? 'application/javascript' : 'text/html;charset=utf-8');
  response.end(request.url === '/test.js' ? js : `<html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="connect-src 'none';media-src 'none'"><style>${css}</style></head><body><div id="root"></div><script src="/test.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
const page = await context.newPage();
const checks = [], errors = [], snapshots = {}; let external = 0;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => { if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue(); external++; return route.abort(); });
await page.addInitScript(() => {
  window.returnDevices = { microphone: 0, playback: 0 };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.returnDevices.microphone++; throw Error('Microphone disabled'); };
  HTMLMediaElement.prototype.play = async () => { window.returnDevices.playback++; throw Error('Playback disabled'); };
});
const check = (name, pass, detail) => checks.push({ name, passed: !!pass, ...(detail === undefined ? {} : { detail }) });
const snapshot = async name => snapshots[name] = await page.evaluate(() => window.callReturn.snapshot());
const prepare = async () => {
  await page.evaluate(() => window.callReturn.reduced(false));
  await page.evaluate(() => window.callReturn.setup());
  await page.locator('.chat-header').waitFor();
  await page.locator('.chat-header > button[aria-label*="语音通话"]').click();
  await page.getByRole('button', { name: '开始通话', exact: true }).waitFor();
  await page.waitForTimeout(360);
  await page.evaluate(() => window.callReturn.clear());
};
const clickReturn = async twice => page.locator('.vg-voice-call-minimize').evaluate((node, twice) => { node.click(); if (twice) node.click(); return window.callReturn.snapshot(); }, !!twice);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
  await page.waitForFunction(() => window.callReturn);
  await prepare();
  await page.screenshot({ path: `${output}/preparation-390.png` });
  snapshots.normalImmediate = await clickReturn(false);
  const normal = snapshots.normalImmediate;
  check('preparation return closes business target immediately', !normal.target, normal);
  check('preparation return uses one existing orb handoff', normal.flights.length === 1 && normal.ghosts === 1, normal);
  const flight = normal.flights[0];
  check('return targets the current chat orb and contains no transcript or controls', flight?.destinationHidden && flight?.inert && flight?.ariaHidden === 'true' && flight?.orbOnly && flight?.controls === 0 && flight?.text?.length <= 32, flight);
  check('return contracts the large stage orb within 320ms', flight && flight.duration <= 320 && /scale\(0\./.test(flight.frames.at(-1).transform), flight);
  await page.waitForTimeout(65); await page.screenshot({ path: `${output}/return-in-motion-390.png` });
  await page.waitForTimeout(340);
  const settled = await snapshot('normalSettled');
  check('settled return leaves no ghost or hidden orb', settled.ghosts === 0 && settled.hidden === 0, settled);
  await prepare(); const rapid = await clickReturn(true); snapshots.rapidImmediate = rapid;
  check('two immediate return activations close once without duplicate flight', !rapid.target && rapid.flights.length === 1 && rapid.ghosts === 1, rapid);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  const interrupted = await snapshot('pointerInterrupted');
  check('pointer interruption clears the return visual immediately', interrupted.ghosts === 0 && interrupted.hidden === 0, interrupted);
  for (const guard of ['session', 'account']) {
    await prepare(); const returning = await clickReturn(false);
    await page.evaluate(guard => window.callReturn[guard](), guard);
    const cancelled = await snapshot(`${guard}DuringReturn`);
    check(`${guard} change cancels an active return immediately`, returning.flights.length === 1 && cancelled.ghosts === 0 && cancelled.hidden === 0, cancelled);
    await page.waitForTimeout(330);
  }
  await prepare(); await page.evaluate(() => window.callReturn.reduced(true));
  const reduced = await clickReturn(false); snapshots.reducedBeforeReturn = reduced;
  check('reduced motion closes immediately without a clone', !reduced.target && reduced.flights.length === 0 && reduced.ghosts === 0 && reduced.hidden === 0, reduced);
  await prepare(); const motion = await clickReturn(false); await page.evaluate(() => window.callReturn.reduced(true));
  const reducedDuring = await snapshot('reducedDuringReturn');
  check('enabling reduced motion interrupts an active return', motion.flights.length === 1 && reducedDuring.ghosts === 0 && reducedDuring.hidden === 0, reducedDuring);
  await prepare(); await page.evaluate(() => document.querySelector('.chat-header').style.display = 'none');
  const missing = await clickReturn(false); snapshots.missingTarget = missing;
  check('missing chat anchor still closes immediately without a stray flight', !missing.target && missing.flights.length === 0 && missing.ghosts === 0 && missing.hidden === 0, missing);
  await page.evaluate(() => document.querySelector('.chat-header').style.removeProperty('display'));
  await prepare(); await page.evaluate(() => { const cover=document.createElement('div');cover.className='vg-modal-overlay';cover.dataset.returnCover='';document.body.append(cover); });
  const covered = await clickReturn(false); snapshots.coveredChat = covered;
  check('another open modal prevents a return into the covered chat', !covered.target && covered.flights.length === 0 && covered.ghosts === 0 && covered.hidden === 0, covered);
  await page.evaluate(() => document.querySelector('[data-return-cover]').remove());
  await prepare(); await page.evaluate(() => window.callReturn.session());
  const stale = await clickReturn(false); snapshots.staleSession = stale;
  check('a different current session never receives the old call orb', !stale.target && stale.flights.length === 0 && stale.ghosts === 0 && stale.hidden === 0, stale);
  await page.waitForTimeout(350);
  check('return never starts a call', (await snapshot('final')).starts === 0);
  check('microphone and playback remain isolated', JSON.stringify(await page.evaluate(() => window.returnDevices)) === JSON.stringify({ microphone: 0, playback: 0 }));
  check('no uncaught browser error', errors.length === 0, errors);
  check('no external network attempt', external === 0, external);
} catch (error) { checks.push({ name: 'runner completed', passed: false, error: error.stack }); await page.screenshot({ path: `${output}/failure.png` }); }
finally {
  const result = { mode: before ? 'before' : 'after', status: checks.every(check => check.passed) ? 'pass' : 'fail', checks, snapshots, errors, externalRequests: external,
    scope: 'Actual ChatWindow, VoiceCallHost, VoiceCallDialog, shared handoff and isolated IndexedDB records. Controller stubbed, start forbidden, no model/microphone/playback/native/Android. Existing production CSS; no renderer build.', realModelCalls: 0, androidTested: false };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, passed: checks.filter(check => check.passed).length, total: checks.length, output }));
  await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
  if (result.status !== 'pass') process.exitCode = 1;
}
