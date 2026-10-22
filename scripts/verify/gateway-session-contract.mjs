import fs from 'node:fs';import assert from 'node:assert/strict';import {build} from 'esbuild';import ts from 'typescript';import {pathToFileURL} from 'node:url';import path from 'node:path';
const root='.tmp-preview/ui-overhaul-20261016/gateway-session-boundary';
const declarations=files=>files.flatMap(file=>{const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);return source.statements.filter(node=>!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node)).map(node=>node.getText(source).replace(/^export /,''));}).sort();
assert.deepEqual(declarations(['src/lib/ai/gateway-session.ts','src/lib/ai/gateway.ts']),declarations([root+'/gateway.before.ts']),'all pre-existing declarations and function bodies are text-identical');
const result={checks:['original declarations unchanged'],scope:'Isolated fake fetch with shared real session/transport modules; no external network, credentials, model, microphone or audio.'};
const check=(value,label)=>{assert.ok(value,label);result.checks.push(label);};
globalThis.window=globalThis;globalThis.location={search:''};globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
const events=new EventTarget();globalThis.addEventListener=events.addEventListener.bind(events);globalThis.removeEventListener=events.removeEventListener.bind(events);globalThis.dispatchEvent=events.dispatchEvent.bind(events);
const output=await build({stdin:{contents:"export * as session from './src/lib/ai/gateway-session'; export * as compat from './src/lib/ai/gateway';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':JSON.stringify({VITE_AI_GATEWAY_URL:'https://isolated.invalid'})}});
fs.writeFileSync(root+'/contract-bundle.mjs',output.outputFiles[0].text);
const {session,compat}=await import(pathToFileURL(path.resolve(root+'/contract-bundle.mjs')).href);
const calls=[];let status=200,body={content:'local reply'},stream=false;
globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(options.signal?.aborted)throw options.signal.reason??new DOMException('Cancelled','AbortError');return stream?new Response('data: {"choices":[{"delta":{"content":"local"}}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}):new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});};
const params={apiKey:'',systemPrompt:'synthetic',message:'local test',history:[]};
try{
 check(session.setGatewayAccessToken===compat.setGatewayAccessToken,'old and lightweight entry share the exact token setter');
 check(!compat.hasAiGatewayAccess(),'no session is not authorized');
 session.setGatewayAccessToken(' local-session ');check(compat.hasAiGatewayAccess(),'lightweight token is visible through old API');
 await compat.gatewayChat(params);check(calls.at(-1).options.headers.Authorization==='Bearer local-session','chat reads current shared token');
 compat.setGatewayAccessToken('refreshed-session');stream=true;const reply=await compat.gatewayChatStream({...params,onDelta(){}});check(reply.content==='local','stream parser still returns visible text');check(calls.at(-1).options.headers.Authorization==='Bearer refreshed-session','stream sees token changed through original API');stream=false;
 session.setGatewayAccessToken(null);check(!session.hasAiGatewayAccess()&&!compat.hasAiGatewayAccess(),'clearing token clears both entrypoints');
 await compat.gatewayChat(params);check(!('Authorization' in calls.at(-1).options.headers),'cleared token is absent from later request');
 body={user:{id:'synthetic-user',username:'local'},accessToken:'test-access',refreshToken:'test-refresh',expiresIn:60};
 await session.registerGatewayAccount('local','synthetic-password',true);check(calls.at(-1).url.endsWith('/v1/auth/register')&&JSON.parse(calls.at(-1).options.body).adultConfirmed===true,'registration endpoint and consent remain intact');
 await compat.loginGatewayAccount('local','synthetic-password',true);check(calls.at(-1).url.endsWith('/v1/auth/login'),'old login API retains endpoint');
 session.setGatewayAccessToken('unrelated-access');await compat.refreshGatewaySession('explicit-refresh');check(calls.at(-1).options.headers.Authorization==='Bearer explicit-refresh'&&!('body' in calls.at(-1).options),'refresh uses explicit token and sends no body');
 await session.deleteGatewayAccount();check(calls.at(-1).options.method==='DELETE'&&calls.at(-1).options.headers.Authorization==='Bearer unrelated-access','deletion uses current shared token');
 for(const [code,error] of [[401,'auth:invalid_key'],[403,'auth:invalid_key'],[402,'billing:insufficient'],[429,'rate:limited'],[500,'server:error']]){status=code;await assert.rejects(()=>compat.gatewayChat(params),new RegExp(error));result.checks.push('unchanged chat error mapping '+code);}
 status=200;body={ok:true};check(await session.checkGatewayHealth()==='connected','health check retains connected result');
 const abort=new AbortController();abort.abort();const count=calls.length;check(await compat.checkGatewayHealth(abort.signal)==='offline'&&calls.length===count,'cancelled health does not request network');
 await assert.rejects(()=>compat.gatewayChat({...params,signal:abort.signal}),error=>error.name==='AbortError');result.checks.push('pre-cancelled chat remains AbortError');
 result.pass=true;
}finally{fs.writeFileSync(root+'/contract.json',JSON.stringify(result,null,2));}
console.log(JSON.stringify({pass:result.pass,checks:result.checks.length}));
