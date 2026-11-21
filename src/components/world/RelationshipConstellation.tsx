import { useMemo, useState } from 'react';
import { avatarImageSrc } from '../../lib/avatar';
import type { Character, RelationshipEvent, RelationshipState } from '../../db/index';
import { characterRef, userRef } from '../../lib/world/subjects';
import { pairTitle, recentReasons, reasonText } from '../../lib/world/relationships';
import { DEFAULT_USER_AVATAR, useAuthStore } from '../../store/auth-store';
import '../../styles/relationship-roles.css';

const WIDTH = 360, HEIGHT = 320, CENTER = { x: 180, y: 160 }, PAGE_SIZE = 8;
type Point = { ref: string; x: number; y: number };
type Person = { ref: string; name: string; avatar?: string; user?: boolean };
type Edge = { key: string; a: string; b: string };

/** Cluster related neighbors around the whole perimeter, including its lower half. */
export function constellationLayout(refs: string[], edges: { a: string; b: string }[]): Point[] {
  const order = [...new Set(refs)].slice(0, PAGE_SIZE);
  const visible = new Set(order);
  // Limit every swap's cost calculation to the current page's peripheral geometry.
  const peripheralEdges = edges.filter(edge => edge.a !== edge.b && visible.has(edge.a) && visible.has(edge.b));
  const cost = () => peripheralEdges.reduce((sum, edge) => {
    const a = order.indexOf(edge.a), b = order.indexOf(edge.b);
    if (a < 0 || b < 0) return sum;
    const d = Math.min(Math.abs(a - b), order.length - Math.abs(a - b));
    return sum + d * d;
  }, 0);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
      const previous = cost();
      [order[a], order[b]] = [order[b], order[a]];
      if (cost() < previous) changed = true;
      else [order[a], order[b]] = [order[b], order[a]];
    }
    if (!changed) break;
  }
  return order.map((ref, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / order.length;
    return { ref, x: CENTER.x + 124 * Math.cos(angle), y: CENTER.y + 106 * Math.sin(angle) };
  });
}

/** Peripheral arcs run outside the portraits, leaving the center spokes clear. */
export function constellationRoute(a: Point, b: Point, secondary: boolean, lane = 0): string {
  if (!secondary) {
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
    return `M ${a.x + dx / distance * 27} ${a.y + dy / distance * 27} L ${b.x - dx / distance * 27} ${b.y - dy / distance * 27}`;
  }
  const angle = (p: Point) => Math.atan2((p.y - CENTER.y) / 106, (p.x - CENTER.x) / 124);
  const alpha = angle(a), beta = angle(b), rx = 150 + lane % 3 * 7, ry = 132 + lane % 3 * 7;
  const sweep = ((beta - alpha + Math.PI * 3) % (Math.PI * 2) - Math.PI) > 0 ? 1 : 0;
  const outer = (theta: number) => `${CENTER.x + rx * Math.cos(theta)} ${CENTER.y + ry * Math.sin(theta)}`;
  const tip = (p: Point) => {
    const dx = p.x - CENTER.x, dy = p.y - CENTER.y, d = Math.hypot(dx, dy);
    return `${p.x + dx / d * 24} ${p.y + dy / d * 24}`;
  };
  return `M ${tip(a)} L ${outer(alpha)} A ${rx} ${ry} 0 0 ${sweep} ${outer(beta)} L ${tip(b)}`;
}

