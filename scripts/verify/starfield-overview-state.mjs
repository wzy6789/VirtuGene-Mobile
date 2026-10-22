import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { transform } from 'esbuild';

const source = 'src/components/world/starfield-overview.ts';
assert.ok(existsSync(source), 'shared starfield filtering and stable marker selection are available');
const { code } = await transform(readFileSync(source, 'utf8'), { loader: 'ts', format: 'esm' });
const { buildStarfieldOverview } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const scenes = [
  { id: 'a', title: '雨后的站台', place: '城南', timeLabel: '黄昏', status: 'active' },
  { id: 'b', title: 'Library', place: '书房', timeLabel: '清晨', status: 'paused' },
  { id: 'c', title: '山间夜话', place: '林间', timeLabel: '夜晚', status: 'finished' },
  { id: 'd', title: '另一段经历', place: '城南', timeLabel: '白天', status: 'active' },
];
const view = options => buildStarfieldOverview({ scenes, filter: 'all', query: '', selectedId: null, slots: new Map(), ...options });

const filtered = view({ query: ' 城南 ', filter: 'active' });
assert.deepEqual(filtered.filtered.map(scene => scene.id), ['a', 'd']);
assert.deepEqual(filtered.markers.map(marker => marker.scene.id), ['a', 'd']);
assert.deepEqual(view({ query: 'LIBRARY' }).filtered.map(scene => scene.id), ['b']);
assert.deepEqual(view({ query: '不存在的场景' }).markers, []);

const focused = view({ selectedId: 'd' });
assert.deepEqual(focused.markers.map(marker => marker.scene.id), ['a', 'b', 'd']);
assert.equal(new Set(focused.markers.map(marker => marker.slot)).size, focused.markers.length);
const slots = new Map(focused.markers.map(marker => [marker.scene.id, marker.slot]));
const updated = view({ scenes: [{ id: 'new', title: '新场景', status: 'active' }, ...scenes], selectedId: 'd', slots });
for (const marker of updated.markers) if (slots.has(marker.scene.id)) assert.equal(marker.slot, slots.get(marker.scene.id));
assert.ok(updated.markers.every(marker => updated.filtered.some(scene => scene.id === marker.scene.id)));
console.log('PASS: shared search/filter scope, real selected scene, stable retained marker slots');
