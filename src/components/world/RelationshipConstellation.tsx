import type { Character, RelationshipEvent, RelationshipState } from '../../db/index';
import { useState } from 'react';
import { characterRef, userRef } from '../../lib/world/subjects';
import { pairTitle, recentReasons } from '../../lib/world/relationships';
import { DEFAULT_USER_AVATAR, useAuthStore } from '../../store/auth-store';

const WIDTH = 360;
const HEIGHT = 300;
const CENTER = { x: 180, y: 137 };
const ORIGIN_BOTTOM = { x: 180, y: 272 };
const DEFAULT_SLOTS = [
  { x: 180, y: 33 }, { x: 93, y: 47 }, { x: 270, y: 48 },
  { x: 47, y: 120 }, { x: 313, y: 124 }, { x: 82, y: 207 },
  { x: 278, y: 204 }, { x: 146, y: 246 }, { x: 220, y: 249 },
];
const FOCUS_SLOTS = [
  { x: 180, y: 28 }, { x: 92, y: 50 }, { x: 268, y: 50 },
  { x: 42, y: 130 }, { x: 318, y: 130 }, { x: 77, y: 214 },
  { x: 283, y: 214 }, { x: 132, y: 252 }, { x: 228, y: 252 },
];
const MAX_NEIGHBORS = 6;

type GraphNode = { id: string; ref: string; name: string; avatar?: string; x: number; y: number; user?: boolean };
type GraphEdge = { key: string; a: GraphNode; b: GraphNode; state?: RelationshipState; events: RelationshipEvent[]; recorded: boolean };

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function relationTone(edge: GraphEdge): string {
  if (!edge.recorded) return 'rgba(141,138,168,.24)';
  if (edge.state && edge.state.conflict >= edge.state.trust && edge.state.conflict >= edge.state.familiarity) return '#f0a5ad';
  if (edge.state && edge.state.trust >= 67) return '#82e8e3';
  return '#9b8bed';
}

function edgeEndpoints(a: GraphNode, b: GraphNode): { x1: number; y1: number; x2: number; y2: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const inset = Math.min(16, length * 0.16);
  const ux = dx / length;
  const uy = dy / length;
  return { x1: a.x + ux * inset, y1: a.y + uy * inset, x2: b.x - ux * inset, y2: b.y - uy * inset };
}

function starPath(x: number, y: number, radius: number): string {
  const inner = radius * 0.34;
  return `M ${x} ${y - radius} L ${x + inner} ${y - inner} L ${x + radius} ${y} L ${x + inner} ${y + inner} L ${x} ${y + radius} L ${x - inner} ${y + inner} L ${x - radius} ${y} L ${x - inner} ${y - inner} Z`;
}

