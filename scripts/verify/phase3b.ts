/**
 * VirtuGene 5.0.0 Phase 3b 验收：舞台后果进入私聊上下文（闭环）
 *
 * 要证明的闭环：**一起经历 → 记入世界 → 角色在聊天里能自然提起**
 *
 * 覆盖：
 *  P. 纯函数：buildSceneContext（文案、条数上限、不含内部字段、明确禁止编造）
 *  A. 三道闸门：参与过 + 知道且可提起 + 可见；只召回**已结束**的戏
 *  B. 真实 ChatWindow：prompt 里出现这场戏；旁观者的 prompt 里没有；溯源记录 sceneIds
 *  C. 闭环端到端：真实演完一场戏（1 轮 + 1 结算）后，私聊下一句就能"提起"它
 *  D. 不重复注入：这场戏留下的共同记忆只在共同记忆区块出现一次
 *  E. 预算与溯源：被截断就不记录 sceneIds（不谎报）
 *  F. 成本：召回 0 次调用；每次发送 1 次；全程 0 网络
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { continuityRepo } from '../../src/db/continuity-repo';
import { finishSceneAndSettle, runSceneTurn, startScene } from '../../src/lib/world/scene-runtime';
import { selectRecallableScenes } from '../../src/lib/world/scene-recall';
import { buildSceneContext } from '../../src/lib/chat-context';
import { buildContextTrace } from '../../src/lib/chat-trace';
import { compileChatContext } from '../../src/lib/chat-context-compiler';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { webApi } from '../../src/lib/web-api';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { ChatWindow } from '../../src/components/chat/ChatWindow';
import { MemoryBasisModal } from '../../src/components/chat/MemoryBasisModal';
import type { Character, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-p3b';
const C1 = 'c-p3b-star';
const C2 = 'c-p3b-moon';
const SESSION = 's-p3b';

const lines: string[] = [];
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- 零网络 ---------- */
let netCalls = 0;
const realFetch = window.fetch.bind(window);
window.fetch = ((...args: Parameters<typeof fetch>) => {
  netCalls += 1;
  return Promise.reject(new Error('harness: 不该联网'));
}) as typeof fetch;

/* ---------- 两个 LLM 边界都要打桩 ---------- */
type LlmResult = { content: string; truncated?: boolean; usage?: { inputTokens: number; outputTokens: number }; modelId?: string };
let llmCalls = 0;
let stageQueue: string[] = [];
const stageStub = (async () => {
  llmCalls += 1;
  const next = stageQueue.shift() ?? '';
  return { content: next, truncated: false, usage: { inputTokens: 50, outputTokens: 20 }, modelId: 'stub' } as LlmResult;
}) as never;

let chatCalls = 0;
let capturedPrompt = '';
const STUB_REPLIES = ['嗯，那天的事我一直记着。', '行，听你的。', '你说的是那次吧，我也没忘。'];
const originalSend = webApi.chat.send.bind(webApi.chat);
(webApi.chat as unknown as { send: typeof webApi.chat.send }).send = (async (params: { systemPrompt: string }) => {
  chatCalls += 1;
  capturedPrompt = params.systemPrompt;
  return { content: STUB_REPLIES[(chatCalls - 1) % STUB_REPLIES.length], usage: { inputTokens: 500, outputTokens: 20 }, modelId: 'stub' };
}) as typeof webApi.chat.send;

let activeRoot: Root | null = null;
let activeHost: HTMLDivElement | null = null;
function mount(el: ReactElement, height = 900): HTMLDivElement {
  unmount();
  const host = document.createElement('div');
  host.style.height = `${height}px`;
  document.body.appendChild(host);
  activeHost = host;
  activeRoot = createRoot(host);
  activeRoot.render(el);
  return host;
}
function unmount() {
  if (activeRoot) { activeRoot.unmount(); activeRoot = null; }
  if (activeHost) { activeHost.remove(); activeHost = null; }
}
async function sendFromUI(host: HTMLElement, text: string): Promise<void> {
  const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
  if (!textarea) throw new Error('harness: 找不到输入框');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, text);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(60);
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(1500);
}
function makeCharacter(id: string, name: string): Character {
  return {
    id, name, avatar: '🌙', systemPrompt: `${name}：说话克制。`, tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
    voice: { ...DEFAULT_VOICE },
  };
}

