import { useEffect, useMemo, useState } from 'react';
import type { Character, LifeEvent, SharedStoryEvent, StoryRelation } from '../../db/index';
import { stateRepo } from '../../db/state-repo';
import { memoryRepo } from '../../db/memory-repo';
import { sharedEventRepo, pairKey } from '../../db/shared-event-repo';
import { getRelationLevel, levelProgress } from '../../lib/affinity';
import { Modal } from '../ui/Modal';
import { SharedStoryEventsModal } from './SharedStoryEventsModal';

interface RelationNetworkModalProps {
  open: boolean;
  onClose: () => void;
  characters: Character[];
  userId: string;
}

type WorldState = {
  affinity: number;
  mood: number;
  lifeEvents: LifeEvent[];
  storyRelations: StoryRelation[];
};

type Link = { left: string; right: string; label: string; description?: string };

function relationColor(label: string) {
  if (/(宿敌|敌人|竞争|对立|冲突)/.test(label)) return { line: 'rgba(251,113,133,.82)', active: 'rgba(251,113,133,1)', dot: 'bg-rose-400' };
  if (/(家人|亲人|兄妹|兄弟|姐妹|父母)/.test(label)) return { line: 'rgba(251,191,36,.82)', active: 'rgba(251,191,36,1)', dot: 'bg-amber-400' };
  if (/(恋人|爱人|伴侣)/.test(label)) return { line: 'rgba(244,114,182,.82)', active: 'rgba(244,114,182,1)', dot: 'bg-pink-400' };
  if (/(搭档|同伴|队友|朋友)/.test(label)) return { line: 'rgba(0,206,201,.78)', active: 'rgba(0,206,201,1)', dot: 'bg-life-cyan' };
  return { line: 'rgba(167,139,250,.68)', active: 'rgba(0,206,201,.95)', dot: 'bg-[#A99CF9]' };
}

