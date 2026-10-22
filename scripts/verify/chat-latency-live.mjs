import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
const output=process.argv[3]??'docs/CHAT-LATENCY-LIVE-2026-10-13.json';
if(existsSync(output))throw Error('Evidence path already used');
const keyFile=process.argv[2];if(!keyFile)throw Error('Credential file required');
let credential=readFileSync(keyFile,'utf8');const lines=credential.split(/\r?\n/u),start=lines.findIndex(line=>/deepseek/iu.test(line));
const end=lines.findIndex((line,index)=>index>start&&/silicon|硅基|openai|anthropic|qwen/iu.test(line));
const keys=lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[];
let secret=keys[1];credential='';lines.fill('');keys.fill('');if(!secret)throw Error('Configured credential unavailable');
const token=randomUUID(),calls=[],active=new Set();let tokens=0,unknown=false;
const report={date:new Date().toISOString(),scope:'4 fresh isolated production private turns in ABBA order, genuine provider SSE, no artificial DB delay; summaries/settlement/extraction mocked; before reverses only latency changes in memory, in-memory bundle; same persona/input/model, stochastic replies',budget:{maxCalls:6,maxTokensPerCall:900,maxTotalTokens:40000},rows:[],calls,complete:false,errors:[]};
const proxy=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.method!=='POST'||req.headers.authorization!=='Bearer '+token){res.writeHead(403);res.end();return;}
  let settle;const work=new Promise(resolve=>settle=resolve);active.add(work);let call;
  try{
    let data='';for await(const chunk of req){data+=chunk;if(data.length>128000)throw Error('Oversized payload');}
    const body=JSON.parse(data);
    if(body.model!=='deepseek-flash'||!body.stream||calls.length>=6||unknown||tokens+Buffer.byteLength(JSON.stringify(body.messages))+900>40000){(report.rejectedRequests??=[]).push({model:body.model,stream:body.stream,lastMessage:body.messages?.at(-1)?.content});throw Error('Live budget/model guard');}
    body.max_tokens=Math.min(900,body.max_tokens??900);
    call={attempt:calls.length+1,startedAt:Date.now(),model:body.model,payload:body,bodyHash:createHash('sha256').update(JSON.stringify(body.messages)).digest('hex'),pending:true};calls.push(call);
    const upstream=process.env.LATENCY_MOCK==='1'?new Response('data: '+JSON.stringify({choices:[{delta:{content:'终于写完了，出去走走吧。'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}):await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    call.status=upstream.status;res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')??'text/event-stream'});
    const reader=upstream.body.getReader(),decoder=new TextDecoder();let raw='';
    for(;;){const {done,value}=await reader.read();if(done)break;call.firstChunkMs??=Date.now()-call.startedAt;raw+=decoder.decode(value,{stream:true});res.write(value);}
    raw+=decoder.decode();call.rawSse=raw;
    for(const line of raw.split(/\r?\n/u)){if(!line.startsWith('data:'))continue;try{const event=JSON.parse(line.slice(5));if(event.usage)call.usage=event.usage;if(event.choices?.[0]?.finish_reason)call.finish=event.choices[0].finish_reason;}catch{}}
    if(Number.isFinite(call.usage?.total_tokens))tokens+=call.usage.total_tokens;else unknown=true;
    res.end();
  }catch(error){if(call){call.error=error.message;unknown=true;}else report.errors.push('Rejected before provider: '+error.message);if(!res.headersSent)res.writeHead(502);res.end();}
  finally{if(call){call.pending=false;call.durationMs=Date.now()-call.startedAt;}active.delete(work);settle();}
});
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');let browser;
const beforePlugin={name:'latency-before-only',setup(builder){builder.onLoad({filter:/src[\\/]lib[\\/](?:character-memory|memory-source-snapshot|chat[\\/]send-service)\.ts$/},async(args)=>{
  let contents=readFileSync(args.path,'utf8');
  if(args.path.endsWith('memory-source-snapshot.ts')){const from=contents.indexOf('export async function memorySourceSnapshotsStillLive');contents=contents.slice(0,from)+`export async function memorySourceSnapshotsStillLive(value:object):Promise<boolean>{for(const source of snapshots.get(value)??[]){const current=await db.table(source.table).get(source.id);if(!current||JSON.stringify(current)!==JSON.stringify(source.row))return false;}return true;}\n`;}
  if(args.path.endsWith('character-memory.ts')){
    contents=contents.replace('const validation = await Promise.allSettled(references.map(reference => indexVisibleReference(p, reference, false)));','const validation=[];for(const reference of references){try{await indexVisibleReference(p,reference,false);validation.push({status:"fulfilled" as const});}catch(reason){validation.push({status:"rejected" as const,reason});}}');
    contents=contents.replace('const validation = await Promise.allSettled(context.references.map(reference => indexVisibleReference(p, reference, false)));','const validation=[];for(const reference of context.references){try{await indexVisibleReference(p,reference,false);validation.push({status:"fulfilled" as const});}catch(reason){validation.push({status:"rejected" as const,reason});}}');
  }
  if(args.path.endsWith('send-service.ts')){const needle='if (request.controller.signal.aborted && !result.content?.trim()) return;';if(!contents.includes(needle))throw Error('Before anchor missing');contents=contents.replace(needle,'const elapsed=Date.now()-startedAt;if(!request.stream.published&&!request.controller.signal.aborted&&elapsed<620)await new Promise(resolve=>setTimeout(resolve,620-elapsed));\n'+needle);}
  return {contents,loader:'ts'};
});}};
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const label of ['before','after','after','before']){
    const bundle=await build({entryPoints:['scripts/verify/chat-latency-live.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.png':'dataurl','.webp':'dataurl'},plugins:label==='before'?[beforePlugin]:[],define:{LATENCY_PROXY:JSON.stringify('http://127.0.0.1:'+proxy.address().port+'/chat/completions'),LATENCY_TOKEN:JSON.stringify(token),'import.meta.env':'{"VITE_AI_GATEWAY_URL":""}',__APP_VERSION__:'"test"'}});
    const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'application/javascript':'text/html');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const context=await browser.newContext();
    try{const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.latencyLive);const from=calls.length;const row=await page.evaluate(()=>window.latencyLive());report.rows.push({label,...row,callIds:calls.slice(from).map(call=>call.attempt)});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({label,firstVisibleMs:row.firstVisibleMs,totalMs:row.totalMs,failed:row.failed,tokens}));if(row.failed||unknown||calls.length>=6)break;}
    finally{await context.close();await new Promise(resolve=>server.close(resolve));}
  }
  report.complete=report.rows.length===4&&report.rows.every(row=>!row.failed&&row.replies.length)&&calls.every(call=>call.finish==='stop'&&!call.error)&&!unknown;
}catch(error){report.errors.push(error.message);}finally{await browser?.close();await Promise.all([...active]);secret='';await new Promise(resolve=>proxy.close(resolve));report.usage={requests:calls.length,totalKnownTokens:tokens,unknownUsage:unknown,pendingCalls:active.size};writeFileSync(output,JSON.stringify(report,null,2));}
console.log(JSON.stringify({complete:report.complete,usage:report.usage,evidence:output}));
if(!report.complete)process.exitCode=1;
