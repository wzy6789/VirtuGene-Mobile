import { RELATION_CANVAS, type PortraitEdge, type PortraitPoint } from '../../lib/relationship-layout';

const TAU = Math.PI * 2;
const angleOf = (point: PortraitPoint) => Math.atan2((point.y - RELATION_CANVAS.y) / 112, (point.x - RELATION_CANVAS.x) / 124);

/** This modal uses responsive portraits; its ports must use the same measured radius. */
export function portraitNetworkRoutes(center: string, points: PortraitPoint[], edges: PortraitEdge[], radius: number): Map<string, string> {
  const byRef = new Map(points.map(point => [point.ref, point]));
  const perimeter = points.filter(point => point.ref !== center).sort((a, b) => angleOf(a) - angleOf(b) || a.ref.localeCompare(b.ref));
  const index = new Map(perimeter.map((point, i) => [point.ref, i]));
  const n = perimeter.length;
  const peripheral = edges.filter(edge => edge.left !== edge.right && index.has(edge.left) && index.has(edge.right)).map(edge => {
    const a = index.get(edge.left)!, b = index.get(edge.right)!;
    const clockwiseSteps = (b - a + n) % n;
    const clockwise = clockwiseSteps < n / 2 || clockwiseSteps === n / 2 && a < b;
    const steps = clockwise ? clockwiseSteps : n - clockwiseSteps;
    const segments = new Set(Array.from({ length: steps }, (_, i) => clockwise ? (a + i) % n : (a - i - 1 + n) % n));
    return { edge, clockwise, steps, segments, lane: 0 };
  }).sort((a, b) => a.steps - b.steps || a.edge.key.localeCompare(b.edge.key));
  const lanes: Set<number>[] = [];
  for (const route of peripheral) {
    let lane = lanes.findIndex(occupied => [...route.segments].every(segment => !occupied.has(segment)));
    if (lane < 0) { lane = lanes.length; lanes.push(new Set()); }
    for (const segment of route.segments) lanes[lane].add(segment);
    route.lane = lane;
  }
  const routeByKey = new Map(peripheral.map(route => [route.edge.key, route]));
  const paths = new Map<string, string>();
  const port = (node: PortraitPoint, toward: { x: number; y: number }) => {
    const dx = toward.x - node.x, dy = toward.y - node.y, distance = Math.hypot(dx, dy) || 1;
    return { x: node.x + dx / distance * radius, y: node.y + dy / distance * radius };
  };
  for (const edge of edges) {
    const a = byRef.get(edge.left), b = byRef.get(edge.right);
    if (!a || !b || a.ref === b.ref) continue;
    const route = routeByKey.get(edge.key);
    if (!route) {
      const start = port(a, b), end = port(b, a);
      paths.set(edge.key, `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
      continue;
    }
    const alpha = angleOf(a), beta = angleOf(b), direction = route.clockwise ? 1 : -1;
    const span = (direction * (beta - alpha) + TAU) % TAU;
    const approach = Math.min(.11, span / 4);
    const fraction = route.lane / Math.max(1, lanes.length - 1);
    const rx = 158 + 12 * fraction, ry = 146 + 12 * fraction;
    const orbitPoint = (angle: number) => ({ x: RELATION_CANVAS.x + rx * Math.cos(angle), y: RELATION_CANVAS.y + ry * Math.sin(angle) });
    const startAngle = alpha + direction * approach, endAngle = beta - direction * approach;
    const outerA = orbitPoint(startAngle), outerB = orbitPoint(endAngle);
    const start = port(a, outerA), end = port(b, outerB);
    // Join the ellipse tangentially so each portrait has one continuous connector.
    const handle = (point: { x: number; y: number }, angle: number, amount: number) => {
      const dx = -rx * Math.sin(angle) * direction, dy = ry * Math.cos(angle) * direction;
      const length = Math.hypot(dx, dy);
      return { x: point.x + dx / length * amount, y: point.y + dy / length * amount };
    };
    const c1 = handle(outerA, startAngle, -Math.min(10, Math.hypot(start.x - outerA.x, start.y - outerA.y) / 2));
    const c2 = handle(outerB, endAngle, Math.min(10, Math.hypot(end.x - outerB.x, end.y - outerB.y) / 2));
    paths.set(edge.key, `M ${start.x} ${start.y} Q ${c1.x} ${c1.y} ${outerA.x} ${outerA.y} A ${rx} ${ry} 0 ${span - approach * 2 > Math.PI ? 1 : 0} ${route.clockwise ? 1 : 0} ${outerB.x} ${outerB.y} Q ${c2.x} ${c2.y} ${end.x} ${end.y}`);
  }
  return paths;
}
