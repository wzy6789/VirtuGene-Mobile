import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';

// Actual ChatWindow/editor and production WebGL backend on the isolated scene fixture.
// Failure controls affect only local asset transport or local WebGL capability.
const origin=process.env.VG_SCENE_ORIGIN??'http://127.0.0.1:5322';
const out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-realtime-20261019/boundaries';
const selected=process.env.VG_REALTIME_BOUNDARY_CASES?.split(',');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={status:'running',checks:[],cases:[],screenshots:[],errors:[],external:[],limitations:['Actual product components with isolated synthetic IndexedDB and controlled transport; no real model or microphone requests.','Desktop Chrome mobile viewport; Android IME, battery, thermals and native WebView are not measured.']};
const check=(pass,name,detail)=>{report.checks.push({pass:!!pass,name,detail});console.log((pass?'PASS ':'FAIL ')+name);if(!pass)throw Error(name);};
const api=(page,owner,name,...args)=>page.evaluate(({owner,name,args})=>window[owner][name](...args),{owner,name,args});
async function ready(page,backend='webgl2',count=1){await page.waitForFunction(({backend,count})=>{const rows=window.sceneTest.inspect();return rows.length===count&&rows.every(row=>row.state==='ready')&&(!backend||rows[count-1].backend===backend);},{backend,count},{timeout:20000});await page.waitForTimeout(200);}
async function snap(page,name){const file=out+'/'+name+'.png';await page.screenshot({path:file});report.screenshots.push(file);}
async function fixture(options={}){
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 if(options.noWebgl)await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:original.call(this,kind,...args);};});
 if(options.name==='shader-error')await context.addInitScript(()=>{const original=WebGL2RenderingContext.prototype.shaderSource;let once=true;WebGL2RenderingContext.prototype.shaderSource=function(shader,source){if(once){once=false;source='controlled invalid GLSL';}return original.call(this,shader,source);};});
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push({case:options.name,message:error.message}));page.on('request',request=>{const url=request.url();if(!url.startsWith('data:')&&!url.startsWith('blob:')&&new URL(url).origin!==origin)report.external.push(url);});
 await page.goto(origin);await page.waitForFunction(()=>window.sceneTest);await api(page,'backgroundTest','setup',0);await api(page,'sceneTest','stock',7);
 return{context,page};
}
async function run(name,callback){if(selected&&!selected.includes(name))return;let f;try{f=await fixture({name,noWebgl:name==='no-webgl2'});await callback(f.page);report.cases.push({name,status:'pass'});}catch(error){report.cases.push({name,status:'failed',failure:String(error)});console.error(name,error);if(f)await snap(f.page,name+'-failure').catch(()=>{});}finally{await f?.context.close();}}
const openEditor=async page=>{await page.getByRole('button',{name:'聊天设置',exact:true}).click();await page.getByRole('dialog',{name:'聊天设置',exact:true}).getByRole('button',{name:/聊天外观/}).click();const editor=page.getByRole('dialog',{name:'聊天外观',exact:true});await editor.waitFor();return editor;};
const closeSettings=async page=>{await page.getByRole('dialog',{name:'聊天设置',exact:true}).getByRole('button',{name:'返回',exact:true}).click();await page.waitForTimeout(200);};
const noGpuOwners=resources=>resources.realtimeContexts===0&&resources.realtimeRafs===0&&resources.realtimeHosts===0&&resources.modelReferences===0&&resources.modelEntries===0;