export function RelationNetworkModal({ open, onClose, characters, userId }: RelationNetworkModalProps) {
  const [states, setStates] = useState<Record<string, WorldState>>({});
  const [recentMemory, setRecentMemory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 人物共同事件：按"一对角色"分组，点击某条关系即可查看/编辑 */
  const [eventsByPair, setEventsByPair] = useState<Record<string, SharedStoryEvent[]>>({});
  const [detailPair, setDetailPair] = useState<{ a: Character; b: Character } | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    void stateRepo.getAllByUser(userId).then((items) => {
      setStates(Object.fromEntries(items.map((state) => [state.characterId, {
        affinity: state.affinity,
        mood: state.mood,
        lifeEvents: state.lifeEvents ?? [],
        storyRelations: state.storyRelations ?? [],
      }])));
    });
    void sharedEventRepo.getAllByUser(userId).then((events) => {
      const grouped: Record<string, SharedStoryEvent[]> = {};
      for (const event of events) {
        const key = pairKey(event.characterIds[0], event.characterIds[1]);
        (grouped[key] ??= []).push(event);
      }
      setEventsByPair(grouped);
    });
  }, [open, userId, detailPair]);

  useEffect(() => {
    if (!selectedId || !userId) {
      setRecentMemory(null);
      return;
    }
    let active = true;
    void memoryRepo.getRecentByCharacter(selectedId, userId, 1).then((items) => {
      if (active) setRecentMemory(items[0]?.content ?? null);
    });
    return () => { active = false; };
  }, [selectedId, userId]);

  const visible = characters.slice(0, 12);
  const byCharacterId = useMemo(() => new Map(visible.map((character) => [character.id, character])), [visible]);
  const links = useMemo<Link[]>(() => {
    const merged = new Map<string, Link>();
    for (const [sourceId, state] of Object.entries(states)) {
      for (const relation of state.storyRelations) {
        if (!byCharacterId.has(sourceId) || !byCharacterId.has(relation.targetCharacterId)) continue;
        const [left, right] = [sourceId, relation.targetCharacterId].sort();
        const key = `${left}|${right}`;
        if (!merged.has(key)) merged.set(key, { left, right, label: relation.label || '故事关联', description: relation.description });
      }
    }
    return [...merged.values()];
  }, [states, byCharacterId]);

  const positions = visible.map((_, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(visible.length, 1) - Math.PI / 2;
    return { x: 50 + Math.cos(angle) * 35, y: 50 + Math.sin(angle) * 34 };
  });
  const positioned = new Map(visible.map((character, index) => [character.id, { character, position: positions[index] }]));
  const selected = selectedId ? byCharacterId.get(selectedId) : undefined;
  const selectedState = selected ? states[selected.id] : undefined;

  return (
    <Modal open={open} onClose={onClose} title="角色关系网络" width="max-w-lg">
      <div className="p-5">
        <section className="relative mb-4 overflow-hidden rounded-2xl border border-gene-purple/20 bg-gradient-to-r from-gene-purple/[0.11] to-life-cyan/[0.07] px-4 py-3">
          <div className="absolute -right-5 -top-8 h-24 w-24 rounded-full border border-life-cyan/20" />
          <p className="relative text-[10px] tracking-[0.2em] text-life-cyan">STORY RELATIONSHIP MAP</p>
          <p className="relative mt-1 text-sm font-semibold text-ink">这是一张人物关系图，不是群聊记录。</p>
          <p className="relative mt-1 text-[11px] leading-relaxed text-gray-500">在创建或编辑角色时设定同伴、家人、宿敌等关系；共同经历会丰富角色，但不会替你决定他们的关系。</p>
          <div className="relative mt-2 inline-flex rounded-full border border-life-cyan/20 bg-panel/50 px-2 py-1 text-[10px] text-life-cyan">{links.length} 条故事连接</div>
        </section>

        {visible.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-500">先创造至少一位角色，再开始编织你的故事世界。</div>
        ) : (
          <div className="relative h-[360px] overflow-hidden rounded-3xl border border-line bg-[#0B0A18]">
            <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at center, rgba(108,92,231,.30), transparent 43%), linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)', backgroundSize: '100% 100%, 32px 32px, 32px 32px' }} />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06] text-xl text-life-cyan shadow-[0_0_30px_rgba(108,92,231,.35)]">✦</div>
              <span className="mt-1 block text-[9px] tracking-[0.16em] text-white/40">YOUR WORLD</span>
            </div>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {links.map((link) => {
                const a = positioned.get(link.left)?.position;
                const b = positioned.get(link.right)?.position;
                const active = selectedId === link.left || selectedId === link.right;
                const color = relationColor(link.label);
                return a && b ? <g key={`${link.left}-${link.right}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active ? color.active : color.line} strokeWidth={active ? '1.2' : '0.7'} strokeDasharray={/(宿敌|敌人|竞争|对立|冲突)/.test(link.label) ? '2 1.4' : undefined} />{active && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 1.5} textAnchor="middle" fill="#F0EDFF" fontSize="3.2" fontWeight="600">{link.label}</text>}</g> : null;
              })}
            </svg>
            {visible.map((character, index) => {
              const position = positions[index];
              const ownLink = links.find((link) => link.left === character.id || link.right === character.id);
              const related = !!ownLink;
              return (
                <div key={character.id} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1" style={{ left: `${position.x}%`, top: `${position.y}%` }}>
                  <button onClick={() => setSelectedId(character.id)} className={`relative h-12 w-12 overflow-hidden rounded-2xl border bg-[#20203B] text-xl transition-all ${selectedId === character.id ? 'scale-110 border-life-cyan shadow-[0_0_24px_rgba(0,206,201,.55)]' : related ? 'border-[#A99CF9]/60 shadow-[0_0_15px_rgba(108,92,231,.28)]' : 'border-white/15 opacity-75'}`}>
                    {character.avatar.startsWith('data:') ? <img src={character.avatar} alt="" className="h-full w-full object-cover" /> : character.avatar}
                    {related && <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-[#0B0A18] ${relationColor(ownLink!.label).dot}`} />}
                  </button>
                  <span className="max-w-20 truncate text-[10px] text-gray-300">{character.name}</span>
                </div>
              );
            })}
            {links.length === 0 && <div className="absolute inset-x-10 bottom-6 rounded-xl border border-dashed border-white/15 bg-black/15 px-3 py-2 text-center text-[11px] leading-relaxed text-white/45">还没有设定人物关系。编辑任意角色，就能把他们编进同一个故事。</div>}
          </div>
        )}

        {selected && selectedState && (() => {
          const relation = getRelationLevel(selectedState.affinity);
          const storyLinks = selectedState.storyRelations.map((link) => ({ ...link, character: byCharacterId.get(link.targetCharacterId) })).filter((link) => link.character);
          return (
            <section className="mt-3 rounded-2xl border border-life-cyan/20 bg-life-cyan/[0.06] px-4 py-3">
              <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-ink truncate">{selected.name}</p><p className="mt-0.5 text-[11px] text-gray-500">与你的关系：{relation.level.name}</p></div><button onClick={() => setSelectedId(null)} className="text-xs text-gray-500">收起</button></div>
              <div className="mt-3 rounded-xl bg-black/10 px-3 py-2"><span className="block text-[10px] text-gray-500">当前关系温度</span><span className="text-sm text-life-cyan">{Math.round(selectedState.affinity)} · {relation.level.name}</span><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-gene-purple to-life-cyan" style={{ width: `${levelProgress(selectedState.affinity, relation.level, relation.next)}%` }} /></div></div>
              <div className="mt-3">
                <div className="flex items-center justify-between gap-3"><p className="text-[10px] tracking-[0.16em] text-gray-500">STORY CONNECTIONS</p>{storyLinks.length > 0 && <span className="text-[10px] text-life-cyan">角色已知</span>}</div>
                {storyLinks.length === 0 ? <p className="mt-1 text-xs text-gray-500">尚未设定故事关系。</p> : (
                  <div className="mt-2 space-y-2">
                    {storyLinks.map((link) => {
                      const pairEvents = eventsByPair[pairKey(selected.id, link.targetCharacterId)] ?? [];
                      return (
                        <div key={link.targetCharacterId} className="rounded-xl border border-gene-purple/15 bg-panel/55 px-2.5 py-2">
                          <button onClick={() => setSelectedId(link.targetCharacterId)} className="flex w-full items-start gap-2.5 text-left">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface text-xs">{link.character!.avatar.startsWith('data:') ? <img src={link.character!.avatar} alt="" className="h-full w-full object-cover" /> : link.character!.avatar}</span>
                            <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-ink">{link.character!.name} <span className="text-gene-purple">· {link.label}</span></span>{link.description && <span className="mt-0.5 block text-[10px] leading-relaxed text-gray-500">{link.description}</span>}</span>
                            <span className="pt-0.5 text-[10px] text-life-cyan">查看</span>
                          </button>
                          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
                            <span className="text-[10px] text-gray-500">
                              {pairEvents.length > 0 ? `${pairEvents.length} 段共同经历` : '还没有共同经历'}
                            </span>
                            <button
                              onClick={() => setDetailPair({ a: selected, b: link.character! })}
                              className="rounded-full border border-life-cyan/30 bg-life-cyan/10 px-2 py-0.5 text-[10px] text-life-cyan active:scale-[.97]"
                            >
                              共同事件
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {storyLinks.length > 0 && <p className="mt-2 text-[10px] leading-relaxed text-gray-500">这不是群聊绑定。它是角色自己的世界观，会在相关话题里自然影响态度与表达。</p>}
              </div>
              {(selectedState.lifeEvents.length > 0 || recentMemory) && <div className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-gray-500">{selectedState.lifeEvents.slice(0, 1).map((event) => <p key={event.id}><span className="text-life-cyan">共同事件</span> · {event.title}</p>)}{recentMemory && <p><span className="text-gene-purple">最近记忆</span> · {recentMemory}</p>}</div>}
            </section>
          );
        })()}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-gray-500"><span className="inline-flex items-center gap-1.5"><i className="h-px w-4 bg-life-cyan" />搭档 / 同伴</span><span className="inline-flex items-center gap-1.5"><i className="h-px w-4 bg-amber-400" />家人</span><span className="inline-flex items-center gap-1.5"><i className="h-px w-4 bg-pink-400" />恋人</span><span className="inline-flex items-center gap-1.5"><i className="h-px w-4 border-t border-dashed border-rose-400" />宿敌 / 竞争</span></div>
        {characters.length > visible.length && <p className="mt-3 text-[11px] text-gray-500">当前展示前 {visible.length} 位角色；后续将支持更大规模世界的筛选视图。</p>}
      </div>

      {detailPair && (
        <SharedStoryEventsModal
          open={!!detailPair}
          onClose={() => setDetailPair(null)}
          a={detailPair.a}
          b={detailPair.b}
          userId={userId}
        />
      )}
    </Modal>
  );
}
