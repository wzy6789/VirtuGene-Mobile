import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/preset-voice.ts'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.webp':'dataurl','.png':'dataurl'},define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'}});
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><script src="/test.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();
  page.on('console',message=>{if(message.type()==='log')console.log(message.text());});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.presetVoiceTest);
  const result=await page.evaluate(()=>window.presetVoiceTest.run());
  console.log(`PASS preset-voice: ${result.checks} actual database checks; zero network`);
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
