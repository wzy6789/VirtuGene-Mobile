import { useEffect, useMemo, useState } from 'react';
import type { Character, CharacterState, RelationshipEvent, RelationshipState, SharedStoryEvent } from '../../db/index';
import { stateRepo } from '../../db/state-repo';
import { memoryRepo } from '../../db/memory-repo';
import { sharedEventRepo, pairKey } from '../../db/shared-event-repo';
import { relationshipRepo } from '../../db/relationship-repo';
import { worldRepo } from '../../db/world-repo';
import { characterRef, subjectPairKey, userRef } from '../../lib/world/subjects';
import { describeFacets, recentReasons, reasonText } from '../../lib/world/relationships';
import { getRelationLevel } from '../../lib/affinity';
import { Modal } from '../ui/Modal';
import { SharedStoryEventsModal } from './SharedStoryEventsModal';
import { DEFAULT_USER_AVATAR, useAuthStore } from '../../store/auth-store';

interface RelationNetworkModalProps {
  open: boolean;
  onClose: () => void;
  characters: Character[];
  userId: string;
}

type CharacterWorldState = Pick<CharacterState, 'affinity' | 'mood' | 'lifeEvents' | 'storyRelations' | 'tierNames'>;

type GraphNode = {
  id: string;
  ref: string;
  name: string;
  avatar?: string;
  x: number;
  y: number;
  user?: boolean;
};

type GraphLink = {
  key: string;
  left: string;
  right: string;
  label: string;
  description?: string;
  kind: 'user' | 'story' | 'world';
  affinity?: number;
  state?: RelationshipState;
  reasons: RelationshipEvent[];
  sharedEvents: SharedStoryEvent[];
  recorded: boolean;
};

/** 不规则但可读的星位：避免所有角色挤成一个标准圆环，也给名字留下独立空间。 */
const CONSTELLATION_SLOTS = [
  { x: 50, y: 11 }, { x: 24, y: 16 }, { x: 77, y: 16 },
  { x: 11, y: 36 }, { x: 89, y: 37 }, { x: 25, y: 51 },
  { x: 76, y: 50 }, { x: 12, y: 69 }, { x: 49, y: 76 },
  { x: 88, y: 68 }, { x: 29, y: 88 }, { x: 72, y: 86 },
];

/** 聚焦某个角色时的环带位置：中心留给焦点，底部中央留给 ORIGIN。 */
const FOCUS_SLOTS = [
  { x: 50, y: 10 }, { x: 24, y: 15 }, { x: 77, y: 15 },
  { x: 10, y: 35 }, { x: 90, y: 36 }, { x: 18, y: 54 },
  { x: 82, y: 53 }, { x: 12, y: 73 }, { x: 88, y: 72 },
  { x: 35, y: 88 }, { x: 65, y: 88 },
];

const MAX_NEIGHBORS = 6;

const BACKDROP_STARS = [
  { x: 8, y: 12, s: 1 }, { x: 17, y: 29, s: 2 }, { x: 38, y: 8, s: 1 },
  { x: 63, y: 7, s: 2 }, { x: 94, y: 13, s: 1 }, { x: 5, y: 56, s: 1 },
  { x: 96, y: 56, s: 2 }, { x: 39, y: 93, s: 1 }, { x: 61, y: 94, s: 1 },
];

function relationColor(link: GraphLink, active = false): { line: string; glow: string; dash?: string } {
  const label = `${link.label} ${link.description ?? ''}`;
  if (/(宿敌|敌人|竞争|对立|冲突|摩擦)/.test(label)) return { line: active ? '#fb7185' : 'rgba(251,113,133,.58)', glow: 'rgba(251,113,133,.35)', dash: '4 3' };
  if (link.kind === 'user') return { line: active ? '#77e7e1' : 'rgba(0,206,201,.45)', glow: 'rgba(0,206,201,.30)', dash: link.recorded ? undefined : '2 4' };
  if (/(家人|亲人|兄妹|兄弟|姐妹|父母)/.test(label)) return { line: active ? '#fbbf24' : 'rgba(251,191,36,.58)', glow: 'rgba(251,191,36,.28)' };
  if (/(恋人|爱人|伴侣)/.test(label)) return { line: active ? '#f472b6' : 'rgba(244,114,182,.58)', glow: 'rgba(244,114,182,.28)' };
  return { line: active ? '#b7a8ff' : link.recorded ? 'rgba(167,139,250,.62)' : 'rgba(167,139,250,.22)', glow: 'rgba(167,139,250,.28)', dash: link.recorded ? undefined : '2 4' };
}

