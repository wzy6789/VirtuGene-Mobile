/**
 * 官网素材：从**当前手机端界面**重新截取产品截图（演示账号 + 演示内容）。
 *
 * 为什么需要它：website/assets/product/ 里的截图不能靠目录名判断新旧，
 * 也不能靠改名复用——旧目录里 12 张有 9 张名实不符（设置页被叫成创建世界等）。
 * 这个脚本直接驱动真实 App：Vite dev server + 带 CDP 的浏览器，
 * 截图落到 .tmp-site-shots/，再挑选、导出到 website/assets/product/。
 *
 * 用法：
 *   1) node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4186 --strictPort
 *   2) msedge --headless=new --remote-debugging-port=9236 --user-data-dir=<临时目录> about:blank
 *   3) node scripts/capture-site-shots.mjs
 *
 * 数据全部是本机 IndexedDB 里的演示数据，脚本每次运行会先清空数据库，可重复执行。
 */
/**
 * 官网素材：从**当前**手机端界面重新截图（5.1.0 工作树）
 *
 * 为什么不用 website/assets/product/latest：
 * 那批图是 09-12 用旧结构截的，而且文件名与实际页面不符
 * （03-memory 实际是年表、10-create-world 实际是设置页……）。
 * 这里直接驱动真实 App（Vite dev server + CDP），用演示账号与演示内容重新截。
 *
 * 演示数据全部是本机 IndexedDB 里的假数据，不含任何真实聊天 / 邮箱 / 密钥。
 */
import { writeFile, mkdir } from 'node:fs/promises';

const CDP_PORT = 9236;
const APP_URL = 'http://127.0.0.1:4186/';
const OUT = 'F:/VirtuGene-Mobile/.tmp-site-shots';

await mkdir(OUT, { recursive: true });

const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page' && t.url === 'about:blank') ?? targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const consoleErrors = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  }
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});

const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const run = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value;
};
const shot = async (name) => {
  const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(result.data, 'base64'));
  const text = await run('document.body.innerText.replace(/\\s+/g," ").slice(0,300)');
  console.log(`SHOT ${name} :: ${text}`);
};

await call('Page.enable');
await call('Runtime.enable');
await call('Network.enable');
// 只允许本机 dev server；任何外部模型请求一律拦掉，保证截图里不可能出现真实账号内容。
await call('Network.setBlockedURLs', { urls: ['https://*', 'http://api.*', 'wss://*'] });
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await call('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
});

await call('Page.navigate', { url: APP_URL });
await wait(4000);

// 关掉可能出现的引导 / 弹层
await run(`(()=>{const b=[...document.querySelectorAll('button')];const t=b.find(x=>/以后再说|跳过|知道了|开始使用/.test(x.innerText));if(t)t.click();return !!t})()`);
await wait(600);