export function RelationshipConstellation({
  userId,
  characters,
  states,
  events,
}: {
  userId: string;
  characters: Character[];
  states: RelationshipState[];
  events: RelationshipEvent[];
}) {
  const userAvatar = useAuthStore((state) => state.avatar) ?? DEFAULT_USER_AVATAR;
  const userNode: GraphNode = { id: `u:${userId}`, ref: userRef(userId), name: '你', avatar: userAvatar, x: CENTER.x, y: CENTER.y, user: true };
  const characterNodes: GraphNode[] = characters.map((character, index) => ({
    id: character.id,
    ref: characterRef(character.id),
    name: character.name,
    avatar: character.avatar,
    ...(DEFAULT_SLOTS[index] ?? { x: CENTER.x, y: CENTER.y }),
  }));
  const stateMap = new Map(states.map((state) => [state.pairKey, state]));
  const eventMap = new Map<string, RelationshipEvent[]>();
  for (const event of events) {
    const list = eventMap.get(event.pairKey) ?? [];
    list.push(event);
    eventMap.set(event.pairKey, list);
  }
  const edges: GraphEdge[] = [];
  for (const node of characterNodes) {
    const key = pairKey(userNode.ref, node.ref);
    const relatedEvents = eventMap.get(key) ?? [];
    edges.push({ key, a: userNode, b: node, state: stateMap.get(key), events: relatedEvents, recorded: Boolean(stateMap.has(key) || relatedEvents.length) });
  }
  for (let i = 0; i < characterNodes.length; i += 1) {
    for (let j = i + 1; j < characterNodes.length; j += 1) {
      const a = characterNodes[i];
      const b = characterNodes[j];
      const key = pairKey(a.ref, b.ref);
      const relatedEvents = eventMap.get(key) ?? [];
      edges.push({ key, a, b, state: stateMap.get(key), events: relatedEvents, recorded: Boolean(stateMap.has(key) || relatedEvents.length) });
    }
  }

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusedRef, setFocusedRef] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const originRef = userNode.ref;
  const activeFocusRef = focusedRef && characterNodes.some((node) => node.ref === focusedRef) ? focusedRef : originRef;
  const focusEdges = edges
    .filter((edge) => edge.a.ref === activeFocusRef || edge.b.ref === activeFocusRef)
    .sort((a, b) => Number(b.recorded) - Number(a.recorded) || b.events.length - a.events.length);
  const primaryFocusEdge = focusEdges.find((edge) => edge.a.user || edge.b.user);
  const displayEdges = focusEdges.length <= MAX_NEIGHBORS
    ? focusEdges
    : primaryFocusEdge
      ? [primaryFocusEdge, ...focusEdges.filter((edge) => edge !== primaryFocusEdge).slice(0, MAX_NEIGHBORS - 1)]
      : focusEdges.slice(0, MAX_NEIGHBORS);
  const visibleEdges = showAll ? focusEdges : displayEdges;
  const hiddenEdgeCount = Math.max(0, focusEdges.length - displayEdges.length);
  const activeCenter = activeFocusRef === originRef ? userNode : characterNodes.find((node) => node.ref === activeFocusRef) ?? userNode;
  const graphNodes = (() => {
    const refs = new Set(visibleEdges.flatMap((edge) => [edge.a.ref, edge.b.ref]).filter((ref) => ref !== activeFocusRef));
    const neighborRefs = [...(refs.has(originRef) ? [originRef] : []), ...[...refs].filter((ref) => ref !== originRef)];
    const neighbors = neighborRefs.map((ref, index) => {
      if (ref === originRef) return { ...userNode, x: ORIGIN_BOTTOM.x, y: ORIGIN_BOTTOM.y };
      const character = characterNodes.find((node) => node.ref === ref);
      const slots = activeFocusRef === originRef ? DEFAULT_SLOTS : FOCUS_SLOTS;
      const slot = slots[index - (refs.has(originRef) ? 1 : 0)] ?? { x: CENTER.x, y: 32 };
      return { ...(character ?? { id: ref, ref, name: '未知角色' }), ...slot };
    });
    return [{ ...activeCenter, x: CENTER.x, y: CENTER.y }, ...neighbors];
  })();
  const graphNodeByRef = new Map(graphNodes.map((node) => [node.ref, node]));
  const selected = visibleEdges.find((edge) => edge.key === selectedKey) ?? null;
  const selectedReasons = selected ? recentReasons(selected.events, 2) : [];
  const selectedTitle = selected ? pairTitle({ subjectA: selected.a.ref, subjectB: selected.b.ref }, userId, (id) => characters.find((c) => c.id === id)?.name ?? 'TA') : '';
  const hasRecordedEdges = edges.some((edge) => edge.recorded);

  return (
    <section className="vg-relationship-constellation" aria-label="关系星图">
      <div className="vg-relationship-constellation-head">
        <div>
          <p className="vg-world-constellation-kicker">RELATIONSHIP MAP</p>
          <h2>关系星图</h2>
          <p>先看你与他们的航线，点一颗星展开它的近邻关系。</p>
        </div>
        <span className="vg-relationship-count">{characters.length} 位角色</span>
      </div>

      <div className="vg-relationship-constellation-map">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="你与角色以及角色之间的关系星图">
          <circle cx={CENTER.x} cy={CENTER.y} r="116" fill="none" stroke="rgba(108,92,231,.13)" strokeDasharray="1 8" />
          <circle cx={CENTER.x} cy={CENTER.y} r="73" fill="none" stroke="rgba(0,206,201,.09)" strokeDasharray="1 9" />
          {[{ x: 25, y: 44, r: 1 }, { x: 333, y: 49, r: .8 }, { x: 31, y: 246, r: .8 }, { x: 329, y: 251, r: 1.2 }, { x: 88, y: 20, r: .7 }, { x: 270, y: 281, r: .8 }, { x: 350, y: 160, r: .7 }].map((star) => (
            <circle key={`${star.x}-${star.y}`} cx={star.x} cy={star.y} r={star.r} fill="#b6adff" opacity=".6" />
          ))}
          {visibleEdges.map((edge) => {
            const a = graphNodeByRef.get(edge.a.ref);
            const b = graphNodeByRef.get(edge.b.ref);
            if (!a || !b) return null;
            const active = selectedKey === edge.key;
            const selectedRefs = selectedKey?.split('|') ?? [];
            const dimmed = Boolean(selectedKey && !active && !selectedRefs.includes(edge.a.ref) && !selectedRefs.includes(edge.b.ref));
            const endpoints = edgeEndpoints(a, b);
            return (
              <g key={edge.key} className="vg-relationship-edge" onClick={() => setSelectedKey(edge.key)}>
                <line x1={endpoints.x1} y1={endpoints.y1} x2={endpoints.x2} y2={endpoints.y2} stroke={relationTone(edge)} strokeWidth={active ? 3 : edge.recorded ? 1.9 : 1} strokeDasharray={edge.recorded ? undefined : '3 6'} opacity={dimmed ? .14 : 1} />
              </g>
            );
          })}
          {graphNodes.map((node) => {
            const connected = edges.filter((edge) => edge.a.ref === node.ref || edge.b.ref === node.ref);
            const active = selectedKey?.split('|').includes(node.ref) ?? false;
            const tone = connected.find((edge) => edge.recorded) ? relationTone(connected.find((edge) => edge.recorded)!) : '#9b8bed';
            const isCenter = node.ref === activeFocusRef;
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={node.user ? '回到你的关系视角' : `查看 ${node.name} 的关系`}
                className="vg-relationship-node"
                onClick={() => {
                  if (node.user) {
                    setFocusedRef(null);
                    setSelectedKey(null);
                    setShowAll(false);
                  } else {
                    setFocusedRef(node.ref);
                    setSelectedKey(pairKey(originRef, node.ref));
                    setShowAll(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (node.user) {
                      setFocusedRef(null);
                      setSelectedKey(null);
                      setShowAll(false);
                    } else {
                      setFocusedRef(node.ref);
                      setSelectedKey(pairKey(originRef, node.ref));
                      setShowAll(false);
                    }
                  }
                }}
              >
                {node.user ? (
                  <>
                    <path d={`M ${node.x} ${node.y - 18} L ${node.x + 18} ${node.y} L ${node.x} ${node.y + 18} L ${node.x - 18} ${node.y} Z`} fill="#101d34" stroke="#82e8e3" strokeWidth="1.2" />
                    {node.avatar?.startsWith('data:') ? <image href={node.avatar} x={node.x - 11} y={node.y - 11} width="22" height="22" preserveAspectRatio="xMidYMid slice" /> : <text x={node.x} y={node.y + 5} textAnchor="middle" fill="#f0edff" fontSize="16">{node.avatar || '🧬'}</text>}
                  </>
                ) : (
                  <>
                    <path d={starPath(node.x, node.y, isCenter || active ? 14 : 11)} fill={tone} className="vg-relationship-star" />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="vg-relationship-legend">
        <span><i className="is-connected" />已有真实记录</span>
        <span><i className="is-unconnected" />等待相遇</span>
        <span>{hasRecordedEdges ? '点选节点或连线查看原因' : '连线会在共同经历后变亮'}</span>
      </div>

      {focusedRef && (
        <button type="button" className="vg-relationship-focus-reset" onClick={() => { setFocusedRef(null); setSelectedKey(null); setShowAll(false); }}>
          ‹ 回到你的视角 <span>{visibleEdges.length} 条近邻航线</span>
        </button>
      )}
      {hiddenEdgeCount > 0 && (
        <button type="button" className="vg-relationship-focus-reset" onClick={() => setShowAll((value) => !value)}>
          {showAll ? '收起较远关系' : `展开另外 ${hiddenEdgeCount} 条关系`}
        </button>
      )}

      {selected && (
        <div className="vg-relationship-insight">
          <div className="vg-relationship-insight-title">
            <div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-gray-500">这条连线</p>
              <h3>{selectedTitle}</h3>
            </div>
            <button type="button" onClick={() => setSelectedKey(null)} aria-label="关闭关系详情">×</button>
          </div>
          {selectedReasons.length > 0 ? (
            <ul className="vg-relationship-insight-reasons">
              {selectedReasons.map((event) => <li key={event.id}>{event.reason}</li>)}
            </ul>
          ) : (
            <p className="vg-relationship-insight-empty">还没有记录到他们之间的具体变化。</p>
          )}
        </div>
      )}
    </section>
  );
}
