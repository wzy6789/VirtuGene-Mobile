import {Capacitor, registerPlugin} from '@capacitor/core';

const nativeCache=registerPlugin<{clear():Promise<{requested:boolean}>}>('ResourceCache');
// Only explicitly named disposable resources. Unknown caches may be offline
// user data and must never be treated as disposable merely by sharing an origin.
export const RESOURCE_CACHE_PREFIX='virtugene-resource-cache:';
export interface ResourceCacheInfo {nativeSupported:boolean;nativeUnavailable:boolean;webSupported:boolean;webCacheCount:number|null}
export interface ResourceCacheResult {nativeRequested:boolean;nativeFailed:boolean;removedCaches:number;failedCaches:number;unavailable:boolean}
let cleaning:Promise<ResourceCacheResult>|undefined;

export async function inspectResourceCache():Promise<ResourceCacheInfo> {
 const native=Capacitor.isNativePlatform();
 const nativeSupported=native&&Capacitor.getPlatform()==='android'&&Capacitor.isPluginAvailable('ResourceCache');
 const webSupported=typeof caches!=='undefined';
 let webCacheCount:number|null=null;
 if(webSupported)try {webCacheCount=(await caches.keys()).filter(name=>name.startsWith(RESOURCE_CACHE_PREFIX)).length;}catch{/* No size/count is guessed when storage cannot be inspected. */}
 return {nativeSupported,nativeUnavailable:native&&!nativeSupported,webSupported,webCacheCount};
}

export function clearResourceCache():Promise<ResourceCacheResult> {
 if(cleaning)return cleaning;
 cleaning=performClear().finally(()=>{cleaning=undefined;});
 return cleaning;
}
async function performClear():Promise<ResourceCacheResult> {
 const info=await inspectResourceCache();
 const result:ResourceCacheResult={nativeRequested:false,nativeFailed:false,removedCaches:0,failedCaches:0,unavailable:info.nativeUnavailable||(!info.nativeSupported&&!info.webSupported)};
 if(info.nativeSupported)try {result.nativeRequested=(await nativeCache.clear()).requested===true;result.nativeFailed=!result.nativeRequested;}catch {result.nativeFailed=true;}
 if(info.webSupported)try {
  // Enumerate again at execution time; do not reuse an old inspection result.
  const names=(await caches.keys()).filter(name=>name.startsWith(RESOURCE_CACHE_PREFIX));
  for(const name of names)try {if(await caches.delete(name))result.removedCaches++;}catch {result.failedCaches++;}
 }catch {result.failedCaches++;}
 return result;
}
