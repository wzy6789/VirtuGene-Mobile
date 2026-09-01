import { useEffect, useState } from 'react';
import { useEmotionStore } from '../../store/emotion-store';
import { useChatStore } from '../../store/chat-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useAuthStore } from '../../store/auth-store';
import { useRipple } from '../../lib/ripple';
import { diaryRepo } from '../../db/diary-repo';
import { moodEmoji as diaryMoodEmoji, moodColor as diaryMoodColor } from '../../lib/diary-utils';
import { EmotionChart } from './EmotionChart';
import { EmotionCurve } from './EmotionCurve';
import { getRelationLevel, levelProgress } from '../../lib/affinity';
import { messageRepo } from '../../db/message-repo';
import { memoryRepo } from '../../db/memory-repo';
import { useResizable } from '../../hooks/useResizable';
import { IS_MOBILE } from '../../lib/platform';
import type { EmotionDimensions, MemoryItem } from '../../db/index';

const PANEL_DEFAULT = IS_MOBILE
  ? Math.min(360, typeof window !== 'undefined' ? window.innerWidth : 360)
  : 320;
const PANEL_MIN = 300;
const PANEL_MAX = 420;

const DIM_LABELS: { key: keyof EmotionDimensions; label: string }[] = [
  { key: 'valence', label: '愉悦度' },
  { key: 'arousal', label: '唤醒度' },
  { key: 'intimacy', label: '亲密度' },
  { key: 'engagement', label: '投入度' },
  { key: 'expressiveness', label: '外显度' },
  { key: 'stability', label: '稳定度' },
];

function getValenceBadgeClass(valence: number) {
  if (valence >= 7.5) return 'bg-life-cyan/15 text-life-cyan border-life-cyan/25';
  if (valence >= 5) return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  if (valence >= 2.5) return 'bg-orange-500/15 text-orange-400 border-orange-500/25';
  return 'bg-red-500/15 text-red-400 border-red-500/25';
}

function deltaArrow(current: number, previous: number) {
  const diff = current - previous;
  if (diff >= 0.5) return { arrow: '↑', color: 'text-life-cyan' };
  if (diff <= -0.5) return { arrow: '↓', color: 'text-amber-400' };
  return { arrow: '→', color: 'text-gray-500' };
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 随机抽 3 片记忆碎片（Fisher-Yates 洗牌） */
function pickShards(list: MemoryItem[]): MemoryItem[] {
  if (list.length === 0) return [];
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 3);
}

/** 记忆碎片文艺化：以"我"的视角呈现（记忆里存的"用户"即我自己） */
function poeticize(content: string): string {
  return content.replace(/用户/g, '我').replace(/\s+/g, ' ').trim();
}

function moodColor(mood: number): string {
  if (mood >= 75) return '#00CEC9';
  if (mood >= 50) return '#FBBF24';
  if (mood >= 25) return '#FB923C';
  return '#F87171';
}

function valenceDotClass(valence: number) {
  if (valence >= 7.5) return 'bg-life-cyan shadow-[0_0_6px_rgba(0,206,201,0.6)]';
  if (valence >= 5) return 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]';
  if (valence >= 2.5) return 'bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.6)]';
  return 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]';
}

/** 分区小标题（统一克制风格） */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] tracking-[0.2em] text-gray-500 uppercase">{children}</p>;
}

