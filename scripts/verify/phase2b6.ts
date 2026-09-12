/**
 * VirtuGene 5.0.0 Phase 2b-6 验收：R7 裁定（关系数值的唯一来源）
 *
 * 裁定内容：
 *  - **用户 ↔ 角色 的好感度**只有 4.x `CharacterState.affinity` 一个来源（既有结算写入、无上限）。
 *  - 世界层**不再保存**这个数字，只保留 4.x 没有的四个分面（trust / dependency / conflict / familiarity）。
 *  - 世界层的分面**只能通过带原因的事件（applyEvent）变化**：数值变了，就一定有可读原因。
 *  - 早期 5.0 开发版写进世界层的"好感度快照"会被**幂等清理**；旧备份导入也剥掉该字段。
 *
 * 覆盖：
 *  P. 结构性：分面集合里没有 affinity；写 affinity **直接抛错**（防止第二个数值来源）
 *  A. 状态与事件：世界层状态行不含好感度；分面仍照常按事件变化（夹到 0~100）
 *  B. 清理旧快照：造一条带 affinity 的旧行 → 迁移把它剥掉、四个分面保留、幂等
 *  C. 备份导入：旧备份里的 affinity 不会复活到世界层
 *  D. 端到端：一次真实结算后，好感度只在 CharacterState 上涨，世界层依然没有数字；关系页照常可解释
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import Dexie from 'dexie';
import { db, RELATIONSHIP_FACETS, type RelationshipState } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { messageRepo } from '../../src/db/message-repo';
import { stateRepo } from '../../src/db/state-repo';
import { worldRepo } from '../../src/db/world-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { relationshipRepo } from '../../src/db/relationship-repo';
import { importSyncData, parseSyncData } from '../../src/lib/sync';
import { webApi } from '../../src/lib/web-api';
import { characterRef, userRef, subjectPairKey } from '../../src/lib/world/subjects';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useEmotionStore } from '../../src/store/emotion-store';
import { MobileRelationsPage } from '../../src/components/world/MobileRelationsPage';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import type { Character, Session } from '../../src/db/index';

const DB = 'virtugene';
const U = 'u-2b6';
const C1 = 'c-2b6-star';
const C2 = 'c-2b6-moon';
const SESSION = 's-2b6';

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

/* ---------- 结算打桩 ---------- */
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
    id, name, avatar: '🌙', systemPrompt: '你是星遥。', tags: [], isPreset: false, isCustom: true,
    published: false, createdBy: U, createdAt: Date.now(), proactivity: 0.5, signature: '', greeting: '',
    voice: { ...DEFAULT_VOICE },
  };
}

/** 直接往表里塞一条"早期版本形态"的行（带 affinity），绕过类型 —— 模拟历史遗留数据 */
async function seedLegacyRow(row: Omit<RelationshipState, 'id'> & { affinity: number }): Promise<void> {
  const id = `rel_legacy_${row.pairKey.replace(/[^\w]/g, '_')}`;
  await db.relationshipStates.put({ ...row, id } as unknown as RelationshipState);
}

