import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const output = resolve(process.env.VG_GROUP_MOTION_EVIDENCE ?? '.tmp-preview/group-touch-motion-20261013');
mkdirSync(output, { recursive: true });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const fixture = `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {GroupChatPage} from './src/components/chat/GroupChatPage';
import {TagInput,PERSONALITY_TAGS} from './src/components/ui/PhysicalInteractions';
import {useGroupStore} from './src/store/group-store'; import {useChatStore} from './src/store/chat-store';
import {useAuthStore} from './src/store/auth-store'; import {db} from './src/db';
const characters=[{id:'member',name:'星澜',avatar:'🌙',createdBy:'fixture-user'}];
const group={id:'fixture-group',name:'星域日常',characterIds:['member'],userId:'fixture-user'};
let next=0; const row=(content)=>({id:'fixture-message-'+next++,sessionId:'fixture-session',role:'assistant',senderId:'member',content,createdAt:Date.now()+next,isProactive:false,witnessedBy:['member']});
window.groupMotion={sent:[],copied:[],deletes:0,append:async()=>{const message=row('新来的群聊回复，保持原来的阅读位置。');await db.messages.put(message);const state=useGroupStore.getState();useGroupStore.setState({groupMessages:[...state.groupMessages,message]});},busy:value=>useGroupStore.setState({groupSending:value}),account:id=>useAuthStore.setState({userId:id}),exists:async id=>!!await db.messages.get(id),hasPinned:async()=>!!await db.memories.where('characterId').equals('member').filter(item=>item.pinned&&item.userId==='fixture-user').first()};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.groupMotion.copied.push(text);}}});
function Fixture(){const [open,setOpen]=useState(true),[tags,setTags]=useState(['温柔','细心','可靠','幽默','坦率','冷静']);Object.assign(window.groupMotion,{showTags:()=>setOpen(false),setTags});return <main className="mobile-layout" style={{padding:16,minHeight:'100dvh'}}><TagInput value={tags} onChange={setTags} suggestions={PERSONALITY_TAGS} label="性格标签"/><output id="tags">{JSON.stringify(tags)}</output>{open&&<GroupChatPage initialGroupId={group.id} onClose={()=>setOpen(false)}/>}</main>}
async function run(){
 await db.open();const now=Date.now();
 await db.users.put({id:'fixture-user',username:'验收账号',passwordHash:'fixture-only',createdAt:now});
 await db.characters.bulkPut(characters);await db.groups.put({...group,createdAt:now,updatedAt:now});
 await db.sessions.bulkPut([{id:'fixture-session',userId:'fixture-user',characterId:'',groupId:group.id,type:'group',title:group.name,createdAt:now,updatedAt:now},{id:'foreign-session',userId:'other-user',characterId:'',groupId:'foreign-group',type:'group',title:'其他账号',createdAt:now,updatedAt:now}]);
 const messages=Array.from({length:60},(_,i)=>row('第'+(i+1)+'段旧消息。你可以慢慢翻看，不必因为别人发来消息而离开正在看的这段。'));
 await db.messages.bulkPut([...messages,{...row('其他账号的原话保持完整'),id:'foreign-message',sessionId:'foreign-session'}]);
 useAuthStore.getState().login('fixture-user','验收账号',null,'🌙');useChatStore.setState({characters});
 const deleteReal=useGroupStore.getState().deleteGroupMessage;
 useGroupStore.setState({groups:[group],currentGroup:group,currentGroupId:group.id,currentSessionId:'fixture-session',groupMessages:messages,groupSending:false,groupError:null,loadGroups:async()=>{},selectGroup:async()=>{},proactiveGroupTurn:async()=>{},deleteGroupMessage:async id=>{window.groupMotion.deletes++;await deleteReal(id);},sendGroupMessage:async(text)=>{window.groupMotion.sent.push(text);const message={...row(text),role:'user',senderId:undefined};await db.messages.put(message);const state=useGroupStore.getState();useGroupStore.setState({groupMessages:[...state.groupMessages,message]});}});
 createRoot(document.getElementById('root')).render(<Fixture/>);
}
run().catch(error=>{setTimeout(()=>{throw error});});
`;
const bundled = await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',loader:{'.png':'dataurl','.webp':'dataurl','.css':'empty'},define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:JSON.stringify(version)},logLevel:'warning'});
const assets = resolve('dist/renderer/assets');
const cssFile = readdirSync(assets).find(name => /^index-.*\.css$/.test(name));
const server = createServer((request,response) => {
  if (request.url === '/fixture.js') { response.setHeader('content-type','text/javascript'); response.end(bundled.outputFiles[0].contents); }
  else if (request.url === '/styles.css') { response.setHeader('content-type','text/css'); response.end(readFileSync(join(assets,cssFile))); }
  else if (/^\/[\w.-]+\.woff2$/.test(request.url)) { response.setHeader('content-type','font/woff2'); response.end(readFileSync(join(assets,request.url.slice(1)))); }
  else if (request.url === '/favicon.ico') { response.statusCode=204; response.end(); }
  else { response.setHeader('content-type','text/html'); response.end('<!doctype html><html class="dark" lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({channel:'chrome',headless:true});
const errors=[], results=[];
const menuObservations=[];
const check=(condition,name)=>{assert.ok(condition,name);results.push(name);console.log('PASS '+name);};
try {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(()=>{
    window.layoutAudit=[];
    const nativeAnimate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      if(this.closest('.vg-tag-field'))window.layoutAudit.push({kind:'animate',host:this.matches('.vg-tag-field'),frames});
      return nativeAnimate.call(this,frames,options);
    };
    for(const name of ['offsetLeft','offsetTop']){
      const descriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,name);
      Object.defineProperty(HTMLElement.prototype,name,{...descriptor,get(){if(this.matches('[data-flow-key]'))window.layoutAudit.push({kind:'read',name});return descriptor.get.call(this);}});
    }
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  const thread=page.locator('[data-group-thread]');
  await thread.waitFor(); await page.waitForTimeout(450);
  const atBottom=()=>thread.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<2);
  const readHistory=async()=>{await thread.evaluate(el=>{el.scrollTop=140;el.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(50);};
  check(await atBottom(),'opening a group starts at the latest message');
  await readHistory(); await page.evaluate(()=>groupMotion.append()); await page.waitForTimeout(450);
  check(await thread.evaluate(el=>el.scrollTop)===140,'a new group reply preserves the user’s history reading position');
  await page.evaluate(()=>groupMotion.busy(true));await page.waitForTimeout(400);
  check(await thread.evaluate(el=>el.scrollTop)===140,'the typing indicator preserves history reading');
  await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));window.visualViewport?.dispatchEvent(new Event('resize'));});await page.waitForTimeout(450);
  check(await thread.evaluate(el=>el.scrollTop)===140,'window and visual viewport changes preserve history reading');
  await page.evaluate(()=>groupMotion.busy(false));await page.waitForTimeout(350);
  const latest=page.getByRole('button',{name:'回到最新群消息'});
  check(await latest.isVisible(),'a history reader has an explicit return-to-latest action');
  await latest.click();await page.waitForTimeout(650);
  check(await atBottom(),'return-to-latest resumes following');
  await page.evaluate(()=>groupMotion.append());await page.waitForTimeout(450);
  check(await atBottom(),'new replies follow after returning to latest');
  await readHistory();
  const input=page.getByRole('textbox',{name:'群消息内容'});
  await input.fill('继续聊吧');await page.waitForTimeout(400);await readHistory();
  await page.getByRole('button',{name:'发送群消息'}).click();await page.waitForTimeout(450);
  check(await atBottom()&&await page.evaluate(()=>groupMotion.sent.join('|'))==='继续聊吧','an explicit send resumes following and sends exactly once');
  await readHistory();await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(80);
  await latest.click();await page.waitForTimeout(80);
  check(await atBottom(),'reduced-motion return reaches latest without waiting for a movement animation');
  check(await page.locator('.vg-latest-message-button').evaluate(el=>el.getAnimations().length===0),'reduced-motion return control has no active animation');
  for(const theme of ['dark','light'])for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
    await page.waitForTimeout(150);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'group controls fit '+theme+' '+width+'px');
  }
  await page.screenshot({path:join(output,'group-light-430.png')});
  const targetId=await thread.getByText('继续聊吧',{exact:true}).evaluate(el=>el.closest('[id^="gmsg-"]').id.slice(5));
  const dialog=page.getByRole('dialog');
  const openSentMenu=async()=>{
    await thread.focus();
    await thread.getByText('继续聊吧',{exact:true}).scrollIntoViewIfNeeded();
    const bubble=await thread.getByText('继续聊吧',{exact:true}).boundingBox();
    await page.mouse.click(bubble.x+bubble.width-2,bubble.y+bubble.height-2,{button:'right'});
    await page.getByRole('dialog',{name:'消息操作'}).waitFor();
  };
  for(const theme of ['dark','light'])for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);await page.waitForTimeout(250);
    await openSentMenu();
    const bounds=await dialog.evaluate(el=>{const box=el.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:innerWidth,height:innerHeight,centered:Math.abs(box.left+box.width/2-innerWidth/2)<2,isDialog:el.classList.contains('vg-mobile-dialog')};});
    menuObservations.push({theme,...bounds});
    check(bounds.left>=0&&bounds.top>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.height&&bounds.centered&&bounds.isDialog,'right-bottom long press stays inside a centered dialog '+theme+' '+width+'px');
    if(theme==='dark'&&width===320)await page.screenshot({path:join(output,'group-menu-dark-320.png')});
    if(theme==='light'&&width===430)await page.screenshot({path:join(output,'group-menu-light-430.png')});
    await page.keyboard.press('Escape');await page.waitForTimeout(50);
  }
  check(await thread.evaluate(el=>document.activeElement===el),'Escape closes the menu and restores its prior scroll-surface focus');
  await openSentMenu();
  const actionMetrics=await dialog.locator('[data-group-message-actions] > button').evaluateAll(buttons=>buttons.map(button=>({height:button.getBoundingClientRect().height,svg:!!button.querySelector('svg')})));
  check(actionMetrics.length===4&&actionMetrics.every(item=>item.height>=48&&item.svg),'all four message actions have SVG icons and 48px touch targets');
  await dialog.getByRole('button',{name:'关闭',exact:true}).focus();await page.keyboard.press('Shift+Tab');
  check(await dialog.getByRole('button',{name:'删除',exact:true}).evaluate(el=>document.activeElement===el),'Shift+Tab wraps within the dialog');
  await page.mouse.click(8,8);await page.waitForTimeout(50);
  check(await dialog.count()===0,'tapping the scrim closes the dialog');
  await openSentMenu();
  const backHandled=await page.evaluate(()=>{const event=new Event('vg:back-request',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});await page.waitForTimeout(50);
  check(backHandled&&await dialog.count()===0&&await page.locator('[data-group-page]').count()===1,'native-back request closes the menu before leaving the group');
  await page.emulateMedia({reducedMotion:'no-preference'});await openSentMenu();await page.keyboard.press('Escape');
  check(await page.locator('.vg-modal-exit').count()===0,'closing message actions never retains a sensitive exit snapshot');
  await page.emulateMedia({reducedMotion:'reduce'});await openSentMenu();
  await dialog.getByRole('button',{name:'复制',exact:true}).click();await page.waitForTimeout(100);
  check(await dialog.count()===0&&await page.evaluate(()=>groupMotion.copied.join('|'))==='继续聊吧','copy preserves the selected text and closes the action dialog');
  await openSentMenu();await dialog.getByRole('button',{name:'引用',exact:true}).click();await page.waitForTimeout(100);
  check(await dialog.count()===0&&(await page.locator('[data-group-quote]').textContent()).includes('继续聊吧'),'quote preserves the selected source in the composer');
  await page.getByRole('button',{name:'取消引用或图片'}).click();
  await openSentMenu();await dialog.getByRole('button',{name:'记住',exact:true}).click();await page.waitForFunction(async()=>groupMotion.hasPinned());await dialog.waitFor({state:'hidden'});
  check(await page.evaluate(()=>groupMotion.hasPinned())&&await dialog.count()===0,'remember uses the real group store and persists a pinned member memory');
  await page.evaluate(()=>groupMotion.busy(true));await openSentMenu();
  check(await dialog.getByRole('button',{name:'删除',exact:true}).isDisabled()&&await dialog.getByRole('button',{name:'记住',exact:true}).isDisabled(),'generation keeps delete and remember actions locked');
  await page.evaluate(()=>groupMotion.busy(false));await page.keyboard.press('Escape');
  await openSentMenu();await dialog.getByRole('button',{name:'删除',exact:true}).click();
  check(await page.evaluate(id=>groupMotion.exists(id),targetId),'opening delete confirmation does not delete the message');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  check(await page.getByRole('dialog',{name:'消息操作'}).count()===1&&await page.evaluate(id=>groupMotion.exists(id),targetId),'cancelling confirmation returns to the menu with the message intact');
  await dialog.getByRole('button',{name:'删除',exact:true}).click();
  await page.evaluate(()=>groupMotion.account('other-user'));await page.waitForTimeout(100);
  check(await dialog.count()===0&&await page.evaluate(id=>groupMotion.exists(id),targetId)&&await page.evaluate(()=>groupMotion.exists('foreign-message')),'account changes dismiss stale confirmation and preserve both accounts’ records');
  await page.evaluate(()=>groupMotion.account('fixture-user'));await page.waitForTimeout(100);await openSentMenu();await dialog.getByRole('button',{name:'删除',exact:true}).click();
  await dialog.getByRole('button',{name:'确认删除',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(async id=>!await groupMotion.exists(id),targetId);await page.waitForTimeout(100);
  check(await page.evaluate(()=>groupMotion.deletes)===1&&await thread.locator('#gmsg-'+targetId).count()===0&&await dialog.count()===0,'confirmed delete runs once through the real store and removes the IndexedDB/UI record');
  check(await page.evaluate(()=>groupMotion.exists('foreign-message')),'deletion leaves the other account’s message untouched');
  await page.evaluate(()=>groupMotion.showTags());await page.waitForTimeout(100);await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:320,height:844});await page.waitForTimeout(300);
  await page.evaluate(()=>{layoutAudit.length=0;groupMotion.setTags(['温柔','幽默','冷静']);});await page.waitForTimeout(60);
  const events=await page.evaluate(()=>layoutAudit);
  const animated=events.filter(event=>event.kind==='animate');
  check(animated.length>0,'wrapped tag changes retain a FLIP position transition');
  check(animated.every(event=>!event.host&&event.frames.every(frame=>Object.keys(frame).every(key=>['transform','opacity','offset','easing','composite'].includes(key)))),'tag layout animations use only transform/opacity and never animate the field height');
  const firstAnimation=events.findIndex(event=>event.kind==='animate');
  check(firstAnimation>0&&events.slice(firstAnimation).every(event=>event.kind!=='read'),'all tag layout measurements finish before any animation begins');
  await page.waitForTimeout(300);
  const before=await page.locator('.vg-tag-field').evaluate(el=>el.offsetHeight);
  await page.getByRole('button',{name:'删除标签 幽默',exact:true}).click();await page.waitForTimeout(480);
  check(await page.locator('#tags').textContent()==='["温柔","冷静"]'&&await page.locator('.vg-tag-field').evaluate(el=>el.offsetHeight)<=before,'normal tag removal finishes and the field settles to its natural height');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);
  await page.evaluate(()=>{layoutAudit.length=0;groupMotion.setTags(['细心','可靠','幽默','坦率','冷静']);});await page.waitForTimeout(100);
  check(await page.evaluate(()=>layoutAudit.every(event=>event.kind!=='animate')),'reduced motion skips tag FLIP transitions');
  await page.getByRole('button',{name:'删除标签 细心',exact:true}).click();await page.waitForTimeout(80);
  check(!(await page.locator('#tags').textContent()).includes('细心'),'reduced-motion tag deletion remains immediate and usable');
  check(errors.length===0,'no browser exceptions');
  writeFileSync(join(output,'result.json'),JSON.stringify({checks:results.length,results,errors,productionStylesheet:cssFile,menuObservations,businessBoundary:'Actual React UI, scrolling hook, group delete/remember store commands, and IndexedDB. Seeded records, local send stub and clipboard boundary mock; no model generation or native clipboard claim.',externalModelCalls:0,deviceTested:false,version},null,2)+'\n');
  console.log('ALL PASS '+results.length);
} catch(error) {
  writeFileSync(join(output,'failure.json'),JSON.stringify({error:error.stack,passed:results,errors},null,2)+'\n');throw error;
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
