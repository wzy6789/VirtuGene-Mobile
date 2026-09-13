/**
 * VirtuGene 5.0.0 Living World 验收 D：世界空间 UI（§5–§12 / §37 / §40 / §66–§70 / §78）
 *
 * 这一套走的是**真实 UI 路径**：挂载真组件、在真输入框里打字、按 Enter、
 * 由假 LLM 端点（`window.fetch` 上的 chat/completions）提供响应。
 * 因此它证明的不是"函数写对了"，而是"用户真的能这样用"。
 */
import { createElement } from 'react';
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { sharedMemoryRepo } from '../../src/db/shared-memory-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { ensureCanvasScene, loadCanvas, loadEarlier, latestSuggestions, latestTrace, saveAsStory } from '../../src/lib/world/world-canvas';
import { groupStream } from '../../src/components/world/WorldStream';
import { WorldCanvas } from '../../src/components/world/WorldCanvas';
import { MobileLayout } from '../../src/components/layout/MobileLayout';
import { useUIStore } from '../../src/store/ui-store';
import { useChatStore } from '../../src/store/chat-store';
import { installFakeLlm, createReporter, seedWorld, sleep, mount, unmount, typeInto, pressEnter, fakeCharacter } from './world-harness';
import type { WorldSceneEntry } from '../../src/db/index';

const U = 'u-worldD';
const C1 = 'cD-moon';
const C2 = 'cD-star';

const rep = createReporter();
const { check, section } = rep;
const llm = installFakeLlm();
const realFetch = llm.realFetch;
const chars = () => [fakeCharacter(C1, '古月娜', U), fakeCharacter(C2, '星遥', U)];

const entry = (kind: WorldSceneEntry['kind'], content: string, speakerId?: string): WorldSceneEntry => ({
  id: `${kind}-${Math.random()}`, sceneId: 's', index: 0, kind, act: 1, content,
  ...(speakerId ? { speakerId } : {}), createdAt: 0,
});

