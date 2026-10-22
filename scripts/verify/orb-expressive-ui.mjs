import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname,join,basename } from 'node:path';
import { mkdirSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const out=process.env.VG_ORB_EXPRESSIVE_OUT??'.tmp-preview/starfield-upgrade-20261017/P6a';mkdirSync(out,{recursive:true});
const entry=`import React,{useState,Profiler} from 'react';import{createRoot}from'react-dom/client';import{SoulOrbButton}from'./src/components/ui/SoulOrb';import{useSettingsStore}from'./src/store/settings-store';
useSettingsStore.setState({reduceMotion:false});window.commits=0;
function Demo(){const[mood,setMood]=useState('curious');window.setMood=setMood;return <Profiler id="orb" onRender={()=>window.commits++}><main><header><span>小星 · 动作实录</span><SoulOrbButton size={44} emotion="idle" motionContext="reading" motionOverride="gentle" label="阅读小球" onActivate={()=>{}}/></header><h1>更好奇，也更亲近</h1><p>真实组件隔离预览 · 不连接账号、模型或麦克风</p><div className="pet"><SoulOrbButton size={160} emotion={mood} motionContext="interaction" motionOverride="gentle" label="轻触小星" onActivate={()=>{}}/></div><div className="choices">{[['curious','探头'],['happy','开心'],['shy','害羞']].map(([id,label])=><button onClick={()=>setMood(id)} key={id}>{label}</button>)}</div><p>阅读时轻柔陪伴，互动时再活泼起来。</p></main></Profiler>};createRoot(document.getElementById('root')).render(<Demo/>);`;
const bundles={};
for(const phase of ['before','after']){
  const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.png':'dataurl'},define:{'import.meta.env':'{"DEV":true}', 'import.meta.hot':'undefined',__APP_VERSION__:'"6.1.6"'},plugins:phase==='before'?[{name:'immutable-motion-before',setup(b){b.onLoad({filter:/[\\/]src[\\/]lib[\\/]orb-(vitality|personality|render)\.ts$/},args=>({contents:readFileSync(join(out,'source-before',basename(args.path)),'utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]:[]});bundles[phase]=result.outputFiles[0].text;
}
const css=readdirSync('dist/renderer/assets').filter(n=>n.endsWith('.css')).map(n=>readFileSync(join('dist/renderer/assets',n),'utf8')).join('\n');
const server=createServer((req,res)=>{const phase=req.url.includes('before')?'before':'after';res.setHeader('Content-Type',req.url.startsWith('/bundle')?'application/javascript':'text/html;charset=utf-8');res.end(req.url.startsWith('/bundle')?bundles[phase]:`<!doctype html><html class="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}html,body,#root{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:system-ui}main{padding:24px 20px;text-align:center}header{display:flex;align-items:center;justify-content:space-between;font-size:16px}h1{font-size:24px;margin-top:44px}p{font-size:13px;color:var(--text-secondary);line-height:1.7}.pet{height:280px;display:grid;place-items:center}.choices{display:flex;justify-content:center;gap:12px}.choices button{min-height:44px;padding:0 20px;background:var(--bg-panel);border:1px solid var(--border);color:var(--text);border-radius:14px}</style><div id="root"></div><script>Math.random=()=>.5;window.fetch=()=>{throw Error('No external requests allowed')};</script><script src="/bundle-${phase}.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],errors=[],videos=[];
const check=(pass,name)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
try{
  for(const phase of ['before','after'])for(const theme of phase==='before'?['dark']:['dark','light']){
    const context=await browser.newContext({viewport:{width:390,height:844},recordVideo:{dir:out,size:{width:390,height:844}},reducedMotion:'no-preference'}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
    await page.goto(`${origin}/${phase}`);await page.waitForFunction(()=>window.setMood&&document.querySelector('[data-orb-motion="active"]'));
    if(theme==='light')await page.evaluate(()=>document.documentElement.classList.remove('dark'));
    await page.mouse.move(0,0);await page.waitForTimeout(1800);
    const commits=await page.evaluate(()=>window.commits);await page.waitForTimeout(500);check(commits===await page.evaluate(()=>window.commits),`${phase}-${theme} no React frame commits`);
    for(const mood of ['curious','happy','shy']){await page.evaluate(m=>window.setMood(m),mood);await page.waitForTimeout(mood==='happy'?2300:1800);await page.screenshot({path:join(out,`${phase}-${theme}-${mood}.png`)});}
    await page.getByRole('button',{name:'轻触小星',exact:true}).click();await page.waitForTimeout(500);
    for(const width of [320,390,430]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${phase}-${theme}-${width} no horizontal overflow`);}
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(200);check(await page.locator('[data-orb-motion="active"]').count()===0,`${phase}-${theme} reduced motion pauses both orbs`);
    const snapshot=await page.locator('.pet svg > g').getAttribute('transform');await page.waitForTimeout(180);check(snapshot===await page.locator('.pet svg > g').getAttribute('transform'),`${phase}-${theme} paused geometry is stable`);
    const video=page.video();await context.close();const file=join(out,`${phase}-${theme}.webm`);await video.saveAs(file);videos.push(file);
  }
  check(errors.length===0,'no browser runtime errors');
}finally{await browser.close();await new Promise(r=>server.close(r));writeFileSync(join(out,'ui-result.json'),JSON.stringify({checks,errors,videos,scope:'Actual SoulOrbButton, isolated origin, immutable before motion modules, same current material in both; no account/model/microphone/native audio',pass:checks.every(c=>c.pass)&&errors.length===0},null,2));}
console.log(`PASS ${checks.length} expressive UI checks; ${videos.length} recordings`);
