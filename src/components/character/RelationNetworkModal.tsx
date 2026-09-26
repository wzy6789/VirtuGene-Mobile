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
import { portraitLayout, portraitRoute } from '../../lib/relationship-layout';

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

/** 每组最多八位近邻，更多头像分页展示，避免挤压和重叠。 */
const MAX_NEIGHBORS = 8;

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
  if (avatar && /^(data:|https?:\/\/|blob:)/.test(avatar)) return <img src={avatar} alt="" className={`${className} object-cover`} draggable={false} />;
  return <span className={`${className} flex items-center justify-center`}>{avatar || fallback}</span>;
}

function linkKey(a: string, b: string) {
  return subjectPairKey(a, b);
}

/** 优先呈现有实际关系和共同经历的航线。 */
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
  const [eventsByPair, setEventsByPair] = useState<Record<string, SharedStoryEvent[]>>({});
  const [detailPair, setDetailPair] = useState<{ a: Character; b: Character } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [neighborPage, setNeighborPage] = useState(0);
  const userAvatar = useAuthStore((state) => state.avatar) ?? DEFAULT_USER_AVATAR;

  useEffect(() => {
    if (open) {
      setSelectedKey(null);
      setFocusedRef(null);
      setNeighborPage(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !userId) return;
    let alive = true;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        await worldRepo.ensureDefaultWorld(userId);
        const worlds = await worldRepo.listByUser(userId);
        const [characterStates, sharedEvents, worldStates, worldEvents] = await Promise.all([
          stateRepo.getAllByUser(userId),
          sharedEventRepo.getAllByUser(userId),
          Promise.all(worlds.map(world=>relationshipRepo.listStatesByWorld(world.id, 300, userId))).then(rows=>rows.flat()),
          Promise.all(worlds.map(world=>relationshipRepo.listEventsByWorld(world.id, 400, userId))).then(rows=>rows.flat()),
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
          for(let a=0;a<event.characterIds.length;a++) for(let b=a+1;b<event.characterIds.length;b++) {
            const key = pairKey(event.characterIds[a], event.characterIds[b]);
            (grouped[key] ??= []).push(event);
          }
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
        setLoadError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, userId, reload]);

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
    void memoryRepo.getRecentActiveByCharacter(characterId, userId, 1).then((items) => {
      if (alive) setRecentMemory(items[0]?.content ?? null);
    }).catch(() => { if (alive) setRecentMemory(null); });
    return () => { alive = false; };
  }, [selectedKey, userId]);

  const visible = useMemo(()=>characters.filter(character => character.createdBy === userId),[characters,userId]);
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
    // A real shared experience is also evidence of a connection, even without
    // a manually assigned relation or a numerical relationship-state row.
    for(const events of Object.values(eventsByPair)) {
      const ids=events[0]?.characterIds??[];
      for(let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++) {
        if(!byCharacterId.has(ids[a])||!byCharacterId.has(ids[b]))continue;
        const pairEvents=eventsByPair[pairKey(ids[a],ids[b])];
        if(!pairEvents?.length)continue;
        const key=linkKey(characterRef(ids[a]),characterRef(ids[b]));
        if(merged.has(key))continue;
        add({left:characterRef(ids[a]),right:characterRef(ids[b]),label:'共同经历',kind:'world',sharedEvents:pairEvents,recorded:true});
      }
    }
    return [...merged.values()];
  }, [byCharacterId, eventsByPair, relationshipStates, stateByPair, states, userId, visible, worldEventsByPair]);

  const originRef = userRef(userId);
  const activeFocusRef = focusedRef?.startsWith('c:') && byCharacterId.has(focusedRef.slice(2)) ? focusedRef : originRef;
  const focusLinks = useMemo(() => links
    .filter((link) => link.left === activeFocusRef || link.right === activeFocusRef)
    .sort((a, b) => linkScore(b) - linkScore(a) || a.label.localeCompare(b.label)), [activeFocusRef, links]);
  useEffect(()=>{setNeighborPage(page=>Math.min(page,Math.max(0,Math.ceil(focusLinks.length/MAX_NEIGHBORS)-1)));},[focusLinks.length]);
  const displayLinks = useMemo(() => {
    return focusLinks.slice(neighborPage * MAX_NEIGHBORS, (neighborPage + 1) * MAX_NEIGHBORS);
  }, [focusLinks, neighborPage]);

  const nodes = useMemo<GraphNode[]>(() => {
    const focusNode = activeFocusRef === originRef ? null : visible.find((character) => characterRef(character.id) === activeFocusRef);
    const neighborSet = new Set(displayLinks.flatMap((link) => [link.left, link.right]).filter((ref) => ref !== activeFocusRef));
    // 用户与角色使用相同大小的头像，位置交给统一布局计算。
    const neighborRefs = [
      ...(neighborSet.has(originRef) ? [originRef] : []),
      ...[...neighborSet].filter((ref) => ref !== originRef),
    ];
    const positions = new Map(portraitLayout(activeFocusRef, neighborRefs, links).map(point => [point.ref, point]));
    const neighborNodes = neighborRefs.map((ref) => {
      const position = positions.get(ref)!;
      if (ref === originRef) return { id: ref, ref, name: '你', avatar: userAvatar, x: position.x, y: position.y, user: true } satisfies GraphNode;
      const character = byCharacterId.get(ref.slice(2));
      return { id: ref, ref, name: character?.name ?? '未知角色', avatar: character?.avatar, x:position.x,y:position.y } satisfies GraphNode;
    });
    return [
      focusNode
        ? { id: focusNode.id, ref: activeFocusRef, name: focusNode.name, avatar: focusNode.avatar, x: 180, y: 200 }
        : { id: originRef, ref: originRef, name: '你', avatar: userAvatar, x: 180, y: 200, user: true },
      ...neighborNodes,
    ];
  }, [activeFocusRef, byCharacterId, displayLinks, originRef, userAvatar, visible, links]);

  const nodesByRef = useMemo(() => new Map(nodes.map((node) => [node.ref, node])), [nodes]);
  const secondaryLinks = links.filter(link => link.recorded && link.left !== activeFocusRef && link.right !== activeFocusRef
    && nodesByRef.has(link.left) && nodesByRef.has(link.right)).sort((a,b)=>linkScore(b)-linkScore(a)).slice(0,5);
  const renderedLinks = [...secondaryLinks, ...displayLinks];

  const selected = renderedLinks.find((link) => link.key === selectedKey) ?? null;
  const selectedRefs = useMemo(() => new Set(selectedKey?.split('|') ?? []), [selectedKey]);
  const selectedNodes = selected ? [nodesByRef.get(selected.left), nodesByRef.get(selected.right)].filter((node): node is GraphNode => Boolean(node)) : [];
  const selectedCharacter = selectedNodes.find((node) => !node.user);
  const selectedReasons = selected ? recentReasons(selected.reasons, 3) : [];

  return (
    <Modal open={open} onClose={onClose} title="关系星图" width="max-w-xl">
      <div className="px-4 pb-5 pt-3 sm:px-5">
        {loadError && <div role="alert" className="mb-3 flex items-center justify-between rounded-xl border border-rose-400/20 p-3 text-sm text-sub">关系暂未读取<button type="button" onClick={()=>setReload(value=>value+1)} className="text-life-cyan">重试</button></div>}
        <section className="vg-portrait-constellation relative isolate w-full overflow-hidden rounded-[26px] border border-white/10 bg-[#090c1c]" style={{aspectRatio:'360 / 400',containerType:'inline-size'}} aria-label="角色关系星图">
          <div className="pointer-events-none absolute inset-0" style={{background:'radial-gradient(ellipse at 50% 50%,rgba(96,85,185,.23),transparent 48%),radial-gradient(ellipse at 85% 15%,rgba(33,119,135,.13),transparent 42%)'}} />
          {BACKDROP_STARS.map(star=><span key={`${star.x}-${star.y}`} className="pointer-events-none absolute rounded-full bg-violet-200/50" style={{left:`${star.x}%`,top:`${star.y}%`,width:star.s,height:star.s}} />)}
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 360 400" aria-label="人物关系连线">
            <defs><radialGradient id="relation-halo"><stop stopColor="#a99bf3" stopOpacity=".16" /><stop offset="1" stopColor="#a99bf3" stopOpacity="0" /></radialGradient></defs>
            <circle cx="180" cy="200" r="65" fill="url(#relation-halo)" />
            {renderedLinks.map(link=>{
              const a=nodesByRef.get(link.left),b=nodesByRef.get(link.right);if(!a||!b)return null;
              const active=link.key===selectedKey,secondary=secondaryLinks.includes(link),color=relationColor(link,active);
              const path=portraitRoute(a,b,nodes,secondary);
              return <g key={link.key} role="button" tabIndex={0} aria-label={`查看${a.name}与${b.name}的关系`}
                onClick={()=>setSelectedKey(link.key)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedKey(link.key);}}}
                className="cursor-pointer outline-none focus:opacity-100" opacity={selectedKey&&!active ? .28 : secondary&&!active ? .5 : 1}>
                <path d={path} fill="none" stroke="transparent" strokeWidth="18" />
                {active&&<path d={path} fill="none" stroke={color.glow} strokeWidth="7" opacity=".5" />}
                <path d={path} fill="none" stroke={color.line} strokeWidth={active?2.2:secondary?1:1.4} strokeDasharray={color.dash} strokeLinecap="round" />
              </g>;
            })}
          </svg>
          {nodes.map(node=>{
            const center=node.ref===activeFocusRef,active=selectedRefs.has(node.ref);
            return <button key={node.ref} type="button" data-portrait-ref={node.ref} data-centered={center||undefined}
              aria-label={node.user?'以你的视角查看关系':`以${node.name}为中心查看关系`} aria-pressed={center}
              onClick={()=>{setFocusedRef(node.user?null:node.ref);setSelectedKey(null);setNeighborPage(0);}}
              className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[#171a32] p-[3px] outline-none transition-[border-color,box-shadow] duration-300 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-white ${center?'border-life-cyan/80 shadow-[0_0_24px_rgba(91,200,210,.28)]':active?'border-white/80 shadow-[0_0_15px_rgba(180,160,255,.3)]':'border-[#8274ba]/50'}`}
              style={{left:`${node.x/360*100}%`,top:`${node.y/400*100}%`,width:'clamp(40px, 14cqw, 52px)',height:'clamp(40px, 14cqw, 52px)'}}>
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full text-2xl">{renderAvatar(node.avatar,'✦','h-full w-full')}</span>
            </button>;
          })}
          {loading&&<span className="absolute bottom-3 left-1/2 h-1.5 w-1.5 -translate-x-1/2 animate-pulse rounded-full bg-life-cyan" role="status" aria-label="正在同步星图" />}
        </section>
        <div className="mt-3 flex items-center justify-between gap-2">
          {activeFocusRef!==originRef?<button type="button" onClick={()=>{setFocusedRef(null);setSelectedKey(null);setNeighborPage(0);}} className="rounded-full border border-line px-4 py-2 text-xs text-sub">回到我的视角</button>:<span />}
          {focusLinks.length>MAX_NEIGHBORS&&<div className="flex items-center gap-2">
            <button type="button" aria-label="上一组头像" disabled={neighborPage===0} onClick={()=>{setNeighborPage(p=>p-1);setSelectedKey(null);}} className="h-9 w-9 rounded-full border border-line text-sub disabled:opacity-25">‹</button>
            <span className="text-xs tabular-nums text-sub">{neighborPage+1}/{Math.ceil(focusLinks.length/MAX_NEIGHBORS)}</span>
            <button type="button" aria-label="下一组头像" disabled={(neighborPage+1)*MAX_NEIGHBORS>=focusLinks.length} onClick={()=>{setNeighborPage(p=>p+1);setSelectedKey(null);}} className="h-9 w-9 rounded-full border border-line text-sub disabled:opacity-25">›</button>
          </div>}
        </div>
        {selected && (
          <section className="mt-4 rounded-[24px] border border-life-cyan/20 bg-gradient-to-br from-life-cyan/[0.08] to-gene-purple/[0.08] px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3" aria-label="所选关系的两个人物">{selectedNodes.map(node=><span key={node.ref} className="h-9 w-9 overflow-hidden rounded-full bg-surface text-xl">{renderAvatar(node.avatar,'✦','h-full w-full')}</span>)}</div>
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

      </div>

      {detailPair && <SharedStoryEventsModal open={!!detailPair} onClose={() => setDetailPair(null)} a={detailPair.a} b={detailPair.b} userId={userId} />}
    </Modal>
  );
}