function tone(state: RelationshipState | undefined) {
  if (state && state.conflict >= state.trust && state.conflict >= state.familiarity) return '#f0a5ad';
  return state && state.trust >= 67 ? '#68c9c7' : '#a395d9';
}
type Props = { userId: string; characters: Character[]; states: RelationshipState[]; events: RelationshipEvent[]; compact?: boolean };
export function RelationshipConstellation(props: Props) {
  return <Constellation key={props.userId} {...props} />;
}
function Constellation({ userId, characters, states, events, compact = false }: Props) {
  const avatar = useAuthStore(state => state.avatar) ?? DEFAULT_USER_AVATAR;
  const [focused, setFocused] = useState<string>();
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string>();
  const origin = userRef(userId);
  // Read names, avatars and evidence from the current props; no business-record cache.
  const people: Person[] = [
    { ref: origin, name: '你', avatar, user: true },
    ...characters.filter(c => c.agentProfile !== 'secretary').map(c => ({ ref: characterRef(c.id), name: c.name, avatar: c.avatar })),
  ];
  const byRef = new Map(people.map(p => [p.ref, p]));
  const center = focused && byRef.has(focused) ? focused : origin;
  // Only ref/key topology is memoized, never source records, reads or access decisions.
  const topology = useMemo(() => {
    const refs = [origin, ...characters.filter(c => c.agentProfile !== 'secretary').map(c => characterRef(c.id))];
    const known = new Set(refs);
    const edges = new Map<string, Edge>();
    const add = (a: string, b: string) => {
      if (a === b || !known.has(a) || !known.has(b)) return;
      const key = [a, b].sort().join('|');
      if (!edges.has(key)) edges.set(key, { key, a, b });
    };
    // Presence alone never creates a relationship; retain every loaded evidence-backed edge.
    for (const state of states) add(state.subjectA, state.subjectB);
    for (const event of events) add(event.subjectA, event.subjectB);
    return { refs, edges: [...edges.values()] };
  }, [origin, characters, states, events]);
  const neighbors = useMemo(() => topology.refs.filter(ref => ref !== center), [topology.refs, center]);
  const totalPages = Math.max(1, Math.ceil(neighbors.length / PAGE_SIZE));
  const activePage = Math.min(page, totalPages - 1);
  const geometry = useMemo(() => {
    const refs = neighbors.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
    const nodes: Point[] = [{ ref: center, ...CENTER }, ...constellationLayout(refs, topology.edges)];
    const positions = new Map(nodes.map(p => [p.ref, p]));
    const edges = topology.edges.filter(e => positions.has(e.a) && positions.has(e.b))
      .sort((a, b) => Number(a.a === center || a.b === center) - Number(b.a === center || b.b === center));
    const routes = edges.map((edge, index) => {
      const secondary = edge.a !== center && edge.b !== center;
      return { ...edge, secondary, path: constellationRoute(positions.get(edge.a)!, positions.get(edge.b)!, secondary, index) };
    });
    return { nodes, routes, edgeKeys: new Set(edges.map(edge => edge.key)) };
  }, [neighbors, topology.edges, center, activePage]);
  // Resolve current display evidence afresh, outside the geometric memos.
  const visibleStates = new Map<string, RelationshipState>();
  for (const state of states) {
    const key = [state.subjectA, state.subjectB].sort().join('|');
    if (geometry.edgeKeys.has(key)) visibleStates.set(key, state);
  }
  const selected = geometry.routes.find(e => e.key === selectedKey);
  const selectedReasons = selected ? recentReasons(events.filter(event => [event.subjectA, event.subjectB].sort().join('|') === selected.key), 2) : [];
  const focus = (ref: string) => { setFocused(ref === origin ? undefined : ref); setPage(0); setSelectedKey(undefined); };

  return <section className="vg-relationship-constellation vg-evidence-constellation" data-compact={compact || undefined} aria-label="关系星图">
    {!compact && <div className="vg-relationship-constellation-head"><div><h2>关系星图</h2><p>点头像切换视角，点连线查看已有记录。</p></div><span className="vg-relationship-count">{people.length - 1} 位角色</span></div>}
    <div className="vg-relationship-constellation-map">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="已有记录的关系连线">
        <ellipse cx={CENTER.x} cy={CENTER.y} rx="124" ry="106" fill="none" stroke="var(--border)" strokeDasharray="1 8" />
        {geometry.routes.map(edge => {
          const { secondary, path } = edge, active = edge.key === selectedKey;
          return <g key={edge.key} className="vg-relationship-edge" data-peripheral={secondary || undefined} data-edge-key={edge.key} role="button" tabIndex={0} aria-pressed={active} aria-label={`查看${byRef.get(edge.a)!.name}与${byRef.get(edge.b)!.name}的关系`}
            onClick={() => setSelectedKey(edge.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKey(edge.key); } }}>
            <path d={path} fill="none" stroke="transparent" strokeWidth="16" />
            <path className="vg-constellation-line" d={path} fill="none" stroke={tone(visibleStates.get(edge.key))} strokeWidth={active ? 2.6 : secondary ? 1.1 : 1.8} opacity={active ? 1 : secondary ? .55 : .95} />
          </g>;
        })}
      </svg>
      {geometry.nodes.map(point => {
        const node = byRef.get(point.ref);
        if (!node) return null;
        return <button key={node.ref} type="button" className="vg-evidence-avatar" data-centered={node.ref === center || undefined} data-portrait-ref={node.ref}
        aria-pressed={node.ref === center} aria-label={node.user ? '以你的视角查看关系' : `以${node.name}为中心查看关系`} onClick={() => focus(node.ref)} style={{ left: `${point.x / WIDTH * 100}%`, top: `${point.y / HEIGHT * 100}%` }}>
        {avatarImageSrc(node.avatar) ? <img src={avatarImageSrc(node.avatar)} alt="" draggable={false} /> : <span aria-hidden="true">{node.avatar || '✦'}</span>}
      </button>;})}
    </div>
    <div className="vg-evidence-map-controls">
      {center !== origin ? <button type="button" onClick={() => focus(origin)}>回到我的视角</button> : <span className="vg-evidence-map-note">仅连接已有记录</span>}
      {totalPages > 1 && <div className="vg-evidence-map-pages" aria-label="头像分页"><button type="button" aria-label="上一组头像" disabled={activePage === 0} onClick={() => { setPage(activePage - 1); setSelectedKey(undefined); }}>上一组</button><span role="status">{activePage + 1}/{totalPages}</span><button type="button" aria-label="下一组头像" disabled={activePage + 1 >= totalPages} onClick={() => { setPage(activePage + 1); setSelectedKey(undefined); }}>下一组</button></div>}
    </div>
    {!geometry.routes.length && <p className="vg-evidence-map-note">{topology.edges.length ? '这组头像之间还没有记录到联系；可以换组或切换视角。' : '还没有记录到关系变化。'}</p>}
    {selected && <div className="vg-relationship-insight"><div className="vg-relationship-insight-title"><h3>{pairTitle({ subjectA: selected.a, subjectB: selected.b }, userId, id => byRef.get(characterRef(id))?.name ?? 'TA')}</h3><button type="button" aria-label="关闭关系详情" onClick={() => setSelectedKey(undefined)}>×</button></div>
      {selectedReasons.length ? <ul className="vg-relationship-insight-reasons">{selectedReasons.map(event => <li key={event.id}>{reasonText(event)}</li>)}</ul> : <p className="vg-relationship-insight-empty">还没有记录到他们之间的具体变化。</p>}
    </div>}
  </section>;
}
