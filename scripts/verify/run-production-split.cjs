const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const root = path.resolve('dist/renderer');
const report = JSON.parse(fs.readFileSync('.tmp-preview/bundle-after.json', 'utf8'));
const appVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const chunk = suffix => {
  const found = report.chunks.find(c => c.modules.some(m => m.id.endsWith(suffix)));
  assert.ok(found, `Missing module ${suffix}`);
  return found.name;
};
const forbidden = ['components/world/MobileWorldPage.tsx', 'components/world/WorldCanvas.tsx', 'lib/world/world-turn.ts', 'lib/secretary/agent.ts', 'lib/secretary/character-messaging.ts', 'components/onboarding/SecretarySetupModal.tsx', 'components/chat/ChatWindow.tsx', 'components/settings/SettingsPanel.tsx', 'node_modules/pinyin-pro/dist/esm/data/dict1.mjs'];
for (const module of forbidden) assert.ok(!report.startup.includes(chunk(module)), `${module} is still a startup dependency`);
assert.ok(report.chunks.find(c => c.name === report.entry).bytes < 500000, 'Entry exceeds 500 KB budget');
assert.ok(report.startupBytes < 850000 && report.startupGzip < 280000, 'Static dependency graph exceeds budget');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
  const target = file === root || fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.woff2') ? 'font/woff2' : target.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    res.end(data);
  });
});
async function prepare(page) {
  await page.addInitScript(version => {
    const ready = localStorage.getItem('split-user-seeded') === '1';
    localStorage.setItem('virtugene-auth', JSON.stringify({ state: { userId: ready ? 'split-user' : null, username: '拆包验收', avatar: '🧬', apiKey: null, isLoggedIn: ready }, version: 0 }));
    localStorage.setItem('virtugene:onboarded:split-user', '1');
    localStorage.setItem('virtugene:secretary-intro:v2:split-user', '1');
    if (localStorage.getItem('split-check-upgrade') === '1') {
      localStorage.removeItem('split-check-upgrade');
      localStorage.setItem('virtugene:lastSeenVersion', '5.3.0');
    } else if (!localStorage.getItem('virtugene:lastSeenVersion')) {
      localStorage.setItem('virtugene:lastSeenVersion', version);
    }
  }, appVersion);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button', { name: '登录', exact: true }).waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('virtugene'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['users'], 'readwrite');
      tx.objectStore('users').put({ id: 'split-user', username: '拆包验收', createdAt: Date.now(), passwordHash: '', passwordSalt: '', adultConfirmedAt: Date.now() });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close(); localStorage.setItem('split-user-seeded', '1');
  });
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const base = `http://127.0.0.1:${server.address().port}/`;
  const mobile = { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36' };
  const errors = [], checks = [];
  const pass = message => { checks.push(message); console.log('PASS ' + message); };
  try {
    const context = await browser.newContext(mobile);
    const page = await context.newPage();
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.stack); });
    await prepare(page);
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    await network.send('Network.setCacheDisabled', { cacheDisabled: true });
    const requests = [];
    page.on('request', request => { if (request.url().endsWith('.js')) requests.push(new URL(request.url()).pathname.slice(1)); });
    await page.goto(base);
    await page.getByRole('button', { name: '查看今日', exact: true }).waitFor().catch(async error => {
      console.log(await page.locator('body').innerText());
      await page.screenshot({ path: '.tmp-preview/split-failure.png' });
      throw error;
    });
    await page.locator('.vg-splash').waitFor({ state: 'hidden' });
    for (const module of forbidden) assert.ok(!requests.includes(chunk(module)), `${module} downloaded on the home screen`);
    const homeRequests = [...new Set(requests)];
    const homeChunks = report.chunks.filter(c => homeRequests.includes(c.name));
    const home = { requests: homeRequests, bytes: homeChunks.reduce((n, c) => n + c.bytes, 0), gzip: homeChunks.reduce((n, c) => n + c.gzip, 0) };
    assert.ok(home.bytes < 1100000 && home.gzip < 470000, 'First home including dynamic seed exceeds budget');
    console.log('HOME_JS', JSON.stringify(home));
    pass('production home does not fetch world, assistant executor, settings, chat or pinyin dictionary');
    // Seed through the real app database after its schema migration has completed.
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('virtugene'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['characters'], 'readwrite');
        tx.objectStore('characters').put({ id: 'split-assistant', name: '小星', avatar: '🧬', tags: [], isPreset: false, isCustom: true, published: false, createdBy: 'split-user', createdAt: Date.now(), proactivity: 0, systemPrompt: '', agentProfile: 'secretary', secretaryStatus: 'active', secretaryPersonality: 'warm' });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
    await page.locator('.vg-splash').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '展开生活助理工作台' }).click();
    await page.getByRole('button', { name: '与助理小星对话' }).click();
    await page.getByRole('button', { name: '助理更多操作' }).waitFor();
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => /\/agent-.*\.js$/.test(r.name)));
    pass('assistant entry fetches chat and executor chunks and renders real controls');
    if (await page.getByRole('dialog', { name: '选择对话模型' }).count()) {
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: '助理更多操作' }).click();
    await page.getByRole('button', { name: '助理管理 · 解雇与聘用' }).click();
    await page.getByRole('textbox', { name: '助理名字' }).waitFor();
    pass('assistant management opens through its own lazy boundary');
    await page.keyboard.press('Escape');
    const assistantTabs = page.getByRole('navigation', { name: '助理页面' });
    await assistantTabs.getByRole('button', { name: '今日', exact: true }).click();
    await page.getByRole('heading', { name: '小星', exact: true }).waitFor();
    assert.equal(await assistantTabs.getByRole('button').count(), 3);
    assert.equal(await page.locator('.vg-nav-tab[aria-current="page"]').innerText(), '消息');
    await assistantTabs.getByRole('button', { name: /待处理/ }).click();
    await page.getByRole('group', { name: '待处理分类' }).waitFor();
    pass('named assistant unifies today, conversation and pending in a production split build');
    await page.getByRole('button', { name: '返回消息', exact: true }).click();
    await page.getByRole('button', { name: '查看今日', exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: '世界入口' }).count(), 0);
    await page.locator('.vg-nav-tab').filter({ hasText: '世界' }).click();
    await page.getByRole('navigation', { name: '世界入口' }).waitFor();
    assert.ok(requests.includes(chunk('components/world/MobileWorldPage.tsx')));
    pass('first world navigation fetches and mounts world separately');
    await page.locator('.vg-nav-tab').filter({ hasText: '我的' }).click();
    await page.getByRole('button', { name: '设置' }).waitFor();
    pass('settings parent tab loads on demand');
    await page.evaluate(() => localStorage.setItem('split-check-upgrade', '1'));
    await page.reload();
    const announcement = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '基因序列已更新' }) });
    await announcement.waitFor();
    assert.ok((await announcement.innerText()).includes(`v${appVersion}`));
    const releaseNotes = fs.readFileSync('src/lib/changelog.ts', 'utf8');
    const currentNotes = releaseNotes.match(/version: '[^']+', date: '[^']+', notes: \[\s*'([^']+)'/);
    assert.ok(currentNotes, 'Current release must include notes');
    assert.ok((await announcement.innerText()).includes(currentNotes[1]), 'Upgrade must show the current release notes');
    await announcement.getByRole('button', { name: '知道了', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('virtugene:lastSeenVersion')), appVersion);
    await page.reload();
    await page.getByRole('button', { name: '查看今日', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '基因序列已更新' }).count(), 0);
    pass('upgrade announces the actual release version and scope once, then preserves dismissal');
    assert.deepEqual(errors, []);
    await context.close();
    // A delayed page must not remove navigation or replace a newer destination when it finally arrives.
    const slow = await browser.newContext(mobile);
    const slowPage = await slow.newPage();
    await prepare(slowPage);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await slowPage.route('**/' + chunk('components/world/MobileWorldPage.tsx'), async route => { await gate; await route.continue(); });
    await slowPage.goto(base);
    await slowPage.locator('.vg-splash').waitFor({ state: 'hidden' });
    await slowPage.locator('.vg-nav-tab').filter({ hasText: '世界' }).click();
    await slowPage.getByRole('status').filter({ hasText: '正在打开你的空间' }).waitFor();
    await slowPage.locator('.vg-nav-tab').filter({ hasText: '消息' }).click();
    await slowPage.getByRole('button', { name: '查看今日', exact: true }).waitFor();
    release();
    await slowPage.waitForResponse(response => response.url().endsWith(chunk('components/world/MobileWorldPage.tsx')));
    assert.equal(await slowPage.getByRole('navigation', { name: '世界入口' }).count(), 0);
    pass('slow feature keeps navigation usable and late completion cannot hijack the current tab');
    await slow.close();
    const failure = await browser.newContext(mobile);
    const failedPage = await failure.newPage();
    await prepare(failedPage);
    let failures = 0;
    await failedPage.route('**/' + chunk('components/world/MobileWorldPage.tsx'), route => ++failures === 1 ? route.abort() : route.continue());
    await failedPage.goto(base);
    await failedPage.locator('.vg-splash').waitFor({ state: 'hidden' });
    await failedPage.locator('.vg-nav-tab').filter({ hasText: '世界' }).click();
    await failedPage.getByRole('button', { name: '重新加载应用', exact: true }).waitFor();
    await failedPage.getByRole('button', { name: '重新加载应用', exact: true }).click();
    await failedPage.getByRole('button', { name: '查看今日', exact: true }).waitFor();
    await failedPage.locator('.vg-nav-tab').filter({ hasText: '世界' }).click();
    await failedPage.getByRole('navigation', { name: '世界入口' }).waitFor({ timeout: 10000 });
    pass('failed module retains navigation and explicit reload repairs the browser module cache');
    await failure.close();
    fs.writeFileSync('.tmp-preview/production-split-results.json', JSON.stringify({ checks, startup: { bytes: report.startupBytes, gzip: report.startupGzip }, home, errors }, null, 2));
    console.log(`${checks.length} production checks passed`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
