import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { worldEventRepo } from '../../db/world-event-repo';
import { worldSceneRepo } from '../../db/world-scene-repo';
import { sharedMemoryRepo } from '../../db/shared-memory-repo';
import { continuityRepo, KIND_LABEL } from '../../db/continuity-repo';
import type { Character, ContinuityThread, SharedMemory, WorldEvent, WorldScene, WorldSceneEntry } from '../../db/index';
import { SpaceHeading } from '../ui/SpaceHeading';
import { ContinuityThreadsModal } from '../character/ContinuityThreadsModal';
import { pickWaitingStory, relativeDay, THREAD_TEASER } from '../../lib/world/world-picks';
import { eventLabel } from '../../lib/world/world-timeline';

/**
 * 世界主页（5.0.0 Living World §5 / §6 / §7 / §75 / §76 / §79 / §80）
 *
 * 这一页只有一个任务：**让用户知道现在可以直接进世界**。
 *
 * 因此它刻意**不是** Dashboard：
 * - 顶部只有一句"谁和你一起生活在这里"，统计是一行灰字（§5）
 * - 视觉核心只有一个区域：**此刻**（§6）——正在发生什么 / 或者"此刻很安静"
 * - 下面只有几个克制入口：关系 / 记忆 / 时间线 / 设定 / 我的生活（§7）
 * - **没有任何"故事模式""世界剧场""创建场景"一级入口**（§7/§77）
 *
 * 空世界不出现教程，也不出现"未来会有…"这种施工感文案（§76/§80）。
 */
