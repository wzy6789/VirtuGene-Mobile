import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const focus=process.argv.includes('--focus');
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright'),root=focus?'release/chat-continuity-focus-20261019':'release/chat-continuity-resume-20261019';
const files=['src/db/index.ts','src/db/continuity-repo.ts','src/lib/continuity-sources.ts','src/lib/chat/send-service.ts','src/lib/chat-topic-outcomes.ts','src/lib/chat-topic-controls.ts',...(focus?['src/db/chat-topic-state-repo.ts','src/lib/chat-conversation-state.ts']:[])];
const hashes=()=>Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),before=hashes();
const bundle=await build({entryPoints:[focus?'scripts/verify/chat-continuity-focus.ts':'scripts/verify/chat-continuity-resume.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}','import.meta.hot':'undefined',__APP_VERSION__:'"continuity-resume"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});let report;
try{const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({permissions:[]});await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>!!window.runContinuityResume);
 if(focus){await page.waitForFunction(()=>!!window.runContinuityFocus);report=await page.evaluate(()=>window.runContinuityFocus());await page.evaluate(()=>window.prepareFocusReload());await page.reload();await page.waitForFunction(()=>!!window.focusAfterReload);report.reload=await page.evaluate(()=>window.focusAfterReload());const prompt=report.reload.calls.find(call=>call.body.messages.at(-1)?.content===report.reload.result.source.content)?.body.messages[0].content??'';report.checks.push({name:'new JavaScript page keeps exact focus for a vague follow-up',ok:!report.reload.result.error&&!report.reload.result.failed&&prompt.includes('[本轮接续事项]')&&prompt.includes('地铁')});}
 else{report=await page.evaluate(()=>window.runContinuityResume());
 const check=(name,ok)=>report.checks.push({name,ok:!!ok});
 await page.evaluate(()=>window.prepareResumeReload());await page.reload();await page.waitForFunction(()=>!!window.resumeAfterReload);report.reload=await page.evaluate(()=>window.resumeAfterReload());
 check('fresh JavaScript page resumes original record from another session',!report.reload.result.error&&!report.reload.result.failed&&report.reload.result.replies.length>0&&report.reload.thread?.id==='resume-original-thread'&&report.reload.thread.status==='open'&&report.reload.originalExists);
 report.migration=await page.evaluate(()=>window.runResumeMigration());
 check('43to47 upgrade preserves all fixture raw rows and the continuity index',report.migration.allRowsPreserved&&report.migration.version===47&&report.migration.indexedIds[0]==='resume-original-thread');
 check('failed index upgrade rolls back without losing the original row',report.migration.failedUpgradeRejected&&report.migration.failedUpgradePreservedRow);}
 report.failures=report.checks.filter(check=>!check.ok);report.complete=!report.failures.length;if(!report.complete)process.exitCode=1;}
catch(error){report={complete:false,error:error.stack??String(error)};process.exitCode=1;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));const after=hashes(),path=root+'/checks-'+Date.now()+'.json';writeFileSync(path,JSON.stringify({...report,sourceHashesBefore:before,sourceHashesAfter:after,stableSources:JSON.stringify(before)===JSON.stringify(after)},null,2)+'\n');console.log(JSON.stringify({path,complete:report.complete,checks:report.checks?.length,failures:report.failures?.map(check=>check.name),error:report.error,apiCalls:0}));}