await run('settings-and-two-hosts',async page=>{
 await api(page,'sceneTest','scene','cafe-afternoon','auto',{renderer:'auto',parallaxEnabled:false});await ready(page);
 const saved=await api(page,'backgroundTest','rows');
 await page.evaluate(()=>{window.boundaryBudgetSamples=[];window.boundaryBudgetTimer=setInterval(()=>{const r=window.sceneTest.resources();window.boundaryBudgetSamples.push({bytes:r.reservedBytes+r.realtimeReservedBytes,contexts:r.realtimeContexts,models:r.modelReferences});},35);});
 let editor=await openEditor(page);await ready(page,'webgl2',2);
 let before=await api(page,'sceneTest','inspect');await page.waitForTimeout(350);let after=await api(page,'sceneTest','inspect');
 check(['covered','hidden','covered-preview'].includes(after[0].reason)&&after[0].backend==='poster'&&before[0].particles?.frames===after[0].particles?.frames,'covered chat preserves poster while yielding GPU ownership to editor',after);
 check(after[1].backend==='webgl2'&&after[1].particles?.frames>before[1].particles?.frames,'visible editor actually previews real-time room and particles',after);
 await editor.getByRole('button',{name:'雨夜咖啡厅',exact:true}).click();await editor.locator('.vg-background-preview').scrollIntoViewIfNeeded();await ready(page,'webgl2',2);
 const draft=await api(page,'backgroundTest','rows');check(draft.roleRow.revision===saved.roleRow.revision&&draft.roleRow.config.scene.id==='cafe-afternoon','different scene preview remains an unsaved draft');
 const different=await api(page,'sceneTest','inspect');check(await editor.locator('.vg-chat-scene').getAttribute('data-scene-id')==='cafe-rain-night'&&different[1].state==='ready','different room preview is the selected complete scene',different);
 await page.route('**/*.glb',async route=>{await new Promise(r=>setTimeout(r,120));await route.continue().catch(()=>{});});
 for(const label of ['雪夜书房','晨光客厅','雨夜咖啡厅']){await editor.getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(20);}
 await ready(page,'webgl2',2);await page.waitForTimeout(250);
 const latest=await api(page,'sceneTest','resources');check(await editor.locator('.vg-chat-scene').getAttribute('data-scene-id')==='cafe-rain-night'&&latest.realtimeContexts===1&&latest.modelReferences===1,'rapid different-room selection cancels late models and retains only latest preview',latest);await page.unroute('**/*.glb');
 await snap(page,'two-hosts-different-room');
 await editor.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'放弃修改',exact:true}).click();await closeSettings(page);await ready(page);
 const cancelled=await api(page,'backgroundTest','rows');check(cancelled.roleRow.revision===saved.roleRow.revision&&cancelled.roleRow.config.scene.id==='cafe-afternoon','cancel preserves saved room and revision');
 let resources=await api(page,'sceneTest','resources');check(resources.realtimeContexts===1&&resources.modelReferences===1,'cancel releases preview model and context exactly once',resources);
 editor=await openEditor(page);await ready(page,'webgl2',2);await editor.getByRole('button',{name:'雨夜咖啡厅',exact:true}).click();await editor.getByRole('radio',{name:/^兼容模式/}).check();await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'hidden'});await closeSettings(page);await ready(page,'layered');
 const compatibility=await api(page,'backgroundTest','rows');check(compatibility.roleRow.config.scene.id==='cafe-rain-night'&&compatibility.roleRow.config.scene.renderer==='layered','actual Save commits scene and compatibility choice');resources=await api(page,'sceneTest','resources');check(noGpuOwners(resources),'compatibility selection releases all real-time ownership',resources);
 await api(page,'backgroundTest','reload');await ready(page,'layered');check((await api(page,'backgroundTest','rows')).roleRow.config.scene.renderer==='layered','compatibility choice survives repository reload');
 editor=await openEditor(page);await ready(page,'layered',2);await editor.getByRole('radio',{name:/^实时立体/}).check();await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'hidden'});await closeSettings(page);await ready(page);
 check((await api(page,'backgroundTest','rows')).roleRow.config.scene.renderer==='auto','actual Save restores real-time rendering');
 const samples=await page.evaluate(()=>{clearInterval(window.boundaryBudgetTimer);return window.boundaryBudgetSamples;});check(samples.length>0&&samples.every(sample=>sample.bytes<=48*1024*1024),'tracked decoded plus estimated real-time peak stays within auto 48 MiB through preview switching',{peak:Math.max(...samples.map(s=>s.bytes)),samples});
 await api(page,'chatStreamTest','unmount');await page.waitForTimeout(250);resources=await api(page,'sceneTest','resources');check(noGpuOwners(resources)&&resources.references===0,'settings workflow teardown leaves no scene or model owner',resources);
});

