import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join, basename, resolve } from 'node:path';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const out = process.env.VG_CHAT_ATMOSPHERE_EVIDENCE ?? '.tmp-preview/chat-atmosphere-ui-20261014';
mkdirSync(out, { recursive: true });
const bundle = await build({ entryPoints: ['scripts/verify/chat-atmosphere-ui.tsx'], bundle: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' },
  define: { 'import.meta.hot': 'undefined', 'import.meta.env': '{"DEV":true,"VITE_AI_GATEWAY_URL":""}', __APP_VERSION__: '"isolated-atmosphere-verification"' },
  plugins: [{ name: 'unchanged-bubble-render-count', setup(builder) {
    builder.onLoad({ filter: /MessageBubble\.tsx$/ }, async args => ({ loader: 'tsx', contents: readFileSync(args.path, 'utf8')
      .replace(/(function MessageBubble\([^\n]+\{\s*\n)/, '$1  window.bubbleRenders ??= {}; window.bubbleRenders[message.id] = (window.bubbleRenders[message.id] || 0) + 1;\n') }));
  } }],
});
const assets = 'dist/renderer/assets';
const cssFiles = readdirSync(assets).filter(file => file.endsWith('.css'));
const css = cssFiles.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('');
const server = createServer((req, res) => {
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url.startsWith('/assets/')) {
    try { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(readFileSync(join(assets, basename(req.url)))); }
    catch { res.writeHead(404); res.end(); }
  } else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><div id="app" class="mobile-layout"></div><script src="/test.js"></script></body></html>`); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = { status: 'running', capturedAt: new Date().toISOString(), checks: [], palettes: [], screenshots: [], errors: [], limitations: [
  'Actual React components and production CSS in desktop Chrome touch emulation; not Android GPU, native IME, hardware haptics or an installed APK.',
  'App background, hidden-tab and viewport conditions are explicitly simulated. No private chat data, real model, paid speech or microphone calls.',
] };
const check = (ok, label, details) => {
  evidence.checks.push({ pass: !!ok, label, ...(details ? { details } : {}) });
  if (!ok) throw new Error(label + (details ? `: ${JSON.stringify(details)}` : ''));
  console.log(`ok ${label}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!window.atmosphereTest);
  const api = (name, ...args) => page.evaluate(({ name, args }) => window.atmosphereTest[name](...args), { name, args });
  const chat = (name, ...args) => page.evaluate(({ name, args }) => window.chatStreamTest[name](...args), { name, args });
  const ready = async (history = 4, compact = true) => { await api('setup', history, compact); await page.getByRole('textbox', { name: '消息内容', exact: true }).waitFor(); await page.waitForTimeout(350); };
  const appearance = (theme, motion = 'gentle', mode = 'manual') => api('set', { mode, theme, motion });
  const roomTheme = () => page.locator('.chat-room').getAttribute('data-chat-atmosphere');
  const edge = (part = '::before') => page.locator('.vg-chat-atmosphere-edge').evaluate((node, part) => {
    const s = getComputedStyle(node, part); return { name: s.animationName, playState: s.animationPlayState, duration: s.animationDuration,
      opacity: Number(s.opacity), transition: s.transitionDuration, width: parseFloat(s.width), filter: s.filter, transform: s.transform,
      pointerEvents: getComputedStyle(node).pointerEvents, left: s.left, right: s.right };
  }, part);
  const screenshot = async name => { const path = `${out}/${name}.png`; await page.screenshot({ path }); evidence.screenshots.push(resolve(path)); };
  await ready();
  const owner = await api('owner');
  const themes = await page.evaluate(() => window.atmosphereTest.themes);
  check(await roomTheme() === 'warm', 'existing explicit personality selects the warm character theme');
  check((await api('resolve', { tags: [], systemPrompt: '故事里她遇见一个温柔的人。' })).primary === 'neutral', 'unrelated lore never invents a personality theme');

  // Real rendered contrast includes each ancestor's opacity and every computed
  // gradient endpoint. The endpoint combinations conservatively cover highlights
  // rather than reporting only the raw palette pair from the configuration file.
  const inspectPalette = () => page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const p = ctx.getImageData(0, 0, 1, 1).data; return [p[0], p[1], p[2], p[3] / 255]; };
    const over = (top, bottom) => { const alpha = top[3] + bottom[3] * (1 - top[3]); return alpha ? [0,1,2].map(i => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha).concat(alpha) : [0,0,0,0]; };
    const lum = c => [0.2126,0.7152,0.0722].reduce((sum, k, i) => { const v = c[i] / 255; return sum + k * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); }, 0);
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const paints = node => {
      if (!node || node === document.documentElement.parentElement) return [[255,255,255,1]];
      const parent = node.parentElement ? paints(node.parentElement) : [[255,255,255,1]];
      const s = getComputedStyle(node), base = rgba(s.backgroundColor);
      const stops = [...s.backgroundImage.matchAll(/rgba?\([^)]*\)|color\([^)]*\)|#[\da-f]+/gi)].map(match => rgba(match[0]));
      // An opaque gradient covers the whole box; its transparent background-color
      // is not an additional visible endpoint. Transparent gradient stops already
      // include the exposed base where that exposure can actually occur.
      const candidates = stops.length ? stops.map(stop => over(stop, base)) : [base];
      // Palette surfaces are opaque, so deduplication bounds this independently
      // of the number of ancestors in an actual message row.
      return [...new Map(parent.flatMap(bg => candidates.map(color => over(color, bg))).map(color => [color.map(v => Math.round(v * 100)).join(','), color])).values()].slice(0, 48);
    };
    const probe = node => {
      const s = getComputedStyle(node); let opacity = 1;
      for (let p = node; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
      const ink = rgba(s.color); ink[3] *= opacity;
      const surfaces = paints(node);
      return { text: node.textContent?.trim().slice(0,40), color: s.color, font: s.fontSize, opacity,
        minimum: Math.min(...surfaces.map(bg => ratio(over(ink, bg), bg))), backgrounds: surfaces.length };
    };
    const room = document.querySelector('.chat-room'), css = getComputedStyle(room);
    const named = {
      assistant: document.querySelector('.is-character .vg-message-text'),
      user: document.querySelector('.is-user .vg-message-text'),
      title: document.querySelector('.chat-header-title .text-ink'),
      status: document.querySelector('.vg-chat-presence'),
      input: document.querySelector('[aria-label="消息内容"]'),
      send: document.querySelector('.chat-composer-send'),
    };
    const edge = document.querySelector('.vg-chat-atmosphere-edge'), glow = getComputedStyle(edge, '::before');
    const input = document.querySelector('[aria-label="消息内容"]');
    const composer = [...document.querySelectorAll('.chat-composer-inner > .vg-voice-tools,.chat-composer-input,.chat-composer-send')].map(node => {
      const box = node.getBoundingClientRect(); return {left:box.left,right:box.right,width:box.width};
    });
    return { bg: css.backgroundColor, text: css.color, phase: room.dataset.chatPhase,
      reading: Object.fromEntries(Object.entries(named).filter(([,node]) => node).map(([name,node]) => [name,probe(node)])),
      width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      buttons: [...document.querySelectorAll('.chat-header button,.chat-composer button')].filter(n => n.getClientRects().length).map(n => {
        const box = n.getBoundingClientRect(); return { label: n.getAttribute('aria-label') ?? n.title, width: box.width, height: box.height, disabled: n.disabled };
      }),
      glow: { width: parseFloat(glow.width), roomWidth: room.getBoundingClientRect().width, pointerEvents: getComputedStyle(edge).pointerEvents },
      inputWidth: input.getBoundingClientRect().width, composer,
      threadBackground: getComputedStyle(document.querySelector('.chat-thread')).backgroundImage,
    };
  });
  // Keep the send control enabled while sampling its actual high-contrast palette.
  await page.evaluate(() => { const input = document.querySelector('[aria-label="消息内容"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, '随手写一行'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  for (const theme of themes) for (const mode of ['dark', 'light']) for (const width of [320,390,430]) {
    await page.setViewportSize({ width, height: 844 }); await api('theme', mode); await appearance(theme.id); await page.waitForTimeout(80);
    const palette = await inspectPalette(); evidence.palettes.push({ theme: theme.id, mode, ...palette });
    const expected = theme[mode];
    const expectedRgb = value => `rgb(${parseInt(value.slice(1,3),16)}, ${parseInt(value.slice(3,5),16)}, ${parseInt(value.slice(5,7),16)})`;
    check(palette.bg === expectedRgb(expected.bg) && palette.text === expectedRgb(expected.text), `${theme.id} ${mode} ${width}px consumes the intended actual palette`, palette);
    const readable = Object.entries(palette.reading).filter(([name]) => name !== 'send');
    check(readable.every(([,value]) => value.minimum >= 4.5) && palette.reading.send.minimum >= 3,
      `${theme.id} ${mode} ${width}px rendered reading contrast >=4.5 and send icon >=3`, palette.reading);
    check(!palette.overflow && palette.buttons.every(button => button.width >= 44 && button.height >= 44), `${theme.id} ${mode} ${width}px keeps clear layout and full touch targets`, palette.buttons);
    check(palette.inputWidth >= 120 && palette.composer.every((box, index) => index === 0 || box.left - palette.composer[index - 1].right >= 4),
      `${theme.id} ${mode} ${width}px preserves readable input width without overlapping controls`, {inputWidth:palette.inputWidth,composer:palette.composer});
    check(palette.glow.width <= Math.min(72, palette.glow.roomWidth * .18) && palette.glow.pointerEvents === 'none' && palette.threadBackground === 'none',
      `${theme.id} ${mode} ${width}px glow stays at the edge and clears the old thread texture`, palette.glow);
    if (width === 390 || (theme.id === 'cool' && width !== 390)) await screenshot(`${theme.id}-${mode}-${width}`);
  }

  await page.setViewportSize({ width: 390, height: 844 }); await api('theme', 'dark');
  await appearance('cool'); await chat('switchTo', 'b'); await page.waitForTimeout(80);
  check(await roomTheme() === 'calm', 'another role retains its own default after the first role receives an override');
  await chat('switchTo', 'a'); await page.waitForTimeout(80);
  check(await roomTheme() === 'cool' && await page.locator('.vg-chat-atmosphere-edge').count() === 1, 'return to a role restores its override without an old background layer');
  await api('account', 'another-atmosphere-account'); await page.waitForTimeout(80);
  check(await roomTheme() === 'warm', 'same role ID in a different account cannot inherit the previous account override');
  await api('set', { mode:'manual',theme:'mysterious',motion:'vivid' }, 'a', owner);
  check((await api('preference', 'a', owner)).theme === 'cool', 'an inactive account cannot mutate an appearance preference');
  await api('reset', 'a', owner);
  check((await api('preference', 'a', owner)).theme === 'cool', 'an inactive account cannot reset another account preference');
  await appearance('lively'); await api('account', owner); await page.waitForTimeout(80);
  check(await roomTheme() === 'cool', 'switching back restores the original account independently');
  const beforeInvalid = JSON.stringify(await api('records'));
  for (const invalid of [{ mode:'manual',theme:'unknown',motion:'gentle' },{ mode:'image',theme:'warm',motion:'gentle' },{ mode:'manual',theme:'warm',motion:'particles' }]) await api('set', invalid);
  check(JSON.stringify(await api('records')) === beforeInvalid, 'invalid preference mode, palette and motion are rejected');
  const persisted = await api('persistence'); await api('rehydrate', persisted.state); await page.waitForTimeout(60);
  check(await roomTheme() === 'cool' && (await api('records'))[JSON.stringify(['another-atmosphere-account','a'])].theme === 'lively', 'rehydration retains valid per-account preferences');
  await api('rehydrate', { byRole: { ...persisted.state.byRole, malformed: {mode:'manual',theme:'cool',motion:'gentle'}, [JSON.stringify([owner,'bad'])]: { mode:'manual',theme:'bad',motion:'gentle' }, [JSON.stringify(['', 'a'])]: {mode:'manual',theme:'cool',motion:'gentle'} } });
  const clean = await api('records');
  check(!clean.malformed && !clean[JSON.stringify([owner,'bad'])] && !clean[JSON.stringify(['','a'])] && clean[JSON.stringify([owner,'a'])].theme === 'cool', 'rehydration filters malformed records while preserving valid preferences');
  await api('reset'); await page.waitForTimeout(80);
  check(await roomTheme() === 'warm' && (await api('preference')).motion === 'gentle' && (await api('preference')).mode === 'character', 'reset restores personality color and gentle motion');

  await ready(); await appearance('cool'); await page.waitForTimeout(220);
  check((await edge()).name === 'vg-chat-edge' && (await edge()).playState === 'running' && parseFloat((await edge()).duration) >= 12,
    'idle companionship breathes slowly with no positional or filter animation');
  check((await edge()).transform === 'none' && (await edge()).filter === 'none', 'edge animation uses no moving surface or blur filter');
  await page.locator('.chat-thread').evaluate(node => node.dispatchEvent(new Event('scroll')));
  check((await edge()).playState === 'paused' && await page.locator('.chat-room').evaluate(node => node.hasAttribute('data-chat-resting')), 'scroll pauses only the decorative layer');
  await page.waitForTimeout(230);
  check((await edge()).playState === 'running', 'edge resumes after scrolling settles');
  await page.getByRole('textbox', { name:'消息内容',exact:true }).focus();
  check((await edge()).playState === 'paused', 'focused composition pauses even without a changed viewport ratio');
  await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(50);
  check((await edge()).playState === 'running', 'leaving composition restores quiet companionship');
  await page.getByRole('textbox', { name:'消息内容',exact:true }).focus(); await chat('switchTo','b'); await page.waitForTimeout(80);
  check((await edge()).playState === 'paused', 'conversation switch cannot restart the background behind a still-focused input');
  await page.evaluate(() => document.activeElement.blur()); await chat('switchTo','a'); await page.waitForTimeout(80);
  await page.evaluate(() => { document.getElementById('app').hidden = true; document.getElementById('app').inert = true; });
  check((await edge()).playState === 'paused', 'retained hidden and inert conversation pauses its background');
  await page.evaluate(() => { document.getElementById('app').hidden = false; document.getElementById('app').inert = false; document.documentElement.setAttribute('data-vg-background',''); });
  check((await edge()).playState === 'paused', 'app background flag pauses the atmosphere');
  await page.evaluate(() => document.documentElement.removeAttribute('data-vg-background'));
  for (const reduced of ['system','app']) {
    if (reduced === 'system') await page.emulateMedia({reducedMotion:'reduce'}); else await api('reduced', true);
    check((await edge()).name === 'none' && (await edge()).transition === '0s', `${reduced} reduced motion gives an equivalent static atmosphere`);
    await page.emulateMedia({reducedMotion:'no-preference'}); await api('reduced', false);
  }
  await appearance('cool','off');
  check((await edge()).name === 'none', 'explicit off retains a static glow');
  await appearance('cool','vivid');
  check((await edge()).name === 'vg-chat-edge' && (await edge()).transform === 'none', 'vivid changes restrained edge life without moving the text column');
  await appearance('cool','gentle');
  await page.getByRole('button', {name:'聊天设置',exact:true}).click();
  await page.getByRole('dialog', {name:'聊天设置',exact:true}).waitFor();
  check((await edge()).playState === 'paused', 'an open settings portal pauses the underlying atmosphere');
  await page.getByText('聊天外观', {exact:true}).click();
  await page.getByLabel('聊天主题预览').waitFor();
  check(await page.getByLabel('聊天主题预览').getAttribute('data-chat-atmosphere') === 'cool', 'portal preview explicitly receives the current role palette');
  await screenshot('settings-cool-dark-390');
  await page.getByRole('radiogroup', {name:'聊天配色方式',exact:true}).getByRole('radio', {name:/跟随角色/}).check();
  check(await roomTheme() === 'warm', 'real follow-character choice immediately restores the authored personality');
  await page.getByRole('radiogroup', {name:'聊天配色方式',exact:true}).getByRole('radio', {name:/手动配色/}).check();
  const themeCards = await page.getByRole('group', {name:'角色氛围配色',exact:true}).getByRole('button').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(); return {width:box.width,height:box.height,label:node.getAttribute('aria-label')};
  }));
  check(themeCards.length === 7 && themeCards.every(card => card.width >= 44 && card.height >= 44), 'all seven actual theme choices retain full touch areas inside settings', themeCards);
  for (const mode of ['dark','light']) {
    await page.setViewportSize({width:320,height:844}); await api('theme',mode); await page.waitForTimeout(80);
    const smallMenu = await page.getByRole('dialog',{name:'聊天设置',exact:true}).evaluate(node => ({overflow:node.scrollWidth>node.clientWidth+1,
      cards:[...node.querySelectorAll('[aria-label="角色氛围配色"] button')].map(button=>{const box=button.getBoundingClientRect();return{width:box.width,height:box.height};})}));
    check(!smallMenu.overflow && smallMenu.cards.length===7 && smallMenu.cards.every(card=>card.width>=44&&card.height>=44), `${mode} 320px actual settings menu keeps all theme choices reachable`, smallMenu);
    await screenshot(`settings-cool-${mode}-320`);
  }
  await page.setViewportSize({width:390,height:844});await api('theme','dark');
  await page.getByRole('button', {name:'聊天配色：稳重可靠',exact:true}).click();
  check(await roomTheme() === 'steady' && await page.getByLabel('聊天主题预览').getAttribute('data-chat-atmosphere') === 'steady', 'real settings selection updates room and preview together');
  await page.getByRole('button', {name:/恢复角色默认/}).click();
  check(await roomTheme() === 'warm', 'real reset control restores the role default');
  await page.keyboard.press('Escape'); await page.getByRole('dialog', {name:'聊天设置',exact:true}).waitFor({state:'hidden'});
  await appearance('cool'); await page.waitForTimeout(80);
  await page.getByRole('button', {name:'聊天设置',exact:true}).click();
  await page.getByRole('button', {name:'与星遥语音通话',exact:true}).click();
  const voice = page.getByRole('dialog', {name:'星遥 · 语音通话',exact:true}); await voice.waitFor();
  const voicePalette = await voice.evaluate(node => ({ body:getComputedStyle(node.querySelector('.vg-voice-call')).backgroundColor, panel:getComputedStyle(node).getPropertyValue('--chat-bg').trim(), footer:node.querySelector('.vg-voice-call-footer') ? getComputedStyle(node.querySelector('.vg-voice-call-footer')).backgroundColor : null }));
  // Ready setup has no fixed call footer; the panel's variables cover it when mounted.
  check(voicePalette.body === 'rgb(20, 19, 33)' && voicePalette.panel === '#141321', 'voice setup inherits the same role palette through the portal', voicePalette);
  await voice.getByRole('button', {name:'返回',exact:true}).click(); await voice.waitFor({state:'hidden'});

  await ready(80, false); await appearance('cool'); await page.waitForTimeout(350);
  const renderProbe = await page.evaluate(async () => {
    const thread = document.querySelector('.chat-thread'); thread.dispatchEvent(new WheelEvent('wheel', {deltaY:-80})); thread.scrollTop -= 80;
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const rows = [...thread.querySelectorAll('[data-message-id]')], id = rows[Math.floor(rows.length / 2)].dataset.messageId;
    const initial = window.bubbleRenders[id], from = thread.scrollTop;
    for (let i = 0; i < 25; i++) { thread.scrollTop = from + 18 * Math.sin(i/6); await new Promise(requestAnimationFrame); }
    return {id,renders:window.bubbleRenders[id]-initial,retained:!!thread.querySelector(`[data-message-id="${id}"]`)};
  });
  check(renderProbe.retained && renderProbe.renders === 0, 'scrolling the atmosphere adds zero unchanged historical bubble renders', renderProbe);

  await ready(0); await appearance('cool'); await chat('submit','今天的风很轻。');
  await page.waitForFunction(() => window.chatStreamTest.requests().length === 1);
  await page.getByRole('status', {name:'正在回应',exact:true}).waitFor();
  check(await page.locator('[data-streaming-reply],.vg-typing-row,.vg-reply-waiting-dots').count() === 0 && await page.locator('.chat-room').getAttribute('data-chat-phase') === 'waiting', 'waiting glow never creates an empty message');
  check((await edge()).name === 'none' && (await edge()).opacity >= .25, 'waiting orb remains the focus while edge glow stays stationary');
  await chat('push',0,'慢慢聊，我'); await page.locator('[data-streaming-reply]').waitFor(); await page.waitForTimeout(270);
  check(await page.locator('.chat-room').getAttribute('data-chat-phase') === 'streaming' && (await edge()).name === 'none' && (await edge()).opacity <= .15,
    'first body hands attention to the text and dims the static edge');
  await page.evaluate(() => { window.atmosphereBubble = document.querySelector('[data-streaming-reply] .vg-message-bubble'); window.atmosphereEntrances = 0;
    document.addEventListener('animationstart', event => { if (event.target.closest?.('[data-streaming-reply]')) window.atmosphereEntrances++; }, true); });
  await chat('push',0,'在听。'); await page.waitForTimeout(90);
  check(await page.evaluate(() => window.atmosphereBubble === document.querySelector('[data-streaming-reply] .vg-message-bubble') && window.atmosphereEntrances === 0), 'continuation preserves the bubble node without replaying its entrance');
  await chat('finish',0); await page.getByRole('button', {name:'停止生成',exact:true}).waitFor({state:'hidden'}); await page.waitForTimeout(250);
  check(await page.locator('.chat-room').getAttribute('data-chat-phase') === 'idle' && (await edge()).name === 'vg-chat-edge', 'reply completion restores gentle companionship once');
  await screenshot('stream-complete-cool-dark-390');
  const oldRoom = await page.locator('.chat-room').elementHandle(); await chat('unmount');
  check(await oldRoom.evaluate(node => !node.isConnected && !node.hasAttribute('data-chat-resting')), 'unmount removes the paused marker and disconnects the atmosphere');
  check(await chat('extraNetwork') === 0 && evidence.errors.length === 0, 'scenarios trigger no extra network, paid model, speech or uncaught errors', evidence.errors);
  evidence.status = 'pass'; evidence.checkCount = evidence.checks.length;
  console.log(`PASS chat-atmosphere-ui: ${evidence.checkCount} checks`);
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error.message;
  console.error(error); process.exitCode = 1;
} finally {
  evidence.css = cssFiles.map(file => ({file,sha256:createHash('sha256').update(readFileSync(join(assets,file))).digest('hex')}));
  evidence.sources = ['scripts/verify/chat-atmosphere-ui.tsx','scripts/verify/chat-atmosphere-ui.mjs','src/lib/chat-atmosphere.ts','src/styles/chat-atmosphere.css','src/store/chat-appearance-store.ts','src/components/chat/useChatAtmosphere.ts','src/components/chat/ChatAppearanceSettings.tsx','src/components/chat/ChatWindow.tsx','src/components/chat/VoiceCallDialog.tsx'].map(file => ({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));
  writeFileSync(`${out}/result.json`, JSON.stringify(evidence, null, 2));
  await browser.close(); server.close();
}
