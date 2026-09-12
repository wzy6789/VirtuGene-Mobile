import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { continuityRepo, KIND_LABEL } from '../../db/continuity-repo';
import type { Character, ContinuityThread, SharedMemory, WorldEvent, WorldEventType } from '../../db/index';
import { SpaceHeading } from '../ui/SpaceHeading';
import { ContinuityThreadsModal } from '../character/ContinuityThreadsModal';
import { pickWaitingStory, relativeDay, THREAD_TEASER } from '../../lib/world/world-picks';

/**
 * 世界首页（5.0 Living World 一级入口）
 *
 * 职责（2a 建立外壳；2b-0 起真实数据已接通）：
 * - 「世界」一级入口 + **基于真实数据的状态**（空 / 有内容 / 读取失败三态）
 * - 不调用任何 LLM、不改任何 Prompt、不涉及世界剧场 AI
 * - 不堆功能按钮（§6：不能做成工具型 Dashboard）
 *
 * 数据来源（Phase 2b-0 起已接通）：约定/计划等未完成事项、关系等阶升级会由既有结算流程
 * 自动派生为世界事件（见 lib/world/world-writer.ts）；普通闲聊与「记住」刻意不写。
 * Phase 2b-2 起多了一条**用户显式**的来源：在聊天里长按「收藏为共同记忆」，
 * 写入 sharedMemories + shared_memory 世界事件 + 该角色认知。
 * 因此空状态文案只列**真的会写入**的来源，不承诺尚未实现的行为。
 */

