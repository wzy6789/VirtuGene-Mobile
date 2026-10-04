// Real Vite application, isolated browser storage, no external service calls.
const { createRequire } = require('module');
const path = require('path'), fs = require('fs'), assert = require('assert/strict');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
(async () => {
  const base = process.env.VG_APP_URL || 'http://127.0.0.1:5173';
  const origin = new URL(base).origin;
  const output = path.resolve('.tmp-preview/api-onboarding-20261002'); fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  page.setDefaultTimeout(60_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let checks = 0, external = 0;
  const check = (value, label) => { assert.ok(value, label); checks++; };
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    if (url.origin === 'https://api.deepseek.com' && url.pathname === '/v1/models') return route.fulfill({ status: 200, json: { data: [] } });
    if (url.origin === 'https://api.deepseek.com' && url.pathname === '/v1/chat/completions') {
      const body = route.request().postDataJSON();
      check(body.model === 'deepseek-flash' && body.thinking?.type === 'disabled' && body.max_tokens === 16, 'account connection actually validates Flash with a short direct response');
      return route.fulfill({ status: 200, json: { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] } });
    }
    if (url.origin === origin) return route.continue();
    external++; return route.abort();
  });
  await page.addInitScript(() => localStorage.setItem('virtugene:lastSeenVersion', '5.3.0'));
  const auth = () => page.evaluate(async () => {
    const state = JSON.parse(localStorage.getItem('virtugene-auth') || '{}').state || {};
    const { db } = await import('/src/db/index.ts');
    const user = state.userId ? await db.users.get(state.userId) : null;
    let key = null;
    if (user?.apiKeyIv && user.apiKeyCiphertext) {
      const { decryptApiKey } = await import('/src/lib/crypto.ts');
      key = await decryptApiKey(user.apiKeyIv, user.apiKeyCiphertext, 'fixture-password-5301', Uint8Array.from(atob(user.passwordSalt), c => c.charCodeAt(0)));
    }
    return { id: state.userId, logged: state.isLoggedIn, key };
  });
  const waitLogged = async () => {
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('virtugene-auth') || '{}').state?.isLoggedIn === true);
    await page.locator('.mobile-bottom-nav').waitFor({ state: 'attached' });
  };
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('button', { name: '注册你的基因', exact: true }).click();
    await page.getByPlaceholder('用户名', { exact: true }).fill('接入验证账号');
    await page.getByPlaceholder('密码（至少 6 位）').fill('fixture-password-5301');
    await page.getByPlaceholder('确认密码', { exact: true }).fill('fixture-password-5301');
    await page.getByRole('checkbox').check();
    check(await page.getByPlaceholder('DeepSeek API Key（可稍后配置）').inputValue() === '', 'registration exposes an optional DeepSeek key');
    await page.setViewportSize({ width: 320, height: 568 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'registration fits a narrow screen');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await waitLogged();
    let state = await auth();
    check(state.logged && !state.key, `a real local account can register without a DeepSeek key (logged=${state.logged}, keyPresent=${Boolean(state.key)})`);
    await page.evaluate(id => {
      localStorage.setItem('virtugene:onboarded:' + id, '1');
      localStorage.setItem('virtugene:secretary-intro:v2:' + id, '1');
    }, state.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload(); await waitLogged();
    await page.locator('.mobile-bottom-nav').getByRole('button', { name: '我的', exact: true }).click();
    await page.getByRole('button', { name: /^AI 连接/ }).click();
    check(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backgroundColor === 'rgb(17, 23, 41)'), 'real application opens dark connection settings');
    await page.getByRole('button', { name: /服务商密钥/ }).click();
    await page.getByRole('button', { name: '配置 自定义 · OpenAI 兼容', exact: true }).click();
    await page.getByLabel('添加模型 ID', { exact: true }).fill('local-check-model');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByText('配置已保存，可通过测试确认连接。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    await page.getByRole('button', { name: /默认对话模型/ }).click();
    await page.getByRole('searchbox', { name: '搜索模型' }).fill('local-check-model');
    await page.getByRole('radio', { name: /local-check-model/ }).check();
    check(await page.getByRole('radio', { name: /local-check-model/ }).isChecked(), 'keyless local configuration is selected in the real application');
    await page.screenshot({ path: path.join(output, 'default-local-model-dark.png') });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.reload(); await waitLogged();
    state = await auth();
    check(!state.key, 'relaunch retains the keyless account');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('virtugene-settings') || '{}').state?.defaultModel?.model === 'local-check-model'), 'model selection survives relaunch');
    await page.locator('.mobile-bottom-nav').getByRole('button', { name: '我的', exact: true }).click();
    await page.getByRole('button', { name: '断开灵魂链接', exact: true }).click();
    await page.getByRole('button', { name: '确认断开', exact: true }).click();
    await page.getByPlaceholder('用户名', { exact: true }).fill('接入验证账号');
    await page.getByPlaceholder('密码', { exact: true }).fill('fixture-password-5301');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await waitLogged();
    check(!(await auth()).key, 'password login works without requiring a DeepSeek key');
    await page.locator('.mobile-bottom-nav').getByRole('button', { name: '我的', exact: true }).click();
    await page.getByRole('button', { name: /^AI 连接/ }).click();
    await page.getByRole('button', { name: /账号绑定密钥/ }).click();
    await page.getByRole('button', { name: '更换密钥', exact: true }).click();
    const fakeKey = 'sk-fixture-only-primary-key';
    await page.getByPlaceholder('输入新的 API Key (sk-...)').fill(fakeKey);
    await page.getByPlaceholder('输入登录密码以确认').fill('fixture-password-5301');
    await page.getByRole('button', { name: '确认更换', exact: true }).click();
    await page.getByPlaceholder('输入新的 API Key (sk-...)').waitFor({ state: 'hidden' });
    check((await auth()).key === fakeKey, 'optional primary credential replacement updates the encrypted account record');
    await page.reload(); await waitLogged();
    check(await page.evaluate(async () => (await import('/src/lib/api-key-storage.ts')).loadPersistedApiKey()) === fakeKey, 'replacement survives relaunch in encrypted device storage');
    check(external === 0, 'onboarding and configuration made no external service requests');
    check(errors.length === 0, errors.join('\n'));
    const report = `PASS ${checks} real application onboarding checks\n`;
    fs.writeFileSync(path.join(output, 'result.txt'), report); console.log(report);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
