const { createRequire } = require('node:module');
const path = require('node:path'), fs = require('node:fs'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const server = http.createServer((req, res) => {
  const file = path.join(__dirname, path.basename((req.url || '/assistant-hub.html').split('?')[0]));
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html; charset=utf-8'); res.end(data); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let ui = 0; const pass = label => { ui++; console.log('PASS ' + label); };
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/assistant-hub.html?virtugene-preview=mobile`);
    await page.waitForFunction(() => window.hubTest);
    const data = await page.evaluate(() => window.hubTest.dataChecks()); console.log('DATA ' + data.checks);
    await page.evaluate(() => window.hubTest.mount());
    await page.getByRole('heading', { name: '用户起的名字', exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: '助理页面' }).getByRole('button').count(), 3);
    assert.equal(await page.getByRole('heading', { name: '行动舱', exact: true }).count(), 0); pass('workspace title is the user name and contains only three tabs');
    assert.equal(await page.evaluate(() => window.hubTest.calls()), 0); pass('opening today never starts a model request');
    assert.equal(await page.locator('#assistant-today .vg-cabin-focus').getByText('还没排期的想法', { exact: true }).count(), 0); pass('unplanned idea is absent from today priorities');
    const tabs = page.getByRole('navigation', { name: '助理页面' });
    assert.ok(await page.locator('#assistant-today .vg-cabin-stats strong .vg-animated-value').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 32)); pass('real statistics retain display-size digits inside AnimatedValue');
    assert.equal(await page.locator('#assistant-today .vg-cabin-focus [data-energy="today"]').first().evaluate(el => getComputedStyle(el, '::before').width), '3px'); pass('today priority has its three-pixel theme energy bar');
    await page.evaluate(() => { const el = document.querySelector('#assistant-today .vg-cabin'); el.scrollTop = 140; el.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.querySelector('.vg-assistant-header').dataset.compact === 'true');
    assert.ok(await page.locator('.vg-assistant-header .vg-soul-orb-button').isVisible()); pass('scrolling creates compact chrome while the orb remains visible');
    await page.evaluate(() => { const el = document.querySelector('#assistant-today .vg-cabin'); el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.querySelector('.vg-assistant-header').dataset.compact === 'false');
    await page.emulateMedia({reducedMotion:'no-preference'});await page.bringToFront();
    await page.getByRole('button', { name: '完成：每日提交方案', exact: true }).first().click();
    await page.getByRole('button', { name: '撤销完成', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.vg-assistant-header .vg-soul-orb').dataset.orbEmotion === 'success');
    assert.equal(await page.locator('.vg-completion-echo').evaluate(el => getComputedStyle(el).pointerEvents), 'none'); pass('saved completion drives success face and a non-blocking check echo');
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>document.querySelector('.vg-assistant-header .vg-soul-orb')?.dataset.orbAttention==='host',{},{timeout:1000});
    pass('a committed task completion supplies a bounded visual attention target');
    await page.waitForFunction(()=>document.querySelector('.vg-assistant-header .vg-soul-orb')?.dataset.orbAttention!=='host',{},{timeout:1800});
    pass('task attention expires without needing another scroll or pointer event');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('button', { name: '撤销完成', exact: true }).click();
    await page.getByRole('button', { name: '完成：每日提交方案', exact: true }).first().waitFor();
    await tabs.getByRole('button', { name: '对话', exact: true }).click();
    const input = page.locator('#assistant-chat textarea'); await input.waitFor();
    await input.fill('保留这段未发送的文字');
    await tabs.getByRole('button', { name: '今日', exact: true }).click();
    await tabs.getByRole('button', { name: /待处理/ }).click();
    await page.locator('#assistant-pending').getByText('还没排期的想法', { exact: true }).waitFor();
    await tabs.getByRole('button', { name: '对话', exact: true }).click();
    assert.equal(await input.inputValue(), '保留这段未发送的文字'); pass('draft survives today and pending tab switches');
    await tabs.getByRole('button', { name: '今日', exact: true }).click();
    await page.locator('#assistant-today .vg-cabin-task').first().getByRole('button', { name: '和助理聊这件事' }).click();
    await page.getByText('正在讨论：每日提交方案', { exact: true }).waitFor(); pass('task opens existing conversation with a selected occurrence');
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.vg-assistant-header .vg-soul-orb').getAttribute('data-orb-emotion'), 'thinking'); pass('discussing the selected task uses the thinking face');
    await page.evaluate(() => window.hubTest.setPlan([{ kind: 'todo.reschedule', date: window.hubTest.tomorrow, time: '15:00' }]));
    await input.fill('把这件事改到明天下午三点'); await input.press('Enter');
    await page.getByText('已修改', { exact: true }).waitFor();
    assert.ok(await page.evaluate(async () => (await window.hubTest.db.secretaryTasks.toArray()).some(t => t.results.some(r => r.detail?.includes('已改到') && r.detail?.includes('仅本次')))));
    await page.waitForFunction(() => !document.querySelector('.vg-assistant-context')?.textContent.includes('已变化'));
    pass('contextual reschedule returns actual receipt and refreshes selected version');
    await page.getByRole('button', { name: '去查看', exact: true }).click();
    await page.locator('#assistant-today:not([hidden])').waitFor();
    assert.equal(await page.getByRole('heading', { name: '用户起的名字', exact: true }).count(), 1); pass('receipt locates the actual occurrence inside the same named workspace');
    assert.equal(await page.locator('#assistant-today .vg-cabin-stats strong').first().innerText(), '0'); pass('conversation and today share the same actual statistics');
    await tabs.getByRole('button', { name: '对话', exact: true }).click();
    await page.getByRole('button', { name: '结束讨论这件事' }).click();
    await page.evaluate(() => { window.hubTest.setPlan([]); window.hubTest.hold(); });
    await input.fill('和我聊聊'); await input.press('Enter');
    await page.getByText('正在为你处理', { exact: true }).waitFor();
    await page.waitForFunction(() => window.hubTest.calls() >= 2);
    const before = await page.evaluate(() => window.hubTest.calls());
    await tabs.getByRole('button', { name: '今日', exact: true }).click();
    await tabs.getByRole('button', { name: /待处理/ }).click();
    await page.evaluate(() => window.hubTest.release());
    await tabs.getByRole('button', { name: '对话', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.vg-assistant-header')?.textContent.includes('正在为你处理'));
    assert.equal(await page.evaluate(() => window.hubTest.calls()), before); pass('request continues across tab switches without replay');
    await page.evaluate(async () => { const c = window.hubTest.useChatStore.getState().selectedCharacterId; await window.hubTest.db.characters.update(c, { name: '我亲自取的新名字' }); });
    await page.getByRole('heading', { name: '我亲自取的新名字', exact: true }).waitFor(); pass('renaming immediately updates workspace identity');
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const name of ['今日', '对话', '待处理']) {
        await tabs.getByRole('button', { name: name === '待处理' ? /待处理/ : name, exact: name !== '待处理' }).click();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      pass(`all tabs fit ${width}px`);
    }
    await tabs.getByRole('button', { name: '今日', exact: true }).click();
    await page.screenshot({ path: '.tmp-preview/assistant-hub-dark.png' });
    const longName = '星河深处陪我一起生活的小助理';
    const oldName = await page.evaluate(async name => {
      const c = window.hubTest.useChatStore.getState().characters.find(c => c.agentProfile === 'secretary');
      const previous = await window.hubTest.db.characters.get(c.id);
      await window.hubTest.db.characters.update(c.id, { name });
      window.hubTest.useChatStore.setState({ characters: window.hubTest.useChatStore.getState().characters.map(row => row.id === c.id ? { ...row, name } : row) });
      return previous.name;
    }, longName);
    await page.getByRole('heading', { name: longName, exact: true }).waitFor();
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => {
        const header = document.querySelector('.vg-assistant-header');
        const title = header.querySelector('h1');
        const controls = [...header.querySelectorAll(':scope > button')].map(el => el.getBoundingClientRect());
        const r = title.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth && r.width > 50 && getComputedStyle(title).textOverflow === 'ellipsis'
          && controls.every(b => b.width >= 44 && b.height >= 44 && b.left >= 0 && b.right <= innerWidth)
          && controls.every(b => b.right <= r.left || b.left >= r.right);
      })); pass(`long user name truncates without shrinking or overlapping controls at ${width}px`);
      await page.screenshot({ path: `.tmp-preview/assistant-hub-long-name-${width}.png` });
    }
    await page.evaluate(async name => {
      const c = window.hubTest.useChatStore.getState().characters.find(c => c.agentProfile === 'secretary');
      await window.hubTest.db.characters.update(c.id, { name });
      window.hubTest.useChatStore.setState({ characters: window.hubTest.useChatStore.getState().characters.map(row => row.id === c.id ? { ...row, name } : row) });
    }, oldName);
    await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'));
    await page.screenshot({ path: '.tmp-preview/assistant-hub-light.png' });
    await page.getByRole('button', { name: '返回消息' }).click();
    await page.getByRole('button', { name: '查看今日', exact: true }).waitFor();
    assert.equal(await page.locator('.vg-secretary-workspace').count(), 1);
    assert.equal(await page.locator('.vg-cabin-launcher').count(), 0); pass('home has one named assistant card and no second cabin entry');
    await page.getByRole('button', { name: '查看今日', exact: true }).click();
    await page.getByRole('heading', { name: '我亲自取的新名字', exact: true }).waitFor();
    await tabs.getByRole('button', { name: '对话', exact: true }).click();
    await input.fill('不能泄露给其他账号');
    await page.evaluate(() => window.hubTest.auth('hub-other'));
    await page.getByRole('heading', { name: '聘用助理', exact: true }).waitFor();
    assert.equal(await page.getByText('每日提交方案', { exact: true }).count(), 0);
    assert.equal(await page.locator('textarea').count(), 0); pass('account change removes private conversation and task state');
    await page.evaluate(() => window.hubTest.noApi());
    await tabs.getByRole('button', { name: '今日', exact: true }).click();
    await page.getByRole('button', { name: '＋ 记一件事', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '记下一件事' });
    await editor.getByRole('textbox', { name: '事项名称' }).fill('没聘用也能记下事情');
    await editor.getByRole('button', { name: '保存行动', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(async () => (await window.hubTest.db.todos.toArray()).some(t => t.userId === 'hub-other' && t.title === '没聘用也能记下事情' && t.visibility === 'private'))); pass('manual private capture works without an assistant or API key');
    // Turn this isolated fixture into an inbox-only workspace. Capture itself
    // intentionally defaults to today and is verified above.
    await page.evaluate(async () => {
      const todo = await window.hubTest.db.todos.where('userId').equals('hub-other').first();
      await window.hubTest.db.todos.update(todo.id, { dueDate: undefined });
      await window.hubTest.db.todoOccurrences.where('todoId').equals(todo.id).modify({ dueDate: '9999-12-31' });
    });
    await page.getByText('今天暂无待做安排', { exact: true }).waitFor();
    assert.equal(await page.locator('.vg-cabin-focus .vg-cabin-task').count(), 0);
    assert.equal(await page.getByText('今天的行动都完成了', { exact: true }).count(), 0); pass('unplanned-only workspace has an honest empty today state');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(__dirname, '.last-result-assistant-hub.txt'), `${data.checks} data + ${ui} UI checks passed\n`);
    console.log(`PASSED ${data.checks} data + ${ui} UI`);
  } catch (e) { await page.screenshot({ path: '.tmp-preview/assistant-hub-failure.png' }); console.log(await page.locator('body').innerText()); throw e; }
  finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