async function run() {
  const { worldId } = await seedWorld({
    userId: U,
    characters: [{ id: C1, name: '古月娜' }, { id: C2, name: '星遥' }],
  });
  // 世界交互"不碰聊天表"的基准：先让聊天 store 完成自己的初始化（它可能补建默认会话），
  // 再记录基准——否则测到的会是聊天 store 的副作用，而不是世界层的越界写入。
  await useChatStore.getState().loadCharacters();
  const sessionsBefore = await db.sessions.count();
  const messagesBefore = await db.messages.count();

  /* ================= P. 世界流的视觉分组（§69） ================= */
  section('P. 世界流：连续同角色合成一个视觉组（不是三个头像）');
  {
    const groups = groupStream([
      entry('narration', '夜已经很深了。'),
      entry('dialogue', '你今天回来得比平时晚。', C1),
      entry('action', '她把窗户推开了一点。', C1),
      entry('dialogue', '外面风大。', C1),
      entry('user_input', '我坐到她旁边。'),
      entry('dialogue', '……嗯。', C2),
      entry('system', '这一刻被世界记住了。'),
      entry('suggestion', '告诉她真相'),
    ]);
    check('① 旁白 / 用户行动 / 角色组 / 系统痕迹各归其位',
      groups.map((g) => g.kind).join('|') === 'narration|character|user|character|system',
      groups.map((g) => g.kind));
    const characterGroup = groups.find((g) => g.kind === 'character');
    check('② 同一角色的「对白 + 动作 + 对白」只占一个视觉组',
      characterGroup?.kind === 'character' && characterGroup.entries.length === 3,
      characterGroup?.kind === 'character' ? characterGroup.entries.length : null);
    check('③ 灵感建议不占正文（渲染在输入框上方）',
      !groups.some((g) => g.kind === 'system' && g.entry.kind === 'suggestion'));
  }

  /* ================= Q. 只渲染最近 60 条 + 分页（§68） ================= */
  section('Q. 长片段：默认只渲染最近 60 条，更早的按需加载');
  const scene = await ensureCanvasScene({ userId: U, worldId, characters: chars() });
  {
    for (let i = 0; i < 95; i += 1) {
      await worldSceneRepo.appendEntry(scene.id, {
        kind: i % 5 === 3 ? 'dialogue' : 'narration',
        content: `第 ${i} 条世界流内容`,
        ...(i % 5 === 3 ? { speakerId: C1 } : {}),
      });
    }
    const view = await loadCanvas(scene.id);
    check('① 默认只取最近 60 条', view!.entries.length === 60, view!.entries.length);
    check('② 总数如实回报，并告诉 UI"还有更早的"', view!.total === 95 && view!.hasMore === true, { total: view!.total, hasMore: view!.hasMore });
    const older = await loadEarlier(scene.id, view!.entries[0].index);
    check('③ 继续加载更早内容（一次 60 条，不一次塞满 DOM）',
      older.length === 35 && older[older.length - 1].index < view!.entries[0].index, older.length);
  }

  /* ================= R. 世界主页（§5 / §6 / §7 / §80） ================= */
  section('R. 世界主页：一个「此刻」，几个克制入口，没有施工感');
  {
    await worldSceneRepo.appendEntry(scene.id, { kind: 'narration', content: '窗外还有海浪。' });
    useUIStore.setState({ activeView: 'chat', mobileTab: 'world', canvasSceneId: null, chatFromList: false, chatFromCharacters: false });
    const host = mount(createElement(MobileLayout), 800);
    await sleep(500);
    const text = host.innerText;
    check('① 标题是「我的世界」+ 一句自然描述', text.includes('我的世界') && text.includes('共同生活'), text.slice(0, 160));
    check('② 视觉核心是「此刻」', text.includes('此刻'));
    check('③ 主导航仍然是 消息｜世界｜角色｜我的',
      ['消息', '世界', '角色', '我的'].every((t) => text.includes(t)), text.slice(-120));
    check('④ 主 UI 里没有「世界剧场」这种一级入口（§7/§77）', !text.includes('世界剧场'), text.slice(0, 400));
    check('⑤ 主 UI 里没有「故事模式」这种要求用户先选模式的词（§4）', !text.includes('故事模式'));
    check('⑥ 入口是关系 / 记忆 / 时间线 / 设定 / 我的生活',
      ['关系', '记忆', '时间线', '设定', '我的生活'].every((t) => text.includes(t)));
    check('⑦ 底部一级导航在世界主页可见',
      !(host.querySelector('.mobile-bottom-nav')?.className ?? '').includes('hidden'));

    // 灵感区
    check('⑧ 有"不知道做什么"的灵感入口（§79：模板降级为一句自然语言）',
      text.includes('不知道做什么') && text.includes('今晚我们去海边'), text.slice(-300));
    unmount();
  }

  /* ================= S. 世界空间：真实 UI 路径（§9–§12 / §57 / §67） ================= */
  section('S. 世界空间：进入以后直接用自然语言交互');
  {
    useUIStore.setState({ activeView: 'canvas', mobileTab: 'world', canvasSceneId: scene.id, chatFromList: false, chatFromCharacters: false });
    const host = mount(createElement(MobileLayout), 700);
    await sleep(600);
    const text = host.innerText;
    check('① 进入世界空间后**底部一级导航隐藏**（沉浸式，§67）',
      (host.querySelector('.mobile-bottom-nav')?.className ?? '').includes('hidden'),
      host.querySelector('.mobile-bottom-nav')?.className);
    check('② 顶部只显示地点 · 时间与在场的人（点击才展开）',
      text.includes('古月娜') && text.includes('星遥') && text.includes('状态'), text.slice(0, 160));
    check('③ 输入框 placeholder 明确"不只是聊天"（§81）',
      (host.querySelector('textarea')?.getAttribute('placeholder') ?? '').includes('改变这个世界'),
      host.querySelector('textarea')?.getAttribute('placeholder'));
    check('④ 世界里不显示数据库类型（Scene / Act / WorldEvent / Settlement / WorldAction）',
      !['Scene', 'Act', 'WorldEvent', 'Settlement', 'WorldAction', '幕次', '张力'].some((w) => text.includes(w)), text.slice(0, 300));
    check('⑤ 视口里没有出现幕次标记与内部数值',
      !/\btension\b/.test(text) && !text.includes('当前张力'));

    // 真实一轮：打字 + Enter
    const textarea = host.querySelector('textarea')!;
    typeInto(textarea, '今晚我们去海边。');
    await sleep(60);
    llm.httpQueue.push(
      JSON.stringify({ intent: 'change_location', locationChange: '海边' }),
      JSON.stringify({ narration: '海浪声近了。', speakers: [{ character: '古月娜', intent: '看着海', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false }),
      JSON.stringify({ dialogue: '这里的风比城里凉。' }),
      // 换地点属于"持久的世界变化"，因此这一轮还会结算一次（§28）
      JSON.stringify({ summary: '你们去了海边。', worldEvents: [], sharedMemories: [], relationshipChanges: [], continuityChanges: [], worldFactChanges: [], characterStateChanges: [] }),
    );
    const httpBefore = llm.httpCalls();
    pressEnter(textarea);
    await sleep(1400);
    const after = host.innerText;
    check('⑥ 用户行动立刻可见（不套聊天气泡）', after.includes('今晚我们去海边'), after.slice(-400));
    check('⑦ 旁白与角色对白分别渲染（旁白无气泡，对白带名字）',
      after.includes('海浪声近了。') && after.includes('古月娜') && after.includes('这里的风比城里凉。'));
    check('⑧ 这一轮恰好 4 次调用（理解 + 导演 + 角色 + 一次结算）', llm.httpCalls() - httpBefore === 4, llm.httpCalls() - httpBefore);
    check('⑨ 地点变化真的生效（顶部状态更新）', after.includes('海边'), after.slice(0, 120));
    check('⑩ 变更后的地点与"世界记住了"的系统痕迹都在世界流里', after.includes('地点：海边'));

    // 灵感建议 → chips 形式
    llm.httpQueue.push(
      JSON.stringify({ intent: 'talk' }),
      JSON.stringify({
        narration: '', speakers: [{ character: '星遥', intent: '给你一个岔路口', mode: 'dialogue' }],
        sequential: false, worldChanges: [], shouldSettle: false,
        suggestions: ['告诉她真相', '先不说'],
      }),
      JSON.stringify({ dialogue: '那件事……你打算怎么办。' }),
    );
    const textarea2 = host.querySelector('textarea')!;
    typeInto(textarea2, '你觉得我该告诉她吗。');
    await sleep(40);
    pressEnter(textarea2);
    await sleep(1200);
    const withSuggestions = host.innerText;
    check('⑪ 灵感建议渲染成输入框上方的 chips，而不是"请选择 A/B/C"（§37）',
      withSuggestions.includes('告诉她真相') && withSuggestions.includes('先不说') && !withSuggestions.includes('请选择'),
      withSuggestions.slice(-300));
    const suggestionChip = Array.from(host.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === '告诉她真相');
    check('⑫ 建议可以点击', !!suggestionChip);

    llm.httpQueue.push(
      JSON.stringify({ intent: 'talk' }),
      JSON.stringify({ narration: '', speakers: [{ character: '星遥', intent: '回应', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false }),
      JSON.stringify({ dialogue: '嗯，你说吧。' }),
    );
    suggestionChip?.click();
    await sleep(1200);
    check('⑬ 点了建议 = 用户自己说了那句话（不是替用户做决定）',
      host.innerText.includes('告诉她真相'));
    check('⑭ 发送后建议消失（不会长期占屏，§38）',
      !Array.from(host.querySelectorAll('button')).some((b) => (b.textContent ?? '').trim() === '先不说'));

    // 世界控制面板
    const controlButton = host.querySelector('.vg-composer-control') as HTMLElement | null;
    controlButton?.click();
    await sleep(80);
    const sheet = host.innerText;
    check('⑮ 世界控制面板里每一项都有对应的一句自然语言（§39）',
      sheet.includes('让他们自己聊一会儿') && sheet.includes('跳过时间') && sheet.includes('撤销上一轮') && sheet.includes('保存为故事'),
      sheet.slice(-400));
    check('⑯ 面板明说"这些也可以用一句话做到"', sheet.includes('一句话'));
    unmount();
  }

  /* ================= T. 滚动行为（§70） ================= */
  section('T. 滚动：正在向上阅读时绝不被强拉到底部');
  {
    useUIStore.setState({ activeView: 'canvas', mobileTab: 'world', canvasSceneId: scene.id });
    const host = mount(createElement(MobileLayout), 380);
    await sleep(600);
    const scroller = host.querySelector('.vg-canvas-scroll') as HTMLElement;
    check('① 世界流容器可滚动且内容超出一屏（否则这条测试没有意义）',
      scroller.scrollHeight > scroller.clientHeight + 60,
      { sh: scroller.scrollHeight, ch: scroller.clientHeight });

    /**
     * 真实时序：用户**先**往下发了一句话，然后在等回应的时候往上翻；
     * 回应这才姗姗来迟。此时绝不能被拉回底部（§70）。
     * 假 LLM 默认瞬间返回，所以这里必须人为加延迟，否则测不到这段时序。
     */
    llm.setDelay(500);
    llm.httpQueue.push(
      JSON.stringify({ intent: 'talk' }),
      JSON.stringify({ narration: '', speakers: [{ character: '古月娜', intent: 'x', mode: 'dialogue' }], sequential: false, worldChanges: [], shouldSettle: false }),
      JSON.stringify({ dialogue: '你还在看上面吗？' }),
    );
    typeInto(host.querySelector('textarea')!, '嗯，我在翻以前的事。');
    await sleep(40);
    pressEnter(host.querySelector('textarea')!);
    await sleep(250);              // 这一轮已经在跑，但回应还没回来
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    await sleep(60);
    await sleep(2200);             // 等回应落库
    check('② 用户停在上面阅读时，滚动位置**没有**被强行拉到底部',
      scroller.scrollTop < 60, scroller.scrollTop);
    const newButton = Array.from(host.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('新内容'));
    check('③ 出现「↓ 新内容」按钮（让用户自己决定什么时候下去）', !!newButton, host.innerText.slice(-200));
    newButton?.click();
    await sleep(900);   // 平滑滚动需要时间跑完
    check('④ 点击后回到最新内容，提示消失',
      scroller.scrollTop > scroller.scrollHeight - scroller.clientHeight - 80 &&
      !Array.from(host.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes('新内容')),
      { top: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight });
    llm.setDelay(0);
    unmount();
  }

  /* ================= U. 保存为故事（§78） ================= */
  section('U. 保存为故事：故事是世界经历的结果，不是前提');
  {
    const callsBefore = llm.httpCalls() + llm.calls();
    const saved = await saveAsStory({ userId: U, worldId, sceneId: scene.id, title: '第一次一起看海' });
    check('① 保存为故事 0 次调用（用户按下就该成功）',
      llm.httpCalls() + llm.calls() === callsBefore, llm.httpCalls() + llm.calls() - callsBefore);
    check('② 它在世界层留下一条"你们的故事"与一段共同记忆',
      !!saved &&
      (await worldEventRepo.getBySource(U, worldId, 'story', scene.id))?.title === '第一次一起看海' &&
      (await sharedMemoryRepo.listByWorld(worldId, 50)).some((m) => m.title === '第一次一起看海'));
    check('③ 参与者获得了认知（他们"记得"这件事）',
      (await db.characterKnowledge.where('worldId').equals(worldId).toArray()).length >= 2);
  }

  /* ================= V. 灵感与痕迹的读取（§11.5 / §37） ================= */
  section('V. 世界痕迹与建议的读取');
  {
    await worldSceneRepo.appendEntry(scene.id, { kind: 'suggestion', content: 'a', meta: { options: ['A', 'B'] } });
    const view = await loadCanvas(scene.id);
    check('① 最新一条建议能被读出来（供输入框上方渲染）',
      latestSuggestions(view!.entries)?.options.join('|') === 'A|B', latestSuggestions(view!.entries));
    await worldSceneRepo.appendEntry(scene.id, { kind: 'system', content: '这一刻被世界记住了。', meta: { trace: true } });
    const view2 = await loadCanvas(scene.id);
    check('② 世界痕迹能被读出来（点开才看具体内容）',
      latestTrace(view2!.entries)?.content === '这一刻被世界记住了。', latestTrace(view2!.entries));
  }

  /* ================= W. 纪律 ================= */
  section('W. 纪律');
  {
    check('① 全程零计划外网络请求（只有假 LLM 端点被命中）', llm.netCalls() === 0, llm.netCalls());
    check('② 世界内容不进聊天表（会话与消息在整段世界交互前后**完全没有变化**）',
      sessionsBefore === (await db.sessions.count()) && messagesBefore === (await db.messages.count()),
      { sessions: [sessionsBefore, await db.sessions.count()], messages: [messagesBefore, await db.messages.count()] });
    const worldPageCount = await db.worldSceneEntries.where('sceneId').equals(scene.id).count();
    check('③ 世界流只增不减地落在 worldSceneEntries', worldPageCount > 90, worldPageCount);
  }

  section('清理');
  unmount();
  await worldRepo.clearForUser(U);
  check('清理后世界层为空', (await db.worldScenes.count()) === 0 && (await db.worldFacts.count()) === 0);
}

run()
  .catch((err) => {
    rep.check(`抛出异常 :: ${String(err && (err as Error).stack ? (err as Error).stack : err)}`, false);
  })
  .finally(() => {
    unmount();
    llm.restore();
    rep.finish(realFetch);
  });
