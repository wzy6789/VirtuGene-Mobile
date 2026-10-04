type FrameClient = (dt: number, now: number) => void;
const clients = new Set<FrameClient>();
let frame = 0, previous = 0;

/** All visible orbs share one clock. No component state is updated on a frame. */
function tick(now: number) {
  frame = 0;
  const dt = previous ? Math.min(.064, (now - previous) / 1000) : 1 / 60;
  previous = now;
  clients.forEach(client => client(dt, now));
  if (clients.size) frame = requestAnimationFrame(tick);
}
export function subscribeSoulOrbFrame(client: FrameClient): () => void {
  clients.add(client);
  if (!frame) { previous = 0; frame = requestAnimationFrame(tick); }
  return () => {
    clients.delete(client);
    if (!clients.size) { cancelAnimationFrame(frame); frame = 0; previous = 0; }
  };
}
export const soulOrbMotionActivity = () => ({ clients: clients.size, scheduled: !!frame });

/** Exact critically damped integration remains stable at variable frame rates. */
export function settleOrbValue(value: number, velocity: number, target: number, dt: number): [number, number] {
  const frequency = 16, displacement = value - target;
  const c = velocity + frequency * displacement, decay = Math.exp(-frequency * dt);
  return [target + (displacement + c * dt) * decay, (velocity - frequency * c * dt) * decay];
}
