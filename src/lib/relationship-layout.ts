/** Stable portrait layout; the renderer never uses names as spatial labels. */
export type PortraitPoint = { ref: string; x: number; y: number };
export type PortraitEdge = { key: string; left: string; right: string };
export const RELATION_CANVAS = { width: 360, height: 340, x: 180, y: 170 };
const ORBIT = { x: 124, y: 112 };
// A 44px portrait at the 320px mobile layout fits inside this logical radius.
const PORTRAIT_INSET = 30;
const OUTER_ORBIT = { x: 158, y: 146, laneSpan: 12 };
const TAU = Math.PI * 2;

export function portraitLayout(center: string, neighbors: string[], edges: PortraitEdge[]): PortraitPoint[] {
  const order = [...new Set(neighbors)].filter(id => id !== center).slice(0, 8);
  const n = order.length;
  const neighborsInPage = new Set(order);
  const peripheralEdges = edges.filter(edge => edge.left !== edge.right && neighborsInPage.has(edge.left) && neighborsInPage.has(edge.right));
  const cost = (ids: string[]) => {
    const index = new Map(ids.map((id, i) => [id, i]));
    const pairs = peripheralEdges.map(edge => [index.get(edge.left)!, index.get(edge.right)!]);
    let total = 0;
    for (let i = 0; i < pairs.length; i++) {
      const [a, b] = pairs[i];
      const distance = Math.min(Math.abs(a - b), n - Math.abs(a - b));
      total += distance * distance;
      const between = (point: number) => (point - a + n) % n < (b - a + n) % n;
      for (let j = 0; j < i; j++) {
        const [c, d] = pairs[j];
        if (a !== c && a !== d && b !== c && b !== d && between(c) !== between(d)) total += 4;
      }
    }
    return total;
  };
  // Shorter peripheral spans and fewer interleaved pairs make the outer lanes easier to follow.
  for (let pass=0; pass<8; pass++) {
    let changed=false;
    for (let a=0;a<n;a++) for(let b=a+1;b<n;b++) {
      const before=cost(order);[order[a],order[b]]=[order[b],order[a]];
      if(cost(order)<before) changed=true; else [order[a],order[b]]=[order[b],order[a]];
    }
    if(!changed) break;
  }
  return [{ref:center,x:RELATION_CANVAS.x,y:RELATION_CANVAS.y}, ...order.map((ref,i) => {
    // Two neighbors occupy opposite halves instead of leaving the lower orbit unused.
    const angle = n === 1 ? Math.PI / 2 : -Math.PI / 2 + TAU * i / n;
    return {ref,x:RELATION_CANVAS.x+ORBIT.x*Math.cos(angle),y:RELATION_CANVAS.y+ORBIT.y*Math.sin(angle)};
  })];
}

function orbitAngle(point: PortraitPoint): number {
  return Math.atan2((point.y - RELATION_CANVAS.y) / ORBIT.y, (point.x - RELATION_CANVAS.x) / ORBIT.x);
}

type PeripheralLane = { fraction: number; clockwise: boolean };

