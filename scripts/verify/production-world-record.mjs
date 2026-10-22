import fs from 'node:fs';import ts from 'typescript';import {build} from 'esbuild';import assert from 'node:assert/strict';
/** Visible production flow over an explicitly synthetic pre-existing scene. */
export async function verifyProductionWorldRecord(page,owner,out,check){
 const source=fs.readFileSync('src/db/world-scene-repo.ts','utf8'),ast=ts.createSourceFile('world-scene-repo.ts',source,ts.ScriptTarget.Latest,true),factory=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='emptySceneState');assert.ok(factory);
 const bundle=await build({stdin:{contents:"import {deriveWorldVisualState,emptyConversationState} from './src/lib/world/world-visual-state';\n"+factory.getText(ast),resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});
 const {emptySceneState}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 await page.locator('.chat-header').getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'世界',exact:true}).click();await page.getByRole('button',{name:'世界设定',exact:true}).waitFor();
 const sceneId='production-world-record-scene',title='站台上的一段对话',passage='雨停了，站台上的灯亮起来。';
 const worldId=await page.evaluate(async({owner,sceneId,title,passage,state})=>{
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('virtugene');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{
   const tx=database.transaction(['worlds','worldScenes','worldSceneEntries'],'readwrite'),request=tx.objectStore('worlds').index('userId').getAll(owner);let worldId;
   request.onsuccess=()=>{const world=request.result[0];if(!world){tx.abort();return;}worldId=world.id;const now=Date.now();tx.objectStore('worlds').put({...world,clock:{worldAt:now,lastReconciledAt:now,pace:'realtime'}});
    state.participants=[{characterId:'startup-owned-role',goals:[],knowsEventIds:[],secrets:[],enteredAt:now}];
    tx.objectStore('worldScenes').put({id:sceneId,userId:owner,worldId,title,place:'站台',timeLabel:'傍晚',mood:'平静',characterIds:['startup-owned-role'],status:'paused',state,startedAt:now,createdAt:now,updatedAt:now});
    tx.objectStore('worldSceneEntries').put({id:'production-record-passage',sceneId,index:0,act:1,kind:'narration',content:passage,createdAt:now,witnessedBy:['startup-owned-role']});
    tx.objectStore('worldSceneEntries').put({id:'production-record-dialogue',sceneId,index:1,act:1,kind:'dialogue',speakerId:'startup-owned-role',content:'等下一班车的时候，聊一会儿吧。',createdAt:now+1,witnessedBy:['startup-owned-role']});
   };tx.oncomplete=()=>resolve(worldId);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('missing owned world'));
  });}finally{database.close();}
 },{owner,sceneId,title,passage,state:emptySceneState()});
 await page.reload();await page.locator('.vg-splash').waitFor({state:'hidden'});await page.getByRole('button',{name:'世界',exact:true}).click();await page.getByRole('button',{name:'继续这一幕',exact:true}).click();await page.getByText(passage,{exact:true}).waitFor();
 await page.getByRole('button',{name:'世界控制',exact:true}).click();const controls=page.getByRole('dialog',{name:'世界偏好',exact:true});await controls.getByRole('button',{name:/^写入世界记录/}).click();await controls.waitFor({state:'hidden'});await page.getByText('这一段已经写入世界记录。',{exact:true}).waitFor();check(true,'production actual scene saves through visible world controls');
 await page.getByRole('button',{name:'离开世界',exact:true}).click();
 await page.getByRole('navigation',{name:'世界档案'}).getByRole('button',{name:'记忆',exact:true}).click();
 const row=page.locator('.vg-memory-exhibit-list li').filter({hasText:title});await row.getByRole('button').click();
 let detail=page.getByRole('dialog',{name:'记录详情',exact:true});await detail.getByText('来源原文（当前）',{exact:true}).click();
 await detail.locator('details').getByText(passage,{exact:true}).waitFor();
 check(true,'production saved library record opens exact current original passage');await page.screenshot({path:out+'/world-record-source.png'});
 await page.reload();await page.locator('.vg-splash').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'世界',exact:true}).click();
 await page.getByRole('navigation',{name:'世界档案'}).getByRole('button',{name:'记忆',exact:true}).click();
 await page.locator('.vg-memory-exhibit-list li').filter({hasText:title}).getByRole('button').click();
 detail=page.getByRole('dialog',{name:'记录详情',exact:true});await detail.getByText('来源原文（当前）',{exact:true}).click();
 await detail.locator('details').getByText(passage,{exact:true}).waitFor();
 check(true,'production page reload preserves saved record and source relationship');
 const rows=await page.evaluate(async({owner,worldId,sceneId})=>{
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('virtugene');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const tx=database.transaction(['worldEvents','sharedMemories','characterKnowledge'],'readonly'),result={};const events=tx.objectStore('worldEvents').index('[worldId+sourceType+sourceId]').getAll([worldId,'story',sceneId]);events.onsuccess=()=>{result.events=events.result.filter(row=>row.userId===owner);if(result.events[0]){const knowledge=tx.objectStore('characterKnowledge').index('[characterId+eventId]').getAll(['startup-owned-role',result.events[0].id]);knowledge.onsuccess=()=>result.knowledge=knowledge.result.filter(row=>row.userId===owner);}};const memories=tx.objectStore('sharedMemories').index('[worldId+sourceType+sourceId]').getAll([worldId,'story',sceneId]);memories.onsuccess=()=>result.memories=memories.result.filter(row=>row.userId===owner);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}finally{database.close();}
 },{owner,worldId,sceneId});
 check(rows.events.length===1&&rows.memories.length===1&&rows.events[0].memoryIds[0]===rows.memories[0].id&&rows.knowledge.length===1,'production indexed storage confirms one linked record and participant permission');
 return {sceneId,worldId,scope:'Actual dist controls, library, current source and real page reload. Only initial scene/prose seeded as synthetic data; no generated-story or Android acceptance claim.'};
}