export function EmotionPanel() {
  const isPanelOpen = useEmotionStore((s) => s.isPanelOpen);
  const isAnalyzing = useEmotionStore((s) => s.isAnalyzing);
  const analysisError = useEmotionStore((s) => s.analysisError);
  const currentSnapshot = useEmotionStore((s) => s.currentSnapshot);
  const previousSnapshot = useEmotionStore((s) => s.previousSnapshot);
  const snapshots = useEmotionStore((s) => s.snapshots);
  const closePanel = useEmotionStore((s) => s.closePanel);
  const analyzeCurrentSession = useEmotionStore((s) => s.analyzeCurrentSession);
  const loadSessionSnapshots = useEmotionStore((s) => s.loadSessionSnapshots);
  const ripple = useRipple();

  const selectedCharacterId = useChatStore((s) => s.selectedCharacterId);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const characters = useChatStore((s) => s.characters);
  const messages = useChatStore((s) => s.messages);
  const affinity = useCharacterStateStore((s) => s.affinity);
  const mood = useCharacterStateStore((s) => s.mood);
  const milestones = useCharacterStateStore((s) => s.milestones);
  const tierNames = useCharacterStateStore((s) => s.tierNames);
  const renameTier = useCharacterStateStore((s) => s.renameTier);
  const userId = useAuthStore((s) => s.userId) ?? '';

  /** 对话统计（真值来自 DB，避免只统计内存中已加载的分页消息） */
  const [stats, setStats] = useState<{ count: number; days: number }>({ count: 0, days: 0 });
  /** 记忆结晶（该角色的回忆录） */
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  /** 随机抽出的 3 片记忆碎片（可刷新） */
  const [shards, setShards] = useState<MemoryItem[]>([]);
  /** 等阶名编辑 */
  const [renamingTier, setRenamingTier] = useState(false);
  const [tierNameInput, setTierNameInput] = useState('');

  /** 我的心情（来自日记，最近 7 天） */
  const [myMoods, setMyMoods] = useState<{ date: string; mood: number }[]>([]);

  useEffect(() => {
    if (!isPanelOpen || !userId) return;
    let alive = true;
    diaryRepo
      .getByUser(userId)
      .then((diaries) => {
        if (!alive) return;
        const sorted = [...diaries].sort((a, b) => a.date.localeCompare(b.date));
        setMyMoods(sorted.slice(-7).map((d) => ({ date: d.date, mood: d.mood ?? 3 })));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isPanelOpen, userId]);

  // 对话统计真值：消息总数 / 相识天数（按第一条消息；不依赖内存分页）
  useEffect(() => {
    if (!isPanelOpen || !currentSessionId) return;
    let alive = true;
    void messageRepo.countBySession(currentSessionId).then((count) => {
      if (alive) setStats((s) => ({ ...s, count }));
    });
    void messageRepo.getFirst(currentSessionId).then((first) => {
      if (alive) {
        setStats((s) => ({
          ...s,
          days: first ? Math.max(1, Math.floor((Date.now() - first.createdAt) / 86400000) + 1) : 0,
        }));
      }
    });
    return () => { alive = false; };
  }, [isPanelOpen, currentSessionId]);

  // 记忆结晶：该角色的回忆录（新→旧）；每次随机回忆 3 片
  useEffect(() => {
    if (!isPanelOpen || !selectedCharacterId || !userId) return;
    let alive = true;
    void memoryRepo.getByCharacter(selectedCharacterId, userId).then((list) => {
      if (alive) {
        const sorted = [...list].reverse();
        setMemories(sorted);
        setShards(pickShards(sorted));
      }
    });
    return () => { alive = false; };
  }, [isPanelOpen, selectedCharacterId, userId]);

  const { width, startDrag } = useResizable({
    initial: PANEL_DEFAULT,
    min: PANEL_MIN,
    max: PANEL_MAX,
    reverse: true,
  });

  const character = characters.find((c) => c.id === selectedCharacterId);

  const relation = getRelationLevel(affinity);
  const progress = levelProgress(affinity, relation.level, relation.next);
  // 等阶显示名：用户自定义 > 默认（100+ 等阶可随便改名）
  const levelName = tierNames[relation.level.name] ?? relation.level.name;
  const nextName = relation.next ? (tierNames[relation.next.name] ?? relation.next.name) : null;

  // Load snapshots when session changes
  useEffect(() => {
    if (currentSessionId && isPanelOpen) {
      loadSessionSnapshots(currentSessionId);
    }
  }, [currentSessionId, isPanelOpen, loadSessionSnapshots]);

  const handleAnalyze = () => {
    if (!selectedCharacterId || !currentSessionId || !character) return;
    analyzeCurrentSession(selectedCharacterId, currentSessionId, character.name);
  };

  // Select a history snapshot for preview
  const handleSelectSnapshot = (snapshot: typeof currentSnapshot) => {
    if (!snapshot) return;
    const idx = snapshots.findIndex((s) => s.id === snapshot.id);
    const prev = idx >= 0 && idx + 1 < snapshots.length ? snapshots[idx + 1] : null;
    useEmotionStore.setState({ currentSnapshot: snapshot, previousSnapshot: prev });
  };

  return (
    <div
      className={`relative h-full flex flex-col bg-app border-l border-line shrink-0 overflow-hidden ${
        IS_MOBILE ? 'absolute inset-y-0 right-0 z-40 shadow-2xl' : ''
      }`}
      style={{ width: isPanelOpen ? width : 0, opacity: isPanelOpen ? 1 : 0 }}
    >
      {isPanelOpen && !IS_MOBILE && (
        <div
          onMouseDown={startDrag}
          className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize hover:bg-gene-purple/30 transition-colors z-10"
        />
      )}
      <div className="flex flex-col h-full" style={{ minWidth: width }}>
        {/* Header */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-line shrink-0">
          <span className="text-sm font-medium text-ink">
            {character ? `${character.name} 的情绪图谱` : '情绪图谱'}
          </span>
          <button
            onClick={closePanel}
            className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-sub hover:bg-surface transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* 灵魂状态总览卡 */}
          <div className="relative overflow-hidden rounded-xl border border-gene-purple/25 bg-gradient-to-br from-gene-purple/12 via-transparent to-life-cyan/10 p-4 space-y-3">
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-gene-purple/20 blur-2xl pointer-events-none" />
            <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-life-cyan/15 blur-2xl pointer-events-none" />

            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <SectionTitle>灵魂状态</SectionTitle>
                <div className="flex items-baseline gap-2 mt-1">
                  {renamingTier ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={tierNameInput}
                        onChange={(e) => setTierNameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        onBlur={() => {
                          void renameTier(relation.level.name, tierNameInput);
                          setRenamingTier(false);
                        }}
                        placeholder={relation.level.name}
                        maxLength={8}
                        className="w-24 bg-surface border border-gene-purple/40 rounded px-1.5 py-0.5 text-sm text-ink outline-none"
                      />
                      <button onClick={() => setRenamingTier(false)} className="text-xs text-gray-400 hover:text-ink">
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-lg font-bold milestone-level">{levelName}</span>
                      <button
                        onClick={() => {
                          setTierNameInput(tierNames[relation.level.name] ?? relation.level.name);
                          setRenamingTier(true);
                        }}
                        title="改等阶名"
                        className="shrink-0 w-4 h-4 flex items-center justify-center text-gray-400 hover:text-life-cyan"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                    </div>
                  )}
                  <span className="text-xs text-gray-500 truncate">{relation.level.desc}</span>
                </div>
                {currentSnapshot && (
                  <span
                    className={`inline-flex mt-2 text-xs px-2.5 py-0.5 rounded-full border ${getValenceBadgeClass(currentSnapshot.dimensions.valence)}`}
                  >
                    {currentSnapshot.dominantEmotion}
                  </span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-gray-500">好感度</p>
                <p className="text-lg font-semibold tabular-nums text-ink">
                  {Math.round(affinity)}
                </p>
                <div className="mt-1 flex items-center justify-end gap-1.5">
                  <span className="text-sm tabular-nums font-medium" style={{ color: moodColor(mood) }}>
                    {Math.round(mood)}
                  </span>
                  <span className="text-xs text-gray-500">心情</span>
                </div>
              </div>
            </div>

            {/* 到下一级进度 */}
            {relation.next ? (
              <div className="relative">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">距离「{nextName}」</span>
                  <span className="text-xs tabular-nums text-gray-400">{Math.round(progress)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-gene-purple to-life-cyan transition-all duration-500 shadow-[0_0_8px_rgba(108,92,231,0.40)]"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="relative text-[10px] text-gray-500">
                已抵达最终等阶，灵魂同频（好感度仍在增长）
              </div>
            )}

            {/* 里程碑时间线 */}
            {milestones.length > 0 && (
              <div className="relative space-y-1">
                <SectionTitle>关系里程碑</SectionTitle>
                <div className="space-y-0.5">
                  {milestones.map((m) => (
                    <div key={m.reachedAt} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">进阶为「{tierNames[m.level] ?? m.level}」</span>
                      <span className="text-gray-400 tabular-nums">{formatTime(m.reachedAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 对话统计（真值来自 DB，长会话分页不再虚低） */}
            <div className="relative grid grid-cols-3 gap-1 pt-2 border-t border-line">
              <div className="text-center">
                <div className="text-sm font-semibold tabular-nums text-ink">{stats.count}</div>
                <div className="text-xs text-gray-500">消息</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold tabular-nums text-ink">{stats.days}</div>
                <div className="text-xs text-gray-500">相识天数</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold tabular-nums text-ink">{snapshots.length}</div>
                <div className="text-xs text-gray-500">情绪图谱</div>
              </div>
            </div>
          </div>

          {/* 我的心情（日记联动） */}
          {myMoods.length > 0 && (
            <div className="rounded-xl bg-surface border border-line p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">我的心情（日记）</span>
                <span className="text-sm">{diaryMoodEmoji(myMoods[myMoods.length - 1].mood)}</span>
              </div>
              <div className="flex items-end gap-1.5 h-9">
                {myMoods.map((m) => (
                  <div
                    key={m.date}
                    className="flex-1 rounded-t transition-all hover:opacity-100"
                    style={{
                      height: `${(m.mood / 5) * 100}%`,
                      backgroundColor: diaryMoodColor(m.mood),
                      opacity: 0.75,
                      boxShadow: `0 0 6px ${diaryMoodColor(m.mood)}66`,
                    }}
                    title={`${m.date} · ${['很差', '低落', '一般', '开心', '很棒'][m.mood - 1] ?? ''}`}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1 text-[9px] text-gray-400">
                <span>较早</span>
                <span>最近</span>
              </div>
            </div>
          )}

              {/* 记忆碎片 · 回忆（随机 3 片，可刷新） */}
              {memories.length > 0 && (
                <div className="rounded-xl bg-surface border border-line p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">记忆碎片 · 回忆</span>
                    <button
                      onClick={() => setShards(pickShards(memories))}
                      className="text-[10px] text-life-cyan hover:underline flex items-center gap-1"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
                      </svg>
                      随机回忆
                    </button>
                  </div>
                  <div className="space-y-2">
                    {shards.map((m, i) => (
                      <div
                        key={m.id}
                        className={`relative rounded-lg bg-panel/60 border border-line px-3 py-2 ${
                          i % 2 === 0 ? 'rotate-[-1.2deg]' : 'rotate-[1.2deg]'
                        }`}
                      >
                        <p className="text-xs text-ink/90 leading-relaxed italic">「{poeticize(m.content)}」</p>
                        <p className="text-[10px] text-gray-500 mt-1 tabular-nums">✦ {formatTime(m.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

          {/* Analyze button */}
          <button
            onClick={handleAnalyze}
            onPointerDown={ripple.onPointerDown}
            disabled={isAnalyzing || messages.length === 0}
            className="ripple-host w-full py-2.5 rounded-xl bg-gene-purple hover:bg-[#5B4BD4] disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none text-sm font-medium text-white transition-all flex items-center justify-center gap-2 shadow-[0_2px_14px_rgba(108,92,231,0.35)]"
          >
            {isAnalyzing ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="20" />
                </svg>
                正在解析情绪序列...
              </>
            ) : (
              '⚗ 分析情绪基因'
            )}
          </button>

          {/* Error banner */}
          {analysisError && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              {analysisError}
            </div>
          )}

          {/* Empty state */}
          {!currentSnapshot && !isAnalyzing && !analysisError && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <span className="text-3xl mb-2">🧬</span>
              <span className="text-xs">尚未生成情绪图谱</span>
              <span className="text-xs text-gray-600 mt-1">点击上方按钮开始分析</span>
            </div>
          )}

          {/* Chart + badge + summary */}
          {currentSnapshot && (
            <>
              <SectionTitle>情绪图谱</SectionTitle>

              {/* Low message warning */}
              {currentSnapshot.messageCount < 4 && (
                <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                  对话数据较少，分析可能不够准确
                </div>
              )}

              {/* Radar chart */}
              <div className="flex justify-center">
                <EmotionChart
                  dimensions={currentSnapshot.dimensions}
                  previousDimensions={previousSnapshot?.dimensions}
                  size={220}
                />
              </div>

              {/* 愉悦度曲线 */}
              {snapshots.length >= 2 && (
                <div className="space-y-1">
                  <SectionTitle>心情曲线</SectionTitle>
                  <EmotionCurve snapshots={snapshots} />
                </div>
              )}

              {/* Dominant emotion badge */}
              <div className="flex justify-center">
                <span
                  className={`text-xs px-3 py-1 rounded-full border ${getValenceBadgeClass(currentSnapshot.dimensions.valence)}`}
                >
                  {currentSnapshot.dominantEmotion}
                </span>
              </div>

              {/* Summary */}
              <p className="text-xs text-gray-400 leading-relaxed text-center">
                {currentSnapshot.summary}
              </p>

              {/* Delta indicators */}
              {previousSnapshot && (
                <div className="space-y-1.5">
                  <SectionTitle>情绪波动追踪</SectionTitle>
                  {DIM_LABELS.map(({ key, label }) => {
                    const cur = currentSnapshot.dimensions[key];
                    const prev = previousSnapshot.dimensions[key];
                    const { arrow, color } = deltaArrow(cur, prev);
                    return (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">{label}</span>
                        <div className="flex items-center gap-1.5 tabular-nums">
                          <span className="text-gray-400">{cur.toFixed(1)}</span>
                          <span className={color}>{arrow}</span>
                          <span className={color}>{Math.abs(cur - prev).toFixed(1)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* History — 快照卡片流（横向滚动，点击预览） */}
              {snapshots.length > 1 && (
                <div className="space-y-1.5">
                  <SectionTitle>历史图谱</SectionTitle>
                  <div className="flex gap-2 overflow-x-auto pb-1 snap-x">
                    {snapshots.slice(1).map((snap) => (
                      <button
                        key={snap.id}
                        onClick={() => handleSelectSnapshot(snap)}
                        className="snap-start shrink-0 flex flex-col items-center gap-1 px-2.5 py-2 rounded-xl bg-surface border border-line hover:border-life-cyan/40 hover:shadow-[0_0_10px_rgba(0,206,201,0.12)] transition-all"
                      >
                        <span className={`w-2 h-2 rounded-full ${valenceDotClass(snap.dimensions.valence)}`} />
                        <span className="text-[10px] text-gray-500 whitespace-nowrap">{snap.dominantEmotion}</span>
                        <span className="text-[9px] text-gray-400 whitespace-nowrap">{formatTime(snap.createdAt)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
