import type { ImageVariant, SceneAssetSelection } from './scene-types';

export interface SceneImage { url: string; width: number; height: number; source?:HTMLImageElement; release(): void }
export type SceneImageDecoder = (variant: ImageVariant, signal: AbortSignal) => Promise<SceneImage>;
const abortError = () => new DOMException('Scene consumer cancelled', 'AbortError');

export const decodeSceneImage: SceneImageDecoder = (variant, signal) => new Promise((resolve, reject) => {
  const image = new Image(); image.decoding = 'async';
  let done = false;
  const clear = () => { image.onload = image.onerror = null; signal.removeEventListener('abort', abort); };
  const abort = () => { if (done) return; done = true; clear(); image.removeAttribute('src'); reject(abortError()); };
  const fail = () => { if (done) return; done = true; clear(); image.removeAttribute('src'); reject(Error('scene:image-failed')); };
  image.onerror = fail;
  image.onload = async () => {
    try { await image.decode(); } catch { fail(); return; }
    if (done || signal.aborted) { abort(); return; }
    done = true; clear();
    let released = false;
    resolve({ url: variant.src, width: image.naturalWidth, height: image.naturalHeight,source:image,
      release: () => { if (released) return; released = true; image.removeAttribute('src'); } });
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort(); else image.src = variant.src;
});

/** Each host owns leases, not the shared decoder. A cancelled preview cannot abort the room's request. */
export function createSceneAssetPool(decoder: SceneImageDecoder = decodeSceneImage) {
  type Entry = { refs: number; promise: Promise<SceneImage>; controller: AbortController; value?: SceneImage; retired: boolean; variant:ImageVariant };
  const entries = new Map<string, Entry>();
  const acquire = async (variant: ImageVariant, signal: AbortSignal): Promise<SceneImage> => {
    if (signal.aborted) throw abortError();
    let entry = entries.get(variant.src);
    if (!entry) {
      const controller = new AbortController();
      const fresh: Entry = { refs: 0, controller, retired: false, promise: Promise.resolve(undefined as never),variant };
      fresh.promise = decoder(variant, controller.signal).then(value => {
        if (fresh.retired) { value.release(); throw abortError(); }
        fresh.value = value; return value;
      });
      // All consumers may leave before an uncancellable decode rejects.
      void fresh.promise.catch(() => {});
      entry = fresh; entries.set(variant.src, entry);
    }
    const owned = entry; owned.refs++;
    let released = false, settled = false;
    const release = () => {
      if (released) return; released = true;
      if (--owned.refs === 0) {
        owned.retired = true; owned.controller.abort(); owned.value?.release();
        if (entries.get(variant.src) === owned) entries.delete(variant.src);
      }
    };
    return new Promise((resolve, reject) => {
      const abort = () => { if (settled) return; settled = true; release(); reject(abortError()); };
      signal.addEventListener('abort', abort, { once: true });
      owned.promise.then(value => {
        if (settled) return;
        settled = true; signal.removeEventListener('abort', abort);
        if (signal.aborted) { release(); reject(abortError()); return; }
        resolve({ url: value.url, width: value.width, height: value.height, source:value.source, release });
      }, error => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); release(); reject(error); });
    });
  };
  const estimatedBytesFor=(variants:ImageVariant[])=>[...new Map([...entries.values()].map(e=>[e.variant.src,e.variant] as const).concat(variants.map(v=>[v.src,v] as const))).values()].reduce((n,v)=>n+v.width*v.height*4,0);
  return { acquire, estimatedBytesFor, inspect: () => ({ entries: entries.size, references: [...entries.values()].reduce((n, e) => n + e.refs, 0), decodedBytes: [...entries.values()].reduce((n, e) => n + (e.value ? e.value.width * e.value.height * 4 : 0), 0),reservedBytes:estimatedBytesFor([]) }) };
}
export const sceneAssetPool = createSceneAssetPool();
export interface LoadedSceneAssets {
  selection: SceneAssetSelection; poster: SceneImage; base?: SceneImage;
  layers: { id: string; image: SceneImage }[]; windowMask?: SceneImage; release(): void;
}
/** Roll back acquired and late results internally; ownership passes only on successful return. */
export async function loadSceneAssets(selection: SceneAssetSelection, signal: AbortSignal, pool = sceneAssetPool): Promise<LoadedSceneAssets> {
  const local = new AbortController(); const cancel = () => local.abort();
  signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) local.abort();
  const held: SceneImage[] = []; let transferred = false, failed = false;
  const take = async (variant: ImageVariant | undefined) => {
    if (!variant) return undefined;
    const image = await pool.acquire(variant, local.signal);
    if (failed || local.signal.aborted) { image.release(); throw abortError(); }
    held.push(image); return image;
  };
  try {
    const [poster, base, windowMask, ...layers] = await Promise.all([
      take(selection.poster), take(selection.base), take(selection.windowMask), ...selection.layers.map(l => take(l.variant)),
    ]);
    if (local.signal.aborted) throw abortError();
    transferred = true; let disposed = false;
    return { selection, poster: poster!, base, windowMask,
      layers: layers.map((image, i) => ({ id: selection.layers[i].layer.id, image: image! })),
      release: () => { if (disposed) return; disposed = true; held.forEach(image => image.release()); held.length = 0; } };
  } catch (error) {
    failed = true; local.abort(); held.forEach(image => image.release()); held.length = 0; throw error;
  } finally { signal.removeEventListener('abort', cancel); if (!transferred) local.abort(); }
}
