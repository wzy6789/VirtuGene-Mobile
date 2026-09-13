/**
 * VirtuGene 5.0.0 Phase 2b-5 验收（2B：关系网络可解释化）
 *
 * 覆盖：
 *  P. 纯函数：分面语义化（不显示数值）、配对标题、原因排序、"有没有可解释的记录"
 *  A. 实时写入：4.x 等阶升级 → 关系变化史里留下**可读的原因**；
 *     普通互动**不写**（噪音控制）；同一来源**幂等**；
 *     **R7 不变量**：世界层不写任何数值（好感度仍只有 4.x 一个来源）
 *  B. 读回：世界层关系状态与关系史按世界隔离（不串用户/世界）
 *  C. 端到端渲染（真实 MobileRelationsPage）：现在的关系 + 为什么会这样 + 空状态 + 错误态
 *  D. 外壳：世界页入口 → 关系网络覆盖页，底部导航保持可见且高亮「世界」
 *  E. 纪律：页面**不出现任何内部数值**、全程零网络 / 零 AI 调用
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import Dexie from 'dexie';
import { db } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { stateRepo } from '../../src/db/state-repo';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { relationshipRepo } from '../../src/db/relationship-repo';
import { webApi } from '../../src/lib/web-api';
import {
  describeFacet,
  describeFacets,
  facetStrength,
  hasExplainableRecord,
  pairTitle,
  recentReasons,
  reasonText,
} from '../../src/lib/world/relationships';
import { characterRef, userRef } from '../../src/lib/world/subjects';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useEmotionStore } from '../../src/store/emotion-store';
import { useUIStore, MOBILE_TABS } from '../../src/store/ui-store';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { MobileRelationsPage } from '../../src/components/world/MobileRelationsPage';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { MobileLayout } from '../../src/components/layout/MobileLayout';
import type { Character, RelationshipState, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-2b5';
const U2 = 'u-2b5-other';
const C1 = 'c-2b5-star';
const C2 = 'c-2b5-moon';
const SESSION = 's-2b5';

const lines: string[] = [];
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures += 1;
  lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}
function section(t: string) { lines.push(`\n--- ${t} ---`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- 零网络打点 ---------- */
let netCalls = 0;
const realFetch = window.fetch.bind(window);
window.fetch = ((...args: Parameters<typeof fetch>) => {
  netCalls += 1;
  return Promise.reject(new Error(`harness: 不该联网 -> ${String(args[0])}`));
}) as typeof fetch;

/* ---------- 结算打桩（只模拟"模型说了什么"） ---------- */
type SettleResult = Awaited<ReturnType<typeof webApi.context.settle>>;
let aiCalls = 0;
const queue: SettleResult[] = [];
const dims = (intimacy: number) => ({
  valence: 6, arousal: 5, intimacy, engagement: 6, expressiveness: 5, stability: 6,
});
(webApi.context as unknown as { settle: () => Promise<SettleResult> }).settle = async () => {
  aiCalls += 1;
  const next = queue.shift();
  if (!next) throw new Error('harness: 没有排队的结算响应');
  return next;
};

/* ---------- 渲染 ---------- */
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
function clickButtonByText(text: string, root: ParentNode = document.body): boolean {
  const btn = Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
  if (!btn) return false;
  (btn as HTMLButtonElement).click();
  return true;
}
function makeCharacter(id: string, name: string, userId = U): Character {
  return {
    id, name, avatar: '🌙', systemPrompt: 'x', tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: userId, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
    voice: { ...DEFAULT_VOICE },
  };
}

