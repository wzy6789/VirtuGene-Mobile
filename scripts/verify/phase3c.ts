/**
 * VirtuGene 5.0.0 Phase 3c 验收：幕次与选择分支
 *
 * 要证明的三件事：
 *  1. **幕次由本地规则推进**（0 次调用、可解释、有节奏兜底、有上限）：张力到位 + 本幕够长 ⇒ 翻幕；
 *     本幕长得离谱 ⇒ 也必须往前推；最后一幕不再推进。
 *  2. **选择分支是真的**：选项必须 2~3 个且不重复，否则降级成旁白（绝不出现"假选择"）；
 *     用户点选后**记下选了什么**、选项不再可点，并且这一次选择成为下一拍的输入（仍然只花 1 次调用）。
 *  3. 成本纪律不变：打开/离开 0 次；每次动作 1 次；翻幕本身不花钱。
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { parseSceneOutput } from '../../src/lib/ai/scene-director';
import {
  ACT_FORCE_ENTRIES,
  ACT_MIN_ENTRIES,
  MAX_ACTS,
  actLabel,
  actMarkerContent,
  countActEntries,
  shouldAdvanceAct,
  validateChoiceOptions,
} from '../../src/lib/world/scene-acts';
import { finishSceneAndSettle, loadScene, runSceneTurn, startScene } from '../../src/lib/world/scene-runtime';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { MobileStagePage } from '../../src/components/world/MobileStagePage';
import type { Character, Session, WorldSceneEntry } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-p3c';
const C1 = 'c-p3c-star';
const C2 = 'c-p3c-moon';
const SESSION = 's-p3c';

const lines: string[] = [];
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch 打点 + **假 LLM 端点**：
 * - 命中 chat/completions ⇒ 从同一个 stageQueue 取一条响应，按 OpenAI JSON 形态返回
 *   （这样"真实 UI 路径"（内部走 llmChat）也能被完整验收，不会被误记成"偷偷联网"）
 * - 其它请求 ⇒ 记为"不该联网"并拒绝
 */
let netCalls = 0;
let llmHttpCalls = 0;
const realFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('chat/completions')) {
    llmHttpCalls += 1;
    const next = stageQueue.shift() ?? '';
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: next }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  netCalls += 1;
  return Promise.reject(new Error(`harness: 不该联网 -> ${url}`));
}) as typeof fetch;

type LlmResult = { content: string; truncated?: boolean; usage?: { inputTokens: number; outputTokens: number }; modelId?: string };
let llmCalls = 0;
let stageQueue: string[] = [];
const seenMessages: unknown[][] = [];
const stageStub = (async (params: { messages: unknown[] }) => {
  llmCalls += 1;
  seenMessages.push(params.messages);
  const next = stageQueue.shift() ?? '';
  return { content: next, truncated: false, usage: { inputTokens: 50, outputTokens: 20 }, modelId: 'stub' } as LlmResult;
}) as never;

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
function makeCharacter(id: string, name: string): Character {
  return {
    id, name, avatar: '🌙', systemPrompt: `${name}：说话克制。`, tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
    voice: { ...DEFAULT_VOICE },
  };
}
const entry = (kind: WorldSceneEntry['kind'], act: number): WorldSceneEntry => ({
  id: `${kind}-${act}-${Math.random()}`, sceneId: 's', index: 0, kind, act, content: 'x', createdAt: 0,
});

