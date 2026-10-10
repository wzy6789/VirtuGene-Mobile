import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const bundle = await build({ entryPoints: ['scripts/verify/chat-stream.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.png': 'dataurl', '.webp': 'dataurl', '.css': 'empty' }, define: { 'import.meta.env': '{"VITE_AI_GATEWAY_URL":""}', __APP_VERSION__: '"test"' } });
const assets = 'dist/renderer/assets';
const css = readdirSync(assets).filter(file => file.endsWith('.css')).map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('');
const server = createServer((req, res) => {
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url.startsWith('/assets/')) { try { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'font/woff2'); res.end(readFileSync(join(assets, basename(req.url)))); } catch { res.writeHead(404); res.end(); } }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}<style>html,body,#app{height:100%;margin:0;background:var(--bg);color:var(--text)}</style></head><body><div id="app"></div><script src="/test.js"></script></body></html>`); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let checks = 0;
const pacingCases = [];
let debugPage;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  debugPage=page;
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => !!window.chatStreamTest);
  const test = (name, ...args) => page.evaluate(({ name, args }) => window.chatStreamTest[name](...args), { name, args });
  const check = (ok, label) => { if (!ok) throw new Error(label); checks++; console.log(`ok ${label}`); };
  const waitRequests = count => page.waitForFunction(count => window.chatStreamTest.requests().length >= count, count);
  const done = () => page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden' });
  const ready = async history => { await test('setup', history); await page.getByRole('textbox', { name: '消息内容' }).waitFor({ state: 'visible' }); await page.waitForTimeout(100); };
  await ready(0);
  checks += await test('unitChecks'); console.log('ok transport and buffering checks');
  const watchArrivals = () => page.evaluate(() => {
    window.bubbleArrivalTimes=[];
    window.bubbleArrivalObserver=new MutationObserver(() => {
      const count=document.querySelectorAll('[data-streaming-reply] .vg-streaming-part').length;
      if(count>window.bubbleArrivalTimes.length)window.bubbleArrivalTimes.push({count,time:performance.now()});
    });
    window.bubbleArrivalObserver.observe(document.body,{childList:true,subtree:true,attributes:true});
  });
  for(const buffered of [false,true]) {
    await ready(0); await watchArrivals();
    const reply='嗯，收到了。---这一条单独说。---还有另一件事。---先聊到这里。';
    if(buffered)await test('useCompleteResponses',[reply]);
    await test('submit','分开说说');
    if(!buffered){await waitRequests(1);await test('push',0,reply);}
    await page.locator('[data-streaming-reply]').waitFor();
    check(await page.locator('.vg-streaming-part').count()===1, `${buffered?'complete':'SSE'} reply first arrival does not reveal the whole batch`);
    if(!buffered)await test('finish',0);
    await done();
    const times=await page.evaluate(()=>{window.bubbleArrivalObserver.disconnect();return window.bubbleArrivalTimes;});
    pacingCases.push({transport:buffered?'complete':'SSE',reducedMotion:true,arrivals:times,gapsMs:times.slice(1).map((item,index)=>Math.round(item.time-times[index].time)),totalMs:Math.round(times.at(-1).time-times[0].time)});
    check(times.length===4&&times.every((item,index)=>item.count===index+1&&(!index||item.time-times[index-1].time>=350)),`${buffered?'complete':'SSE'} actual DOM receives four separate paced arrivals even after the provider finishes`);
    const rows=(await test('records')).filter(m=>m.role==='assistant');
    check(rows.length===4&&rows.map(m=>m.content).join('---')===reply&&rows.every((m,index)=>m.replyBatchSize===4&&m.replyBatchIndex===index),`${buffered?'complete':'SSE'} paced preview hands off to exactly four saved rows in order`);
  }
  for(const buffered of [false,true]) {
    await ready(0);
    const reply='第一条已看到。---第二条还没出现。---第三条还没出现。';
    if(buffered)await test('useCompleteResponses',[reply]);
    await test('submit','分条回复一下');
    if(!buffered){await waitRequests(1);await test('push',0,reply);}
    await page.locator('[data-streaming-reply]').waitFor();
    if(!buffered)await test('finish',0);
    await page.getByRole('button',{name:'停止生成',exact:true}).click();await done();
    await page.waitForTimeout(900);
    const rows=(await test('records')).filter(m=>m.role==='assistant');
    check(rows.length===1&&rows[0].content==='第一条已看到。'&&rows[0].stopped&&rows[0].interrupted&&!rows[0].replyBatchId,`${buffered?'complete':'SSE'} stop after provider completion drops hidden bubbles and saves only the visible prefix`);
    check((await test('records')).every(m=>!m.failed),`${buffered?'complete':'SSE'} delivery cancellation does not create a send failure`);
  }
  for(const cancel of [true,false]) {
    await ready(0);const memoryId=await test('seedMemory');
    await test('useCompleteResponses',['嗯，我记得。---你喜欢海边星空。']);await test('submit','你记得我喜欢什么吗');
    await page.locator('[data-streaming-reply]').waitFor();
    if(cancel)await page.getByRole('button',{name:'停止生成',exact:true}).click();
    await done();await page.waitForTimeout(100);
    const rows=(await test('records')).filter(m=>m.role==='assistant');const memory=await test('deliveryMemory');
    check(rows[0].contextTrace?.memoryIds?.includes(memoryId),'pacing memory fixture really recalls its independent preference');
    check(cancel? !memory.lastMentionedAt&&!rows.some(m=>m.contextTrace?.spokenMemoryIds?.includes(memoryId)) : !!memory.lastMentionedAt&&rows[0].contextTrace?.spokenMemoryIds?.includes(memoryId),cancel?'cancelled hidden memory is never marked as spoken':'a memory in a displayed later bubble is marked spoken after delivery');
  }
  await ready(0);
  await test('useCompleteResponses',['过来陪我坐会儿。','想聊就聊，我听着。']);
  await page.evaluate(()=>{
    window.completePreviewTexts=[];
    window.completePreviewObserver=new MutationObserver(()=>document.querySelectorAll('[data-streaming-reply]').forEach(node=>window.completePreviewTexts.push(node.textContent)));
    window.completePreviewObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
  });
  await test('submit','陪我聊会儿');
  await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);
  let completeSaved=[];
  const completeDeadline=Date.now()+15000;
  while(Date.now()<completeDeadline){
    completeSaved=(await test('records')).filter(m=>m.role==='assistant');
    if(completeSaved.length)break;
    await page.waitForTimeout(50);
  }
  check(completeSaved.map(m=>m.content).join('')==='想聊就聊，我听着。','complete JSON bad staging is retried before the good reply reaches the real DB');
  check(!(await page.evaluate(()=>window.completePreviewTexts.join(''))).includes('过来陪我坐'),'rejected JSON staging never flashes as a streamed preview');
  check((await test('completeRequests')).length===2,'complete JSON quality correction uses only the existing one-retry allowance');
  await page.evaluate(()=>window.completePreviewObserver.disconnect());
  await ready(0);
  await test('useCompleteResponses',['我这边面还没吃完。','嗯，回头聊。']);
  await page.evaluate(()=>{
    window.activityPreviewTexts=[];
    window.activityPreviewObserver=new MutationObserver(()=>document.querySelectorAll('[data-streaming-reply]').forEach(node=>window.activityPreviewTexts.push(node.textContent)));
    window.activityPreviewObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
  });
  await test('submit','好，我先去洗碗，回头聊');
  let activitySaved=[];
  const activityDeadline=Date.now()+15000;
  while(Date.now()<activityDeadline){
    activitySaved=(await test('records')).filter(m=>m.role==='assistant');
    if(activitySaved.length)break;
    await page.waitForTimeout(50);
  }
  check(activitySaved.map(m=>m.content).join('')==='嗯，回头聊。','an unsupported ongoing meal is corrected before the actual private-chat DB write');
  check((await test('completeRequests')).length===2,'current-activity correction uses the existing one-retry budget');
  check(!(await page.evaluate(()=>window.activityPreviewTexts.join(''))).includes('面还没吃完'),'a rejected complete JSON activity claim never flashes in the preview');
  await page.evaluate(()=>window.activityPreviewObserver.disconnect());
  await ready(0);
  await test('useCompleteResponses',['回头聊。---我这边面还没吃完。','去吧。---我正在看书。']);
  await test('submit','我先去洗碗，回头聊');
  let fallbackSaved=[];
  const fallbackDeadline=Date.now()+15000;
  while(Date.now()<fallbackDeadline){
    fallbackSaved=(await test('records')).filter(m=>m.role==='assistant');
    if(fallbackSaved.length)break;
    await page.waitForTimeout(50);
  }
  check(fallbackSaved.map(m=>m.content).join('')==='回头聊。','two rejected drafts retain only the best draft independent goodbye in the actual DB');
  check((await test('completeRequests')).length===2,'sanitizing after exhausted correction makes no third model call');
  const fallbackEvents=await page.evaluate(()=>JSON.parse(localStorage.getItem('virtugene-chat-quality-events:stream-test-user')??'[]'));
  check(fallbackEvents.at(-1)?.issue==='self-report-risk','successful fallback keeps its source-risk diagnostics');
  await ready(0);
  await test('useCompleteResponses',['我这边面还没吃完。','我正在看书。']);
  await test('submit','我先走了，回头聊');
  await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);
  const blockedDeadline=Date.now()+15000;
  let blockedRecords=[];
  while(Date.now()<blockedDeadline){
    blockedRecords=await test('records');
    if(blockedRecords.some(m=>m.failed))break;
    await page.waitForTimeout(50);
  }
  check(blockedRecords.filter(m=>m.role==='assistant').length===0&&blockedRecords.some(m=>m.role==='user'&&m.failed),'two wholly unsupported drafts fail honestly without saving fabricated activity');
  check((await test('completeRequests')).length===2,'wholly rejected response respects the existing single retry budget');
  const blockedEvents=await page.evaluate(()=>JSON.parse(localStorage.getItem('virtugene-chat-quality-events:stream-test-user')??'[]'));
  check(blockedEvents.at(-1)?.blocked===true&&blockedEvents.at(-1)?.issue==='self-report-risk','complete rejection is visible in quality diagnostics');
  await ready(0);
  await test('useCompleteResponses',['你难得这么直白一次。','我也喜欢你，听着有点开心。']);
  await test('submit','我爱你');
  let affectionSaved=[];
  const affectionDeadline=Date.now()+15000;
  while(Date.now()<affectionDeadline){
    affectionSaved=(await test('records')).filter(m=>m.role==='assistant');
    if(affectionSaved.length)break;
    await page.waitForTimeout(50);
  }
  check(affectionSaved.map(m=>m.content).join('')==='我也喜欢你，听着有点开心。','unsupported rarity of affection is corrected before the actual private-chat DB write');
  check((await test('completeRequests')).length===2,'affection history risk shares the existing single correction budget');
  await ready(0);
  await test('useCompleteResponses',['不过你笑我挑仙人掌省事，我可记着了。','我还是更喜欢仙人掌那股安静的劲。']);
  await test('submit','我会选向日葵，跟你选的不一样也挺好');
  let teasingSaved=[];
  const teasingDeadline=Date.now()+15000;
  while(Date.now()<teasingDeadline){
    teasingSaved=(await test('records')).filter(m=>m.role==='assistant');
    if(teasingSaved.length)break;
    await page.waitForTimeout(50);
  }
  check(teasingSaved.map(m=>m.content).join('')==='我还是更喜欢仙人掌那股安静的劲。','a fabricated remembered tease is corrected before the actual private-chat DB write');
  check((await test('completeRequests')).length===2,'user attribution warning shares one correction budget without a separate critic call');
  await ready(0);
  await test('submit','我喜欢这个说法'); await waitRequests(1);
  const proseSlash=String.fromCharCode(92);
  const escapedProse='你那句'+proseSlash+'"不一样也挺好'+proseSlash+'"，我听着了。';
  for(const chunk of ['你那句',proseSlash,'"不一样也挺好',proseSlash,'"，我听着了。']){
    await test('push',0,chunk); await page.waitForTimeout(50);
    check(!(await page.locator('[data-streaming-reply]').innerText()).includes(proseSlash),'SSE quotation fragments never show an escaping slash');
  }
  await test('finish',0); await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='你那句"不一样也挺好"，我听着了。','ordinary escaped quotation saves exactly the visible prose');
  await ready(0);
  await test('useCompleteResponses',[escapedProse]);
  await test('submit','把转义引号原样写出来');
  const literalDeadline=Date.now()+15000;
  let literalSaved=[];
  while(Date.now()<literalDeadline){
    literalSaved=(await test('records')).filter(m=>m.role==='assistant');
    if(literalSaved.length)break;
    await page.waitForTimeout(50);
  }
  check(literalSaved.map(m=>m.content).join('')===escapedProse,'a literal-escape request retains slashes through quality and the actual DB write');
  await ready(0);
  await test('submit','保留反斜杠再说一次'); await waitRequests(1);
  await test('push',0,escapedProse); await page.locator('[data-streaming-reply]').waitFor();
  check((await page.locator('[data-streaming-reply]').innerText()).endsWith(escapedProse),'literal-mode SSE preview keeps the requested source characters');
  await page.getByRole('button',{name:'停止生成',exact:true}).click(); await done();
  const literalStopped=(await test('records')).filter(m=>m.role==='assistant');
  check(literalStopped.length===1&&literalStopped[0].stopped&&literalStopped[0].content===escapedProse,'stopping a literal-mode stream saves the same text without losing configured policy');
  await ready(0);
  await test('submit', '你好', true); await waitRequests(1);
  await test('push', 0, '你好'); await page.locator('[data-streaming-reply]').waitFor();
  check((await test('requests'))[0].body.stream === true, 'real chat requests SSE');
  check((await test('records')).filter(m => m.role === 'user').length === 1, 'rapid double send saves one user message');
  check((await test('records')).filter(m => m.role === 'assistant').length === 0, 'visible draft precedes completion and is not a DB token write');
  check(await page.locator('.vg-typing-row').count() === 0, 'typing placeholder disappears on first visible text');
  await test('push', 0, '--'); await page.waitForTimeout(60);
  check(!(await page.locator('[data-streaming-reply]').innerText()).includes('--'), 'partial separator never flashes');
  await test('push', 0, '-我在这里。'); await test('finish', 0); await done();
  const split = (await test('records')).filter(m => m.role === 'assistant');
  check(split.map(m => m.content).join('|') === '你好|我在这里。' && split[0].replyBatchSize === 2, 'split replies saved once with batch metadata');
  check(await page.locator('[data-streaming-reply]').count() === 0, 'final rows replace preview');
  check(split[0].createdAt > (await test('records'))[0].createdAt && split[1].createdAt > split[0].createdAt, 'saved reply ordering survives reopening');

  await ready(0); await test('submit', '今天碰到件好笑的事'); await waitRequests(1);
  await test('push',0,'哈哈哈哈');await page.locator('[data-streaming-reply]').waitFor();
  await test('push',0,'\n\n');await page.waitForTimeout(70);
  check(await page.locator('.vg-streaming-part').count()===1,'pending blank paragraph creates no empty bubble');
  await test('push',0,'这个我真没想到。');await page.waitForFunction(()=>document.querySelectorAll('.vg-streaming-part').length===2);
  check((await page.locator('.vg-streaming-part').first().innerText()).includes('哈哈哈哈')&&!(await page.locator('.vg-streaming-part').first().innerText()).includes('这个我真没想到'),'paragraph fallback preserves already-visible first reaction');
  await test('finish',0);await done();
  const paragraphRows=(await test('records')).filter(m=>m.role==='assistant');
  check(paragraphRows.map(m=>m.content).join('|')==='哈哈哈哈|这个我真没想到。'&&paragraphRows.every(m=>m.replyBatchSize===2),'actual private send commits two paragraph bubbles once with batch metadata');
  check(paragraphRows.every(m=>!m.content.includes('\n')&&!m.content.includes('---')),'stored paragraph bubbles have no line breaks or literal separator');

  await ready(0);await test('submit','详细写一段说明');await waitRequests(1);
  await test('push',0,'第一段。\n\n第二段。');await page.locator('[data-streaming-reply]').waitFor();
  check(await page.locator('.vg-streaming-part').count()===1,'explicit long request configures one streaming bubble');
  await test('finish',0);await done();
  const proseRows=(await test('records')).filter(m=>m.role==='assistant');
  check(proseRows.length===1&&proseRows[0].content==='第一段。第二段。','long request preview and stored content use the same boundary policy');

  await ready(0); await test('submit', '说说今天'); await waitRequests(1);
  await test('push', 0, '长长的第一条---嗯---啊---长长的第四条');
  await page.waitForFunction(() => document.querySelectorAll('.vg-streaming-part').length === 4);
  check((await test('records')).filter(m => m.role === 'assistant').length === 0, 'four visible bubbles remain transient until transport finishes');
  await test('push', 0, '---最后'); await test('finish', 0); await done();
  const fourRows = (await test('records')).filter(m => m.role === 'assistant');
  check(fourRows.length === 4 && fourRows.map(m => m.content).join('|') === '长长的第一条|嗯|啊|长长的第四条最后' && fourRows.every(m => m.replyBatchSize === 4), 'four streamed bubbles and overflow commit once with matching batch metadata');
  check((await page.evaluate(() => window.virtugeneChatQuality.report())).samples.at(-1).differenceRatio === 0, 'stream metrics compare actual raw text with all four persisted rows');

  await ready(0); await test('denyNext'); await test('submit', '凭据失败后重发'); await waitRequests(1); await done();
  check((await test('records'))[0].failed && (await test('requests')).length === 1, 'credential failure marks a retryable message without auto-retry');
  await page.getByTitle('发送失败，点击重发', { exact: true }).click(); await waitRequests(2);
  await test('push', 1, '这次收到你的消息了。'); await test('finish', 1); await done();
  check((await test('records')).filter(m => m.role === 'user').length === 1 && !(await test('records'))[0].failed, 'manual retry reuses the original user message');

  await ready(40);
  // Virtualized historical fixture can initially open mid-history. Establish
  // the user's explicit latest position before checking live following.
  const latest = page.getByRole('button', { name: '回到最新消息', exact: true });
  if (await latest.isVisible()) await latest.click();
  await page.waitForFunction(() => { const el = document.querySelector('.chat-thread'); return el.scrollHeight - el.scrollTop - el.clientHeight < 8; });
  await test('submit', '详细说说你的想法'); await waitRequests(1);
  await test('push', 0, '我想和你聊聊今天。'); await page.locator('[data-streaming-reply]').waitFor();
  const storeBefore = await test('storeChanges');
  await test('push', 0, '今天路过书店。'.repeat(100)); await page.waitForTimeout(200);
  check(await test('storeChanges') === storeBefore, 'stream updates do not invalidate the historical message store');
  const longGeometry = await page.locator('.chat-thread').evaluate(el => ({ height: el.scrollHeight, top: el.scrollTop, viewport: el.clientHeight, gap: el.scrollHeight - el.scrollTop - el.clientHeight }));
  check(longGeometry.gap < 8, `long reply follows bottom smoothly ${JSON.stringify(longGeometry)}`);
  await page.locator('.chat-thread').evaluate(el => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400 })); el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  const readTop = await page.locator('.chat-thread').evaluate(el => el.scrollTop);
  await test('push', 0, '后来我又去看了展览。'.repeat(60)); await page.waitForTimeout(180);
  check(Math.abs(await page.locator('.chat-thread').evaluate(el => el.scrollTop) - readTop) < 8, 'reading history is not pulled back by stream');
  await page.getByRole('button', { name: '回到最新消息', exact: true }).click();
  await page.waitForFunction(() => { const el = document.querySelector('.chat-thread'); return el.scrollHeight - el.scrollTop - el.clientHeight < 8; }, undefined, { timeout: 1500 });
  check(await page.locator('.chat-thread').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 8), 'return to latest resumes following');
  for (const width of [320, 390, 430]) { await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(70); check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `stream layout fits ${width}px`); }
  await page.setViewportSize({ width: 390, height: 844 });
  mkdirSync('.tmp-preview', { recursive: true }); await page.screenshot({ path: '.tmp-preview/chat-stream.png' });
  await page.getByRole('button', { name: '停止生成', exact: true }).click(); await done();
  const stopped = (await test('records')).filter(m => m.role === 'assistant' && !m.id.startsWith('history-'));
  check(stopped.length === 1 && stopped[0].stopped && stopped[0].interrupted && stopped[0].content.includes('展览'), 'stop retains complete received prefix with truthful status');
  check((await test('requests')).length === 1 && (await test('requests'))[0].aborted, 'stop aborts transport without retry');

  await ready(0); await test('submit', '在吗'); await waitRequests(1);
  await page.getByRole('button', { name: '停止生成', exact: true }).click(); await done();
  check((await test('records')).length === 1 && !(await test('records'))[0].failed, 'stop before text leaves user message without fake failure');

  await ready(0); await test('submit', '说点什么'); await waitRequests(1); await test('push', 0, '窗外正在下雨。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('fail', 0); await done();
  const partial = (await test('records')).filter(m => m.role === 'assistant');
  check(partial.length === 1 && partial[0].interrupted && !partial[0].stopped && partial[0].content === '窗外正在下雨。', 'network interruption saves partial response');
  check((await test('requests')).length === 1, 'visible response is never secretly regenerated');

  await ready(0); await test('submit', '给星遥的话'); await waitRequests(1); await test('push', 0, '星遥回复。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('switchTo', 'b'); await page.waitForTimeout(130);
  check(await page.locator('[data-streaming-reply]').count() === 0, 'old preview stays out of another conversation');
  await test('submit', '给林霜的话'); await waitRequests(2); await test('push', 1, '林霜回复。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('finish', 0); await page.waitForTimeout(150);
  check(await page.getByRole('button', { name: '停止生成', exact: true }).count() === 1, 'old request completion does not unlock current request');
  check((await test('records', 'b')).filter(m => m.role === 'assistant').length === 0, 'old reply is not written to current conversation');
  await test('switchTo', 'a'); await page.waitForTimeout(100);
  check((await test('records', 'a')).some(m => m.content === '星遥回复。'), 'background reply persists to its own session');
  await test('switchTo', 'b'); await page.waitForTimeout(100);
  check((await page.locator('[data-streaming-reply]').innerText()).includes('林霜回复。'), 'returning restores the live preview');
  await test('finish', 1); await done();
  check((await test('records', 'b')).some(m => m.content === '林霜回复。'), 'second conversation completes independently');

  await ready(0); await test('submit', '我要离开页面了'); await waitRequests(1); await test('push', 0, '这段话已经收到。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('unmount'); await page.waitForTimeout(250);
  check((await test('records')).some(m => m.role === 'assistant' && m.interrupted && m.content === '这段话已经收到。'), 'leaving page aborts and preserves received response');
  await ready(0); await test('submit', '我要切换账号了'); await waitRequests(1); await test('push', 0, '旧账号正文。'); await page.locator('[data-streaming-reply]').waitFor();
  await test('logout'); await page.waitForTimeout(200);
  check(!(await test('records')).some(m => m.role === 'assistant'), 'account switch rejects late reply writes');
  check(await page.locator('[data-streaming-reply]').count() === 0, 'account switch clears the old live preview');
  for (const sourcePresetId of ['preset-guyuena', 'preset-luxueqi']) {
  const visualDraft='我看看像不像……行吧，算你有想象。';
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('submit','刚看到的云有点像一只猫。');await waitRequests(1);
  await test('push',0,visualDraft);await page.waitForTimeout(100);
  check(await page.locator('[data-streaming-reply]').count()===0,`${sourcePresetId}: a false visual verdict never flashes before inspection`);
  await test('finish',0);await waitRequests(2);await test('push',1,'猫形状的云，我也想看看。');await test('finish',1);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='猫形状的云，我也想看看。'&&(await test('requests')).length===2,`${sourcePresetId}: no-image inspection uses one repair and saves current curiosity`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',[visualDraft+'这个比喻我喜欢。','我已经看到你发来的照片了。']);await test('submit','说起刚才的云');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='这个比喻我喜欢。'&&(await test('completeRequests')).length===2,`${sourcePresetId}: two false visual drafts keep only independent reaction without a third call`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',[visualDraft,'我已经看到你发来的照片了。']);await test('submit','说起刚才的云');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check(!(await test('records')).some(m=>m.role==='assistant')&&(await test('records'))[0].failed,`${sourcePresetId}: wholly false sight fails without pretending to receive a photo`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',[visualDraft,'这个比喻我喜欢。---其实我刚才也看了一眼窗外的云。']);await test('submit','刚看到的云有点像一只猫。');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='这个比喻我喜欢。'&&(await test('completeRequests')).length===2,`${sourcePresetId}: usable repair wins over lower-scored wholly false draft without invented window activity or third call`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('seedUserImage','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');await test('useCompleteResponses',['我已经看到你发来的照片了。']);await test('submit','刚才的照片呢？');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===1);await done();
  const imageRequest=(await test('completeRequests'))[0];
  check(imageRequest.messages.some(message=>message.role==='user'&&Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'))&&(await test('records')).some(m=>m.role==='assistant'&&m.content==='我已经看到你发来的照片了。'),`${sourcePresetId}: actually forwarded history image permits inspection with one call`);
  const childhoodDraft='我记得小时候天天听这首歌。';
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('submit','今天听见了小时候的歌。');await waitRequests(1);
  await test('push',0,childhoodDraft);await page.waitForTimeout(100);
  check(await page.locator('[data-streaming-reply]').count()===0,`${sourcePresetId}: an unsupported childhood memory never flashes before review`);
  await test('finish',0);await waitRequests(2);await test('push',1,'旧歌重听，还挺有意思。');await test('finish',1);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='旧歌重听，还挺有意思。',`${sourcePresetId}: actual DB saves the correction rather than borrowed childhood`);
  check((await test('requests')).length===2,`${sourcePresetId}: childhood correction shares the existing single retry`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',[childhoodDraft+'这首我也想听。','我小时候养过一只猫。']);await test('submit','说起小时候的歌');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='这首我也想听。'&&(await test('completeRequests')).length===2,`${sourcePresetId}: two unsupported childhood drafts preserve only current interest without a third call`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',[childhoodDraft,'我小时候养过一只猫。']);await test('submit','随便聊聊');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check(!(await test('records')).some(m=>m.role==='assistant')&&(await test('records'))[0].failed,`${sourcePresetId}: wholly unsupported childhood fails without a canned replacement`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId,'往事：小时候天天听这首歌。');await test('useCompleteResponses',[childhoodDraft]);await test('submit','你小时候听过吗？');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===1);await done();
  check((await test('completeRequests')).length===1&&(await test('records')).some(m=>m.role==='assistant'&&m.content===childhoodDraft),`${sourcePresetId}: a supported childhood memory survives unchanged with one call`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('submit','刚把一本书拿倒了，自己都笑了。');await waitRequests(1);
  await test('push',0,'我看书看倒过一页。');await page.waitForTimeout(100);
  check(await page.locator('[data-streaming-reply]').count()===0,`${sourcePresetId}: an episodic self-report is held before display`);
  await test('finish',0);await waitRequests(2);await test('push',1,'哈哈，这一下还挺有趣。');await test('finish',1);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='哈哈，这一下还挺有趣。',`${sourcePresetId}: an actual send retries an unsupported episode into a natural reaction`);
  check((await test('requests')).length===2,`${sourcePresetId}: episode repair does not add another model budget`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',['我看书看倒过一页。哈哈，这一下还挺有趣。','我喝茶把杯子打翻过。']);await test('submit','刚把一本书拿倒了，自己都笑了。');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='哈哈，这一下还挺有趣。',`${sourcePresetId}: two unsafe episodes cannot restore the first anecdote through bestDraft`);
  check((await test('completeRequests')).length===2,`${sourcePresetId}: removing an unsafe episode spends no third generation`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',['我看书看倒过一页。','我喝茶把杯子打翻过。']);await test('submit','聊两句');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check(!(await test('records')).some(m=>m.role==='assistant')&&(await test('records'))[0].failed,`${sourcePresetId}: wholly unsupported episodes fail without a canned or invented reply`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId,'经历：我看书看倒过一页。');await test('useCompleteResponses',['我看书看倒过一页。']);await test('submit','你看书有过趣事吗？');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===1);await done();
  check((await test('completeRequests')).length===1&&(await test('records')).some(m=>m.role==='assistant'&&m.content==='我看书看倒过一页。'),`${sourcePresetId}: independent authored episode survives without retry or removal`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',['我看书看倒过一页。']);await test('submit','陪我演一段看倒书的剧情。');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===1);await done();
  check((await test('completeRequests')).length===1&&(await test('records')).some(m=>m.role==='assistant'&&m.content==='我看书看倒过一页。'),`${sourcePresetId}: explicitly invited fictional episode remains available`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('submit','我很开心');await waitRequests(1);
  const ownedRequest = (await test('requests'))[0].body.messages.find(m=>m.role==='system').content;
  check(ownedRequest.includes('[人物关系与表达节奏]')&&!ownedRequest.includes('本应用互动累计等阶：'),`${sourcePresetId}: actual send keeps authored relations instead of a new app acquaintance tier`);
  await test('push',0,'你开心的时候，声音里都带着笑意，我听得出来。');await page.waitForTimeout(100);
  check(await page.locator('[data-streaming-reply]').count()===0,`${sourcePresetId}: ordinary draft is held before publication even with real SSE`);
  await test('finish',0);await waitRequests(2);
  await test('push',1,'你开心，我也开心。');await test('finish',1);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='你开心，我也开心。','reviewed SSE correction stores only the independent emotional response');
  check((await test('requests')).length===2,'reviewed delivery still uses at most one quality correction');
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('submit','聊两句');await waitRequests(1);await test('push',0,'我听到你的笑声了。');
  await page.getByRole('button',{name:'停止生成',exact:true}).click();await done();
  check(!(await test('records')).some(m=>m.role==='assistant')&&!(await test('records'))[0].failed,'cancelling an unpublished reviewed draft creates no hidden partial or false send failure');
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',['我听到你的笑声了。我也开心。','你的嗓音听起来有点哑。']);await test('submit','我很开心');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check((await test('records')).filter(m=>m.role==='assistant').map(m=>m.content).join('')==='我也开心。','two bad drafts retain only an independent safe sentence rather than restoring fake hearing');
  check((await test('completeRequests')).length===2,'audio fallback adds no third request');
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('useCompleteResponses',['我听到你的笑声了。','你的嗓音听起来有点哑。']);await test('submit','我很开心');await page.waitForFunction(()=>window.chatStreamTest.completeRequests().length===2);await done();
  check(!(await test('records')).some(m=>m.role==='assistant')&&(await test('records'))[0].failed,'two entirely unsupported audio drafts fail without writing an invented reply');
  check((await test('completeRequests')).length===2,'entirely rejected audio stays within the same budget');
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('submit','陪我演一段我们打电话的剧情');await waitRequests(1);
  await test('push',0,'我听到你的笑声了。');await page.locator('[data-streaming-reply]').waitFor();
  check((await page.locator('[data-streaming-reply]').innerText()).includes('我听到你的笑声了。'),`${sourcePresetId}: explicitly fictional calling still streams`);
  await test('finish',0);await done();
  check((await test('requests')).length===1&&(await test('records')).some(m=>m.role==='assistant'&&m.content==='我听到你的笑声了。'),`${sourcePresetId}: chosen fictional scene is not retried or stripped`);
  await ready(0);await test('useReviewedCharacter',sourcePresetId);await test('submit','详细写一段说明');await waitRequests(1);
  await test('push',0,'第一段。');await page.locator('[data-streaming-reply]').waitFor();
  check((await page.locator('[data-streaming-reply]').innerText()).includes('第一段。'),`${sourcePresetId}: explicit long answer still streams`);
  await test('finish',0);await done();
  check((await test('requests')).length===1&&(await test('records')).some(m=>m.role==='assistant'&&m.content==='第一段。'),`${sourcePresetId}: long answer persists once`);
  }
  check(await test('extraNetwork') === 0 && errors.length === 0, 'no real network or uncaught page errors');
  mkdirSync('.tmp-preview/chat-delivery-pacing',{recursive:true});
  writeFileSync('.tmp-preview/chat-delivery-pacing/verification.json',JSON.stringify({date:new Date().toISOString(),status:'PASS',checks,pacingCases,paidModelCalls:0,generatedModelTokens:0,scope:'Mock transports through real ChatWindow, delivery queue and IndexedDB; excludes real-device subjective waiting assessment'},null,2)+'\n');
  console.log(`PASS chat-stream: ${checks} checks`);
} catch(error) {
  if(debugPage)console.log('stream failure state',await debugPage.evaluate(async()=>({requests:window.chatStreamTest.requests().map(r=>({aborted:r.aborted,lastInput:r.body.messages?.at(-1)?.content,raw:r.raw})),a:(await window.chatStreamTest.records('a')).map(m=>({role:m.role,content:m.content,failed:m.failed})),b:(await window.chatStreamTest.records('b')).map(m=>({role:m.role,content:m.content,failed:m.failed})),input:document.querySelector('[aria-label="消息内容"]')?.value,preview:document.querySelector('[data-streaming-reply]')?.textContent})).catch(()=>null));
  throw error;
} finally { await browser.close(); server.close(); }
