import {createRoot} from 'react-dom/client';
import {db} from '../../src/db';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {SettingsPanel} from '../../src/components/settings/SettingsPanel';
import {clearResourceCache,inspectResourceCache,RESOURCE_CACHE_PREFIX} from '../../src/lib/resource-cache';
const root=createRoot(document.getElementById('root')!);
window.fetch=async()=>{throw Error('Preview blocks model/network requests');};
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Preview blocks microphone');};
let reads=0,meter=false;
async function seed() {
 await db.delete();await db.open();
 useAuthStore.setState({userId:'cache-test',username:'隔离预览',apiKey:''});
 useSettingsStore.setState({ttsEnabled:false,aiVoiceMode:false});
 await db.characters.put({id:'a',createdBy:'cache-test',name:'测试角色',systemPrompt:'保留人设',createdAt:1,voiceSamples:{lines:['保留样本'],generatedAt:1,promptRevision:1}} as any);
 await db.sessions.put({id:'s',userId:'cache-test',characterId:'a',title:'保留聊天',createdAt:1,updatedAt:1,summary:'保留摘要'});
 await db.messages.bulkPut(Array.from({length:5000},(_,i)=>({id:'m-'+i,sessionId:'s',role:'user',content:'保留原话'.repeat(100),createdAt:i})) as any);
 for(const name of ['memories','diaries','todos'])await db.table(name).put({id:name+'-keep',userId:'cache-test',characterId:'a',content:'保留生活资料',createdAt:1});
 localStorage.setItem('cache-test-credentials','fixture-no-secret');
 localStorage.setItem('cache-test-other-account','preserve');
 document.cookie='cache_test=preserve; SameSite=Lax';
 const unknown=await caches.open('offline-user-records');await unknown.put('/protected-record',new Response('preserve'));
 for(const name of [RESOURCE_CACHE_PREFIX+'images',RESOURCE_CACHE_PREFIX+'pages']) {const cache=await caches.open(name);await cache.put('/mock-resource',new Response('x'.repeat(1024*512)));}
 for(const table of db.tables)for(const method of ['get','getMany','query'] as const){const original=table.core[method].bind(table.core);(table.core as any)[method]=(...args:any[])=>{if(meter)reads++;return (original as any)(...args);};}
 root.render(<SettingsPanel open onClose={()=>{}} initialPage="data"/>);
}
Object.assign(window,{resourceCacheTest:{ready:seed(),inspect:inspectResourceCache,clear:clearResourceCache,
 snapshot:async()=>JSON.stringify({tables:await Promise.all(db.tables.map(async t=>[t.name,await t.toArray()])),storage:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])),cookies:document.cookie}),
 begin:()=>{meter=true;reads=0;},end:()=>{meter=false;return reads;},
 protectedCache:async()=>(await (await caches.open('offline-user-records')).match('/protected-record'))?.text(),
 failedDelete:()=>{const original=caches.delete.bind(caches);caches.delete=async name=>{if(name===RESOURCE_CACHE_PREFIX+'images')throw Error('controlled failure');return original(name);};},
}});