const seedReport = await run(`(async () => {
  const { db } = await import('/src/db/index.ts');
  const { initSeedCharacters } = await import('/src/lib/seed-init.ts');
  const { LAST_SEEN_VERSION_KEY } = await import('/src/lib/changelog.ts');
  const { useAuthStore } = await import('/src/store/auth-store.ts');
  const { useChatStore } = await import('/src/store/chat-store.ts');
  const { useUIStore } = await import('/src/store/ui-store.ts');
  const { useThemeStore } = await import('/src/store/theme-store.ts');
  const { worldRepo } = await import('/src/db/world-repo.ts');
  const { worldSceneRepo } = await import('/src/db/world-scene-repo.ts');
  const { worldEventRepo } = await import('/src/db/world-event-repo.ts');
  const { sharedMemoryRepo } = await import('/src/db/shared-memory-repo.ts');
  const { diaryRepo } = await import('/src/db/diary-repo.ts');
  const { userRef, characterRef } = await import('/src/lib/world/subjects.ts');

  const U = 'web-demo';
  // 让脚本可以反复运行：先清空本机演示数据库（全部是本地假数据）
  await db.delete();
  await db.open();
  localStorage.setItem(LAST_SEEN_VERSION_KEY, '5.0.4');
  localStorage.setItem('virtugene:onboarded:web-demo', '1');
  useThemeStore.setState({ theme: 'dark' });
  useAuthStore.getState().login(U, '旅人', 'sk-demo-not-a-real-key', '');

  await initSeedCharacters();
  const presets = await db.characters.toArray();
  const gu = presets.find((c) => c.id === 'preset-guyuena');
  const lin = presets.find((c) => c.id === 'preset-linshuang');
  const ai = presets.find((c) => c.id === 'preset-aili');
  const so = presets.find((c) => c.id === 'preset-socrates');
  if (!gu) return { error: 'preset-guyuena missing', names: presets.map((c) => c.name) };

  // 预设角色 createdBy 为空，聊天列表只显示 createdBy === userId 的角色——
  // 这正是用户在「基因实验室」里把预设加入自己世界的效果，这里照做一遍。
  for (const c of [gu, lin, ai, so]) {
    if (c) await db.characters.update(c.id, { createdBy: U, isPreset: false, isCustom: true });
  }

  const now = Date.now();
  const DAY = 86400000;
  await db.characterStates.put({
    characterId: gu.id, userId: U, affinity: 62, mood: 71, milestones: [], storyRelations: [],
    lifeFocus: '想把上次没说完的话接着说下去', updatedAt: now,
  });
  await db.characterStates.put({
    characterId: ai.id, userId: U, affinity: 44, mood: 66, milestones: [], storyRelations: [],
    lifeFocus: '在星图上新画了一条航线', updatedAt: now,
  });

  const sid = 'demo-session-gu';
  await db.sessions.put({
    id: sid, characterId: gu.id, userId: U, title: '周五的面试',
    createdAt: now - 3 * DAY, updatedAt: now - 60000, model: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  });
  await db.sessions.put({
    id: 'demo-session-ai', characterId: ai.id, userId: U, title: '夜里的航线',
    createdAt: now - 5 * DAY, updatedAt: now - 2 * DAY, model: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  });
  const dialogue = [
    ['user', '今天有点累。'],
    ['assistant', '那就别硬撑。……说吧，是什么事。'],
    ['user', '周五要去面试，有点慌。'],
    ['assistant', '面试而已。你紧张的时候话会变少，上次也这样，最后不还是拿下了。'],
    ['user', '你居然记得。'],
    ['assistant', '我记得的事，比你以为的多。'],
    ['user', '那周五之前，陪我练一遍？'],
    ['assistant', '……可以。别迟到。'],
  ];
  for (let i = 0; i < dialogue.length; i++) {
    await db.messages.put({
      id: 'demo-msg-' + i, sessionId: sid, role: dialogue[i][0], content: dialogue[i][1],
      createdAt: now - 3 * DAY + i * 60000,
    });
  }
  await db.messages.put({
    id: 'demo-msg-ai-0', sessionId: 'demo-session-ai', role: 'user', content: '你昨晚在看什么？',
    createdAt: now - 2 * DAY,
  });
  await db.messages.put({
    id: 'demo-msg-ai-1', sessionId: 'demo-session-ai', role: 'assistant', content: '一条很旧的航线。它拐了个弯，绕开了整片星云。',
    createdAt: now - 2 * DAY + 30000,
  });

  const world = await worldRepo.ensureDefaultWorld(U, '旅人');
  const refs = [userRef(U), characterRef(gu.id), characterRef(ai.id)];

  await worldEventRepo.create({
    userId: U, worldId: world.id, type: 'stage', title: '雨夜，我们在便利店躲了半小时',
    summary: '雨把整条街洗亮了。她站在门口，一直没进来。', participants: refs,
    sourceType: 'stage', sourceId: 'demo-scene-rain', timestamp: now - 2 * DAY, importance: 4,
  });
  await worldEventRepo.create({
    userId: U, worldId: world.id, type: 'shared_memory', title: '她说周五要去面试',
    summary: '她提过一次，后来自己都忘了。', participants: refs,
    sourceType: 'chat', sourceId: 'demo-event-interview', timestamp: now - 3 * DAY, importance: 5,
  });
  await worldEventRepo.create({
    userId: U, worldId: world.id, type: 'interaction', title: '凌晨两点她还没睡',
    summary: '她说她在等一条消息。', participants: [userRef(U), characterRef(gu.id)],
    sourceType: 'chat', sourceId: 'demo-event-night', timestamp: now - 1 * DAY, importance: 3,
  });
  await sharedMemoryRepo.create({
    userId: U, worldId: world.id, title: '周五有一场面试',
    summary: '你说过有点慌。她当时只回了一句"面试而已"，但把日期记住了。',
    participants: [userRef(U), characterRef(gu.id)], sourceType: 'chat', sourceId: 'demo-event-interview', visibility: 'world',
  });
  await sharedMemoryRepo.create({
    userId: U, worldId: world.id, title: '雨夜的便利店',
    summary: '两个人挤在门口等雨停，谁都没提要走。',
    participants: refs, sourceType: 'stage', sourceId: 'demo-scene-rain', visibility: 'world',
  });

  const sceneMain = await worldSceneRepo.createScene({
    userId: U, worldId: world.id, title: '雨夜便利', place: '街角便利店', timeLabel: '深夜',
    mood: '安静', characterIds: [gu.id, ai.id], sceneGoal: '把雨停之前的话说完',
    participants: [
      { characterId: gu.id, goals: ['先听你说'], knowsEventIds: [], secrets: ['她其实也紧张'] },
      { characterId: ai.id, goals: ['打破沉默'], knowsEventIds: [], secrets: [] },
    ],
  });
  await worldSceneRepo.appendEntry(sceneMain, { kind: 'narration', content: '雨点敲在遮阳棚上，一下一下，像谁在数着什么。' });
  await worldSceneRepo.appendEntry(sceneMain, { kind: 'dialogue', speakerId: gu.id, content: '你站那么远做什么，进来。' });
  await worldSceneRepo.appendEntry(sceneMain, { kind: 'dialogue', speakerId: ai.id, content: '她在等你先开口哦。' });
  await worldSceneRepo.appendEntry(sceneMain, { kind: 'choice', content: '你准备：', meta: { options: ['把面试的事说出来', '先问她为什么失眠', '什么都不说，只是站着'] } });
  await worldSceneRepo.setSceneStatus(sceneMain, 'active');

  const sceneB = await worldSceneRepo.createScene({
    userId: U, worldId: world.id, title: '冰原重逢', place: '极北冰原', timeLabel: '清晨',
    mood: '克制', characterIds: [gu.id], sceneGoal: '她要不要承认自己等了很久',
  });
  await worldSceneRepo.appendEntry(sceneB, { kind: 'narration', content: '风从冰面上刮过来，把她的头发吹到脸上。' });
  await worldSceneRepo.setSceneStatus(sceneB, 'active');

  const sceneC = await worldSceneRepo.createScene({
    userId: U, worldId: world.id, title: '天台夜话', place: '学校天台', timeLabel: '傍晚',
    mood: '松弛', characterIds: [ai.id], sceneGoal: '聊一聊接下来去哪',
  });
  await worldSceneRepo.setSceneStatus(sceneC, 'active');

  await diaryRepo.create({
    userId: U, date: new Date(now - DAY).toISOString().slice(0, 10),
    title: '雨停之前', content: '今天在便利店门口站了很久，雨一直没停。她没催我走。',
    mood: 4, tags: ['日常'], characterId: gu.id,
  });

  await db.characterStates.toArray();
  useChatStore.getState().selectCharacter(gu.id);
  useUIStore.setState({ activeView: 'chat', mobileTab: 'chat', chatFromList: false, chatFromCharacters: false, canvasSceneId: null });
  await new Promise((r) => setTimeout(r, 400));
  return {
    ok: true,
    characters: presets.map((c) => c.name),
    scenes: (await worldSceneRepo.listScenes(world.id)).map((s) => s.title),
    memories: (await db.sharedMemories.count()),
    events: (await db.worldEvents.count()),
  };
})()`);

