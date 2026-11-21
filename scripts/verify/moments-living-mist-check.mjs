import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.VG_MOMENTS_ORIGIN ?? 'http://127.0.0.1:5572';
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Synthetic preview only');
assert(['5571', '5572'].includes(new URL(origin).port), 'Dedicated isolated port only');
const out = resolve('.tmp-preview/moments-living-mist-20261025/checks');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const context = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark', recordVideo: { dir: out, size: { width: 360, height: 780 } } });
const page = await context.newPage();
const errors = [], results = [];
page.on('pageerror', error => errors.push(String(error)));
const check = async (name, fn) => { try { await fn(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: String(error) }); } };
const shot = async name => {
  // DOM-ready is not proof that lazy images or font glyphs reached the frame.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter(image => { const b = image.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; }).map(image => image.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  return page.screenshot({ path: resolve(out, name + '.png') });
};
const first = () => page.locator('#moment-mist-post-0');
try {
  await page.goto(origin + '/?virtugene-preview=mobile');
  await page.waitForFunction(() => window.mistReady || window.mistError);
  assert.equal(await page.evaluate(() => window.mistError), undefined);
  await page.waitForSelector('.vg-moment-card');
  await check('24 real DB posts rendered', async () => assert.equal(await page.locator('.vg-moment-card').count(), 24));
  await check('Default cover is continuous page background, no separate image or empty expansion', async () => {
    assert.equal(await page.locator('.vg-moments-cover img').count(), 0);
    const before = await page.locator('.vg-moments-cover').boundingBox();
    assert(await page.locator('.vg-moments-workplane').evaluate(element => {
      const pseudo = getComputedStyle(element, '::before');
      const cover = document.querySelector('.vg-moments-cover').getBoundingClientRect();
      return getComputedStyle(element).backdropFilter === 'none' && !pseudo.backdropFilter.includes('blur(') && parseFloat(pseudo.top) >= cover.height - 1;
    }), 'No text-free cover area is frosted');
    await page.getByRole('button', { name: '封面设置', exact: true }).click();
    const after = await page.locator('.vg-moments-cover').boundingBox();
    assert.equal(after.height, before.height);
    await page.getByRole('button', { name: '收起封面设置', exact: true }).click();
  });
  await check('Latest four comments, chronological, including older hidden reply target', async () => {
    const ids = await first().locator('[data-comment-id]').evaluateAll(nodes => nodes.map(n => n.dataset.commentId));
    assert.deepEqual(ids, [4, 5, 6, 7].map(i => 'mist-comment-' + i));
    assert.match(await first().locator('[data-comment-id="mist-comment-7"]').innerText(), /回复 林栀/);
  });
  await check('Profile avatar fully within identity strip; like avatars separated', async () => {
    const data = await page.evaluate(() => {
      const strip = document.querySelector('.vg-moments-profile-row').getBoundingClientRect();
      const avatar = document.querySelector('.vg-moments-profile-row>img').getBoundingClientRect();
      const likes = [...document.querySelectorAll('.vg-moment-like-avatars>*')].map(e => e.getBoundingClientRect().toJSON());
      return { strip: strip.toJSON(), avatar: avatar.toJSON(), likes };
    });
    assert(data.avatar.top >= data.strip.top && data.avatar.bottom <= data.strip.bottom);
    assert.equal(data.avatar.width, 52); assert.equal(data.likes.length, 6);
    for (let i = 1; i < data.likes.length; i++) assert(data.likes[i].left >= data.likes[i - 1].right + 5);
  });
  await shot('01-feed-360');
  await check('Only inner feed scrolls; header stays fixed', async () => {
    const before = await page.locator('.vg-moments-header').boundingBox();
    await page.locator('.vg-moments-feed').evaluate(el => { el.scrollTop = 300; el.dispatchEvent(new Event('scroll', { bubbles: true })); });
    const after = await page.locator('.vg-moments-header').boundingBox();
    assert.equal(before.y, after.y); assert.equal(await page.evaluate(() => scrollY), 0);
    await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.vg-moments-workplane'), '::before').top) === 0);
  });
  await check('Reading old comments retains that group after background refresh', async () => {
    const before = await first().locator('[data-comment-id]').evaluateAll(nodes => nodes.map(n => n.dataset.commentId));
    await page.evaluate(() => window.mistTest.comment('后来的一条评论'));
    await page.waitForFunction(async () => (await window.mistTest.snapshot()).comments.some(c => c.id === 'mist-later-comment'));
    await page.waitForTimeout(120);
    assert.deepEqual(await first().locator('[data-comment-id]').evaluateAll(nodes => nodes.map(n => n.dataset.commentId)), before);
  });
  await check('Single menu clamped to viewport; Back dismisses', async () => {
    await first().getByRole('button', { name: '赞或评论' }).click();
    assert.equal(await page.getByRole('menu').count(), 1);
    const box = await page.getByRole('menu').boundingBox();
    assert(box.x >= 11 && box.x + box.width <= 349 && box.y >= 11 && box.y + box.height <= 769);
    const back = await page.evaluate(() => { const event = new Event('vg:back-request', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    assert(back); assert.equal(await page.getByRole('menu').count(), 0);
    await first().getByRole('button', { name: '赞或评论' }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    assert.equal(await page.getByRole('menu').count(), 0);
  });
  await check('Comment draft survives keyboard dismissal; successful send visible and DB-backed', async () => {
    await first().getByRole('button', { name: '赞或评论' }).click();
    await page.getByRole('menuitem', { name: '评论', exact: true }).click();
    await page.getByRole('textbox', { name: '评论内容' }).fill('这是合成验收评论');
    await page.evaluate(() => window.dispatchEvent(new Event('vg:keyboard-dismissed')));
    assert.equal(await page.getByRole('textbox', { name: '评论内容' }).count(), 0);
    await first().getByRole('button', { name: '继续评论 · 草稿已保留' }).click();
    assert.equal(await page.getByRole('textbox', { name: '评论内容' }).inputValue(), '这是合成验收评论');
    await first().getByRole('button', { name: '发送', exact: true }).click();
    await first().getByText('这是合成验收评论', { exact: false }).waitFor();
    assert((await page.evaluate(() => window.mistTest.snapshot())).comments.some(c => c.content === '这是合成验收评论' && c.status === 'active'));
    await shot('02-comment-sent');
  });
  await check('Own comment context menu does not open post management behind dialog', async () => {
    await first().getByText('这是合成验收评论', { exact: false }).dispatchEvent('contextmenu');
    await page.getByRole('dialog', { name: '删除这条评论？' }).waitFor();
    assert.equal(await page.getByRole('menu').count(), 0);
    await page.keyboard.press('Escape');
  });
  await check('Composer: 9 images, header publish, failed write keeps draft/audience/images', async () => {
    await page.getByRole('button', { name: '发布动态', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '发布动态' });
    await dialog.getByRole('textbox', { name: '动态内容' }).fill('合成动态草稿');
    await dialog.getByRole('button', { name: '仅自己', exact: true }).click();
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 32; c.getContext('2d').fillRect(0, 0, 32, 32); return c.toDataURL('image/png').split(',')[1]; });
    await dialog.locator('input[type=file]').setInputFiles(Array.from({ length: 9 }, (_, i) => ({ name: i + '.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
    await page.waitForFunction(() => document.querySelectorAll('.vg-moment-preview-grid>div').length === 9);
    assert.equal(await dialog.getByRole('button', { name: '添加动态图片' }).count(), 0);
    assert.equal(await dialog.getByRole('button', { name: '发布', exact: true }).count(), 1);
    assert(await dialog.getByRole('button', { name: '发布', exact: true }).evaluate(button => {
      const range = document.createRange(); range.selectNodeContents(button);
      return button.getBoundingClientRect().width >= 80 && range.getClientRects().length === 1;
    }), 'Publish text stays on one line in a real 80px action');
    await page.evaluate(() => window.mistTest.failPublish(true));
    await dialog.getByRole('button', { name: '发布', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('textbox').inputValue(), '合成动态草稿');
    assert.equal(await dialog.locator('.vg-moment-preview-grid>div').count(), 9);
    assert.match(await dialog.getByRole('button', { name: '仅自己', exact: true }).getAttribute('class'), /is-selected/);
    await shot('03-compose-failure');
    await dialog.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('dialog', { name: '放弃这次编辑？' }).getByRole('button', { name: '继续编辑' }).click();
    assert.equal(await dialog.getByRole('textbox').inputValue(), '合成动态草稿');
    await page.evaluate(() => window.mistTest.failPublish(false));
    await dialog.getByRole('button', { name: '发布', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.vg-moment-card').count(), 25);
    const state = await page.evaluate(() => window.mistTest.snapshot());
    assert.equal(state.moments, 25);
    assert.equal(await page.locator('.vg-moments-feed').evaluate(el => el.scrollTop), 0);
  });
  for (const width of [320, 360, 430]) {
    await check(width + 'px layout and 200% font have no horizontal overflow', async () => {
      await page.setViewportSize({ width, height: 780 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '30px'; window.mistTest.longName(); });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.vg-moments-feed').scrollWidth <= document.querySelector('.vg-moments-feed').clientWidth + 1));
      const name = await page.locator('.vg-moments-profile-row>div').boundingBox();
      assert(name.x + name.width <= width - 12);
      await shot('04-width-' + width + '-large-font');
    });
  }
  await page.setViewportSize({ width: 360, height: 780 });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await check('Settings retain all four groups and disclosure, scroll without clipping', async () => {
    await page.getByRole('button', { name: '朋友圈设置' }).click();
    const dialog = page.getByRole('dialog', { name: '朋友圈设置' });
    for (const title of ['消息与提醒', '好友分享', '可见与屏蔽', '展示']) assert(await dialog.getByText(title, { exact: true }).count());
    assert.match(await dialog.innerText(), /会调用模型生成好友动态/);
    await shot('05-settings');
    await dialog.getByRole('button', { name: '返回', exact: true }).click();
  });
  await check('Custom portrait, landscape, compact cover and expansion preserved', async () => {
    for (const orientation of ['portrait', 'landscape']) {
      await page.evaluate(o => window.mistTest.cover(o, 'compact'), orientation);
      await page.locator('.vg-moments-cover-image').waitFor();
      assert.match(await page.locator('.vg-moments-cover-image').getAttribute('src'), /合成封面|%E5%90%88/);
      await page.getByRole('button', { name: '展开朋友圈封面' }).click();
      await page.waitForTimeout(280);
      const b = await page.locator('.vg-moments-cover').boundingBox();
      assert(Math.abs(b.width / b.height - 4 / 3) < .01);
    }
  });
  await check('Reduced motion stops ambient animation', async () => {
    await page.evaluate(() => { document.documentElement.dataset.vgReducedMotion = 'true'; });
    assert.equal(await page.locator('.vg-moments-backdrop').evaluate(e => getComputedStyle(e, '::after').animationName), 'none');
  });
  await check('Owner switch clears previous post/comment/draft UI', async () => {
    await page.evaluate(() => window.mistTest.switchOwner());
    await page.getByText('还没有动态', { exact: true }).waitFor();
    assert.equal(await page.locator('.vg-moment-card').count(), 0);
  });
  await check('Read failure is actionable, distinct from empty; loading uses stable rows', async () => {
    await page.evaluate(() => window.mistTest.failRead(true));
    await page.getByRole('button', { name: '重新读取动态' }).waitFor();
    assert.equal(await page.getByText('还没有动态', { exact: true }).count(), 0);
    await shot('06-error');
    await page.evaluate(() => window.mistTest.loading());
    await page.getByRole('status', { name: '正在读取动态' }).waitFor();
    await shot('07-loading');
  });
  await check('No runtime errors, model requests, microphone, media or native calls', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.auditSilence), { network: 0, microphone: 0, audio: 0, native: 0 });
  });
} finally {
  await context.close(); await browser.close();
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ at: new Date().toISOString(), origin, scope: 'Desktop Edge mobile viewport, synthetic DB, no Android or real model claim', results, errors }, null, 2));
}
console.log(JSON.stringify({ pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass), out }, null, 2));
if (results.some(r => !r.pass)) process.exitCode = 1;
