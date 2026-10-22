import type { WorldScene } from '../../db';

export type StarfieldSceneFilter = 'all' | 'active' | 'paused' | 'finished';
type OverviewScene = Pick<WorldScene, 'id' | 'title' | 'status'> & Partial<Pick<WorldScene, 'place' | 'timeLabel'>>;

/** The map is a bounded view of the same filtered records as the list.
 * Retained objects keep their committed slots when another record arrives. */
export function buildStarfieldOverview<T extends OverviewScene>({ scenes, filter, query, selectedId, slots }: {
  scenes: readonly T[]; filter: StarfieldSceneFilter; query: string; selectedId: string | null;
  slots: ReadonlyMap<string, number>;
}) {
  const keyword = query.trim().toLocaleLowerCase();
  const filtered = scenes.filter(scene => (filter === 'all' || scene.status === filter)
    && (!keyword || [scene.title, scene.place, scene.timeLabel].filter(Boolean).join(' ').toLocaleLowerCase().includes(keyword)));
  const visible = filtered.slice(0, 3);
  const selected = filtered.find(scene => scene.id === selectedId);
  if (selected && !visible.some(scene => scene.id === selected.id)) visible[visible.length - 1] = selected;
  const nextSlots = new Map<string, number>();
  const used = new Set<number>();
  for (const scene of visible) {
    const slot = slots.get(scene.id);
    if (slot !== undefined && slot >= 0 && slot < 3 && !used.has(slot)) { nextSlots.set(scene.id, slot); used.add(slot); }
  }
  const markers = visible.map(scene => {
    let slot = nextSlots.get(scene.id);
    if (slot === undefined) { slot = [0, 1, 2].find(value => !used.has(value))!; used.add(slot); }
    return { scene, slot };
  });
  return { filtered, markers };
}
