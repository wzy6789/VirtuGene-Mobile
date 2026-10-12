import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const errors = []; let checks = 0, blockedExternal = 0;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const host = new URL(route.request().url()).hostname;
  if (host === '127.0.0.1' || host === 'localhost') return route.continue();
  blockedExternal++; return route.abort();
});
mkdirSync('.tmp-preview/voice-call', { recursive: true });
try {
  await page.addInitScript(() => {
    localStorage.setItem('virtugene:lastSeenVersion', '6.0.24');
    localStorage.setItem('virtugene:onboarded:call-app-user', '1');
  });
  await page.goto('http://127.0.0.1:5173/?virtugene-preview=mobile', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(async () => {
    const { db } = await import('/src/db/index.ts');
    const { useAuthStore } = await import('/src/store/auth-store.ts');
    const { useChatStore } = await import('/src/store/chat-store.ts');
    const { useUIStore } = await import('/src/store/ui-store.ts');
    const { useVoiceCallStore } = await import('/src/store/voice-call-store.ts');
    const { useVoiceCallUIStore } = await import('/src/store/voice-call-ui-store.ts');
    const userId = 'call-app-user', sessionId = 'call-app-session';
    const character = { id: 'call-app-role', name: '星澜', avatar: '🌙', createdBy: userId, createdAt: 1, isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '本地界面验收角色' };
    await db.users.put({ id: userId, username: '界面验收', passwordHash: 'not-a-real-account', createdAt: 1 });
    await db.characters.put(character);
    await db.sessions.put({ id: sessionId, characterId: character.id, userId, title: character.name, createdAt: 1, updatedAt: 1, unreadCount: 0 });
    useAuthStore.getState().login(userId, '界面验收', null, '🌙');
    await useChatStore.getState().loadCharacters();
    await useChatStore.getState().selectCharacter(character.id, sessionId);
    useUIStore.setState({ mobileTab: 'chat', activeView: 'chat', chatFromList: true });
    let ends = 0;
    // Actual App and ChatWindow; only the call's audio/model presentation is mocked.
    useVoiceCallStore.setState({ end: async () => { ends++; useVoiceCallStore.setState({ busy: false, saving: false, finishing: undefined, view: { ...useVoiceCallStore.getState().view, phase: 'ended' } }); } });
    window.appCallTest = { ends: () => ends,
      connected() { const actualSession = useVoiceCallUIStore.getState().target?.sessionId;
        if (!actualSession) throw new Error('Call preparation must own a session');
        useVoiceCallStore.setState({ owner: { userId, sessionId: actualSession, characterId: character.id }, busy: true, error: undefined,
        record: { id: 'app-call', userId, sessionId: actualSession, characterId: character.id, startedAt: Date.now() - 60000, endedAt: Date.now(), voice: '茉莉', status: 'active', exchanges: [], messageIds: [], summaryState: 'pending' },
        view: { phase: 'listening', userText: '', generatedText: '', heardText: '', level: 0, muted: false } }); },
      navigate(tab) { useUIStore.setState({ mobileTab: tab, activeView: 'chat', chatFromList: false, chatFromCharacters: false }); },
      chat() { useUIStore.setState({ mobileTab: 'chat', activeView: 'chat', chatFromList: true }); },
      summary() { useVoiceCallStore.setState({ busy: false, saving: true, finishing: 'summary', record: { ...useVoiceCallStore.getState().record, status: 'ended' }, view: { ...useVoiceCallStore.getState().view, phase: 'ended' } }); },
      callUI: useVoiceCallUIStore,
    };
  });
  await page.getByRole('button', { name: '与星澜语音通话', exact: true }).waitFor(); checks++;
  const modelSetup = page.getByRole('dialog', { name: /选择对话模型/ });
  await modelSetup.waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape'); await modelSetup.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /稍后再说/ }).click();
  await page.getByRole('dialog', { name: /聘用你的私人助理/ }).waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 320, height: 844 });
  assert.ok(await page.getByRole('button', { name: '与星澜语音通话', exact: true }).evaluate(node => { const box = node.getBoundingClientRect(); return box.height >= 48 && box.width >= 48 && node.textContent.includes('语音通话'); })); checks++;
  assert.ok(await page.locator('.chat-header').evaluate(node => node.scrollWidth <= node.clientWidth)); checks++;
  await page.screenshot({ path: '.tmp-preview/voice-call/app-call-entry-dark-320.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '与星澜语音通话', exact: true }).click();
  await page.getByRole('button', { name: '开始通话', exact: true }).waitFor(); checks++;
  await page.evaluate(() => window.appCallTest.connected());
  await page.getByRole('button', { name: '挂断', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^返回与星澜的语音通话/ }).waitFor();
  assert.ok(await page.getByRole('textbox', { name: '消息内容', exact: true }).isDisabled()); checks++;
  await page.evaluate(() => window.appCallTest.navigate('chat'));
  for (const [tab, label] of [['world', '世界'], ['characters', '角色'], ['me', '我的']]) {
    await page.locator('.mobile-bottom-nav').getByRole('button', { name: label, exact: true }).click();
    assert.equal(await page.locator('.mobile-bottom-nav').getByRole('button', { name: label, exact: true }).getAttribute('aria-current'), 'page'); checks++;
    await page.getByRole('button', { name: /^返回与星澜的语音通话/ }).waitFor();
    assert.equal(await page.evaluate(() => window.appCallTest.ends()), 0); checks++;
    await page.screenshot({ path: `.tmp-preview/voice-call/app-minimized-${tab}-390.png` });
  }
  await page.getByRole('button', { name: /^返回与星澜的语音通话/ }).click();
  await page.getByRole('button', { name: '挂断', exact: true }).waitFor(); checks++;
  for (let index = 0; index < 4; index++) {
    await page.getByRole('button', { name: '收起通话', exact: true }).click();
    await page.getByRole('button', { name: /^返回与星澜的语音通话/ }).click();
  }
  assert.equal(await page.evaluate(() => window.appCallTest.ends()), 0); checks++;
  await page.getByRole('button', { name: '挂断', exact: true }).click();
  assert.equal(await page.evaluate(() => window.appCallTest.ends()), 1); checks++;
  await page.evaluate(() => window.appCallTest.summary());
  await page.getByText('摘要：正在整理…', { exact: true }).waitFor();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.evaluate(() => window.appCallTest.chat());
  await page.getByRole('textbox', { name: '消息内容', exact: true }).waitFor();
  assert.ok(await page.getByRole('textbox', { name: '消息内容', exact: true }).isEnabled()); checks++;
  await page.screenshot({ path: '.tmp-preview/voice-call/app-after-call-dark-390.png' });
  assert.deepEqual(errors, []); checks++;
  const result = { checks, realApiCalls: 0, modelTokens: 0, blockedExternal, deviceTested: false, mode: 'real-vite-app-navigation-with-call-presentation-mock' };
  writeFileSync('.tmp-preview/voice-call/app-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: '.tmp-preview/voice-call/app-failure.png' });
  const state = await page.evaluate(async () => {
    const { useVoiceCallUIStore } = await import('/src/store/voice-call-ui-store.ts');
    const { useVoiceCallStore } = await import('/src/store/voice-call-store.ts');
    const { useAuthStore } = await import('/src/store/auth-store.ts');
    return { target: useVoiceCallUIStore.getState().target, owner: useVoiceCallStore.getState().owner, busy: useVoiceCallStore.getState().busy, phase: useVoiceCallStore.getState().view?.phase, userId: useAuthStore.getState().userId, dialogs: [...document.querySelectorAll('[role=dialog]')].map(node => node.textContent.slice(0, 500)) };
  }).catch(() => undefined);
  writeFileSync('.tmp-preview/voice-call/app-failure.json', JSON.stringify({ error: String(error), state }, null, 2));
  throw error;
}
finally { await browser.close(); }