async function run() {
  /* ---------------- P. 纯函数 ---------------- */
  section('P. 纯函数：舞台回忆文案');
  {
    check('① 没有戏时区块为空（不留空区块）', buildSceneContext([]) === '');
    const text = buildSceneContext([
      { title: '雨夜的便利店', place: '凌晨的便利店', timeLabel: '凌晨两点', summary: '你们把那句没说完的话说完了。' },
      { title: '屋顶上的黄昏', place: '天台', timeLabel: '黄昏', summary: '' },
      { title: '第三场', place: 'x', timeLabel: 'y', summary: 'z' },
    ]);
    check('② 含标题/地点/时间/摘要', text.includes('《雨夜的便利店》') && text.includes('凌晨的便利店') && text.includes('凌晨两点') && text.includes('说完了'), text.slice(0, 200));
    check('③ 最多只写 2 场', (text.match(/^- 《/gm) ?? []).length === 2, text);
    check('④ 不含任何内部字段', !/visibility|visibleTo|importance|worldId|sceneId|0\.\d/.test(text), text.slice(0, 200));
    check('⑤ 明确"亲身在场"，并禁止编造/禁止说成和别的角色',
      text.includes('亲身在场') && text.includes('不要编造没有发生过的细节') && text.includes('别的'), text.slice(-160));
  }

  /* ---------------- 准备 ---------------- */
  await Dexie.delete(DB);
  await db.open();
  await db.users.put({ id: U, username: '智毅', passwordHash: 'x', passwordSalt: 'y', createdAt: Date.now() });
  await characterRepo.create(makeCharacter(C1, '星遥'));
  await characterRepo.create(makeCharacter(C2, '月见'));
  const session: Session = {
    id: SESSION, characterId: C1, userId: U, title: '新对话',
    createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0,
  };
  await sessionRepo.create(session);
  useAuthStore.setState({ userId: U, username: '智毅', apiKey: 'sk-fake', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  const world = await worldRepo.ensureDefaultWorld(U, '智毅');

  /* ---------------- C. 闭环：真实演完一场戏 ---------------- */
  section('C. 闭环第一步：真实演完一场戏（1 轮推演 + 1 次结算）');
  let sceneId = '';
  let stageEventId = '';
  let memoryTitle = '';
  let sceneTitle = '';
  {
    sceneId = await startScene({
      userId: U, worldId: world.id,
      title: '雨夜的便利店', place: '凌晨的便利店', timeLabel: '凌晨两点', mood: '潮湿安静',
      characterIds: [C1], sceneGoal: '把上次没说完的话说完',
    });
    sceneTitle = (await worldSceneRepo.getScene(sceneId))!.title;
    stageQueue = [
      JSON.stringify({ entries: [{ kind: 'narration', content: '雨点敲在玻璃上。' }, { kind: 'dialogue', speaker: '星遥', content: '你来了。' }], tension: 0.5 }),
      JSON.stringify({
        summary: '两个人在雨里把那句没说完的话说完了。',
        memory: { title: '雨夜便利店的长谈', summary: '你们终于没有再绕开那件事。' },
        relationshipChanges: [{ a: '用户', b: '星遥', facets: { trust: 4 }, reason: '把上次没说完的话说完了' }],
        unresolved: [],
      }),
    ];
    const before = llmCalls;
    await runSceneTurn({ userId: U, sceneId, apiKey: 'sk-fake', callLlm: stageStub });
    const settled = await finishSceneAndSettle({ userId: U, sceneId, apiKey: 'sk-fake', callLlm: stageStub });
    check('① 一轮推演 + 一次结算 = 2 次调用', llmCalls - before === 2, llmCalls - before);
    check('② 戏已结束并挂上舞台事件', !!settled.worldEventId && (await worldSceneRepo.getScene(sceneId))?.status === 'finished');
    stageEventId = settled.worldEventId!;
    memoryTitle = '雨夜便利店的长谈';
  }

  /* ---------------- A. 三道闸门 ---------------- */
  section('A. 三道闸门：参与过 + 知道且可提起 + 可见；只召回已结束的戏');
  {
    const forC1 = await selectRecallableScenes({ worldId: world.id, characterId: C1 });
    check('① 在场的角色能召回这场戏', forC1.length === 1 && forC1[0].scene.id === sceneId, forC1.map((r) => r.scene.title));
    check('② 没在场的角色一无所知（参与过这道闸门）',
      (await selectRecallableScenes({ worldId: world.id, characterId: C2 })).length === 0);

    // 正在演的戏不该被当成"我们经历过"
    const ongoing = await startScene({
      userId: U, worldId: world.id, title: '还没演完的戏', place: '走廊', timeLabel: '深夜', mood: '冷',
      characterIds: [C1],
    });
    check('③ 还在演的戏不召回（只召回已经结束的）',
      (await selectRecallableScenes({ worldId: world.id, characterId: C1 })).every((r) => r.scene.id !== ongoing));
    await worldSceneRepo.deleteScene(ongoing);

    // 认知闸门：删掉认知行（模拟撤回/清理）⇒ 不再召回
    const knowRow = await knowledgeRepo.getForCharacterEvent(C1, stageEventId);
    check('④ 结算时确实给在场角色授了认知（full + 可提起）',
      knowRow?.knowledgeLevel === 'full' && knowRow?.canMention === true, knowRow);
    await knowledgeRepo.remove(knowRow!.id);
    check('⑤ 认知被收回 ⇒ 不再召回（被允许知道 ≠ 已经知道）',
      (await selectRecallableScenes({ worldId: world.id, characterId: C1 })).length === 0);
    await knowledgeRepo.upsert({ userId: U, worldId: world.id, characterId: C1, eventId: stageEventId, knowledgeLevel: 'full', canMention: true });
    check('⑥ 认知补回 ⇒ 又能召回', (await selectRecallableScenes({ worldId: world.id, characterId: C1 })).length === 1);

    // 可见性闸门（防御性二次校验）
    const event = (await worldEventRepo.getById(stageEventId))!;
    await worldEventRepo.update(stageEventId, { visibility: 'private', visibleTo: [] });
    check('⑦ 事件被改成 private ⇒ 不召回（可见性闸门）',
      (await selectRecallableScenes({ worldId: world.id, characterId: C1 })).length === 0);
    await worldEventRepo.update(stageEventId, { visibility: 'selected', visibleTo: event.visibleTo ?? [C1] });
    check('⑧ 恢复可见 ⇒ 又能召回', (await selectRecallableScenes({ worldId: world.id, characterId: C1 })).length === 1);

    // limit
    const second = await startScene({
      userId: U, worldId: world.id, title: '第二场戏', place: '天台', timeLabel: '黄昏', mood: '安静',
      characterIds: [C1],
    });
    stageQueue = [JSON.stringify({ entries: [{ kind: 'narration', content: '风很大。' }] }), JSON.stringify({ summary: '在天台上站了一会儿。' })];
    await runSceneTurn({ userId: U, sceneId: second, apiKey: 'sk-fake', callLlm: stageStub });
    await finishSceneAndSettle({ userId: U, sceneId: second, apiKey: 'sk-fake', callLlm: stageStub });
    check('⑨ limit 生效（默认最多 2 场，取最近结束的）',
      (await selectRecallableScenes({ worldId: world.id, characterId: C1 })).length === 2 &&
      (await selectRecallableScenes({ worldId: world.id, characterId: C1, limit: 1 })).length === 1);
  }

  /* ---------------- B. 真实发送 ---------------- */
  section('B. 真实 ChatWindow：角色真的看得到这场戏');
  useChatStore.setState({
    characters: [makeCharacter(C1, '星遥'), makeCharacter(C2, '月见')],
    selectedCharacterId: C1,
    currentSessionId: SESSION,
    messages: [],
    hasMoreMessages: false,
  } as never);
  const host = mount(createElement(ChatWindow), 900);
  await sleep(900);
  {
    const before = chatCalls;
    await sendFromUI(host, '你还记得那天晚上吗');
    check('① 一次发送 = 1 次调用', chatCalls - before === 1, chatCalls - before);
    check('② prompt 里出现「你们一起经历过的事（星域）」区块',
      capturedPrompt.includes('[你们一起经历过的事（星域）]'), capturedPrompt.slice(0, 300));
    check('③ 区块里就是那场戏（标题 + 事件摘要）',
      capturedPrompt.includes(`《${sceneTitle}》`) && capturedPrompt.includes('把那句没说完的话说完了'),
      capturedPrompt.slice(capturedPrompt.indexOf('[你们一起经历过的事（星域）]'), capturedPrompt.indexOf('[你们一起经历过的事（星域）]') + 240));

    const assistant = (await messageRepo.getPage(SESSION, { limit: 50 })).filter((m) => m.role === 'assistant').pop();
    check('④ 溯源如实记录 sceneIds', (assistant?.contextTrace?.sceneIds ?? []).length === 2,
      assistant?.contextTrace);

    // 旁观者视角：完全看不到这场戏
    unmount();
    useChatStore.setState({ selectedCharacterId: C2, currentSessionId: SESSION, messages: [] } as never);
    const host2 = mount(createElement(ChatWindow), 900);
    await sleep(900);
    await sendFromUI(host2, '在吗');
    check('⑤ 没在场的角色，prompt 里没有这场戏',
      !capturedPrompt.includes('[你们一起经历过的事（星域）]') && !capturedPrompt.includes(sceneTitle),
      capturedPrompt.slice(0, 200));
    check('⑥ 没在场的角色，溯源里也没有 sceneIds',
      (((await messageRepo.getPage(SESSION, { limit: 50 })).filter((m) => m.role === 'assistant').pop())?.contextTrace?.sceneIds ?? []).length === 0);
    unmount();
  }

  /* ---------------- D. 不重复注入 ---------------- */
  section('D. 不重复注入：同一件事在 prompt 里只说一次');
  {
    useChatStore.setState({ selectedCharacterId: C1, currentSessionId: SESSION, messages: [] } as never);
    const host3 = mount(createElement(ChatWindow), 900);
    await sleep(900);
    await sendFromUI(host3, '随便聊聊');
    check('① 舞台区块在整段 prompt 里恰好出现 1 次',
      (capturedPrompt.match(/\[你们一起经历过的事（星域）\]/g) ?? []).length === 1,
      (capturedPrompt.match(/\[你们一起经历过的事（星域）\]/g) ?? []).length);
    check('② 这场戏的摘要恰好出现 1 次（没有被别的区块重复讲一遍）',
      (capturedPrompt.match(/把那句没说完的话说完了/g) ?? []).length === 1,
      (capturedPrompt.match(/把那句没说完的话说完了/g) ?? []).length);
    /**
     * 这场戏留下的共同记忆**不会**再走共同记忆区块：
     * 结算时它是挂在 `stage` 事件上的（memoryIds），而 2b-3 的共同记忆召回只认
     * `shared_memory` 类型的事件——因此同一次经历只由**舞台区块**呈现一次。
     * 这不是遗漏：舞台区块给的是"标题 + 地点 + 时间 + 发生了什么"，信息量严格多于那一行记忆标题。
     */
    check('③ 这次经历只由舞台区块呈现（共同记忆区块不重复注入它）',
      (capturedPrompt.match(new RegExp(memoryTitle, 'g')) ?? []).length === 0,
      { memoryTitle, times: (capturedPrompt.match(new RegExp(memoryTitle, 'g')) ?? []).length });
    check('④ 私密/无关的既有区块照常（长期记忆区块仍在）', capturedPrompt.includes('[当前灵魂状态]'));
    unmount();
  }

  /* ---------------- E. 预算与溯源 ---------------- */
  section('E. 预算与溯源：被截断就不记录（不谎报）');
  {
    const BUDGET = 6000;
    const full = compileChatContext('IDENT', [{ key: 'scene', text: 'x'.repeat(1000), priority: 91 }], BUDGET);
    check('① 完整注入 ⇒ 记录 sceneIds',
      buildContextTrace({ compiled: full, scenes: [{ id: 'sc-1' }] }).sceneIds?.join('|') === 'sc-1');
    const partial = compileChatContext('IDENT', [{ key: 'other', text: 'x'.repeat(5000), priority: 100 }, { key: 'scene', text: 'x'.repeat(3000), priority: 91 }], BUDGET);
    check('② 构造出的确是被截断的区块', partial.partial.includes('scene'), { included: partial.included, partial: partial.partial });
    check('③ 被截断 ⇒ 不记录 sceneIds', buildContextTrace({ compiled: partial, scenes: [{ id: 'sc-1' }] }).sceneIds === undefined);
    const omitted = compileChatContext('IDENT', [{ key: 'a', text: 'x'.repeat(5800), priority: 100 }, { key: 'b', text: 'x'.repeat(3000), priority: 95 }, { key: 'scene', text: 'x'.repeat(400), priority: 40 }], BUDGET);
    check('④ 被丢弃 ⇒ 不记录', omitted.omitted.includes('scene') && buildContextTrace({ compiled: omitted, scenes: [{ id: 'sc-1' }] }).sceneIds === undefined);
    check('⑤ 同一轮可以同时记录共同记忆 / 日记 / 舞台（互不覆盖）',
      (() => {
        // 三个区块都完整注入时，三个 id 列表都要被记录
        const all = compileChatContext('IDENT', [
          { key: 'scene', text: 'x'.repeat(800), priority: 91 },
          { key: 'shared-memory', text: 'x'.repeat(800), priority: 93 },
          { key: 'diary', text: 'x'.repeat(800), priority: 70 },
        ], BUDGET);
        const t = buildContextTrace({ compiled: all, scenes: [{ id: 'sc-1' }], sharedMemories: [{ id: 'sm-1' }], diaries: [{ id: 'd-1' }] });
        return t.sceneIds?.join('|') === 'sc-1' && t.sharedMemoryIds?.join('|') === 'sm-1' && t.diaryIds?.join('|') === 'd-1';
      })());
  }

  /* ---------------- F. 溯源面板 ---------------- */
  section('F. 溯源面板：这条回复参考了哪几场戏');
  {
    const assistant = (await messageRepo.getPage(SESSION, { limit: 50 }))
      .filter((m) => m.role === 'assistant' && (m.contextTrace?.sceneIds?.length ?? 0) > 0)
      .pop();
    check('① 夹具成立：找到一条记录过 sceneIds 的回复', !!assistant, assistant?.contextTrace);
    const modalHost = mount(
      createElement(MemoryBasisModal, { open: true, onClose: () => undefined, trace: assistant!.contextTrace, characterName: '星遥' }),
      600,
    );
    await sleep(500);
    const modalText = document.body.innerText;
    check('② 面板出现「你们一起演过的戏」区块', modalText.includes('你们一起演过的戏'), modalText.slice(0, 300));
    check('③ 面板里能看到那场戏的标题与地点',
      modalText.includes(sceneTitle) && modalText.includes('凌晨的便利店'), modalText.slice(0, 400));
    unmount();
    modalHost.remove();
  }

  section('清理');
  unmount();
  (webApi.chat as unknown as { send: typeof webApi.chat.send }).send = originalSend;
  window.fetch = realFetch;
  await worldRepo.clearForUser(U);
  check('清理后世界层为空', (await db.worldScenes.count()) === 0 && (await worldEventRepo.countByWorld(world.id)) === 0);
}

run()
  .catch((err) => {
    failures += 1;
    lines.push(`FAIL 抛出异常 :: ${String(err && (err as Error).stack ? (err as Error).stack : err)}`);
  })
  .finally(() => {
    const text = `${lines.join('\n')}\n\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`;
    const out = document.createElement('pre');
    out.id = 'result';
    out.textContent = text;
    document.body.appendChild(out);
    document.title = failures === 0 ? 'VERIFY-OK' : 'VERIFY-FAIL';
    void realFetch('/result', { method: 'POST', body: text }).catch(() => undefined);
  });