export function MobileWorldPage() {
  const userId = useAuthStore((s) => s.userId);
  const characters = useChatStore((s) => s.characters);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof worldRepo.stats>>>(null);
  const [recent, setRecent] = useState<WorldEvent[]>([]);
  const [memories, setMemories] = useState<SharedMemory[]>([]);
  const [openThreads, setOpenThreads] = useState<ContinuityThread[]>([]);
  const [scene, setScene] = useState<WorldScene | null>(null);
  const [sceneTail, setSceneTail] = useState<WorldSceneEntry[]>([]);
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
        const world = await worldRepo.ensureDefaultWorld(userId);
        const [nextStats, timeline, mems, threads, scenes] = await Promise.all([
          worldRepo.stats(world.id),
          worldEventRepo.listTimeline(world.id, { limit: 10 }),
          sharedMemoryRepo.listByWorld(world.id, 3),
          continuityRepo.getOpenByUser(userId),
          // §74：世界首页只加载"当前活跃片段 + 少量最近事件"，其余进对应页面再加载
          worldSceneRepo.listScenes(world.id, { limit: 3 }),
        ]);
        const current = scenes.find((s) => s.status === 'active') ?? scenes.find((s) => s.status === 'paused') ?? null;
        const tail = current ? (await worldSceneRepo.listEntries(current.id, { limit: 400 })).slice(-4) : [];
        if (!alive) return;
        setStats(nextStats);
        setRecent(timeline);
        setMemories(mems);
        setOpenThreads(threads);
        setScene(current);
        setSceneTail(tail);
      } catch {
        if (alive) {
          setStats(null);
          setRecent([]);
          setMemories([]);
          setOpenThreads([]);
          setScene(null);
          setSceneTail([]);
          setLoadError(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    if (characters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; };
  }, [userId, characters.length, reloadToken]);

  const nameOf = useMemo(() => {
    const map = new Map(characters.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? 'TA';
  }, [characters]);
  const characterOf = useMemo(() => {
    const map = new Map(characters.map((c) => [c.id, c]));
    return (id: string) => map.get(id) ?? null;
  }, [characters]);

  /** 世界里的角色（用户自建的 + 已经参与过这个世界的） */
  const myCharacters = useMemo(() => {
    const involved = new Set<string>([
      ...(scene?.characterIds ?? []),
      ...openThreads.map((t) => t.characterId),
    ]);
    const owned = characters.filter((c) => c.createdBy === userId);
    const extra = characters.filter((c) => involved.has(c.id) && !owned.some((o) => o.id === c.id));
    return [...owned, ...extra];
  }, [characters, userId, scene, openThreads]);

  const waiting = useMemo(() => pickWaitingStory(openThreads), [openThreads]);

  const memoryCount = stats?.sharedMemoryCount ?? 0;

  const recentHappenings = useMemo(() => {
    const shownMemoryIds = new Set(memories.map((m) => m.id));
    return recent
      .filter((e) => !(e.type === 'continuity' && !e.resolved))
      .filter((e) => !(e.type === 'shared_memory' && e.memoryIds.some((id) => shownMemoryIds.has(id))))
      .slice(0, 3);
  }, [recent, memories]);

  /** 世界的一句话自然描述（§5）：谁在和你一起生活 */
  const livingLine = useMemo(() => {
    const names = myCharacters.map((c) => c.name);
    if (names.length === 0) return '这个世界还在等第一位灵魂住进来。';
    if (names.length === 1) return `${names[0]}与你正在共同生活。`;
    if (names.length <= 3) return `${names.join('、')}与你正在共同生活。`;
    return `${names.length} 个灵魂正在这个世界留下自己的故事。`;
  }, [myCharacters]);

  /** "此刻"的预览：最后一条旁白/对白/动作（不重复用户自己的话） */
  const nowPreview = useMemo(() => {
    const last = [...sceneTail].reverse().find((e) => e.kind === 'narration' || e.kind === 'dialogue' || e.kind === 'action');
    if (!last) return null;
    const who = last.speakerId ? characterOf(last.speakerId) : null;
    return { text: last.content, who: who?.name ?? null };
  }, [sceneTail, characterOf]);

  const enterWorld = (sceneId?: string | null) => {
    useUIStore.getState().openCanvas(sceneId ?? null);
  };
  const openView = (view: 'diary' | 'relations' | 'memory' | 'timeline' | 'worldSettings') =>
    useUIStore.getState().setActiveView(view);

  /** §79：模板降级为"灵感"——点一下等于替用户说了一句话，不打开任何配置页 */
  const inspirations = useMemo(() => {
    if (myCharacters.length === 0) return [];
    const first = myCharacters[0].name;
    return [
      '今晚我们去海边。',
      `让${first}说说 TA 最近在想什么。`,
      '直接到第二天早上。',
    ];
  }, [myCharacters]);

  return (
    <div className="vg-world-page h-full overflow-y-auto px-4 pb-6">
      <div className="pt-5">
        <SpaceHeading eyebrow="living world" title="我的世界" detail={livingLine} />
      </div>

      {/* 弱化统计（§5：一行灰字，不是 KPI 卡片） */}
      {!loading && !loadError && (
        <p className="vg-world-meta mt-2 text-[11px] text-gray-500">
          第 {stats?.daysSinceCreated ?? 1} 天
          <span className="mx-1.5 text-gray-600">·</span>
          {myCharacters.length} 位角色
          <span className="mx-1.5 text-gray-600">·</span>
          {memoryCount} 段共同经历
        </p>
      )}

      {loading ? (
        <div className="mt-10 text-center text-sm text-gray-500" role="status">正在读取你的世界…</div>
      ) : loadError ? (
        <section className="mt-5 rounded-[26px] border border-rose-400/25 bg-rose-500/[0.06] px-5 py-7 text-center">
          <h2 className="mt-1 text-base font-semibold text-ink">世界读取失败</h2>
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
      ) : (
        <>
          {/* ------------------------- 视觉核心：此刻（§6） ------------------------- */}
          <section className="vg-now">
            <p className="vg-now-label">此刻</p>
            {scene && sceneTail.length > 0 ? (
              <>
                <h2 className="vg-now-title">{scene.place} · {scene.timeLabel}</h2>
                {nowPreview && (
                  <p className="vg-now-line">
                    {nowPreview.who ? <b>{nowPreview.who}　</b> : null}
                    {nowPreview.text.length > 90 ? `${nowPreview.text.slice(0, 90)}…` : nowPreview.text}
                  </p>
                )}
                {waiting && (
                  <p className="vg-now-line">
                    上一次，你们谈到了一件还没有真正说完的事情：{waiting.title}
                  </p>
                )}
                <button type="button" className="vg-now-enter" onClick={() => enterWorld(scene.id)}>
                  继续
                </button>
              </>
            ) : (
              <>
                <p className="vg-now-quiet">
                  此刻很安静。
                  <br />
                  {openThreads.length === 0 ? '没有必须完成的故事。' : '没有必须马上完成的事。'}
                  <br />
                  你想做什么都可以。
                </p>
                {myCharacters.length === 0 && (
                  <p className="vg-now-line mt-3">先去「角色」里培养一位灵魂，再回到这里。</p>
                )}
                <button
                  type="button"
                  className="vg-now-enter"
                  onClick={() => enterWorld(null)}
                  disabled={myCharacters.length === 0}
                  style={myCharacters.length === 0 ? { opacity: 0.5 } : undefined}
                >
                  进入世界
                </button>
              </>
            )}
          </section>

          {/* ------------------------- 克制入口（§7） ------------------------- */}
          <section className="vg-world-entries" aria-label="世界功能">
            <button type="button" onClick={() => openView('relations')}>
              <b>关系</b>
              <span>你和他们现在是什么关系</span>
            </button>
            <button type="button" onClick={() => openView('memory')}>
              <b>记忆</b>
              <span>我们经历过的事</span>
            </button>
            <button type="button" onClick={() => openView('timeline')}>
              <b>时间线</b>
              <span>这个世界的一段时间</span>
            </button>
            <button type="button" onClick={() => openView('worldSettings')}>
              <b>设定</b>
              <span>这个世界是什么样的</span>
            </button>
            <button type="button" onClick={() => openView('diary')} style={{ gridColumn: 'span 2' }}>
              <b>我的生活</b>
              <span>日记、心情与照片 · 默认只有你自己知道</span>
            </button>
          </section>

          {/* ------------------------- 还没做完的事（保留 4.x 能力） ------------------------- */}
          {openThreads.length > 0 && (
            <>
              <div className="mt-5 mb-2 flex items-center justify-between">
                <p className="text-[10px] tracking-[0.16em] uppercase text-gray-500">还没做完的事</p>
                <span className="text-[10px] text-gray-500">{openThreads.length} 件</span>
              </div>
              <ul className="space-y-2">
                {openThreads.slice(0, 3).map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const character = characterOf(thread.characterId);
                        if (character) setThreadPanelCharacter(character);
                      }}
                      className="w-full rounded-2xl border border-line bg-surface/60 px-3.5 py-3 text-left active:scale-[.99]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-full bg-life-cyan/12 px-2 py-0.5 text-[10px] text-life-cyan">
                          {KIND_LABEL[thread.kind]}
                        </span>
                        <time className="shrink-0 text-[10px] text-gray-500">
                          {thread.dueAt ? relativeDay(thread.dueAt) : relativeDay(thread.createdAt)}
                        </time>
                      </div>
                      <p className="mt-1.5 text-[13px] font-medium text-ink">{thread.title}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                        {thread.detail || THREAD_TEASER[thread.kind]} · {nameOf(thread.characterId)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  const first = characterOf(openThreads[0].characterId) ?? myCharacters[0];
                  if (first) setThreadPanelCharacter(first);
                }}
                className="mt-2 w-full rounded-xl border border-line px-4 py-2 text-[11px] text-sub"
              >
                管理这些事
              </button>
            </>
          )}

          {/* ------------------------- 最近发生 ------------------------- */}
          {recentHappenings.length > 0 && (
            <>
              <p className="mt-5 mb-2 text-[10px] tracking-[0.16em] uppercase text-gray-500">最近发生</p>
              <ul className="space-y-2">
                {recentHappenings.map((event) => (
                  <li key={event.id} className="rounded-2xl border border-line bg-surface/60 px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-gene-purple/12 px-2 py-0.5 text-[10px] text-gene-purple">
                        {eventLabel(event)}
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

          {/* ------------------------- 灵感（§79；空世界时兼作 onboarding §80） ------------------------- */}
          {inspirations.length > 0 ? (
            <section className="vg-inspiration">
              <p>不知道做什么？</p>
              {inspirations.map((line) => (
                <button
                  key={line}
                  type="button"
                  onClick={() => {
                    // 点灵感 = 替用户把这句话说出去（进入世界后再发送，保证片段已经就绪）
                    enterWorld(null);
                    window.setTimeout(() => window.dispatchEvent(new CustomEvent('vg:world-say', { detail: line })), 80);
                  }}
                >
                  {line}
                </button>
              ))}
            </section>
          ) : (
            <section className="vg-inspiration">
              <p>这里还没有发生任何事情。</p>
              <p className="mt-1">试着说一句：</p>
              <button type="button" onClick={() => enterWorld(null)}>“今晚我们去海边。”</button>
            </section>
          )}
        </>
      )}

      {threadPanelCharacter && userId && (
        <ContinuityThreadsModal
          open
          character={threadPanelCharacter}
          userId={userId}
          onClose={() => setThreadPanelCharacter(null)}
        />
      )}
    </div>
  );
}