export function portraitRoute(a: PortraitPoint, b: PortraitPoint, _points: PortraitPoint[], secondary=false, lane?: PeripheralLane): string {
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.max(1,Math.hypot(dx,dy));
  if (a.ref === b.ref) return '';
  const inset=Math.min(PORTRAIT_INSET,length/3), ux=dx/length,uy=dy/length;
  const start={x:a.x+ux*inset,y:a.y+uy*inset}, end={x:b.x-ux*inset,y:b.y-uy*inset};
  if (!secondary) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

  const alpha = orbitAngle(a), beta = orbitAngle(b);
  const clockwiseSpan = (beta - alpha + TAU) % TAU;
  const clockwise = lane?.clockwise ?? clockwiseSpan <= Math.PI;
  const span = clockwise ? clockwiseSpan : TAU - clockwiseSpan;
  const direction = clockwise ? 1 : -1;
  const fraction = Math.max(0, Math.min(1, lane?.fraction ?? 0));
  const rx = OUTER_ORBIT.x + OUTER_ORBIT.laneSpan * fraction;
  const ry = OUTER_ORBIT.y + OUTER_ORBIT.laneSpan * fraction;
  // Fan the endpoints toward their own lane before joining the outer arc.
  const approach = Math.min(.11, span / 4);
  const orbitPoint = (angle: number) => ({ x: RELATION_CANVAS.x + rx * Math.cos(angle), y: RELATION_CANVAS.y + ry * Math.sin(angle) });
  const outerA = orbitPoint(alpha + direction * approach), outerB = orbitPoint(beta - direction * approach);
  const port = (node: PortraitPoint, outer: {x:number;y:number}) => {
    const x = outer.x - node.x, y = outer.y - node.y, d = Math.max(1, Math.hypot(x, y));
    return {x: node.x + x / d * PORTRAIT_INSET, y: node.y + y / d * PORTRAIT_INSET};
  };
  const portA = port(a, outerA), portB = port(b, outerB);
  // Every control point and the whole ellipse stay inside the canvas, including stroke padding.
  return `M ${portA.x} ${portA.y} Q ${(portA.x+outerA.x)/2} ${(portA.y+outerA.y)/2} ${outerA.x} ${outerA.y} A ${rx} ${ry} 0 ${span - approach * 2 > Math.PI ? 1 : 0} ${clockwise ? 1 : 0} ${outerB.x} ${outerB.y} Q ${(portB.x+outerB.x)/2} ${(portB.y+outerB.y)/2} ${portB.x} ${portB.y}`;
}

/** Allocate the whole page together so overlapping outer arcs do not share the same lane. */
export function portraitRoutes(center: string, points: PortraitPoint[], edges: PortraitEdge[]): Map<string, string> {
  const byRef = new Map(points.map(point => [point.ref, point]));
  const perimeter = points.filter(point => point.ref !== center).sort((a,b) => orbitAngle(a) - orbitAngle(b) || a.ref.localeCompare(b.ref));
  const index = new Map(perimeter.map((point, i) => [point.ref, i]));
  const n = perimeter.length;
  const peripheral = edges.filter(edge => edge.left !== edge.right && index.has(edge.left) && index.has(edge.right)).map(edge => {
    const a = index.get(edge.left)!, b = index.get(edge.right)!;
    const clockwiseSteps = (b - a + n) % n;
    const clockwise = clockwiseSteps < n / 2 || clockwiseSteps === n / 2 && a < b;
    const steps = clockwise ? clockwiseSteps : n - clockwiseSteps;
    const segments = new Set(Array.from({length:steps}, (_, i) => clockwise ? (a + i) % n : (a - i - 1 + n) % n));
    return {edge, clockwise, steps, segments, lane:0};
  }).sort((a,b) => a.steps - b.steps || a.edge.key.localeCompare(b.edge.key));
  const lanes: Set<number>[] = [];
  for (const route of peripheral) {
    let lane = lanes.findIndex(occupied => [...route.segments].every(segment => !occupied.has(segment)));
    if (lane < 0) { lane = lanes.length; lanes.push(new Set()); }
    for (const segment of route.segments) lanes[lane].add(segment);
    route.lane = lane;
  }
  const routeByKey = new Map(peripheral.map(route => [route.edge.key, route]));
  const paths = new Map<string, string>();
  for (const edge of edges) {
    const a = byRef.get(edge.left), b = byRef.get(edge.right);
    if (!a || !b || a.ref === b.ref) continue;
    const route = routeByKey.get(edge.key);
    paths.set(edge.key, portraitRoute(a, b, points, !!route, route ? { clockwise:route.clockwise, fraction:route.lane / Math.max(1,lanes.length-1) } : undefined));
  }
  return paths;
}