for(const kind of ['fetch-error','parse-error','no-webgl2','shader-error'])await run(kind,async page=>{
 let intercepted=0;if(kind==='fetch-error'||kind==='parse-error')await page.route('**/*.glb',route=>{intercepted++;return kind==='fetch-error'?route.fulfill({status:503,contentType:'application/octet-stream',body:'unavailable'}):route.fulfill({status:200,contentType:'model/gltf-binary',body:'invalid GLB bytes'});});
 await api(page,'sceneTest','scene','home-bedroom','auto',{renderer:'auto'});await ready(page,'layered');
 const record=(await api(page,'sceneTest','inspect'))[0],resources=await api(page,'sceneTest','resources');
 check(kind==='no-webgl2'||kind==='shader-error'||intercepted===1,kind+' controlled initialization path exercised',{intercepted});check(!!record.rendererFailure&&noGpuOwners(resources)&&(kind!=='shader-error'||record.rendererFailure==='scene:shader-compile'),kind+' disposes failed WebGL path and retains a complete fallback',{record,resources});
 check(await page.getByRole('textbox',{name:'消息内容'}).isEnabled()&&await page.locator('.vg-message-bubble').count()>0,kind+' preserves readable messages and enabled composer');
 await page.waitForTimeout(450);check((await api(page,'sceneTest','inspect'))[0].backend==='layered'&&(kind==='no-webgl2'||kind==='shader-error'||intercepted===1),kind+' does not loop retries');await snap(page,kind+'-fallback');
 await api(page,'chatStreamTest','unmount');await page.waitForTimeout(200);check(noGpuOwners(await api(page,'sceneTest','resources'))&&(await api(page,'sceneTest','resources')).references===0,kind+' teardown releases fallback assets too');
});

await run('late-fetch-teardown',async page=>{
 let intercepted=0,release;const gate=new Promise(resolve=>release=resolve);let settled=false;
 await page.route('**/*.glb',async route=>{intercepted++;await gate;await route.continue().catch(()=>{});settled=true;});
 await api(page,'sceneTest','scene','home-living','auto',{renderer:'auto'});await page.waitForFunction(()=>window.sceneTest.resources().modelReferences===1);check(intercepted===1,'late-load test catches a live model request');
 await api(page,'chatStreamTest','unmount');await page.waitForTimeout(150);check(noGpuOwners(await api(page,'sceneTest','resources')),'unmount cancels pending fetch and immediately releases reservation/context');release();await page.waitForTimeout(500);
 check(settled&&noGpuOwners(await api(page,'sceneTest','resources'))&&await page.locator('.vg-scene-webgl').count()===0,'late model response cannot resurrect detached canvas or frame loop');
 await page.unroute('**/*.glb');await api(page,'chatStreamTest','remount');await ready(page);check((await api(page,'sceneTest','resources')).realtimeContexts===1,'new host can initialize after cancelled model fetch');
});

await run('responsive-reading',async page=>{
 for(const width of [320,430])for(const theme of ['dark','light']){
  await page.setViewportSize({width,height:width===320?640:932});await api(page,'backgroundTest','theme',theme);await api(page,'sceneTest','font',32);await api(page,'sceneTest','scene',width===320?'home-bedroom':'home-living','auto',{renderer:'auto',parallaxEnabled:false});await ready(page);await page.waitForTimeout(300);
  const geometry=await page.locator('.chat-room').evaluate(node=>{const box=node.getBoundingClientRect(),canvas=node.querySelector('.vg-scene-webgl').getBoundingClientRect(),input=node.querySelector('textarea').getBoundingClientRect();return{width:node.clientWidth,scrollWidth:node.scrollWidth,room:{x:box.x,width:box.width,bottom:box.bottom},canvas:{x:canvas.x,width:canvas.width},input:{x:input.x,right:input.right,bottom:input.bottom}};});
  check(geometry.scrollWidth<=geometry.width+1&&Math.abs(geometry.canvas.width-width)<1&&geometry.input.x>=0&&geometry.input.right<=width+1,width+'px '+theme+' 200% message font preserves scene crop and composer within viewport',geometry);
  check(await page.getByRole('textbox',{name:'消息内容'}).isEnabled(),width+'px '+theme+' remains editable');await snap(page,'reading-'+theme+'-'+width+'-font200');
 }
 await api(page,'backgroundTest','reduced',true);await ready(page,'poster');check(noGpuOwners(await api(page,'sceneTest','resources')),'large-font reduced motion releases WebGL and preserves full static scene');
});

report.checks.push({pass:report.errors.length===0,name:'no unexpected page errors',detail:report.errors},{pass:report.external.length===0,name:'no external model/media requests',detail:report.external});
report.status=report.cases.every(row=>row.status==='pass')&&report.checks.every(row=>row.pass)?'pass':'failed';
await browser.close();writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,cases:report.cases,out}));if(report.status!=='pass')process.exitCode=1;
