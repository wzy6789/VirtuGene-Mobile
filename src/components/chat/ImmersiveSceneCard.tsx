import { lazy, Suspense, memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { Character, CharacterState, ContinuityThread, SharedStoryEvent } from '../../db/index';
import { stateRepo } from '../../db/state-repo';
import { continuityRepo, KIND_LABEL, MAX_OPEN_THREADS } from '../../db/continuity-repo';
import { sharedEventRepo } from '../../db/shared-event-repo';
import { memoryRepo } from '../../db/memory-repo';
import { messageRepo } from '../../db/message-repo';
import { getRelationLevel } from '../../lib/affinity';
import { useEmotionStore } from '../../store/emotion-store';

// 未完成事件面板只在展开后主动点开时才用得到：与手账/群聊同一套按需加载策略
const ContinuityThreadsModal = lazy(() => import('../character/ContinuityThreadsModal').then((m) => ({ default: m.ContinuityThreadsModal })));

interface Props {
  character: Character;
  userId: string;
  sessionId?: string | null;
  affinity: number;
  mood: number;
  /** 本会话最后一条消息时间（"距上次见面"用） */
  lastMessageAt?: number;
  onPrompt: (text: string) => void;
}

function getSceneTime() {
  const hour = new Date().getHours();
  if (hour < 5) return { label: '深夜', detail: '城市已经安静下来', icon: '✦', tone: 'night' };
  if (hour < 11) return { label: '清晨', detail: '新的片段正开始', icon: '◌', tone: 'morning' };
  if (hour < 17) return { label: '午后', detail: '光线停在故事里', icon: '☼', tone: 'day' };
  if (hour < 21) return { label: '傍晚', detail: '今天还没有结束', icon: '◐', tone: 'dusk' };
  return { label: '夜晚', detail: '适合说些真实的话', icon: '☾', tone: 'night' };
}

function moodWord(mood: number) {
  if (mood >= 76) return '明亮';
  if (mood >= 56) return '平静';
  if (mood >= 36) return '有些低落';
  return '需要被理解';
}

/** 距上次说话多久：用真人会说的时间单位，不显示精确时间戳 */
function sinceText(lastMessageAt?: number): string {
  if (!lastMessageAt) return '';
  const minutes = Math.floor((Date.now() - lastMessageAt) / 60000);
  if (minutes < 5) return '你们正在说话';
  if (minutes < 60) return `距上次说话 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `距上次说话 ${hours} 小时`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '距上次说话 1 天' : `距上次说话 ${days} 天`;
}

/**
 * 开场建议：按未完成事件的类别说一句用户会说的话。
 * 只是往输入框里填草稿，用户随时可以改或删。
 */
function threadOpener(thread: ContinuityThread): string {
  const title = thread.title.slice(0, 14);
  switch (thread.kind) {
    case 'promise':
      return `上次答应我的「${title}」，可别忘了。`;
    case 'plan':
      return `上次说好一起做的「${title}」，我们聊聊吧。`;
    case 'topic':
      return `上次没聊完的「${title}」，我们接着说。`;
    case 'conflict':
      return `关于「${title}」，我想和你说清楚。`;
    case 'reminder':
    default:
      return `「${title}」这件事，我们现在说说吧。`;
  }
}

/**
 * Shared Space 2.0 —— 角色此刻的"在场感"。
 * 数据优先顺序：未完成事件 > 角色当前关注 > 最近共同经历 > 最近的长期记忆 > 默认等待文案。
 * 全部读本地数据，不在这里发任何 AI 请求。
 */
export const ImmersiveSceneCard = memo(function ImmersiveSceneCard({ character, userId, sessionId, affinity, mood, lastMessageAt, onPrompt }: Props) {
  const [state, setState] = useState<CharacterState | null>(null);
  const [threads, setThreads] = useState<ContinuityThread[]>([]);
  const [sharedEvents, setSharedEvents] = useState<SharedStoryEvent[]>([]);
  const [recentMemory, setRecentMemory] = useState<string | null>(null);
  const [daysKnown, setDaysKnown] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  /** 数据变更后重新读取本地快照（不做轮询，只在需要时刷新一次） */
  const [reloadToken, setReloadToken] = useState(0);
  const [scene, setScene] = useState(getSceneTime);
  useEffect(() => {
    const update = () => { if (!document.hidden) setScene(getSceneTime()); };
    const timer = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [next, open, events, memories] = await Promise.all([
        stateRepo.getOrCreate(character.id, userId),
        continuityRepo.getOpenByCharacter(character.id, userId).catch(() => [] as ContinuityThread[]),
        sharedEventRepo.getRecentByCharacter(character.id, userId, 3).catch(() => [] as SharedStoryEvent[]),
        memoryRepo.getRecentByCharacter(character.id, userId, 1).catch(() => [] as { content: string }[]),
      ]);
      if (cancelled) return;
      setState(next);
      setThreads(open);
      setSharedEvents(events);
      setRecentMemory(memories[0]?.content ?? null);
      if (!sessionId) {
        setDaysKnown(0);
        return;
      }
      const first = await messageRepo.getFirst(sessionId).catch(() => undefined);
      if (cancelled) return;
      setDaysKnown(first ? Math.max(1, Math.floor((Date.now() - first.createdAt) / 86400000) + 1) : 0);
    })();
    return () => { cancelled = true; };
  }, [character.id, userId, sessionId, reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  /**
   * 后台结算（每 5 条用户消息一次）会产出新的未完成事件与生命状态。
   * 这里跟着结算快照的时间戳刷新一次本地数据，除此之外不做任何轮询。
   */
  const settleAt = useEmotionStore((s) => s.currentSnapshot?.createdAt);
  useEffect(() => {
    if (settleAt) refresh();
  }, [settleAt, refresh]);

  const relationCount = state?.storyRelations?.length ?? 0;
  const topThread = threads[0];
  const relation = state ? getRelationLevel(state.affinity) : null;

  // 优先顺序：未完成事件 > 当前关注 > 最近共同经历 > 长期记忆 > 默认
  const focus = useMemo(() => {
    if (topThread) return `${KIND_LABEL[topThread.kind]}还没做完：${topThread.title}`;
    if (state?.lifeFocus) return state.lifeFocus;
    const lastEvent = state?.lifeEvents?.[0];
    if (lastEvent) return lastEvent.title;
    if (recentMemory) return `TA 记得：${recentMemory}`;
    return `${character.name} 正在等你写下这一刻`;
  }, [topThread, state, recentMemory, character.name]);

  const prompts = useMemo(() => {
    const list: string[] = [];
    if (topThread) {
      list.push(threadOpener(topThread));
    } else {
      list.push('我想和你说说今天发生的事。');
    }
    if (sharedEvents.length > 0 || relationCount > 0) {
      list.push('你最近在想些什么？');
    } else {
      list.push(`我们一起给 ${character.name} 的故事一个开始吧。`);
    }
    return list.slice(0, 2);
  }, [topThread, sharedEvents.length, relationCount, character.name]);

  const mostRelevantLink = useMemo(() => {
    const link = (state?.storyRelations ?? [])[0];
    if (!link) return null;
    return link;
  }, [state]);

  const since = sinceText(lastMessageAt);

  const handleComplete = async (thread: ContinuityThread) => {
    await continuityRepo.complete(thread.id);
    refresh();
  };

  return (
    <section className={`scene-card scene-${scene.tone} shrink-0 mx-3 mt-2 animate-fade-in ${expanded ? 'scene-card-expanded' : ''}`}>
      <div className="scene-grain" />
      <div className="scene-orb scene-orb-a" />
      <div className="scene-orb scene-orb-b" />
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="relative z-[1] w-full flex items-center gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="scene-sigil">
          {character.avatar.startsWith('data:') ? <img src={character.avatar} alt="" /> : <span>{character.avatar}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase text-white/55">
            <span>{scene.icon}</span> {scene.label} · shared space
            {threads.length > 0 && (
              <span className="rounded-full border border-life-cyan/40 bg-life-cyan/12 px-1.5 py-px text-[9px] tracking-normal text-life-cyan">
                {threads.length} 件未完成
              </span>
            )}
          </p>
          <p className="mt-1 text-sm font-medium text-white truncate">{focus}</p>
        </div>
        <span className={`text-white/55 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}>⌄</span>
      </button>

      <div className={`relative z-[1] grid transition-[grid-template-rows,opacity] duration-300 ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-3.5">
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="scene-stat"><span>状态</span><b>{moodWord(mood)}</b></div>
              <div className="scene-stat"><span>连结</span><b>{Math.round(affinity)}{relation ? ` · ${relation.level.name}` : ''}</b></div>
              <div className="scene-stat"><span>未完成</span><b>{threads.length > 0 ? `${threads.length} / ${MAX_OPEN_THREADS}` : '—'}</b></div>
            </div>

            {(daysKnown > 0 || since) && (
              <p className="mb-2.5 text-[10px] text-white/45">
                {daysKnown > 0 ? `你们认识第 ${daysKnown} 天` : ''}
                {daysKnown > 0 && since ? ' · ' : ''}
                {since}
              </p>
            )}

            {topThread ? (
              <div className="scene-thread">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] tracking-[0.12em] uppercase text-life-cyan/85">{KIND_LABEL[topThread.kind]} · 还没做完</p>
                    <p className="mt-1 text-[13px] font-medium text-white">{topThread.title}</p>
                    {topThread.detail && <p className="mt-1 text-[11px] leading-relaxed text-white/55">{topThread.detail}</p>}
                    {topThread.dueAt && (
                      <p className="mt-1 text-[10px] text-white/45">
                        约定在 {new Date(topThread.dueAt).getMonth() + 1} 月 {new Date(topThread.dueAt).getDate()} 日
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void handleComplete(topThread)} className="scene-mini">已经做完了</button>
                  <button type="button" onClick={() => setShowThreads(true)} className="scene-mini">
                    {threads.length > 1 ? `全部 ${threads.length} 件` : '管理'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="scene-thread">
                <p className="text-[11px] leading-relaxed text-white/60">
                  还没有未完成的事。聊到"下次一起……""改天再说"的时候，这里会替你们记住。
                </p>
                <div className="mt-2">
                  <button type="button" onClick={() => setShowThreads(true)} className="scene-mini">＋ 添加一件事</button>
                </div>
              </div>
            )}

            {mostRelevantLink && (
              <p className="mt-2.5 text-[11px] text-white/55">
                <span className="text-life-cyan/85">人物线</span> · TA 与「{mostRelevantLink.label}」
                {sharedEvents.length > 0 ? ` · 最近：${sharedEvents[0].title}` : ''}
              </p>
            )}

            <p className="mt-2.5 mb-2 text-[11px] text-white/45">{scene.detail}。选择一句，让故事继续。</p>
            <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
              {prompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => onPrompt(prompt)} className="scene-prompt">{prompt}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showThreads && (
        <Suspense fallback={null}>
          <ContinuityThreadsModal
            open
            onClose={() => { setShowThreads(false); refresh(); }}
            character={character}
            userId={userId}
          />
        </Suspense>
      )}
    </section>
  );
});
