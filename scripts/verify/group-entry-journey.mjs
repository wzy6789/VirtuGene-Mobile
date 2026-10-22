import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {resolve,join,dirname} from 'node:path';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const before=process.argv.includes('--before');
const out=resolve('.tmp-preview/ui-overhaul-20261016/group-entry/'+(before?'before':'after'));
mkdirSync(out,{recursive:true});
const source=`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {GroupChatPage} from './src/components/chat/GroupChatPage';
import {useGroupStore} from './src/store/group-store';import {useChatStore} from './src/store/chat-store';
import {useAuthStore} from './src/store/auth-store';import {db} from './src/db';import {groupRepo} from './src/db/group-repo';
const original=groupRepo.getById,originalList=groupRepo.getByUser;
let holds=new Map(),failGroup='',failList=false,show;
groupRepo.getById=async id=>{const hold=holds.get(id);if(hold)await hold.promise;if(failGroup===id){failGroup='';throw Error('injected read failure');}return original(id);};
groupRepo.getByUser=async id=>{if(failList){failList=false;throw Error('injected list failure');}return originalList(id);};
const api=window.groupEntry={errors:[],open:id=>show(id??''),close:()=>show(undefined),hold:id=>{let release;const promise=new Promise(r=>release=r);holds.set(id,{promise,release});},release:id=>{const hold=holds.get(id);holds.delete(id);hold?.release();},fail:id=>failGroup=id,failList:()=>failList=true,state:()=>{const s=useGroupStore.getState();return {id:s.currentGroupId,messages:s.groupMessages.map(m=>m.content)};},select:id=>{useGroupStore.getState().selectGroup(id).catch(e=>api.errors.push(e.message));},account:id=>useAuthStore.setState({userId:id}),sessions:()=>db.sessions.toArray()};
function App(){const [target,setTarget]=useState();show=setTarget;return <main className='mobile-layout'>{target!==undefined&&<GroupChatPage key={target} initialGroupId={target||undefined} onClose={()=>setTarget(undefined)}/>}</main>}
async function boot(){await db.open();const now=Date.now();
 await db.users.bulkPut(['owner','foreign'].map(id=>({id,username:id,passwordHash:'fixture',createdAt:now})));
 const characters=[{id:'one',name:'知微',avatar:'🙂',createdBy:'owner',createdAt:now},{id:'two',name:'程砚',avatar:'🙂',createdBy:'owner',createdAt:now}];
 await db.characters.bulkPut(characters);
 await db.groups.bulkPut(['a','b','foreign'].map(id=>({id,userId:id==='foreign'?'foreign':'owner',name:id==='a'?'旧群聊':id==='b'?'新的共同聊天':'其他账号群聊',characterIds:['one','two'],createdAt:now,updatedAt:now})));
 await db.sessions.bulkPut(['a','b','foreign'].map(id=>({id:'session-'+id,userId:id==='foreign'?'foreign':'owner',groupId:id,type:'group',characterId:'',title:id,createdAt:now,updatedAt:now})));
 await db.messages.bulkPut(['a','b','foreign'].flatMap(id=>Array.from({length:id==='a'?65:1},(_,i)=>({id:id+'-'+i,sessionId:'session-'+id,role:'assistant',senderId:'one',content:(id==='a'?'旧群独有的历史记录':id==='b'?'新群独有的消息':'其他账号私密内容')+' '+i+'。这是一段可以上翻阅读的真实本地夹具记录。',createdAt:now+i}))));
 useAuthStore.getState().login('owner','owner',null,'🙂');useChatStore.setState({characters});
 await useGroupStore.getState().loadGroups();await useGroupStore.getState().selectGroup('a');
 createRoot(document.getElementById('app')).render(<App/>);window.ready=true;
}boot().catch(e=>setTimeout(()=>{throw e}));
`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',loader:{'.css':'empty','.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"DEV":true}','import.meta.hot':'undefined',__APP_VERSION__:JSON.stringify(JSON.parse(readFileSync('package.json','utf8')).version)},plugins:before?[{name:'baseline-only-in-bundle',setup(b){b.onLoad({filter:/(GroupChatPage\.tsx|group-store\.ts)$/},args=>{const file=join(out,args.path.endsWith('GroupChatPage.tsx')?'GroupChatPage.tsx':'group-store.ts');return {contents:readFileSync(file,'utf8'),loader:'tsx'};});}}]:[],logLevel:'warning'});
const assets=resolve('dist/renderer/assets'),css=readdirSync(assets).find(n=>/^index-.*\.css$/.test(n));
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].contents);}else if(req.url==='/style.css'){res.setHeader('content-type','text/css');res.end(readFileSync(join(assets,css)));}else if(/^\/[\w.-]+\.woff2$/.test(req.url)&&existsSync(join(assets,req.url.slice(1)))){res.end(readFileSync(join(assets,req.url.slice(1))));}else if(req.url==='/favicon.ico'){res.writeHead(204).end();}else{res.setHeader('content-type','text/html;charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; media-src 'none'");res.end('<!doctype html><html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="app"></div><script>window.fetch=async()=>{throw Error("No network")};if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error("No microphone")};HTMLMediaElement.prototype.play=async()=>{throw Error("No playback")};</script><script src="/fixture.js"></script></body></html>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const result={checks:[],errors:[],scope:'Actual GroupChatPage and group store, synthetic isolated IndexedDB, delayed indexed repository reads. No real model, microphone, audio or Android.'};
const check=(value,name)=>{result.checks.push({name,pass:!!value});console.log((value?'PASS ':'FAIL ')+name);};
try{
 for(const theme of ['dark','light']){
  const context=await browser.newContext({viewport:{width:theme==='dark'?320:390,height:740},reducedMotion:'reduce',recordVideo:{dir:join(out,'video'),size:{width:theme==='dark'?320:390,height:740}}});
  const page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>result.errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
  await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
  await page.evaluate(()=>{groupEntry.hold('b');groupEntry.open('b');});await page.waitForTimeout(100);
  check(await page.getByText(/旧群独有的历史记录/).count()===0,theme+': opening another group never displays previous messages');
  check(await page.getByRole('status',{name:'正在打开群聊'}).count()===1,theme+': loading has a real skeleton and status');
  await page.screenshot({path:join(out,theme+'-opening.png')});
  await page.evaluate(()=>groupEntry.release('b'));await page.getByText(/新群独有的消息/).waitFor();
  check(await page.getByText(/新群独有的消息/).count()===1,theme+': selected group opens after its own data arrives');
  await page.getByRole('button',{name:'返回群聊列表'}).click();
  await page.evaluate(()=>groupEntry.fail('b'));await page.getByRole('button',{name:/新的共同聊天/}).click();await page.waitForTimeout(100);
  check(await page.getByRole('alert').count()===1,theme+': failed open exposes an accessible retry notice');
  if(await page.getByRole('button',{name:'重新打开',exact:true}).count()){
   await page.getByRole('button',{name:'重新打开',exact:true}).click();await page.getByText(/新群独有的消息/).waitFor();
   check(true,theme+': retry opens the selected group without losing the list');
  }
  await page.evaluate(()=>groupEntry.open('a'));await page.locator('[data-group-thread]').waitFor();await page.waitForTimeout(100);
  await page.locator('[data-group-thread]').evaluate(el=>{el.scrollTop=140;el.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(50);
  await page.getByRole('textbox',{name:'群消息内容'}).focus();await page.waitForTimeout(100);
  check(await page.locator('[data-group-thread]').evaluate(el=>Math.abs(el.scrollTop-140)<2),theme+': focusing composer preserves history reading position');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),theme+': group loading and chat fit the phone width');
  await page.screenshot({path:join(out,theme+'-history-focus.png')});
  await page.evaluate(()=>{groupEntry.hold('a');groupEntry.select('a');groupEntry.select('b');});await page.waitForFunction(()=>groupEntry.state().id==='b');
  await page.evaluate(()=>groupEntry.release('a'));await page.waitForTimeout(100);
  check((await page.evaluate(()=>groupEntry.state())).id==='b',theme+': delayed earlier selection cannot overwrite the latest group');
  await page.evaluate(()=>groupEntry.select('foreign'));await page.waitForTimeout(100);
  check((await page.evaluate(()=>groupEntry.state())).id==='b',theme+': foreign group cannot become the current chat');
  await page.evaluate(()=>{groupEntry.hold('a');groupEntry.select('a');groupEntry.account('foreign');groupEntry.release('a');});await page.waitForTimeout(100);
  check((await page.evaluate(()=>groupEntry.state())).id==='b',theme+': account change rejects delayed selection');
  check(await page.locator('[data-group-page]').count()===0,theme+': old account overlay disappears immediately');
  await page.evaluate(()=>{groupEntry.account('owner');groupEntry.close();});await page.waitForTimeout(50);
  await page.evaluate(()=>{groupEntry.failList();groupEntry.open();});await page.waitForTimeout(100);
  check(await page.getByRole('alert').count()===1,theme+': list read failure remains visible beside retained rows');
  if(await page.getByRole('button',{name:'重试',exact:true}).count()){
   await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});check(true,theme+': list retries in place');
  }
  await page.evaluate(()=>groupEntry.open('missing'));await page.waitForTimeout(100);
  check(await page.locator('[data-group-thread]').count()===0&&await page.getByRole('alert').count()===1,theme+': missing group gives recovery instead of a previous chat');
  await context.close();result.checks.push({name:theme+': recording saved',pass:true,video:await page.video().path()});
 }
}catch(e){result.errors.push(e.stack);}finally{result.status=result.checks.every(c=>c.pass)&&!result.errors.length?'pass':'fail';writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));await browser.close();await new Promise(r=>server.close(r));console.log(JSON.stringify({status:result.status,checks:result.checks.length,errors:result.errors}));}
if(result.status!=='pass')process.exitCode=1;
