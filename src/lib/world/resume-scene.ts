import { db, type WorldScene } from '../../db';

export function latestResumableScene(scenes: readonly WorldScene[], userId: string, worldId?: string, lastSceneId?: string | null) {
  if (!userId || !worldId) return undefined;
  const available = scenes.filter(scene => scene.userId === userId && scene.worldId === worldId
    && (scene.status === 'active' || scene.status === 'paused'));
  return available.find(scene => scene.id === lastSceneId)
    ?? available.sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))[0];
}

/** Final authorization reads only the selected scene and its world. */
export async function loadResumableScene(id: string, userId: string, worldId: string, isCurrent: () => boolean) {
  return db.transaction('r', [db.worldScenes, db.worlds], async () => {
    if (!isCurrent()) return undefined;
    const [scene, world] = await Promise.all([db.worldScenes.get(id), db.worlds.get(worldId)]);
    if (!isCurrent() || !scene || !world || scene.userId !== userId || world.userId !== userId
      || scene.worldId !== worldId || !['active', 'paused'].includes(scene.status)) return undefined;
    return scene;
  });
}