console.log('SEED', JSON.stringify(seedReport));
if (!seedReport?.ok) {
  console.error('SEED FAILED');
  socket.close();
  process.exit(1);
}

const click = async (label) => {
  const hit = await run(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.replace(/\\s+/g,'').includes('${label}'));if(!b)return false;b.click();return true})()`);
  return hit;
};
const setView = async (state) => {
  await run(`(async()=>{const {useUIStore}=await import('/src/store/ui-store.ts');useUIStore.setState(${JSON.stringify(state)})})()`);
  await wait(900);
};

await call('Page.reload', { ignoreCache: false });
await wait(4500);
await run(`(()=>{const b=[...document.querySelectorAll('button')];const t=b.find(x=>/以后再说|跳过|知道了/.test(x.innerText));if(t)t.click()})()`);
// 刷新后 zustand 的登录态不在内存里，重新登录一次（数据仍在同一个 IndexedDB）
const relogin = await run(`(async()=>{const {useAuthStore}=await import('/src/store/auth-store.ts');useAuthStore.getState().login('web-demo','旅人','sk-demo-not-a-real-key','');await new Promise(r=>setTimeout(r,600));const {useChatStore}=await import('/src/store/chat-store.ts');await useChatStore.getState().loadCharacters();await new Promise(r=>setTimeout(r,400));return {loggedIn:useAuthStore.getState().isLoggedIn,characters:useChatStore.getState().characters.map(c=>c.name)}})()`);
console.log('RELOGIN', JSON.stringify(relogin));
await wait(1200);

// 1) 会话列表
await setView({ mobileTab: 'chat', activeView: 'chat', chatFromList: false, chatFromCharacters: false });
await shot('01-chat-list');

// 2) 聊天（相遇）
await run(`(async()=>{const {useChatStore}=await import('/src/store/chat-store.ts');await useChatStore.getState().selectCharacter('preset-guyuena')})()`);
await wait(900);
await setView({ mobileTab: 'chat', activeView: 'chat', chatFromList: true });
await wait(900);
// 收起环境/时段面板（它会盖住聊天内容），并滚到最新一条
const collapsed = await run(`(()=>{const open=document.querySelector('.scene-card button[aria-expanded="true"]');if(open){open.click();return 'closed'}return 'already-collapsed'})()`);
console.log('SCENE_CARD', collapsed);
await wait(800);
await run(`(()=>{let n=0;for(const e of document.querySelectorAll('*')){if(e.scrollHeight>e.clientHeight+40){e.scrollTop=e.scrollHeight;n++}}return n})()`);
await wait(500);
await shot('02-conversation');

// 3) 世界主页（星图）
await setView({ mobileTab: 'world', activeView: 'chat', chatFromList: false });
await wait(1600);
await shot('03-world-home');

// 4) 记忆
await setView({ mobileTab: 'world', activeView: 'memory' });
await wait(1200);
await shot('04-memory');

// 5) 关系
await setView({ mobileTab: 'world', activeView: 'relations' });
await wait(1200);
await shot('05-relations');

// 6) 剧情现场（列表）
await setView({ mobileTab: 'world', activeView: 'stage' });
await wait(1400);
await shot('06-stage');

// 6b) 剧情现场（进入其中一场戏，看到旁白 / 对白 / 选择）
await run(`(()=>{const cards=[...document.querySelectorAll('button')].filter(b=>b.innerText.includes('继续这场戏'));if(cards[0])cards[0].click();return cards.length})()`);
await wait(1800);
await shot('06b-scene');

// 7) 年表
await setView({ mobileTab: 'world', activeView: 'timeline' });
await wait(1200);
await shot('07-timeline');

// 8) 我的
await setView({ mobileTab: 'me', activeView: 'chat' });
await wait(1000);
await shot('08-me');

console.log('RUNTIME_ERRORS', JSON.stringify(consoleErrors.slice(0, 6)));
socket.close();
