import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const output = resolve(process.env.VG_CHAT_MEDIA_EVIDENCE ?? '.tmp-preview/chat-media-actions-20261013');
const sourceOnly = process.env.VG_CHAT_MEDIA_SOURCE_ONLY === '1';
mkdirSync(output, { recursive: true });
const appRoot = resolve('dist/renderer');
const indexHtml = readFileSync(join(appRoot, 'index.html'), 'utf8');
const stylesheet = indexHtml.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
assert.ok(stylesheet, 'actual build must specify its stylesheet');
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="#253f61"/><circle cx="240" cy="240" r="130" fill="#80daca"/></svg>');
const define = { 'import.meta.env': '{}', 'import.meta.hot': 'undefined', __APP_VERSION__: JSON.stringify(version) };
const loader = { '.css': 'empty', '.png': 'dataurl', '.webp': 'dataurl' };
const fixture = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {MessageBubble} from './src/components/chat/MessageBubble'; import {ImagePreview} from './src/components/ui/ImagePreview';
import {useAuthStore} from './src/store/auth-store'; import {db} from './src/db'; import {messageRepo} from './src/db/message-repo';
const image=${JSON.stringify(image)};
const row={id:'media-message',sessionId:'media-session',role:'assistant',content:'这是本地图片与消息操作检查，保留所有原有动作。',image,createdAt:1,isProactive:false,contextTrace:{memoryIds:['local-source-only']}};
window.mediaUi={actions:[],copies:[],exists:async()=>!!await db.messages.get(row.id),owner:id=>useAuthStore.setState({userId:id})};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.mediaUi.copies.push(text);}}});
function Fixture(){const [message,setMessage]=useState(row),[gallery,setGallery]=useState(null),[streaming,setStreaming]=useState(false),[revision,setRevision]=useState(0);
Object.assign(window.mediaUi,{gallery:(count=3,index=0)=>setGallery({images:Array.from({length:count},()=>image),index}),images:count=>setGallery(value=>({...value,images:Array.from({length:count},()=>image)})),streaming:setStreaming,reset:async()=>{await db.messages.put(row);setMessage(row);setStreaming(false);setRevision(value=>value+1);}});
const action=kind=>m=>window.mediaUi.actions.push({kind,id:m.id});
return <main className="mobile-layout p-4"><button type="button" className="vg-button" onClick={()=>window.mediaUi.gallery()}>打开相册</button>
{message&&<MessageBubble key={revision} message={message} avatar="🌙" streaming={streaming} speakKey={message.id} speakingKey={null} busyKey={null} onQuote={action('quote')} onRemember={action('remember')} onSpeak={action('speak')} onCollectMemory={action('collect')} onShowBasis={action('basis')} onReviewSpeech={action('sample')} onDelete={m=>{window.mediaUi.actions.push({kind:'delete',id:m.id});void messageRepo.deleteById(m.id).then(()=>setMessage(null));}}/>}
{gallery&&<ImagePreview key={gallery.index} images={gallery.images} initialIndex={gallery.index} onClose={()=>setGallery(null)}/>}</main>}
await db.open(); await db.users.put({id:'media-user',username:'图片验收',passwordHash:'local-only',createdAt:1});
await db.sessions.put({id:row.sessionId,userId:'media-user',characterId:'media-role',title:'图片验收',createdAt:1,updatedAt:1});await db.messages.put(row);
useAuthStore.getState().login('media-user','图片验收',null,'🌙');createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, write: false, format: 'esm', jsx: 'automatic', platform: 'browser', define, loader });
const seed = await build({ entryPoints: ['scripts/verify/preferences-ui-seed.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', define, loader });
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(fixture.outputFiles[0].text); return; }
  if (path === '/fixture') { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(`<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${stylesheet}"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`); return; }
  if (path === '/bootstrap') { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(`<html><body><script>${seed.outputFiles[0].text}</script></body></html>`); return; }
  const file = resolve(appRoot, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(appRoot + sep)) { response.writeHead(404).end(); return; }
  try { response.setHeader('Content-Type', ({ '.html': 'text/html;charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream'); response.end(readFileSync(file)); } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], screenshots = [], errors = [], external = [];
const pass = (name, value, details) => { assert.ok(value, name + (details ? ': ' + JSON.stringify(details) : '')); results.push({ name, details }); console.log('PASS ' + name); };
const prepare = async (page, clipboard = false) => {
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin || url.protocol === 'data:') return route.continue(); external.push({ origin: url.origin, path: url.pathname }); return route.abort(); });
  await page.addInitScript(({ version, clipboard }) => { localStorage.setItem('virtugene:lastSeenVersion', version); localStorage.setItem('virtugene:onboarded:ui-shell-user', '1'); window.mediaAnimations = []; const animate = Element.prototype.animate; Element.prototype.animate = function(frames, options) { window.mediaAnimations.push({className:this.className,frames,options});return animate.call(this,frames,options);}; if(clipboard) Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.productionCopies??=[];window.productionCopies.push(text);}}}); }, { version, clipboard });
};
const focusReady = async (page, dialog) => { await dialog.waitFor(); const handle = await dialog.elementHandle(); await page.waitForFunction(node => node.contains(document.activeElement), handle); };
const snapshot = async (page, name) => { const file = join(output, name + '.png'); await page.screenshot({ path: file }); screenshots.push({ name, file }); };
const nativeBack = page => page.evaluate(() => !window.dispatchEvent(new Event('vg:back-request', { cancelable: true })));
const drag = async (page, x, y, release = true) => { const box = await page.locator('.vg-media-stage').boundingBox(); const sx = box.x + box.width / 2, sy = box.y + box.height / 2; await page.mouse.move(sx,sy); await page.mouse.down(); await page.mouse.move(sx+x,sy+y,{steps:8}); if(release) await page.mouse.up(); };
let page;
try {
  page = await browser.newPage({ viewport:{width:320,height:520}, reducedMotion:'reduce' }); await prepare(page); await page.goto(origin+'/fixture?virtugene-preview=mobile');
  const bubble = page.locator('.vg-message-bubble'), menu = page.getByRole('dialog',{name:'消息操作',exact:true}), viewer = page.getByRole('dialog',{name:'图片预览',exact:true});
  for(const theme of ['dark','light']) for(const width of [320,390,430]) {
    await page.setViewportSize({width,height:520}); await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
    await bubble.click({button:'right'}); await focusReady(page,menu);
    const metrics = await menu.evaluate(node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,small:[...node.querySelectorAll('button')].filter(button=>button.getBoundingClientRect().height<43.5||button.getBoundingClientRect().width<43.5).map(button=>button.textContent),overflow:node.scrollWidth>node.clientWidth+1};});
    pass(`${theme}-${width}居中消息操作不越界且全部操作44px`,metrics.left>=0&&metrics.right<=width&&metrics.top>=0&&metrics.bottom<=520&&!metrics.overflow&&!metrics.small.length,metrics);
    await snapshot(page,`${theme}-${width}-message-actions`); await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
    pass(`${theme}-${width}Escape关闭并恢复原消息焦点`,await bubble.evaluate(node=>document.activeElement===node));
  }
  await bubble.press('Shift+F10');await focusReady(page,menu);pass('键盘Shift+F10打开同一消息弹窗',await menu.isVisible());
  await menu.getByRole('button',{name:'删除',exact:true}).focus();await page.keyboard.press('Tab');pass('消息弹窗Tab循环至关闭按钮',await menu.getByRole('button',{name:'关闭',exact:true}).evaluate(node=>document.activeElement===node));
  await menu.getByRole('button',{name:'引用',exact:true}).click();await menu.waitFor({state:'hidden'});pass('引用仍指向原消息',await page.evaluate(()=>window.mediaUi.actions.some(row=>row.kind==='quote'&&row.id==='media-message')));
  for(const [label,kind] of [['朗读','speak'],['记住','remember'],['表达样本','sample'],['收藏为共同记忆','collect'],['查看记忆依据','basis']]) {await bubble.press('Shift+F10');await menu.getByRole('button',{name:label,exact:true}).click();await menu.waitFor({state:'hidden'});pass(`${label}保留原动作`,await page.evaluate(kind=>window.mediaUi.actions.some(row=>row.kind===kind&&row.id==='media-message'),kind));}
  await bubble.click({button:'right'});await menu.getByRole('button',{name:'复制',exact:true}).click();await menu.waitFor({state:'hidden'});pass('复制传递原消息全文',await page.evaluate(()=>window.mediaUi.copies[0]==='这是本地图片与消息操作检查，保留所有原有动作。'));
  await bubble.click({button:'right'});await menu.getByRole('button',{name:'删除',exact:true}).click();const deletion=page.getByRole('dialog',{name:'删除这条消息？',exact:true});await deletion.getByRole('button',{name:'取消',exact:true}).click();await deletion.waitFor({state:'hidden'});pass('取消删除保留真实消息',await page.evaluate(()=>window.mediaUi.exists()));
  await bubble.click({button:'right'});await page.evaluate(()=>window.mediaUi.owner('other-owner'));await menu.waitFor({state:'hidden'});pass('账号变化关闭旧消息操作且不删除记录',await page.evaluate(()=>window.mediaUi.exists()));await page.evaluate(()=>window.mediaUi.owner('media-user'));
  await bubble.click({button:'right'});await page.evaluate(()=>window.mediaUi.streaming(true));await menu.waitFor({state:'hidden'});await page.evaluate(()=>window.mediaUi.streaming(false));pass('开始生成关闭旧菜单且结束后不自动重新弹出',!(await menu.isVisible()));
  await page.getByRole('button',{name:'查看消息图片',exact:true}).press('Enter');await focusReady(page,viewer);pass('单聊图片键盘进入共享图片预览',await viewer.locator('.vg-media-stage').count()===1);pass('App返回优先关闭图片',await nativeBack(page));await viewer.waitFor({state:'hidden'});pass('关闭图片恢复图片入口焦点',await page.getByRole('button',{name:'查看消息图片',exact:true}).evaluate(node=>document.activeElement===node));
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'打开相册',exact:true}).click();await focusReady(page,viewer);await snapshot(page,'shared-viewer');
  await drag(page,-120,15,false);pass('水平手势锁定，不同时下拉关闭',await page.locator('.vg-media-stage').getAttribute('data-gesture-direction')==='x'&&await page.locator('.vg-media-stage').evaluate(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).m42===0));await page.mouse.up();await page.waitForFunction(()=>document.querySelector('.vg-media-stage')?.getAttribute('data-preview-index')==='1');pass('水平松手切换下一张图片',true);
  await viewer.getByRole('button',{name:'上一张图片',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.vg-media-stage')?.getAttribute('data-preview-index')==='0');await page.waitForFunction(()=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.vg-media-track')).transform).m41)<.5);await drag(page,120,0,false);const pull=await page.locator('.vg-media-track').evaluate(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);pass('图片首帧边界阻尼限制拖动距离',pull>0&&pull<38,pull);await page.mouse.up();await page.waitForFunction(()=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.vg-media-track')).transform).m41)<.5);
  await drag(page,35,35);pass('斜向轻拖不会误翻页或关闭',await viewer.isVisible()&&await page.locator('.vg-media-stage').getAttribute('data-preview-index')==='0');
  await drag(page,0,55,false);pass('纵向手势锁定，不同时横向翻页',await page.locator('.vg-media-stage').getAttribute('data-gesture-direction')==='y');await page.mouse.up();await page.waitForFunction(()=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.vg-media-stage')).transform).m42)<.5);pass('未越阈值的下拉顺滑回位',await viewer.isVisible());
  await viewer.getByRole('button',{name:'下一张图片',exact:true}).click();await page.locator('.vg-media-stage').evaluate(node=>node.addEventListener('pointerdown',()=>{window.captureBefore=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.vg-media-track')).transform).m41;},{capture:true,once:true}));await drag(page,0,0,false);const before=await page.evaluate(()=>window.captureBefore),captured=await page.locator('.vg-media-track').evaluate(node=>new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);pass('动画途中按住从已显示位置接管',Math.abs(captured-before)<1.5,{before,captured});await page.mouse.up();
  await page.evaluate(()=>window.mediaUi.images(1));await page.waitForFunction(()=>document.querySelector('.vg-media-stage')?.getAttribute('data-preview-index')==='0');pass('图片列表缩短立即钳制索引并禁用下一张',await viewer.getByRole('button',{name:'下一张图片',exact:true}).isDisabled());
  await drag(page,0,55,false);await page.locator('.vg-media-stage').evaluate(node=>{if(node.hasPointerCapture(1))node.releasePointerCapture(1);});await page.mouse.up();pass('指针捕获丢失后清除半途拖拽状态',await page.locator('.vg-media-stage').getAttribute('data-gesture-direction')===null&&await page.locator('.vg-media-stage').evaluate(node=>getComputedStyle(node).transform==='none'));
  await drag(page,0,55,false);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();pass('窗口失焦停止拖拽且保留当前图片',await viewer.isVisible()&&await page.locator('.vg-media-stage').getAttribute('data-gesture-direction')===null);
  await page.evaluate(()=>window.mediaUi.images(0));await viewer.waitFor({state:'hidden'});pass('图片列表清空关闭预览，不出现空白负索引',true);
  await page.getByRole('button',{name:'打开相册',exact:true}).click();await focusReady(page,viewer);await drag(page,0,170);await viewer.waitFor({state:'hidden'});pass('下拉越过阈值关闭预览',true);
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'打开相册',exact:true}).click();await focusReady(page,viewer);await page.evaluate(()=>{window.mediaAnimations=[];});await viewer.getByRole('button',{name:'下一张图片',exact:true}).click();pass('减少动效仍切图且不启动位移动画',await page.evaluate(()=>window.mediaAnimations.length===0)&&await page.locator('.vg-media-stage').getAttribute('data-preview-index')==='1');await page.keyboard.press('Escape');await viewer.waitFor({state:'hidden'});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>{document.documentElement.dataset.vgReducedMotion='true';window.dispatchEvent(new Event('vg:motion-preference'));});await page.getByRole('button',{name:'打开相册',exact:true}).click();await focusReady(page,viewer);await page.evaluate(()=>{window.mediaAnimations=[];});await viewer.getByRole('button',{name:'下一张图片',exact:true}).click();pass('应用内减少动效同样禁止图片与计数位移动画',await page.evaluate(()=>window.mediaAnimations.length===0));await page.keyboard.press('Escape');await viewer.waitFor({state:'hidden'});pass('敏感消息操作和图片退出不留离场内容副本',await page.locator('.vg-motion-snapshot').count()===0);
  await bubble.click({button:'right'});await menu.getByRole('button',{name:'删除',exact:true}).click();await deletion.getByRole('button',{name:'删除',exact:true}).click();await page.waitForFunction(async()=>!await window.mediaUi.exists());pass('确认删除通过真实消息仓库落库',!(await page.evaluate(()=>window.mediaUi.exists())));
  await page.close();

  if(!sourceOnly){
    page=await browser.newPage({viewport:{width:320,height:520},reducedMotion:'reduce'});await prepare(page,true);await page.goto(origin+'/bootstrap?virtugene-preview=mobile');await page.evaluate(()=>window.preferencesSeed());
    await page.evaluate(image=>new Promise((done,reject)=>{const request=indexedDB.open('virtugene');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('messages','readwrite');tx.objectStore('messages').put({id:'production-chat-image',sessionId:'ui-shell-session-0',role:'assistant',content:'生产App图片消息验收。',image,createdAt:Date.now()+1000,isProactive:false});tx.oncomplete=()=>{db.close();done();};};}),image);
    await page.goto(origin+'/?virtugene-preview=mobile');const nav=page.getByRole('navigation',{name:'主导航',exact:true});await nav.waitFor({timeout:90000});await nav.getByRole('button',{name:'消息',exact:true}).click();await page.locator('.vg-conversation-row').filter({hasText:'星澜'}).first().click();
    const entry=page.getByRole('button',{name:'查看消息图片',exact:true}),actualViewer=page.getByRole('dialog',{name:'图片预览',exact:true}),actualBubble=page.locator('.vg-message-bubble').filter({has:entry}),actualMenu=page.getByRole('dialog',{name:'消息操作',exact:true});
    await entry.press('Enter');await focusReady(page,actualViewer);pass('actual production App 单聊图片进入共享预览',await actualViewer.locator('.vg-media-stage').count()===1);await snapshot(page,'production-chat-image');await page.keyboard.press('Escape');await actualViewer.waitFor({state:'hidden'});pass('actual production App 图片Escape返回且入口焦点恢复',await entry.evaluate(node=>document.activeElement===node));
    await actualBubble.click({button:'right'});await focusReady(page,actualMenu);await snapshot(page,'production-message-actions');await actualMenu.getByRole('button',{name:'引用',exact:true}).click();await actualMenu.waitFor({state:'hidden'});pass('actual production App 引用保留目标消息',await page.getByRole('button',{name:'取消引用',exact:true}).locator('..').innerText().then(text=>text.includes('生产App图片消息验收。')));
    await actualBubble.click({button:'right'});await actualMenu.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog',{name:'删除这条消息？',exact:true}).getByRole('button',{name:'取消',exact:true}).click();pass('actual production App 取消删除仍能查看消息图片',await entry.isVisible());
    await actualBubble.press('Shift+F10');await actualMenu.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('dialog',{name:'删除这条消息？',exact:true}).getByRole('button',{name:'删除',exact:true}).click();await page.waitForFunction(()=>new Promise(done=>{const request=indexedDB.open('virtugene');request.onsuccess=()=>{const db=request.result,row=db.transaction('messages').objectStore('messages').get('production-chat-image');row.onsuccess=()=>{db.close();done(!row.result);};};}));pass('actual production App 确认删除通过原管线落真实IndexedDB',true);
  }
  pass('专项无页面错误',errors.length===0,errors);pass('专项零真实外部请求和模型用量',external.length===0,external);
  writeFileSync(join(output,'result.json'),JSON.stringify({passed:results.length,sourceOnly,version,actualIndex:indexHtml.match(/assets\/[^"']+/g),results,screenshots,errors,externalRequests:external,modelCalls:0,limitations:'组件夹具仅模拟剪贴板与非删除回调；删除使用真实消息仓库；生产路径使用完整实际产物与隔离IndexedDB。没有Android真机或系统剪贴板测试。'},null,2));console.log(`${results.length} chat media/action checks PASS; ${output}`);
}catch(error){if(page&&!page.isClosed())await snapshot(page,'failure').catch(()=>{});writeFileSync(join(output,'failure.json'),JSON.stringify({failure:String(error),passed:results.length,sourceOnly,results,errors,externalRequests:external,screenshots,modelCalls:0},null,2));throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));}
