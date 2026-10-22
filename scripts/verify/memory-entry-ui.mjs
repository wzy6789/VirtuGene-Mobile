import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve, basename } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const output = resolve(process.argv[2] ?? '.tmp-preview/character-portability-20261015/continuation-1/memory-entry-ui');
mkdirSync(output, { recursive: true });
const assets = resolve('dist/renderer/assets');
const files = new Set(readdirSync(assets));
const css = [...files].filter(name => name.endsWith('.css')).map(name => readFileSync(join(assets, name), 'utf8')).join('\n');
const fixture = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CharacterProfileModal} from './src/components/character/CharacterProfileModal';
import {db} from './src/db';
import {stateRepo} from './src/db/state-repo';
import {useAuthStore} from './src/store/auth-store';
window.fetch=async()=>{throw Error('No external requests in memory entry fixture');};
useAuthStore.setState({userId:'entry-owner',isLoggedIn:true,apiKey:undefined});
await db.open();
const role=id=>({id,createdBy:'entry-owner',name:id==='entry-a'?'林舟':'星遥',avatar:'🌿',tags:['自然交流','细心'],signature:'慢慢聊，认真记得。',systemPrompt:'说话自然，不编造共同经历。',greeting:'今天想聊些什么？',isPreset:false,isCustom:true,createdAt:1});
const a=role('entry-a'),b=role('entry-b');
await db.characters.bulkPut([a,b]);
await db.sessions.bulkPut([{id:'entry-session-a',userId:'entry-owner',characterId:a.id,type:'single',title:'旧会话',createdAt:1,updatedAt:2},{id:'entry-session-b',userId:'entry-owner',characterId:b.id,type:'single',title:'另一角色',createdAt:1,updatedAt:2}]);
await db.messages.bulkPut([{id:'entry-source-a',sessionId:'entry-session-a',role:'user',content:'我更喜欢周四下午练陶艺。',revision:1,createdAt:2,isProactive:false},{id:'entry-source-b',sessionId:'entry-session-b',role:'user',content:'我喜欢周末去海边。',revision:1,createdAt:2,isProactive:false}]);
await db.memories.bulkPut([{id:'entry-memory-a',userId:'entry-owner',characterId:a.id,type:'auto',memoryKind:'preference',status:'active',content:'我更喜欢周四下午练陶艺。',sourceSessionId:'entry-session-a',sourceMessageIds:['entry-source-a'],sourceMessageRevisions:{'entry-source-a':1},createdAt:2,updatedAt:2},{id:'entry-memory-b',userId:'entry-owner',characterId:b.id,type:'auto',memoryKind:'preference',status:'active',content:'我喜欢周末去海边。',sourceSessionId:'entry-session-b',sourceMessageIds:['entry-source-b'],sourceMessageRevisions:{'entry-source-b':1},createdAt:2,updatedAt:2}]);
const original=stateRepo.get.bind(stateRepo);let fail=true;
stateRepo.get=async(...args)=>{if(fail){fail=false;throw Error('Controlled read failure');}return original(...args);};
function Fixture(){const[character,setCharacter]=useState(a),[open,setOpen]=useState(true);window.memoryEntryUI={show:id=>{setCharacter(id===a.id?a:b);setOpen(true);},owner:id=>useAuthStore.setState({userId:id})};return <main><button onClick={()=>setOpen(true)}>打开角色空间</button>{open&&<CharacterProfileModal character={character} userId="entry-owner" onClose={()=>setOpen(false)} onChat={()=>{}} worldCharacters={[a,b]}/>}</main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty', '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'import.meta.env': '{}', 'import.meta.hot': 'undefined', __APP_VERSION__: '"test"' } });
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0], name = basename(path);
  if (path === '/fixture.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fixture.outputFiles[0].text); return; }
  if (path.startsWith('/assets/') && files.has(name)) { res.setHeader('Content-Type', name.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream'); res.end(readFileSync(join(assets, name))); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Permissions-Policy', 'microphone=(), camera=()');
  res.end(`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{height:100%;margin:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { complete: false, checks: [], errors: [], screenshots: [], modelCalls: 0, microphoneCalls: 0, beforeVisual: false };
const check = (value, label) => { assert.ok(value, label); report.checks.push(label); };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?virtugene-preview=mobile`);
  await page.getByText('最近的故事暂时无法读取。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByText('最近的故事暂时无法读取。', { exact: true }).waitFor({ state: 'hidden' });
  check(true, 'actual profile read error exposes a working retry using FeedbackNotice children');
  await page.getByRole('button', { name: '记忆档案', exact: true }).waitFor();
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `profile ${theme}/${width} stays within viewport`);
    const button = page.getByRole('button', { name: '记忆档案', exact: true });
    await button.scrollIntoViewIfNeeded();
    check((await button.boundingBox()).height >= 44, `memory entry ${theme}/${width} retains a 44px touch target`);
    const path = join(output, `profile-${theme}-${width}.png`);
    await page.screenshot({ path }); report.screenshots.push(path);
  }
  await page.getByRole('button', { name: '记忆档案', exact: true }).click();
  await page.getByText('我更喜欢周四下午练陶艺。', { exact: true }).waitFor();
  check(!await page.getByText('我喜欢周末去海边。', { exact: true }).count(), 'archive opened from role A shows A fact without role B fact');
  await page.getByRole('button', { name: '看当时说的话', exact: true }).click();
  await page.getByText('我更喜欢周四下午练陶艺。', { exact: true }).nth(1).waitFor();
  check(true, 'real archive loads the original owned message');
  await page.screenshot({ path: join(output, 'archive-original.png') });
  await page.evaluate(() => window.memoryEntryUI.show('entry-b'));
  await page.getByText('我更喜欢周四下午练陶艺。', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '记忆档案', exact: true }).click();
  await page.getByText('我喜欢周末去海边。', { exact: true }).waitFor();
  check(!await page.getByText('我更喜欢周四下午练陶艺。', { exact: true }).count(), 'switching roles remounts nested archive and never shows prior role data');
  await page.evaluate(() => window.memoryEntryUI.owner('another-owner'));
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check(!await page.getByText('我喜欢周末去海边。', { exact: true }).count(), 'account switch immediately removes private profile and archive');
  check(report.errors.length === 0, 'no browser runtime errors');
  report.complete = true;
} catch (error) { report.errors.push(error.stack ?? String(error)); process.exitCode = 1; }
finally { await browser.close(); await new Promise(r => server.close(r)); writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ complete: report.complete, checks: report.checks.length, errors: report.errors, output }));
