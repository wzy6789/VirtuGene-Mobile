import fs from 'node:fs';import {createHash} from 'node:crypto';

export async function verifyProductionPresetAvatars(page,owner,out,check){
 const portraits=JSON.parse(fs.readFileSync('.tmp-preview/ui-overhaul-20261016/preset-avatar-assets/portraits.json','utf8'));
 const rows=await page.evaluate(async ids=>{const database=await new Promise((r,j)=>{const q=indexedDB.open('virtugene');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});try{return await Promise.all(ids.map(id=>new Promise((r,j)=>{const q=database.transaction('characters').objectStore('characters').get(id);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);})))}finally{database.close();}},portraits.map(p=>p.id));
 await page.locator('.chat-header').getByRole('button',{name:'返回',exact:true}).click();await page.getByRole('button',{name:'角色',exact:true}).click();
 await page.getByRole('button',{name:'＋ 添加角色',exact:true}).click();
 const pool=page.getByRole('dialog',{name:'基因实验室',exact:true}),search=pool.getByPlaceholder('搜索基因序列...');await search.waitFor();
 for(const [index,p] of portraits.entries()){
  const row=rows[index];check(row.avatar===p.identity,p.id+' seeded with a portable stable avatar identity');
  await search.fill(row.name);const image=pool.getByRole('img',{name:row.name,exact:true});await image.scrollIntoViewIfNeeded();await image.waitFor();
  await image.evaluate(image=>image.decode());const source=await image.getAttribute('src');
  check(await image.evaluate(n=>n.naturalWidth>0&&n.naturalHeight>0),p.id+' real preset library portrait decodes');
  check(new URL(source,page.url()).origin===new URL(page.url()).origin&&source.includes('/assets/preset-avatars/'),p.id+' uses bundled local image, not a remote service');
  const response=await page.request.get(new URL(source,page.url()).href),bytes=await response.body();
  check(response.ok()&&createHash('sha256').update(bytes).digest('hex')===p.sha256,p.id+' production image bytes match original embedded JPEG');
 }
 await search.fill('程砚');await page.screenshot({path:out+'/preset-gallery.png'});
 await page.keyboard.press('Escape');await pool.waitFor({state:'hidden'});
 const legacy=fs.readFileSync(portraits[7].asset).toString('base64');
 await page.evaluate(async({owner,legacy})=>{const database=await new Promise((r,j)=>{const q=indexedDB.open('virtugene');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});try{await new Promise((r,j)=>{const tx=database.transaction('characters','readwrite');tx.objectStore('characters').put({id:'preset-avatar-legacy-copy',sourcePresetId:'preset-chengyan',name:'旧头像保留见证',avatar:'data:image/jpeg;base64,'+legacy,tags:[],createdBy:owner,isPreset:false,isCustom:true,published:false,createdAt:1,systemPrompt:'用户自己的设定应当保留',proactivity:0});tx.oncomplete=r;tx.onerror=()=>j(tx.error);});}finally{database.close();}},{owner,legacy});
 await page.reload();await page.locator('.vg-splash').waitFor({state:'hidden'});await page.getByRole('button',{name:'角色',exact:true}).click();await page.getByRole('textbox',{name:'搜索角色',exact:true}).fill('旧头像保留见证');
 const oldImage=page.getByRole('button',{name:'打开旧头像保留见证的角色空间',exact:true}).locator('img');await oldImage.waitFor();await oldImage.evaluate(n=>n.decode());
 check((await oldImage.getAttribute('src'))==='data:image/jpeg;base64,'+legacy,'existing owned base64 avatar remains unchanged after a real page reload');
 await page.getByRole('button',{name:'＋ 添加角色',exact:true}).click();await search.fill('程砚');const stableImage=pool.getByRole('img',{name:'程砚',exact:true});await stableImage.waitFor();await stableImage.evaluate(n=>n.decode());
 check((await stableImage.getAttribute('src')).includes('/assets/preset-avatars/'),'stable preset identity resolves again after reload');
 await page.keyboard.press('Escape');await pool.waitFor({state:'hidden'});
 return {portraits:portraits.length,scope:'Actual Vite dist preset library and owned gallery, local asset bytes and persisted reload; no Android or live model.'};
}