/** 事件类型的"人话"说法（只讲发生了什么，不暴露任何内部数值/字段名） */
const EVENT_TYPE_LABEL: Record<WorldEventType, string> = {
  reality: '你的生活',
  interaction: '一次共同经历',
  shared_memory: '共同记忆',
  stage: '世界剧场',
  relationship: '你们之间的关系',
  continuity: '未完成的事',
  knowledge: '认知',
  life_trace: '生命痕迹',
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 进入聊天：与「消息」页同一套推入语义（返回回到会话列表） */
function goTalkTo(characterId: string): void {
  void useChatStore.getState().selectCharacter(characterId);
  const ui = useUIStore.getState();
  ui.setChatFromCharacters(false);
  ui.setChatFromList(true);
  ui.setMobileTab('chat');
}

export function MobileWorldPage() {
  const userId = useAuthStore((s) => s.userId);
  const username = useAuthStore((s) => s.username);
  const characters = useChatStore((s) => s.characters);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof worldRepo.stats>>>(null);
  const [recent, setRecent] = useState<WorldEvent[]>([]);
  const [unresolved, setUnresolved] = useState<WorldEvent[]>([]);
  const [memories, setMemories] = useState<SharedMemory[]>([]);
  const [openThreads, setOpenThreads] = useState<ContinuityThread[]>([]);
  /** 打开某个角色的「还没做完的事」面板（复用 4.x 现有弹窗，零新写 UI） */
  const [threadPanelCharacter, setThreadPanelCharacter] = useState<Character | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!userId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(false);
      try {
        // 默认世界（确定性 id，幂等）：世界页是所有世界层功能的入口
        const world = await worldRepo.ensureDefaultWorld(userId, username ?? undefined);
        const [nextStats, timeline, open, mems, threads] = await Promise.all([
          worldRepo.stats(world.id),
          // 多取一些：渲染前要过滤掉"还没结束的未完成事项"，只取 3 条会被它们占满
          worldEventRepo.listTimeline(world.id, { limit: 10 }),
          worldEventRepo.listUnresolved(world.id, 5),
          sharedMemoryRepo.listByWorld(world.id, 3),
          continuityRepo.getOpenByUser(userId),
        ]);
        if (!alive) return;
        setStats(nextStats);
        setRecent(timeline);
        setUnresolved(open);
        setMemories(mems);
        setOpenThreads(threads);
      } catch {
        // 读取失败 ≠ 空世界：必须让用户看到"没读到"，而不是误以为数据不存在
        if (alive) {
          setStats(null);
          setRecent([]);
          setUnresolved([]);
          setMemories([]);
          setOpenThreads([]);
          setLoadError(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    // 角色数用于弱化统计；已有页面加载过就复用内存里的列表
    if (characters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; };
  }, [userId, username, characters.length, reloadToken]);

  const myCharacters = useMemo(() => characters.filter((c) => c.createdBy === userId), [characters, userId]);
  const nameOf = useMemo(() => {
    const map = new Map(characters.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? 'TA';
  }, [characters]);
  const characterOf = useMemo(() => {
    const map = new Map(characters.map((c) => [c.id, c]));
    return (id: string) => map.get(id) ?? null;
  }, [characters]);
  /** 「正在等待你的故事」：一条最该被看见的（纯本地规则，见 lib/world/world-picks） */
  const waiting = useMemo(() => pickWaitingStory(openThreads), [openThreads]);
  /**
   * 「未完成的故事」区块只列**其余**线索：
   * - 大卡已经展示过的那条不再重复
   * - 依据"剩余条数"决定是否渲染整块（只有 1 条线索时整块隐藏，
   *   否则会出现"1 件 + 空列表"的自相矛盾）
   */
  const restThreads = useMemo(
    () => (waiting ? openThreads.filter((t) => t.id !== waiting.id) : openThreads).slice(0, 4),
    [openThreads, waiting],
  );

  const eventCount = stats?.eventCount ?? 0;
  const memoryCount = stats?.sharedMemoryCount ?? 0;
  /**
   * 「最近发生」只讲**已经发生的事**：
   * - 还没结束的未完成事项已经由大卡与「未完成的故事」区块承担，不再在这里重复一遍
   *   （否则同一件事会在同一屏出现两次）；已完成的用"未完成的事"标签照常出现在时间线里。
   * - 已经在「共同记忆」区块里展示过的记忆，同理不在时间线里重复；**没被展示到的**
   *   （超出区块条数的更早记忆）仍然照常出现在时间线里，避免"看不见就消失"。
   */
  const recentHappenings = useMemo(() => {
    const shownMemoryIds = new Set(memories.map((m) => m.id));
    return recent
      .filter((e) => !(e.type === 'continuity' && !e.resolved))
      .filter((e) => !(e.type === 'shared_memory' && e.memoryIds.some((id) => shownMemoryIds.has(id))))
      .slice(0, 3);
  }, [recent, memories]);
  const hasEvents = recentHappenings.length > 0 || eventCount > 0;
  const hasMemories = memories.length > 0 || memoryCount > 0;
  const hasThreads = openThreads.length > 0;
  const hasAnything = hasEvents || hasMemories || hasThreads;

  const openDiary = () => useUIStore.getState().setActiveView('diary');

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      {/* 顶部问候：世界首页的第一句话 */}
      <div className="pt-5">
        <SpaceHeading
          eyebrow="living world"
          title={`${greeting()}，${username || '你'}`}
          detail="欢迎回到你的世界。"
        />
      </div>

      {/* 弱化统计（不是 KPI：小字、灰、无卡框） */}
      {!loading && !loadError && (
        <p className="mt-2 text-[11px] text-gray-500">
          {myCharacters.length} 个角色
          <span className="mx-1.5 text-gray-600">·</span>
          第 {stats?.daysSinceCreated ?? 1} 天
          <span className="mx-1.5 text-gray-600">·</span>
          {memoryCount} 段共同记忆
        </p>
      )}

      {loading ? (
        <div className="mt-10 text-center text-sm text-gray-500" role="status">正在读取你的世界…</div>
      ) : loadError ? (
        /* ---------- 读取失败：与"空世界"严格区分 ---------- */
        <section className="mt-5 rounded-[26px] border border-rose-400/25 bg-rose-500/[0.06] px-5 py-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10 text-lg text-rose-300">!</div>
          <h2 className="mt-4 text-base font-semibold text-ink">世界读取失败</h2>
          <p className="mt-2 text-xs leading-6 text-gray-500">
            没能从本机读到你们的世界记录。这通常是暂时的，你的数据仍保存在这台设备上。
          </p>
          <button
            type="button"
            onClick={() => setReloadToken((n) => n + 1)}
            className="mt-5 w-full rounded-xl border border-line px-4 py-2.5 text-sm text-sub active:scale-[.99]"
          >
            重新读取
          </button>
        </section>
      ) : !hasAnything ? (
        /* ---------- 真实空状态：世界层确实还没有任何记录 ---------- */
        <section className="mt-5 overflow-hidden rounded-[26px] border border-line bg-gradient-to-br from-gene-purple/[0.10] via-transparent to-life-cyan/[0.10] px-5 py-7">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-life-cyan/30 bg-life-cyan/10 text-lg text-life-cyan">◌</div>
          <h2 className="mt-4 text-center text-base font-semibold text-ink">你的世界还没有开始</h2>
          <p className="mt-2 text-center text-xs leading-6 text-gray-500">
            这里存放的是你们真正共同经历过的事——<br />
            答应过却还没做完的约定、关系发生的变化，<br />
            以及你从聊天里收藏下来的那些话。
          </p>
          <p className="mt-3 text-center text-[11px] leading-5 text-gray-600">
            现在还没有任何记录。在聊天里长按一条消息，<br />
            可以把它收藏成你们的共同记忆。
          </p>
          <div className="mt-5 flex flex-col items-center gap-2.5">
            <button
              type="button"
              onClick={() => useUIStore.getState().setMobileTab('chat')}
              className="w-full rounded-xl bg-gene-purple px-4 py-2.5 text-sm font-medium text-white active:scale-[.99]"
            >
              去和一个角色说说话
            </button>
            <button
              type="button"
              onClick={openDiary}
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-sub active:scale-[.99]"
            >
              写下今天
            </button>
          </div>
        </section>
      ) : (
        /* ---------- 有内容：每个区块各自按自己的数据渲染（不互相冒充） ---------- */
        <section className="mt-5">
          {/* 第一视觉核心：正在等待你的故事（没有等着继续的事时整块隐藏，不放假内容） */}
          {waiting && (
            <div className="overflow-hidden rounded-[26px] border border-gene-purple/25 bg-gradient-to-br from-gene-purple/[0.16] via-gene-purple/[0.06] to-life-cyan/[0.12] px-5 py-5">
              <p className="text-[10px] tracking-[0.2em] uppercase text-life-cyan">正在等待你的故事</p>
              <h2 className="mt-2 text-[19px] font-semibold leading-snug text-ink">{waiting.title}</h2>
              <p className="mt-1.5 text-[11px] text-gray-400">
                {nameOf(waiting.characterId)} · 你
                <span className="mx-1.5 text-gray-600">·</span>
                {KIND_LABEL[waiting.kind]}
                {waiting.dueAt ? <><span className="mx-1.5 text-gray-600">·</span>{relativeDay(waiting.dueAt)}</> : null}
              </p>
              <p className="mt-3 text-[12px] leading-relaxed text-gray-400">
                {waiting.detail || THREAD_TEASER[waiting.kind]}
              </p>
              <button
                type="button"
                onClick={() => goTalkTo(waiting.characterId)}
                className="mt-4 w-full rounded-xl bg-gene-purple px-4 py-2.5 text-sm font-medium text-white active:scale-[.99]"
              >
                继续这件事 →
              </button>
            </div>
          )}

          {/* 世界已经开始（弱化的事实陈述） */}
          <div className={`rounded-[22px] border border-line bg-surface/70 px-4 py-4 ${waiting ? 'mt-4' : ''}`}>
            <p className="text-[10px] tracking-[0.18em] uppercase text-life-cyan">world is alive</p>
            <h2 className="mt-1.5 text-sm font-semibold text-ink">你的世界已经开始</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              {hasEvents && hasMemories && `这里已经记下了 ${eventCount} 件事、${memoryCount} 段共同记忆。`}
              {hasEvents && !hasMemories && `这里已经记下了 ${eventCount} 件事。`}
              {!hasEvents && hasMemories && `这里已经留下了 ${memoryCount} 段共同记忆。`}
              {!hasEvents && !hasMemories && hasThreads && '你们之间还有几件没有做完的事。'}
            </p>
          </div>

          {hasEvents && recentHappenings.length > 0 && (
            <>
              <p className="mt-4 mb-2 text-[10px] tracking-[0.16em] uppercase text-gray-500">最近发生</p>
              <ul className="space-y-2">
                {recentHappenings.map((event) => (
                  <li key={event.id} className="rounded-2xl border border-line bg-surface/60 px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-gene-purple/12 px-2 py-0.5 text-[10px] text-gene-purple">
                        {EVENT_TYPE_LABEL[event.type]}
                      </span>
                      <time className="shrink-0 text-[10px] text-gray-500">{relativeDay(event.timestamp)}</time>
                    </div>
                    <p className="mt-1.5 text-[13px] font-medium text-ink">{event.title}</p>
                    {event.summary && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{event.summary}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* 未完成的故事：只列其余线索（点进去可完成/收起/继续，复用 4.x 面板）。
              没有"其余"时整块隐藏——避免"1 件 + 空列表"的自相矛盾。 */}
          {restThreads.length > 0 && (
            <>
              <div className="mt-4 mb-2 flex items-center justify-between">
                <p className="text-[10px] tracking-[0.16em] uppercase text-gray-500">未完成的故事</p>
                <span className="text-[10px] text-gray-500">{restThreads.length} 件</span>
              </div>
              <ul className="space-y-2">
                {restThreads.map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => setThreadPanelCharacter(characterOf(thread.characterId))}
                      className="flex w-full items-center gap-3 rounded-2xl border border-life-cyan/20 bg-life-cyan/[0.05] px-3.5 py-3 text-left active:scale-[.99]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-sm text-life-cyan">
                        {KIND_LABEL[thread.kind].slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{thread.title}</span>
                        <span className="mt-0.5 block text-[10px] text-gray-500">
                          {nameOf(thread.characterId)}
                          {thread.dueAt ? ` · ${relativeDay(thread.dueAt)}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-gray-500">›</span>
                    </button>
                  </li>
                ))}
              </ul>
              {restThreads.length > 0 && unresolved.length > 0 && (
                <p className="mt-3 text-[11px] text-gray-500">
                  还有 <span className="text-life-cyan">{unresolved.length}</span> 件没说清、没做完的事，等着你们继续。
                </p>
              )}
            </>
          )}

          {hasMemories && memories.length > 0 && (
            <>
              <p className="mt-4 mb-2 text-[10px] tracking-[0.16em] uppercase text-gray-500">共同记忆</p>
              <ul className="space-y-2">
                {memories.map((memory) => (
                  <li key={memory.id} className="rounded-2xl border border-life-cyan/20 bg-life-cyan/[0.05] px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-ink">{memory.title}</p>
                      <time className="shrink-0 text-[10px] text-gray-500">{relativeDay(memory.createdAt)}</time>
                    </div>
                    {memory.summary && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{memory.summary}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* 我的生活：现实生活进入世界的唯一入口（隐私由每条内容的可见性控制） */}
      <button
        type="button"
        onClick={openDiary}
        className="mt-5 flex w-full items-center gap-3 rounded-[22px] border border-line bg-surface/70 px-4 py-4 text-left active:scale-[.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-life-cyan/25 bg-life-cyan/10 text-base text-life-cyan">✎</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">我的生活</span>
          <span className="mt-0.5 block text-[11px] text-gray-500">日记、心情与照片 · 默认只有你自己知道</span>
        </span>
        <span className="shrink-0 text-gray-500">›</span>
      </button>

      {/* 世界剧场：从「世界」进入的内容页（打开/离开不消耗模型调用） */}
      <button
        type="button"
        onClick={() => useUIStore.getState().setActiveView('stage')}
        className="mt-3 flex w-full items-center gap-3 rounded-[22px] border border-life-cyan/25 bg-gradient-to-br from-gene-purple/[0.12] via-transparent to-life-cyan/[0.10] px-4 py-4 text-left active:scale-[.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-life-cyan/30 bg-life-cyan/10 text-base text-life-cyan">◈</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">世界剧场</span>
          <span className="mt-0.5 block text-[11px] text-gray-500">和他们一起演一场戏 · 结束后会真的留在世界里</span>
        </span>
        <span className="shrink-0 text-gray-500">›</span>
      </button>

      {/* 关系网络：从「世界」进入的内容页（与「我的生活」同样保持底部导航可见） */}
      <button
        type="button"
        onClick={() => useUIStore.getState().setActiveView('relations')}
        className="mt-3 flex w-full items-center gap-3 rounded-[22px] border border-line bg-surface/70 px-4 py-4 text-left active:scale-[.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-gene-purple/25 bg-gene-purple/10 text-base text-gene-purple">↔</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">关系网络</span>
          <span className="mt-0.5 block text-[11px] text-gray-500">你和他们的关系，以及为什么会变成这样</span>
        </span>
        <span className="shrink-0 text-gray-500">›</span>
      </button>

      <p className="mt-4 text-center text-[10px] leading-relaxed text-gray-600">
        世界剧场与世界年表正在陆续生长
      </p>

      {/* 未完成的事：复用 4.x 面板（完成/收起/编辑都在里面，完成后世界事件同步 resolved） */}
      {threadPanelCharacter && (
        <ContinuityThreadsModal
          open
          onClose={() => { setThreadPanelCharacter(null); setReloadToken((n) => n + 1); }}
          character={threadPanelCharacter}
          userId={userId ?? ''}
        />
      )}
    </div>
  );
}