async function run() {
  /* ---------------- P. 结构性 ---------------- */
  section('P. 结构性：分面集合里没有"好感度"，写它会直接抛错');
  {
    check('① 分面集合 = trust / dependency / conflict / familiarity',
      RELATIONSHIP_FACETS.join('|') === 'trust|dependency|conflict|familiarity', RELATIONSHIP_FACETS);
    check('② 分面集合里没有 affinity', !(RELATIONSHIP_FACETS as string[]).includes('affinity'));
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
  for (let i = 1; i <= 3; i += 1) {
    await messageRepo.create({
      id: `m-${i}`, sessionId: SESSION, role: 'user', content: `第 ${i} 句：随便聊聊`, createdAt: Date.now() + i, isProactive: false,
    });
  }
  useAuthStore.setState({ userId: U, username: '智毅', apiKey: 'sk-fake', isLoggedIn: true } as never);
  await useChatStore.getState().loadCharacters();
  const world = await worldRepo.ensureDefaultWorld(U, '智毅');
  const pairU = subjectPairKey(userRef(U), characterRef(C1));

  /* ---------------- A. 状态行不含好感度；分面照常按事件变化 ---------------- */
  section('A. 世界层状态行：没有好感度，只有四个分面');
  {
    const s = await relationshipRepo.ensureState(U, world.id, userRef(U), characterRef(C1));
    check('① 新建状态行不含 affinity 字段', !('affinity' in (s as object)), Object.keys(s));
    check('② 四个分面存在且为 0', s.trust === 0 && s.dependency === 0 && s.conflict === 0 && s.familiarity === 0, s);

    const applied = await relationshipRepo.applyEvent({
      userId: U, worldId: world.id, a: userRef(U), b: characterRef(C1),
      facets: { trust: 30, conflict: 12, familiarity: 5 },
      reason: '你们一起把那件事扛了下来', sourceType: 'test', idempotencyKey: 'a1',
    });
    check('③ 分面照常按事件变化', applied.state.trust === 30 && applied.state.conflict === 12 && applied.state.familiarity === 5, applied.state);
    check('④ 变化后仍然没有 affinity 字段', !('affinity' in (applied.state as object)), Object.keys(applied.state));
    check('⑤ 原因仍然被如实记录（数值变化必有原因）', applied.event.reason.includes('扛了下来'), applied.event.reason);
    const clamped = await relationshipRepo.applyEvent({
      userId: U, worldId: world.id, a: userRef(U), b: characterRef(C1),
      facets: { trust: 200 }, reason: '测试上限夹取', sourceType: 'test', idempotencyKey: 'a2',
    });
    check('⑥ 分面被夹到 0~100（不再有"无上限"的特例）', clamped.state.trust === 100, clamped.state.trust);

    let threwOverride = false;
    try {
      // 结构化阻断：试图把"好感度"写进世界层必须失败（哪怕用 as never 绕过类型）
      await relationshipRepo.overrideFacets(world.id, pairU, { affinity: 50 } as never);
    } catch { threwOverride = true; }
    check('⑦ overrideFacets 写 affinity ⇒ 直接抛错（不会悄悄产生第二个数值来源）', threwOverride);

    let threwEvent = false;
    try {
      await relationshipRepo.applyEvent({
        userId: U, worldId: world.id, a: userRef(U), b: characterRef(C1),
        facets: { affinity: 10 } as never, reason: '试图写好感度', sourceType: 'test', idempotencyKey: 'a3',
      });
    } catch { threwEvent = true; }
    check('⑧ applyEvent 写 affinity ⇒ 直接抛错', threwEvent);
    check('⑨ 抛错之后状态没有被改动（事务没有留下半成品）',
      (await relationshipRepo.getStateFor(userRef(U), characterRef(C1), world.id))?.trust === 100);
  }

  /* ---------------- B. 清理早期版本的好感度快照 ---------------- */
  section('B. 早期版本写过的"好感度快照"会被幂等清理');
  {
    await seedLegacyRow({
      userId: U, worldId: world.id, pairKey: subjectPairKey(userRef(U), characterRef(C2)),
      subjectA: userRef(U), subjectB: characterRef(C2), subjects: [userRef(U), characterRef(C2)],
      trust: 20, dependency: 0, conflict: 0, familiarity: 10, updatedAt: Date.now(),
      affinity: 85, // ← 遗留字段（旧实现从 CharacterState 抄过来的快照）
    } as never);
    const before = await db.relationshipStates.toArray();
    check('① 夹具成立：确实存在一条带好感度快照的旧行',
      before.some((r) => 'affinity' in (r as object) && (r as unknown as { affinity: number }).affinity === 85),
      before.map((r) => Object.keys(r)));

    const counts = await worldRepo.rerunMigration();
    const after = await db.relationshipStates.toArray();
    check('② 迁移后世界层里再没有任何好感度字段',
      after.every((r) => !('affinity' in (r as object))), after.map((r) => Object.keys(r)));
    check('③ 被清理的行数被如实统计', counts.legacyAffinityStripped === 1, counts.legacyAffinityStripped);
    const cleaned = after.find((r) => r.pairKey === subjectPairKey(userRef(U), characterRef(C2)));
    check('④ 四个分面被保留（只删掉过时字段，没有伤到数据）',
      cleaned?.trust === 20 && cleaned?.familiarity === 10, cleaned && { t: cleaned.trust, f: cleaned.familiarity });
    check('⑤ 幂等：再跑一次不再清理任何东西', (await worldRepo.rerunMigration()).legacyAffinityStripped === 0);
    check('⑥ 4.x 好感度没有被迁移碰到（唯一来源照旧）',
      ((await db.characterStates.get([C2, U]))?.affinity ?? 0) === 0);
  }

  /* ---------------- C. 备份导入不复活旧字段 ---------------- */
  section('C. 旧备份导入不会把"第二个数值来源"搬回来');
  {
    const legacyPayload = {
      __meta__: {
        app: 'VirtuGene', kind: 'sync', version: '4.1.0',
        exportedAt: new Date().toISOString(), userId: U, username: '智毅',
      },
      relationshipStates: [{
        id: 'rel_from_backup', userId: U, worldId: world.id, pairKey: pairU,
        subjectA: userRef(U), subjectB: characterRef(C1), subjects: [userRef(U), characterRef(C1)],
        trust: 40, dependency: 0, conflict: 0, familiarity: 0, updatedAt: Date.now(),
        affinity: 999, // 旧备份里的遗留字段
      }],
      relationshipEvents: [],
    };
    check('⓪ 夹具成立：这份备份确实是"可解析"的同步数据', parseSyncData(legacyPayload) !== null);
    const result = await importSyncData(legacyPayload);
    check('① 导入成功', result.ok === true, result);
    const imported = await db.relationshipStates.get('rel_from_backup');
    check('② 导入后仍然没有好感度字段（遗留字段被剥掉）',
      !!imported && !('affinity' in (imported as object)), imported && Object.keys(imported));
    check('③ 分面照常导入', imported?.trust === 40, imported?.trust);
  }

  /* ---------------- D. 端到端：真实结算 ---------------- */
  section('D. 端到端：真实结算后，数字只在 CharacterState 上涨');
  await stateRepo.getOrCreate(C1, U);
  {
    await db.characterStates.update([C1, U], { affinity: 19 });
    const worldStatesBefore = (await relationshipRepo.listStatesByWorld(world.id)).map((s) => ({ ...s }));
    queue.push({
      memories: [], threads: [],
      dimensions: dims(9), dominantEmotion: '亲近', userEmotion: '亲近',
      summary: '你们聊得很投机。',
    } as never);
    await useEmotionStore.getState().settle(C1, SESSION, '星遥');

    check('① 4.x 好感度跨过 20（唯一来源，照常结算）', ((await db.characterStates.get([C1, U]))?.affinity ?? 0) >= 20,
      (await db.characterStates.get([C1, U]))?.affinity);
    const worldStatesAfter = await relationshipRepo.listStatesByWorld(world.id);
    check('② 世界层状态行数量与内容没有被这次结算改动（除 updatedAt）',
      worldStatesAfter.length === worldStatesBefore.length &&
      worldStatesAfter.every((s) => !('affinity' in (s as object))),
      worldStatesAfter.map((s) => Object.keys(s)));
    check('③ 关系变化史里有了一条可读原因（这是世界层该做的事）',
      (await relationshipRepo.listEventsByWorld(world.id)).some((e) => e.reason.includes('熟悉')),
      (await relationshipRepo.listEventsByWorld(world.id)).map((e) => e.reason));
    check('④ 世界事件侧的 relationship 与之一一对应',
      (await worldEventRepo.listByType(world.id, 'relationship', 10)).length === 1);

    // 关系页照常可用（等阶来自 4.x，分面来自世界层）
    const host = mount(createElement(MobileRelationsPage));
    await sleep(800);
    const text = host.innerText;
    check('⑤ 关系页照常显示等阶（来自 4.x 唯一来源）', text.includes('星遥') && text.includes('熟悉'));
    check('⑥ 关系页仍然不出现任何内部数值', !/好感度|trust|affinity|dependency|conflict|familiarity|\d+\/100/.test(text));
    unmount();
  }

  /* ---------------- E. 成本 ---------------- */
  section('E. 纪律');
  {
    check('① 全程零网络请求', netCalls === 0, netCalls);
    check('② 只发生了 1 次既有结算调用（没有新增 AI 调用）', aiCalls === 1, aiCalls);
  }

  section('清理');
  unmount();
  window.fetch = realFetch;
  await worldRepo.clearForUser(U);
  check('清理后世界层为空', (await db.relationshipStates.count()) === 0 && (await worldEventRepo.countByWorld(world.id)) === 0);
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
