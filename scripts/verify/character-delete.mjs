import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const bundle=await build({entryPoints:['scripts/verify/character-delete.ts'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.png':'dataurl','.webp':'dataurl'},define:{'import.meta.env':'{}','import.meta.hot':'undefined',__APP_VERSION__:'"test"'}});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/test.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/test.js'?bundle.outputFiles[0].text:'<!doctype html><script src="/test.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.characterDeleteTest);
  const count=Number(process.argv.find(arg=>arg.startsWith('--count='))?.split('=')[1]??10000);
  const result=await page.evaluate(count=>window.characterDeleteTest.run(count),count);
  if(errors.length)throw Error(errors.join('\n'));
  if(!process.argv.includes('--baseline')&&(result.fullSessionRead||result.maxBulkRead>100||result.operations>Math.ceil(count/100)*4+200))throw Error('Unbounded reads or per-message database requests: '+JSON.stringify(result));
  const out='.tmp-preview/character-delete';mkdirSync(out,{recursive:true});writeFileSync(`${out}/${process.argv.includes('--baseline')?'baseline':`result-${count}`}.json`,JSON.stringify(result,null,2)+'\n');
  console.log('PASS character-delete: '+JSON.stringify(result));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