function renderAvatar(avatar: string | undefined, fallback: string, className: string) {
  if (avatar?.startsWith('data:')) return <img src={avatar} alt="" className={`${className} object-cover`} />;
  return <span className={`${className} flex items-center justify-center`}>{avatar || fallback}</span>;
}

function linkKey(a: string, b: string) {
  return subjectPairKey(a, b);
}

/** 用确定性直连保持拓扑关系清晰，避免复杂曲线让用户误读线路。 */
function directPath(a: GraphNode, b: GraphNode): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const inset = Math.min(7, length * 0.16);
  const ux = dx / length;
  const uy = dy / length;
  return `M ${a.x + ux * inset} ${a.y + uy * inset} L ${b.x - ux * inset} ${b.y - uy * inset}`;
}

function linkScore(link: GraphLink): number {
  const kindScore = link.kind === 'story' ? 45 : link.kind === 'world' ? 38 : 20;
  const evidenceScore = link.reasons.length * 8 + link.sharedEvents.length * 7;
  const affinityScore = link.affinity ? Math.min(24, link.affinity / 4) : 0;
  return (link.recorded ? 100 : 0) + kindScore + evidenceScore + affinityScore;
}

function relativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function RelationNetworkModal({ open, onClose, characters, userId }: RelationNetworkModalProps) {
  const [states, setStates] = useState<Record<string, CharacterWorldState>>({});
  const [relationshipStates, setRelationshipStates] = useState<RelationshipState[]>([]);
  const [relationshipEvents, setRelationshipEvents] = useState<RelationshipEvent[]>([]);
  const [recentMemory, setRecentMemory] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusedRef, setFocusedRef] = useState<string | null>(null);
  const [showAllNeighbors, setShowAllNeighbors] = useState(false);
  const [eventsByPair, setEventsByPair] = useState<Record<string, SharedStoryEvent[]>>({});
  const [detailPair, setDetailPair] = useState<{ a: Character; b: Character } | null>(null);
  const [loading, setLoading] = useState(false);
  const userAvatar = useAuthStore((state) => state.avatar) ?? DEFAULT_USER_AVATAR;

  useEffect(() => {
    if (open) {
      setSelectedKey(null);
      setFocusedRef(null);
      setShowAllNeighbors(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const world = await worldRepo.ensureDefaultWorld(userId);
        const [characterStates, sharedEvents, worldStates, worldEvents] = await Promise.all([
          stateRepo.getAllByUser(userId),
          sharedEventRepo.getAllByUser(userId),
          relationshipRepo.listStatesByWorld(world.id, 300, userId),
          relationshipRepo.listEventsByWorld(world.id, 400, userId),
        ]);
        if (!alive) return;
        setStates(Object.fromEntries(characterStates.map((state) => [state.characterId, {
          affinity: state.affinity,
          mood: state.mood,
          lifeEvents: state.lifeEvents ?? [],
          storyRelations: state.storyRelations ?? [],
          tierNames: state.tierNames,
        }])));
        const grouped: Record<string, SharedStoryEvent[]> = {};
        for (const event of sharedEvents) {
          if (!Array.isArray(event.characterIds) || event.characterIds.length < 2) continue;
          const key = pairKey(event.characterIds[0], event.characterIds[1]);
          (grouped[key] ??= []).push(event);
        }
        setEventsByPair(grouped);
        setRelationshipStates(worldStates);
        setRelationshipEvents(worldEvents);
      } catch {
        if (!alive) return;
        setStates({});
        setEventsByPair({});
        setRelationshipStates([]);
        setRelationshipEvents([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, userId]);

  useEffect(() => {
    const refs = selectedKey?.split('|') ?? [];
    const characterId = refs.includes(userRef(userId))
      ? refs.find((ref) => ref.startsWith('c:'))?.slice(2) ?? null
      : null;
    if (!characterId || !userId) {
      setRecentMemory(null);
      return;
    }
    let alive = true;
    void memoryRepo.getRecentByCharacter(characterId, userId, 1).then((items) => {
      if (alive) setRecentMemory(items[0]?.content ?? null);
    });
    return () => { alive = false; };
  }, [selectedKey, userId]);

  const visible = characters.slice(0, CONSTELLATION_SLOTS.length);
  const byCharacterId = useMemo(() => new Map(visible.map((character) => [character.id, character])), [visible]);
  const stateByPair = useMemo(() => new Map(relationshipStates.map((state) => [state.pairKey, state])), [relationshipStates]);
  const worldEventsByPair = useMemo(() => {
    const map = new Map<string, RelationshipEvent[]>();
    for (const event of relationshipEvents) {
      if (!event.pairKey) continue;
      const list = map.get(event.pairKey) ?? [];
      list.push(event);
      map.set(event.pairKey, list);
    }
    return map;
  }, [relationshipEvents]);

  const links = useMemo<GraphLink[]>(() => {
    const merged = new Map<string, GraphLink>();
    const add = (input: Omit<GraphLink, 'key' | 'reasons' | 'sharedEvents' | 'recorded'> & { reasons?: RelationshipEvent[]; sharedEvents?: SharedStoryEvent[]; recorded?: boolean }) => {
      const key = linkKey(input.left, input.right);
      const previous = merged.get(key);
      if (!previous) {
        merged.set(key, {
          ...input,
          key,
          reasons: input.reasons ?? [],
          sharedEvents: input.sharedEvents ?? [],
          recorded: input.recorded ?? false,
        });
        return;
      }
      merged.set(key, {
        ...previous,
        label: previous.kind === 'user' ? previous.label : input.label || previous.label,
        description: previous.description || input.description,
        kind: previous.kind === 'user' ? previous.kind : input.kind,
        state: input.state ?? previous.state,
        affinity: input.affinity ?? previous.affinity,
        reasons: [...previous.reasons, ...(input.reasons ?? [])].filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index),
        sharedEvents: [...previous.sharedEvents, ...(input.sharedEvents ?? [])].filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index),
        recorded: previous.recorded || input.recorded === true,
      });
    };

    const user = userRef(userId);
    for (const character of visible) {
      const ref = characterRef(character.id);
      const state = states[character.id];
      const affinity = state?.affinity ?? 0;
      const level = getRelationLevel(affinity).level;
      const key = linkKey(user, ref);
      const userHistory = Boolean(
        affinity > 0 ||
        (state?.lifeEvents?.length ?? 0) > 0 ||
        (state?.storyRelations?.length ?? 0) > 0 ||
        stateByPair.has(key) ||
        (worldEventsByPair.get(key)?.length ?? 0) > 0,
      );
      add({
        left: user,
        right: ref,
        label: level.name,
        description: level.desc,
        kind: 'user',
        affinity,
        state: stateByPair.get(key),
        reasons: worldEventsByPair.get(key),
        recorded: userHistory,
      });
    }

    // 角色之间的手动故事关系：两端都在图中时才画线，避免出现孤儿节点。
    for (const [sourceId, state] of Object.entries(states)) {
      if (!byCharacterId.has(sourceId)) continue;
      for (const relation of state.storyRelations ?? []) {
        if (!byCharacterId.has(relation.targetCharacterId)) continue;
        const left = characterRef(sourceId);
        const right = characterRef(relation.targetCharacterId);
        const key = linkKey(left, right);
        add({
          left,
          right,
          label: relation.label || '故事关联',
          description: relation.description,
          kind: 'story',
          state: stateByPair.get(key),
          reasons: worldEventsByPair.get(key),
          sharedEvents: eventsByPair[pairKey(sourceId, relation.targetCharacterId)],
          recorded: true,
        });
      }
    }

    // 世界剧场产生的角色↔角色关系，即使没有手动设定，也会自然长出一条星际航线。
    for (const state of relationshipStates) {
      // 兼容旧版迁移中可能只有 subjectA / subjectB 的关系行，避免整张星图因一条旧数据消失。
      const subjects = Array.isArray(state.subjects) && state.subjects.length > 0
        ? state.subjects
        : [state.subjectA, state.subjectB].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
      const [left, right] = subjects.filter((ref) => ref.startsWith('c:'));
      if (!left || !right || !byCharacterId.has(left.slice(2)) || !byCharacterId.has(right.slice(2))) continue;
      const key = linkKey(left, right);
      const reading = describeFacets(state, 1)[0]?.text;
      add({
        left,
        right,
        label: reading || '关系轨迹',
        kind: 'world',
        state,
        reasons: worldEventsByPair.get(key),
        sharedEvents: eventsByPair[pairKey(left.slice(2), right.slice(2))],
        recorded: true,
      });
    }
    return [...merged.values()];
  }, [byCharacterId, eventsByPair, relationshipStates, stateByPair, states, userId, visible, worldEventsByPair]);

  const originRef = userRef(userId);
  const activeFocusRef = focusedRef?.startsWith('c:') && byCharacterId.has(focusedRef.slice(2)) ? focusedRef : originRef;
  const focusLinks = useMemo(() => links
    .filter((link) => link.left === activeFocusRef || link.right === activeFocusRef)
    .sort((a, b) => linkScore(b) - linkScore(a) || a.label.localeCompare(b.label)), [activeFocusRef, links]);
  const primaryFocusLink = focusLinks.find((link) => link.left === originRef || link.right === originRef);
  const displayLinks = useMemo(() => {
    if (showAllNeighbors || focusLinks.length <= MAX_NEIGHBORS) return focusLinks;
    const rest = focusLinks.filter((link) => link !== primaryFocusLink);
    return primaryFocusLink ? [primaryFocusLink, ...rest.slice(0, MAX_NEIGHBORS - 1)] : rest.slice(0, MAX_NEIGHBORS);
  }, [focusLinks, primaryFocusLink, showAllNeighbors]);
  const hiddenLinkCount = Math.max(0, focusLinks.length - displayLinks.length);

  const nodes = useMemo<GraphNode[]>(() => {
    const focusNode = activeFocusRef === originRef ? null : visible.find((character) => characterRef(character.id) === activeFocusRef);
    const neighborSet = new Set(displayLinks.flatMap((link) => [link.left, link.right]).filter((ref) => ref !== activeFocusRef));
    // 聚焦角色时固定把“你”放在底部，避免被关系排序挤到普通角色位置。
    const neighborRefs = [
      ...(neighborSet.has(originRef) ? [originRef] : []),
      ...[...neighborSet].filter((ref) => ref !== originRef),
    ];
    const neighborNodes = neighborRefs.map((ref, index) => {
      if (ref === originRef) return { id: ref, ref, name: '你', avatar: userAvatar, x: 50, y: 91, user: true } satisfies GraphNode;
      const character = byCharacterId.get(ref.slice(2));
      const position = activeFocusRef === originRef
        ? CONSTELLATION_SLOTS[index]
        : FOCUS_SLOTS[index - (neighborSet.has(originRef) ? 1 : 0)];
      return { id: ref, ref, name: character?.name ?? '未知角色', avatar: character?.avatar, ...position } satisfies GraphNode;
    });
    return [
      focusNode
        ? { id: focusNode.id, ref: activeFocusRef, name: focusNode.name, avatar: focusNode.avatar, x: 50, y: 43 }
        : { id: originRef, ref: originRef, name: '你', avatar: userAvatar, x: 50, y: 43, user: true },
      ...neighborNodes,
    ];
  }, [activeFocusRef, byCharacterId, displayLinks, originRef, userAvatar, visible]);

  const nodesByRef = useMemo(() => new Map(nodes.map((node) => [node.ref, node])), [nodes]);

  const selected = displayLinks.find((link) => link.key === selectedKey) ?? null;
  const selectedRefs = useMemo(() => new Set(selectedKey?.split('|') ?? []), [selectedKey]);
  const selectedNodes = selected ? [nodesByRef.get(selected.left), nodesByRef.get(selected.right)].filter((node): node is GraphNode => Boolean(node)) : [];
  const selectedCharacter = selectedNodes.find((node) => !node.user);
  const selectedReasons = selected ? recentReasons(selected.reasons, 3) : [];
  const focusedCharacter = activeFocusRef.startsWith('c:') ? byCharacterId.get(activeFocusRef.slice(2)) : undefined;

  return (
    <Modal open={open} onClose={onClose} title="关系星图" width="max-w-xl">
      <div className="px-4 pb-5 pt-3 sm:px-5">
        <div className="mb-3 flex items-end justify-between gap-3 px-1">
          <div>
            <p className="text-[11px] font-medium tracking-[0.24em] text-life-cyan">VIRTUGENE / CONSTELLATION</p>
            <p className="mt-1 text-sm font-medium text-ink">{focusedCharacter ? `正在查看 ${focusedCharacter.name} 的关系` : '每一次相遇，都会改变星图的形状。'}</p>
          </div>
          <div className="shrink-0 text-right text-[11px] text-gray-500">
            <span className="block text-sm font-semibold tabular-nums text-life-cyan">{links.filter((link) => link.recorded).length}</span>
            条已记录航线
          </div>
        </div>

        <section className="relative h-[430px] overflow-hidden rounded-[30px] border border-white/10 bg-[#08091a] shadow-[inset_0_0_70px_rgba(75,61,170,.18)]" aria-label="角色关系星图">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_43%,rgba(0,206,201,.16),transparent_19%),radial-gradient(circle_at_18%_18%,rgba(108,92,231,.18),transparent_34%),radial-gradient(circle_at_88%_78%,rgba(63,38,130,.25),transparent_36%)]" />
          <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)', backgroundSize: '34px 34px' }} />
          {BACKDROP_STARS.map((star) => <span key={`${star.x}-${star.y}`} className="absolute rounded-full bg-[#c8c2ff] shadow-[0_0_10px_2px_rgba(167,139,250,.5)]" style={{ left: `${star.x}%`, top: `${star.y}%`, width: `${star.s}px`, height: `${star.s}px` }} />)}
          <div className="absolute left-1/2 top-[43%] h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-life-cyan/10" />
          <div className="absolute left-1/2 top-[43%] h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gene-purple/10 border-dashed" />

          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {displayLinks.map((link) => {
              const a = nodesByRef.get(link.left);
              const b = nodesByRef.get(link.right);
              if (!a || !b) return null;
              const active = selectedKey === link.key;
               const dimmed = Boolean(selectedKey && !active && !selectedRefs.has(a.ref) && !selectedRefs.has(b.ref));
               const color = relationColor(link, active);
               const path = directPath(a, b);
                return (
                <g key={link.key} className="cursor-pointer" onClick={() => setSelectedKey(link.key)}>
                  <path d={path} fill="none" stroke={color.glow} strokeWidth={active ? 4 : 2.3} strokeLinecap="round" opacity={dimmed ? .04 : .45} />
                  <path d={path} fill="none" stroke={color.line} strokeWidth={active ? 1.2 : link.recorded ? .7 : .45} strokeLinecap="round" strokeDasharray={color.dash} opacity={dimmed ? .16 : 1} />
                </g>
              );
            })}
          </svg>

          {nodes.map((node) => {
            const connected = links.filter((link) => link.left === node.ref || link.right === node.ref);
             const active = selectedRefs.has(node.ref);
            const highlighted = connected.some((link) => link.recorded);
            const isCenterNode = node.ref === activeFocusRef;
             if (node.user) {
              return (
                <button key={node.id} type="button" onClick={() => { setSelectedKey(null); setFocusedRef(null); setShowAllNeighbors(false); }} className="absolute -translate-x-1/2 -translate-y-1/2 text-center outline-none" style={{ left: `${node.x}%`, top: `${node.y}%` }} aria-label="你的世界">
                  <span className="relative mx-auto grid h-12 w-12 place-items-center rounded-[16px] border border-life-cyan/60 bg-[#101d34]/90 shadow-[0_0_28px_rgba(0,206,201,.28)] transition-transform duration-300 hover:scale-105">
                    <span className="relative z-10 h-8 w-8 overflow-hidden rounded-[10px]">{renderAvatar(node.avatar, '✦', 'h-full w-full')}</span>
                  </span>
                </button>
              );
            }
              return (
                <button key={node.id} type="button" onClick={() => { setSelectedKey(linkKey(userRef(userId), node.ref)); setFocusedRef(node.ref); setShowAllNeighbors(false); }} className={`absolute -translate-x-1/2 -translate-y-1/2 text-center outline-none transition-all duration-300 ${isCenterNode ? 'z-20 scale-[1.12]' : active ? 'z-20 scale-110' : 'z-10'} ${!highlighted ? 'opacity-75' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} aria-label={`查看 ${node.name} 的关系`}>
                <span className={`relative mx-auto grid place-items-center border bg-[#13162d]/95 transition-all ${isCenterNode ? 'h-16 w-16 rounded-[20px] border-life-cyan shadow-[0_0_34px_rgba(0,206,201,.48)]' : 'h-12 w-12 rounded-[16px]'} ${!isCenterNode && active ? 'border-life-cyan shadow-[0_0_28px_rgba(0,206,201,.48)]' : !isCenterNode && highlighted ? 'border-gene-purple/65 shadow-[0_0_18px_rgba(167,139,250,.28)]' : !isCenterNode ? 'border-white/15 shadow-[0_0_18px_rgba(255,255,255,.08)]' : ''}`}>
                  <span className="absolute inset-[3px] rotate-45 rounded-[11px] border border-white/10" />
                  <span className={`relative z-10 overflow-hidden text-base ${isCenterNode ? 'h-11 w-11 rounded-[14px]' : 'h-8 w-8 rounded-[10px]'}`}>{renderAvatar(node.avatar, '✦', 'h-full w-full')}</span>
                  {highlighted && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-life-cyan shadow-[0_0_10px_3px_rgba(0,206,201,.45)]" />}
                </span>
              </button>
            );
          })}

           {loading && <span className="absolute bottom-4 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-life-cyan shadow-[0_0_12px_4px_rgba(0,206,201,.45)] animate-pulse" role="status" aria-label="正在同步星图" />}
        </section>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1.5"><i className="h-px w-5 bg-life-cyan" />你与角色</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-px w-5 bg-gene-purple" />角色关系</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-px w-5 border-t border-dashed border-rose-400" />冲突航线</span>
          <span className="ml-auto text-gray-600">点星点或航线查看详情</span>
        </div>

        {focusedCharacter && (
          <button type="button" onClick={() => { setFocusedRef(null); setSelectedKey(null); setShowAllNeighbors(false); }} className="mt-3 flex w-full items-center justify-between rounded-xl border border-life-cyan/20 bg-life-cyan/[0.06] px-3 py-2 text-left text-xs text-life-cyan">
            <span>‹ 回到你的视角</span>
            <span className="text-[11px] text-life-cyan/60">{displayLinks.length} 条近邻航线</span>
          </button>
        )}
        {hiddenLinkCount > 0 && (
          <button type="button" onClick={() => setShowAllNeighbors((value) => !value)} className="mt-2 w-full rounded-xl border border-line px-3 py-2 text-center text-xs text-gray-500 transition-colors hover:text-ink">
            {showAllNeighbors ? '收起较远关系' : `展开另外 ${hiddenLinkCount} 条关系`}
          </button>
        )}

        {selected && (
          <section className="mt-4 rounded-[24px] border border-life-cyan/20 bg-gradient-to-br from-life-cyan/[0.08] to-gene-purple/[0.08] px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] tracking-[0.18em] text-life-cyan/70">SELECTED ROUTE</p>
                <h3 className="mt-1 truncate text-base font-semibold text-ink">{selectedNodes.map((node) => node.name).join('  ↔  ')}</h3>
              </div>
              <button type="button" onClick={() => { setSelectedKey(null); setFocusedRef(null); }} className="shrink-0 rounded-full border border-line px-2 py-1 text-xs text-gray-500">收起</button>
            </div>

             {selected.description && selected.kind !== 'user' && <p className="mt-3 text-xs leading-5 text-gray-500">{selected.description}</p>}

            {selectedReasons.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-line/70 pt-3">
                {selectedReasons.map((event) => <li key={event.id} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-life-cyan" /><span className="min-w-0 flex-1 text-xs leading-5 text-ink/85">{reasonText(event)}<span className="ml-2 text-[11px] text-gray-500">{relativeTime(event.createdAt)}</span></span></li>)}
              </ul>
            )}

            {selected.sharedEvents.length > 0 && selectedNodes.length === 2 && !selectedNodes.some((node) => node.user) && (
              <button type="button" onClick={() => setDetailPair({ a: byCharacterId.get(selectedNodes[0].id)!, b: byCharacterId.get(selectedNodes[1].id)! })} className="mt-3 w-full rounded-xl border border-life-cyan/25 bg-life-cyan/10 px-3 py-2 text-left text-xs text-life-cyan">
                查看 {selected.sharedEvents.length} 段共同经历 <span className="float-right">›</span>
              </button>
            )}
            {recentMemory && selectedCharacter && <p className="mt-3 border-t border-line/70 pt-3 text-xs leading-5 text-gray-500"><span className="text-gene-purple">最近记忆</span> · {recentMemory}</p>}
          </section>
        )}

        {characters.length > visible.length && <p className="mt-3 px-1 text-[11px] text-gray-500">星图先展示最活跃的 {visible.length} 位角色，更多星点会在筛选视图中展开。</p>}
      </div>

      {detailPair && <SharedStoryEventsModal open={!!detailPair} onClose={() => setDetailPair(null)} a={detailPair.a} b={detailPair.b} userId={userId} />}
    </Modal>
  );
}
