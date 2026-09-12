import { useEffect, useMemo, useState } from 'react';
import { diaryRepo } from '../../db/diary-repo';
import { memoryRepo } from '../../db/memory-repo';
import { stateRepo } from '../../db/state-repo';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { Modal } from '../ui/Modal';
import type { Character, LifeEvent } from '../../db/index';

type TrailItem = {
  id: string;
  characterId: string;
  title: string;
  createdAt: number;
  kind: 'event' | 'milestone' | 'memory';
};

const WEEK = 7 * 24 * 60 * 60 * 1000;

function shortDate(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function moodLabel(value: number) {
  if (value >= 4.5) return '明亮而丰盛';
  if (value >= 3.5) return '温柔向上';
  if (value >= 2.5) return '平静真实';
  return '值得被好好照顾';
}

function avatarFor(character?: Character) {
  if (!character) return '✦';
  return character.avatar;
}

export function WeeklyLifeReviewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const characters = useChatStore((s) => s.characters);
  const [loading, setLoading] = useState(false);
  const [trail, setTrail] = useState<TrailItem[]>([]);
  const [diaryCount, setDiaryCount] = useState(0);
  const [averageMood, setAverageMood] = useState<number | null>(null);
  const [activeCharacters, setActiveCharacters] = useState(0);
  const [milestoneCount, setMilestoneCount] = useState(0);
  const [memoryCount, setMemoryCount] = useState(0);

  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    const since = Date.now() - WEEK;
    setLoading(true);
    void Promise.all([
      stateRepo.getAllByUser(userId),
      diaryRepo.getByUser(userId),
      memoryRepo.getRecentByUser(userId),
    ]).then(([states, diaries, memories]) => {
      if (!alive) return;
      const weeklyEvents: TrailItem[] = [];
      let milestones = 0;
      const active = new Set<string>();

      for (const state of states) {
        const events = (state.lifeEvents ?? []).filter((event) => event.createdAt >= since);
        const reached = (state.milestones ?? []).filter((milestone) => milestone.reachedAt >= since);
        if (events.length || reached.length || state.updatedAt >= since) active.add(state.characterId);
        for (const event of events) {
          weeklyEvents.push({ id: `event-${event.id}`, characterId: state.characterId, title: event.title, createdAt: event.createdAt, kind: 'event' });
        }
        for (const milestone of reached) {
          milestones += 1;
          weeklyEvents.push({ id: `milestone-${state.characterId}-${milestone.reachedAt}`, characterId: state.characterId, title: `关系抵达「${milestone.level}」`, createdAt: milestone.reachedAt, kind: 'milestone' });
        }
      }

      const weeklyMemories = memories.filter((memory) => memory.createdAt >= since);
      for (const memory of weeklyMemories) {
        weeklyEvents.push({ id: `memory-${memory.id}`, characterId: memory.characterId, title: memory.content.slice(0, 64), createdAt: memory.createdAt, kind: 'memory' });
      }

      const weeklyDiaries = diaries.filter((diary) => new Date(`${diary.date}T23:59:59`).getTime() >= since);
      setTrail(weeklyEvents.sort((a, b) => b.createdAt - a.createdAt).slice(0, 7));
      setDiaryCount(weeklyDiaries.length);
      setAverageMood(weeklyDiaries.length ? weeklyDiaries.reduce((sum, diary) => sum + diary.mood, 0) / weeklyDiaries.length : null);
      setActiveCharacters(active.size);
      setMilestoneCount(milestones);
      setMemoryCount(weeklyMemories.length);
    }).catch(() => {
      if (!alive) return;
      setTrail([]);
      setDiaryCount(0);
      setAverageMood(null);
      setActiveCharacters(0);
      setMilestoneCount(0);
      setMemoryCount(0);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [open, userId]);

  const characterMap = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);
  const totalMoments = trail.filter((item) => item.kind === 'event').length + milestoneCount + memoryCount;

  return (
    <Modal open={open} onClose={onClose} title="本周生命回顾" width="max-w-md">
      <div className="max-h-[78vh] overflow-y-auto p-4 sm:p-5">
        <section className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[#17152D] px-5 py-5 shadow-[0_16px_42px_rgba(45,29,112,0.28)]">
          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full border border-life-cyan/20" />
          <div className="absolute -bottom-12 left-8 h-32 w-32 rounded-full bg-gene-purple/30 blur-3xl" />
          <div className="relative">
            <p className="text-[10px] tracking-[0.26em] text-life-cyan/80">WEEKLY LIFE REVIEW</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">这一周，你的世界<br />留下了新的光。</h2>
            <p className="mt-2 text-xs leading-relaxed text-white/55">每段对话、每次记录与每个共同瞬间，都在让关系成为独一无二的轨迹。</p>
          </div>
          <div className="relative mt-5 grid grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/[0.06] py-3">
            <Metric value={activeCharacters} label="活跃角色" accent="text-white" />
            <Metric value={milestoneCount} label="关系进阶" accent="text-life-cyan" />
            <Metric value={memoryCount} label="新记忆" accent="text-[#B7A8FF]" />
          </div>
        </section>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">正在整理这一周的生命轨迹…</div>
        ) : (
          <div className="mt-4 space-y-4">
            <section className="rounded-2xl border border-line bg-panel/65 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] tracking-[0.18em] text-gray-500">YOUR INNER WEATHER</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{averageMood == null ? '还没有留下随记' : `这周的你，${moodLabel(averageMood)}`}</p>
                </div>
                <div className="rounded-xl bg-gene-purple/10 px-3 py-2 text-right">
                  <div className="text-lg font-bold text-gene-purple">{diaryCount}</div>
                  <div className="text-[10px] text-gray-500">篇随记</div>
                </div>
              </div>
              {averageMood != null && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface">
                  <div className="h-full rounded-full bg-gradient-to-r from-gene-purple to-life-cyan" style={{ width: `${Math.max(8, (averageMood / 5) * 100)}%` }} />
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-line bg-panel/65 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] tracking-[0.18em] text-gray-500">SHARED TRAIL</p>
                  <h3 className="mt-1 text-sm font-semibold text-ink">共同轨迹</h3>
                </div>
                <span className="text-xs text-life-cyan">{totalMoments} 个瞬间</span>
              </div>
              {trail.length === 0 ? (
                <p className="mt-4 rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs leading-relaxed text-gray-500">从一次对话或一篇随记开始，下一次打开这里时，就会看到世界如何慢慢生长。</p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {trail.map((item) => {
                    const character = characterMap.get(item.characterId);
                    const color = item.kind === 'milestone' ? 'bg-amber-400' : item.kind === 'memory' ? 'bg-life-cyan' : 'bg-gene-purple';
                    return (
                      <div key={item.id} className="flex items-start gap-3">
                        <div className="relative mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded-xl border border-line bg-surface text-center leading-8 text-sm">
                          {String(avatarFor(character)).startsWith('data:') ? <img src={String(avatarFor(character))} alt="" className="h-full w-full object-cover" /> : avatarFor(character)}
                        </div>
                        <div className="min-w-0 flex-1 border-b border-line/70 pb-2.5 last:border-b-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-ink truncate">{character?.name ?? '你的世界'}</span>
                            <span className="text-[10px] text-gray-400 shrink-0">{shortDate(item.createdAt)}</span>
                          </div>
                          <p className="mt-0.5 text-xs leading-relaxed text-gray-500 line-clamp-2"><span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${color}`} />{item.title}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Metric({ value, label, accent }: { value: number; label: string; accent: string }) {
  return <div className="px-2 text-center"><span className={`block text-base font-semibold tabular-nums ${accent}`}>{value}</span><span className="mt-0.5 block text-[10px] text-white/50">{label}</span></div>;
}