async function run() {
  /* ---------------- P. 纯函数 ---------------- */
  section('P. 纯函数：分面语义化 / 配对标题 / 原因');
  {
    check('① 分面强度分档（0 视为没有记录）',
      facetStrength(0) === 'none' && facetStrength(-3) === 'none' && facetStrength(1) === 'low' &&
      facetStrength(33) === 'low' && facetStrength(34) === 'mid' && facetStrength(66) === 'mid' &&
      facetStrength(67) === 'high' && facetStrength(100) === 'high',
      [0, -3, 1, 33, 34, 66, 67, 100].map((v) => `${v}:${facetStrength(v)}`));
    check('② 没有记录的分面不产生文案（不显示"信任：无"）', describeFacet('trust', 0) === null);
    check('③ 分面文案只讲感受、不含数字',
      !/\d/.test(describeFacet('trust', 80) ?? '') && (describeFacet('trust', 80) ?? '').includes('信任'),
      describeFacet('trust', 80));
    const state = {
      id: 'x', userId: U, worldId: 'w', pairKey: 'p', subjectA: characterRef(C1), subjectB: characterRef(C2),
      subjects: [], trust: 80, affinity: 0, dependency: 0, conflict: 40, familiarity: 10, updatedAt: 1,
    } as RelationshipState;
    const readings = describeFacets(state, 3);
    check('④ 只读有记录的分面，按强度从高到低',
      readings.map((r) => r.facet).join('|') === 'trust|conflict|familiarity', readings.map((r) => `${r.facet}:${r.strength}`));
    check('⑤ limit 生效', describeFacets(state, 1).length === 1);
    check('⑥ 全 0 的状态 ⇒ 没有任何分面文案', describeFacets({ ...state, trust: 0, conflict: 0, familiarity: 0 }, 3).length === 0);

    check('⑦ 配对标题：你 ↔ 角色', pairTitle(state, U, (id) => (id === C1 ? '星遥' : '月见')) === '星遥 和 月见');
    check('⑧ 配对标题：用户 ↔ 角色时显示"你"',
      pairTitle({ subjectA: userRef(U), subjectB: characterRef(C1) }, U, () => '星遥') === '你 和 星遥',
      pairTitle({ subjectA: userRef(U), subjectB: characterRef(C1) }, U, () => '星遥'));

    const events = [
      { id: 'e1', reason: '关系进入「熟悉」阶段', createdAt: 300, facets: {} },
      { id: 'e2', reason: '', createdAt: 400, facets: {} },
      { id: 'e3', reason: '一起熬夜改代码', createdAt: 200, facets: {} },
    ] as never;
    check('⑨ 原因按时间倒序、过滤空原因、limit 生效',
      recentReasons(events, 5).map((e) => e.id).join('|') === 'e1|e3' && recentReasons(events, 1).length === 1,
      recentReasons(events, 5).map((e) => e.id));
    check('⑩ reasonText 只返回人话原因', reasonText({ reason: ' 关系升温 ' } as never) === '关系升温');
    check('⑪ 有没有可解释的记录：空状态 + 空事件 ⇒ false',
      hasExplainableRecord(undefined, []) === false && hasExplainableRecord(state, []) === true,
      hasExplainableRecord(state, []));
  }

  /* ---------------- 准备数据 ---------------- */
  await Dexie.delete(DB);
  await db.open();
  await db.users.put({ id: U, username: '智毅', passwordHash: 'x', passwordSalt: 'y', createdAt: Date.now() });
  await db.users.put({ id: U2, username: '别人', passwordHash: 'x', passwordSalt: 'y', createdAt: Date.now() });
  await characterRepo.create(makeCharacter(C1, '星遥'));
  await characterRepo.create(makeCharacter(C2, '月见'));
  const session: Session = {
    id: SESSION, characterId: C1, userId: U, title: '新对话',
    createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0,
  };
  await sessionRepo.create(session);
  for (let i = 1; i <= 3; i += 1) {
    await messageRepo.create({
      id: `m-${i}`, sessionId: SESSION, role: 'user', content: `第 ${i} 句：今天也想和你聊聊`, createdAt: Date.now() + i, isProactive: false,
    });
  }
  useAuthStore.setState({ userId: U, username: '智毅', apiKey: 'sk-fake', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  const world = await worldRepo.ensureDefaultWorld(U, '智毅');

  /* ---------------- A. 实时写入：等阶升级留下可读原因 ---------------- */
  section('A. 4.x 等阶升级 → 关系变化史（原因可读、幂等、不写数值）');
  {
    const stateBefore = await relationshipRepo.getStateFor(userRef(U), characterRef(C1), world.id);
    // 必须先**真的存在**状态行，`update` 才有意义（Dexie 对不存在的键是 no-op）
    await stateRepo.getOrCreate(C1, U);
    // 好感度 19 → 下一次结算跨过 20（熟悉）
    await db.characterStates.update([C1, U], { affinity: 19 });
    const affinitySnapshotBefore = (await db.characterStates.get([C1, U]))?.affinity ?? 0;
    check('⓪ 夹具成立：好感度已置为 19（临界）', affinitySnapshotBefore === 19, affinitySnapshotBefore);

    queue.push({
      memories: [], threads: [],
      dimensions: dims(9), dominantEmotion: '亲近', userEmotion: '亲近',
      summary: '你们聊得很投机。',
    } as never);
    await useEmotionStore.getState().settle(C1, SESSION, '星遥');

    const relEvents = await relationshipRepo.listEvents(world.id, [characterRef(C1), userRef(U)].sort().join('|'), 20);
    check('① 关系变化史里新增了 1 条记录', relEvents.length === 1, relEvents.map((e) => e.reason));
    check('② 原因就是这次真实的关系变化（可读、非内部字段）',
      relEvents[0]?.reason.includes('熟悉'), relEvents[0]?.reason);
    check('③ 只记录"为什么"，不带任何数值增量（facets 为空）',
      Object.keys(relEvents[0]?.facets ?? {}).length === 0, relEvents[0]?.facets);
    check('④ 关联到为此写下的世界事件（可互相追溯）', !!relEvents[0]?.sourceEventId, relEvents[0]?.sourceEventId);
    check('⑤ 来源标注为 4.x 生命轨迹', relEvents[0]?.sourceType === 'lifeEvent', relEvents[0]?.sourceType);

    const stateAfter = await relationshipRepo.getStateFor(userRef(U), characterRef(C1), world.id);
    check('⑥ **R7 不变量**：世界层的好感度快照没有被这次写入改动',
      (stateAfter?.affinity ?? 0) === (stateBefore?.affinity ?? 0) && (stateAfter?.affinity ?? 0) === 0,
      { before: stateBefore?.affinity, after: stateAfter?.affinity });
    check('⑦ 4.x 好感度照常上涨（唯一来源仍是 CharacterState）',
      ((await db.characterStates.get([C1, U]))?.affinity ?? 0) > affinitySnapshotBefore,
      { before: affinitySnapshotBefore, after: (await db.characterStates.get([C1, U]))?.affinity });

    // 幂等：同一来源重复同步不写第二条
    const lifeEvent = ((await stateRepo.get(C1, U))?.lifeEvents ?? []).find((e) => e.type === 'relationship');
    check('⑧a 4.x 生命轨迹里确实留下了这次关系变化', !!lifeEvent, (await stateRepo.get(C1, U))?.lifeEvents);
    if (lifeEvent) {
      const { syncLifeEventToWorld } = await import('../../src/lib/world/world-writer');
      await syncLifeEventToWorld({ userId: U, characterId: C1, lifeEvent });
      await syncLifeEventToWorld({ userId: U, characterId: C1, lifeEvent });
    }
    check('⑧ 同一来源重复同步 ⇒ 幂等，仍只有 1 条',
      (await relationshipRepo.listEvents(world.id, [characterRef(C1), userRef(U)].sort().join('|'), 20)).length === 1);

    // 普通互动（非升级）不写关系史
    queue.push({
      memories: [], threads: [],
      dimensions: dims(5), dominantEmotion: '平静', userEmotion: '平静',
      summary: '随便聊了几句。',
    } as never);
    await useEmotionStore.getState().settle(C1, SESSION, '星遥');
    check('⑨ 普通互动**不写**关系变化史（关系史不是聊天流水账）',
      (await relationshipRepo.listEvents(world.id, [characterRef(C1), userRef(U)].sort().join('|'), 20)).length === 1,
      (await relationshipRepo.listEvents(world.id, [characterRef(C1), userRef(U)].sort().join('|'), 20)).map((e) => e.reason));
    check('⑩ 世界事件侧同样只有 1 条 relationship（与 2b-0 口径一致）',
      (await worldEventRepo.listByType(world.id, 'relationship', 20)).length === 1);
  }

  /* ---------------- B. 角色 ↔ 角色 + 世界隔离 ---------------- */
  section('B. 角色之间的关系与世界隔离');
  {
    // 角色 ↔ 角色：世界层独有（4.x 没有这张表），带真实原因
    await relationshipRepo.applyEvent({
      userId: U, worldId: world.id, a: characterRef(C1), b: characterRef(C2),
      facets: { trust: 80, conflict: 40 },
      reason: '他们在同一件事上站到了一起',
      sourceType: 'test', idempotencyKey: 'pair-1',
    });
    const pairKey = [characterRef(C1), characterRef(C2)].sort().join('|');
    const pairState = await relationshipRepo.getState(world.id, pairKey);
    check('① 角色 ↔ 角色 状态可读且带分面', (pairState?.trust ?? 0) === 80 && (pairState?.conflict ?? 0) === 40, pairState);
    const allStates = await relationshipRepo.listStatesByWorld(world.id);
    check('② listStatesByWorld 一次读回全部关系（含用户↔角色与角色↔角色）', allStates.length === 2, allStates.map((s) => s.pairKey));
    const allEvents = await relationshipRepo.listEventsByWorld(world.id);
    check('③ listEventsByWorld 一次读回全部变化', allEvents.length === 2, allEvents.map((e) => e.reason));

    // 另一个用户的世界不允许串进来
    const otherWorld = await worldRepo.ensureDefaultWorld(U2, '别人');
    await relationshipRepo.applyEvent({
      userId: U2, worldId: otherWorld.id, a: userRef(U2), b: characterRef('c-other'),
      facets: { trust: 10 }, reason: '别人之间的关系', sourceType: 'test', idempotencyKey: 'x',
    });
    check('④ 跨用户/跨世界隔离：我的关系列表里没有别人的记录',
      (await relationshipRepo.listStatesByWorld(world.id)).length === 2 &&
      (await relationshipRepo.listEventsByWorld(world.id)).length === 2);
  }

  /* ---------------- C. 端到端渲染 ---------------- */
  section('C. 真实渲染：关系网络页');
  {
    useUIStore.getState().setActiveView('relations');
    const host = mount(createElement(MobileRelationsPage));
    await sleep(900);
    const text = host.innerText;
    check('① 出现标题与分区', text.includes('关系网络') && text.includes('你和他们') && text.includes('他们之间'), text.slice(0, 200));
    check('② 显示与星遥的当前关系等阶（熟悉）与人话说明', text.includes('星遥') && text.includes('熟悉'));
    check('③ 「为什么会变成这样」列出真实原因', text.includes('为什么会变成这样') && text.includes('关系进入「熟悉」阶段'), text.slice(0, 400));
    check('④ 原因带相对时间（不是时间戳）', text.includes('今天'), text.slice(0, 400));
    check('⑤ 角色之间的关系显示人话分面（信任高 / 摩擦中，且不显示数值）',
      /(月见 和 星遥|星遥 和 月见)/.test(text) && text.includes('很信任对方') && text.includes('有些摩擦'), text.slice(0, 600));
    check('⑥ 角色之间的关系也有原因', text.includes('他们在同一件事上站到了一起'));
    check('⑦ **页面不出现任何内部数值**',
      !/好感度|trust|affinity|dependency|conflict|familiarity|selected|worldId|importance|\d+\/100/.test(text),
      text.match(/好感度|trust|affinity|dependency|conflict|familiarity|\d+\/100/g));
    check('⑧ 页面不出现任何裸数值字段（分面值不外泄）',
      !text.includes('80') && !text.includes('40'), text.slice(0, 300));
    unmount();

    // 空状态：没有任何记录的账号
    useAuthStore.setState({ userId: U2, username: '别人', apiKey: 'sk-fake', isLoggedIn: true } as never);
    useChatStore.setState({ characters: [], selectedCharacterId: null, currentSessionId: null, messages: [] } as never);
    const emptyHost = mount(createElement(MobileRelationsPage));
    await sleep(700);
    const emptyText = emptyHost.innerText;
    check('⑨ 没有角色时如实说明（不编造关系）', emptyText.includes('你还没有角色'), emptyText.slice(0, 300));
    unmount();

    // 读取失败 ⇒ 错误态 + 重试（不是"没有关系"）
    useAuthStore.setState({ userId: U, username: '智毅', apiKey: 'sk-fake', isLoggedIn: true } as never);
    await useChatStore.getState().loadCharacters();
    const originalList = relationshipRepo.listStatesByWorld;
    (relationshipRepo as unknown as { listStatesByWorld: typeof originalList }).listStatesByWorld = () => {
      throw new Error('fault-injection: 关系读取失败');
    };
    const errHost = mount(createElement(MobileRelationsPage));
    await sleep(700);
    check('⑩ 读取失败给出错误态而不是"没有关系"',
      errHost.innerText.includes('关系读取失败') && !errHost.innerText.includes('你还没有角色'), errHost.innerText.slice(0, 200));
    check('⑪ 提供重试按钮', errHost.innerText.includes('重新读取'));
    (relationshipRepo as unknown as { listStatesByWorld: typeof originalList }).listStatesByWorld = originalList;
    unmount();
  }

  /* ---------------- D. 外壳：入口与覆盖页 ---------------- */
  section('D. 外壳：世界页入口 → 关系网络覆盖页');
  {
    useUIStore.getState().setActiveView('chat');
    useUIStore.getState().setMobileTab('world');
    const worldHost = mount(createElement(MobileWorldPage));
    await sleep(800);
    check('① 世界页有「关系」入口', worldHost.innerText.includes('关系'), worldHost.innerText.slice(0, 300));
    check('② 点击后真的进入关系网络（activeView = relations）',
      clickButtonByText('关系', worldHost) && useUIStore.getState().activeView === 'relations',
      useUIStore.getState().activeView);

    const shellHost = mount(createElement(MobileLayout), 900);
    await sleep(900);
    const navButtons = Array.from(shellHost.querySelectorAll('nav button'));
    check('③ 覆盖页打开时底部导航仍可见（4 个一级入口）',
      MOBILE_TABS.length === 4 &&
      MOBILE_TABS.every((t) => navButtons.some((b) => (b.textContent ?? '').includes(t.label))),
      navButtons.map((b) => b.textContent));
    check('④ 覆盖页打开时高亮「世界」',
      navButtons.some((b) => (b.textContent ?? '').includes('世界') && b.getAttribute('aria-current') === 'page'),
      navButtons.map((b) => `${b.textContent}:${b.getAttribute('aria-current')}`));
    check('⑤ 关系网络真的渲染在覆盖层里', shellHost.innerText.includes('关系网络') && shellHost.innerText.includes('你和他们'));
    check('⑥ 点「消息」可退出覆盖页',
      clickButtonByText('消息', shellHost) && useUIStore.getState().activeView === 'chat',
      useUIStore.getState().activeView);
    unmount();
  }

  /* ---------------- E. 纪律：零网络 / 零 AI ---------------- */
  section('E. 纪律：不联网、不多调 AI、不写数值');
  {
    check('① 全程零网络请求', netCalls === 0, netCalls);
    check('② 关系页渲染不触发任何 AI 调用', aiCalls === 2, aiCalls);
    const states = await relationshipRepo.listStatesByWorld(world.id);
    check('③ 世界层仍然没有任何"好感度数值"被写进来（只有 4.x 那一份）',
      states.every((s) => (s.affinity ?? 0) === 0), states.map((s) => ({ pair: s.pairKey, affinity: s.affinity })));
  }

  /* ---------------- 清理 ---------------- */
  section('清理');
  unmount();
  window.fetch = realFetch;
  await worldRepo.clearForUser(U);
  await worldRepo.clearForUser(U2);
  check('清理后世界层为空', (await worldEventRepo.countByWorld(world.id)) === 0 && (await db.relationshipStates.count()) === 0);
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