async function run() {
  /* ---------------- P. 纯函数：幕次规则 + 选项校验 ---------------- */
  section('P. 纯函数：幕次推进规则与选项校验');
  {
    const many = (n: number, act: number) => Array.from({ length: n }, () => entry('narration', act));
    check('① 本幕正文太少 ⇒ 即使张力拉满也不翻幕（不能开场就翻）',
      shouldAdvanceAct({ state: { currentAct: 1, currentTension: 1 }, entries: many(ACT_MIN_ENTRIES - 1, 1) }).advance === false);
    check('② 张力到位 + 本幕够长 ⇒ 翻幕（原因 = tension）',
      (() => { const d = shouldAdvanceAct({ state: { currentAct: 1, currentTension: 0.7 }, entries: many(ACT_MIN_ENTRIES, 1) }); return d.advance && d.reason === 'tension' && d.nextAct === 2; })());
    check('③ 张力不足但本幕太长 ⇒ 节奏兜底推进（原因 = pace）',
      (() => { const d = shouldAdvanceAct({ state: { currentAct: 1, currentTension: 0.1 }, entries: many(ACT_FORCE_ENTRIES, 1) }); return d.advance && d.reason === 'pace'; })());
    check('④ 张力不足且本幕不长 ⇒ 不翻幕',
      shouldAdvanceAct({ state: { currentAct: 1, currentTension: 0.1 }, entries: many(ACT_FORCE_ENTRIES - 1, 1) }).advance === false);
    check('⑤ 到了最后一幕就不再推进（留给"结束这场戏"）',
      shouldAdvanceAct({ state: { currentAct: MAX_ACTS, currentTension: 1 }, entries: many(99, MAX_ACTS) }).advance === false);
    check('⑥ 只统计**本幕**的正文（别的幕不算）', countActEntries([...many(6, 1), ...many(9, 2)], 1) === 6);
    check('⑦ system 标记不算正文', countActEntries([...many(3, 1), entry('system', 1)], 1) === 3);
    check('⑧ 幕次人话标签', actLabel(1) === '第一幕' && actLabel(2) === '第二幕' && actMarkerContent(3).includes('第三幕'));

    check('⑨ 2~3 个合法选项 ⇒ 采纳',
      validateChoiceOptions(['推门进去', '先站在门口'])?.length === 2 &&
      validateChoiceOptions(['a', 'b', 'c'])?.length === 3);
    check('⑩ 只有一个选项 ⇒ 不是选择（返回 null，调用方降级成旁白）', validateChoiceOptions(['只有一个']) === null);
    check('⑪ 空/重复/非字符串被清掉：清理后不足 2 个 ⇒ 不算选择',
      validateChoiceOptions(['  ', 'x', 'x']) === null, validateChoiceOptions(['  ', 'x', 'x']));
    check('⑫ 超过 3 个只取前 3 个', validateChoiceOptions(['a', 'b', 'c', 'd'])?.join('|') === 'a|b|c');
    check('⑬ 超长选项被截断到 60 字内',
      (validateChoiceOptions(['x'.repeat(200), 'y'])![0]).length === 60);

    const members = [{ characterId: C1, name: '星遥', persona: 'x' }];
    const parsed = parseSceneOutput(JSON.stringify({
      entries: [
        { kind: 'narration', content: '门虚掩着。' },
        { kind: 'choice', content: '你要怎么做？', options: ['推门进去', '先站在门口'] },
        { kind: 'choice', content: '这个不算选择', options: ['只有一个'] },
      ],
    }), members, 4);
    check('⑭ 合法选择被解析成 choice（带选项）',
      parsed.entries[1]?.kind === 'choice' && parsed.entries[1]?.options?.length === 2, parsed.entries[1]);
    check('⑮ 非法选择**降级成旁白**（绝不出现假选择）',
      parsed.entries[2]?.kind === 'narration' && parsed.entries[2]?.options === undefined, parsed.entries[2]);
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

  /* ---------------- A. 真实推演：选择落库 + 翻幕 ---------------- */
  section('A. 真实推演：选择提示落库、点选后可回看、幕次按规则推进');
  let sceneId = '';
  {
    sceneId = await startScene({
      userId: U, worldId: world.id, title: '虚掩的门', place: '旧楼三层', timeLabel: '深夜', mood: '紧绷',
      characterIds: [C1, C2], sceneGoal: '弄清楚那扇门后面是什么',
    });
    stageQueue = [
      JSON.stringify({
        entries: [
          { kind: 'narration', content: '走廊尽头的门虚掩着，里面有光。' },
          { kind: 'dialogue', speaker: '星遥', content: '要进去吗？' },
          { kind: 'choice', content: '你要怎么做？', options: ['直接推门进去', '先敲门问一声'] },
        ],
        tension: 0.3,
      }),
    ];
    const before = llmCalls;
    const r1 = await runSceneTurn({ userId: U, sceneId, apiKey: 'sk-fake', callLlm: stageStub });
    check('① 一轮（含给出选择）仍然只调用 1 次', llmCalls - before === 1, llmCalls - before);
    const entries1 = await worldSceneRepo.listEntries(sceneId, { limit: 50 });
    const choiceEntry = entries1.find((e) => e.kind === 'choice');
    check('② 选择提示落库（kind=choice + meta.options）',
      !!choiceEntry && (choiceEntry.meta?.options ?? []).length === 2, choiceEntry);
    check('③ 张力低 + 本幕不长 ⇒ 没有翻幕', r1.actAdvanced === undefined, r1.actAdvanced);
    check('④ 幕次仍是第一幕', (await worldSceneRepo.getScene(sceneId))?.state.currentAct === 1);

    // 用户点选其中一个选项（这一轮同样需要一份模型响应）
    stageQueue = [JSON.stringify({ entries: [{ kind: 'narration', content: '门后安静了下来。' }, { kind: 'dialogue', speaker: '月见', content: '……请进。' }], tension: 0.45 })];
    const before2 = llmCalls;
    await runSceneTurn({ userId: U, sceneId, apiKey: 'sk-fake', chosenFromEntryId: choiceEntry!.id, userAction: '先敲门问一声', callLlm: stageStub });
    check('⑤ 点选项也是一轮 1 次调用', llmCalls - before2 === 1, llmCalls - before2);
    const after = await worldSceneRepo.listEntries(sceneId, { limit: 50 });
    const patched = after.find((e) => e.id === choiceEntry!.id);
    check('⑥ 那条选择提示被标记"已选"（UI 不再显示可点选项）', patched?.meta?.chosen === '先敲门问一声', patched?.meta);
    check('⑦ 选择本身作为一条 choice 条目被记下（可回看"你当时选了什么"）',
      after.some((e) => e.kind === 'choice' && e.content === '先敲门问一声'), after.filter((e) => e.kind === 'choice').map((e) => e.content));
    const lastMessages = JSON.stringify(seenMessages[seenMessages.length - 1]);
    check('⑧ 这次选择成为下一拍的输入（角色看得到用户选了什么）', lastMessages.includes('先敲门问一声'));
  }

  /* ---------------- B. 翻幕：本地规则真的会在推演里生效 ---------------- */
  section('B. 翻幕：张力到位 + 本幕够长时，本地规则推进到第二幕');
  {
    // 注意：user_input / choice 都算本幕正文，所以一轮会加 3 条左右 —— 断言必须按真实计数写
    stageQueue.push(JSON.stringify({ entries: [{ kind: 'narration', content: '走廊里的灯闪了一下。' }, { kind: 'dialogue', speaker: '星遥', content: '小心点。' }], tension: 0.4 }));
    await runSceneTurn({ userId: U, sceneId, apiKey: 'sk-fake', userAction: '我继续往前走', callLlm: stageStub });
    const beforeFinal = await worldSceneRepo.getScene(sceneId);
    const entriesBeforeFinal = await worldSceneRepo.listEntries(sceneId, { limit: 80 });
    check('① 张力没到阈值、本幕也没长到兜底线 ⇒ 仍在第一幕',
      beforeFinal?.state.currentAct === 1,
      { act: beforeFinal?.state.currentAct, tension: beforeFinal?.state.currentTension, entries: countActEntries(entriesBeforeFinal, 1) });

    stageQueue.push(JSON.stringify({ entries: [{ kind: 'narration', content: '门后传来脚步声。' }, { kind: 'dialogue', speaker: '月见', content: '别过来。' }], tension: 0.8 }));
    const before = llmCalls;
    const r = await runSceneTurn({ userId: U, sceneId, apiKey: 'sk-fake', userAction: '我推开门', callLlm: stageStub });
    check('② 翻幕本身不花钱（该轮仍然只有 1 次调用）', llmCalls - before === 1, llmCalls - before);
    check('③ 真的翻到了第二幕（张力到位 + 本幕够长）', r.actAdvanced === 2, { advanced: r.actAdvanced, tension: r.tension });
    const scene2 = await worldSceneRepo.getScene(sceneId);
    check('④ 状态里 currentAct = 2，且张力重新开始积累', scene2?.state.currentAct === 2 && scene2.state.currentTension === 0, scene2?.state);
    const entries = await worldSceneRepo.listEntries(sceneId, { limit: 80 });
    check('⑤ 写下了用户看得见的幕次标记', entries.some((e) => e.kind === 'system' && e.content.includes('第二幕')), entries.filter((e) => e.kind === 'system').map((e) => e.content));
    check('⑥ 新条目归属第二幕', entries.filter((e) => e.content === actMarkerContent(2)).every((e) => e.act === 2));
    check('⑦ 正文没有落进聊天（messages 数量不变）',
      (await db.messages.count()) === 0, await db.messages.count());
  }

  /* ---------------- C. UI：真实组件的选项按钮 ---------------- */
  section('C. 真实组件：选项按钮能点，点完不再可点');
  {
    useUIStore.getState().setActiveView('stage');
    const host = mount(createElement(MobileStagePage), 900);
    await sleep(900);
    // 打开那场戏
    const opened = Array.from(host.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('继续这场戏'));
    opened?.click();
    await sleep(900);
    const text = host.innerText;
    check('① 舞台上显示当前幕次', text.includes('第二幕'), text.slice(0, 200));
    check('② 已选过的选择显示为"你选的内容"，不再显示选项按钮',
      text.includes('先敲门问一声') && !text.includes('直接推门进去'), text.slice(0, 400));

    // 造一个新的选择提示，验证按钮可点、点完消失
    stageQueue = [JSON.stringify({
      entries: [
        { kind: 'narration', content: '桌上放着一封信。' },
        { kind: 'choice', content: '你要怎么做？', options: ['拆开信封', '先收起来'] },
      ],
      tension: 0.2,
    })];
    // 通过 UI 输入一句话触发这一轮
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '我环顾四周');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(60);
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await sleep(1600);
    }
    const choiceButtons = Array.from(host.querySelectorAll('button')).filter((b) => ['拆开信封', '先收起来'].includes((b.textContent ?? '').trim()));
    check('③ 选项按钮渲染出来了（2 个）', choiceButtons.length === 2, choiceButtons.map((b) => b.textContent));
    // 点选项这一轮同样要有一份响应（空响应会触发 jsonMode 降级重试，那是另一条路径，这里不测它）
    stageQueue.push(JSON.stringify({ entries: [{ kind: 'narration', content: '信封里是一张旧照片。' }], tension: 0.3 }));
    const httpBefore = llmHttpCalls;
    choiceButtons[0]?.click();
    await sleep(1800);
    const afterText = host.innerText;
    check('④ 点选项后：该选择显示为已选内容', afterText.includes('拆开信封'), afterText.slice(-400));
    check('⑤ 点选项后：选项按钮消失（不会重复点）',
      Array.from(host.querySelectorAll('button')).filter((b) => ['先收起来'].includes((b.textContent ?? '').trim())).length === 0);
    check('⑥ 点选项这一轮也只多 1 次调用（走真实 UI → 假 LLM 端点）', llmHttpCalls - httpBefore === 1, llmHttpCalls - httpBefore);
  }

  /* ---------------- D. 结算看到选择后果 ---------------- */
  section('D. 结算：选择后果会进入结算依据');
  {
    const { entries } = await loadScene(sceneId);
    check('① 正文里能找到用户的选择（结算跑的就是这份正文）',
      entries.some((e) => e.content === '拆开信封'), entries.filter((e) => e.kind === 'choice').map((e) => e.content));
    stageQueue = [JSON.stringify({
      summary: '门后的真相被摊开了。',
      memory: { title: '旧楼三层的那封信', summary: '你们都看到了那张照片。' },
      relationshipChanges: [{ a: '用户', b: '星遥', facets: { trust: 3 }, reason: '一起把那封信看完了' }],
      unresolved: [],
    })];
    const before = llmCalls;
    const settled = await finishSceneAndSettle({ userId: U, sceneId, apiKey: 'sk-fake', callLlm: stageStub });
    check('② 结算仍然只花 1 次调用', llmCalls - before === 1, llmCalls - before);
    check('③ 结算成功并写下舞台事件', !settled.error && !!settled.worldEventId, settled.error);
    const settlePrompt = JSON.stringify(seenMessages[seenMessages.length - 1]);
    check('④ 结算提示里包含了选择分支的正文', settlePrompt.includes('拆开信封'));
    check('⑤ 戏已结束', (await worldSceneRepo.getScene(sceneId))?.status === 'finished');
  }

  /* ---------------- E. 纪律 ---------------- */
  section('E. 纪律');
  {
    check('① 全程零"计划外"网络请求（只有假 LLM 端点被命中）', netCalls === 0, netCalls);
    check('② 调用总数 = A(2) + B(2) + C(2，走真实 UI) + D(1 结算) = 7',
      llmCalls + llmHttpCalls === 7, { stub: llmCalls, http: llmHttpCalls });
  }

  section('清理');
  unmount();
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
