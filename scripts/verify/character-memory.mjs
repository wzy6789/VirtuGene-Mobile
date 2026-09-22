import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const bundle = await build({entryPoints:['scripts/verify/character-memory.ts'],bundle:true,write:false,platform:'browser',format:'iife',define:{'import.meta.env':'{}',__APP_VERSION__:'"test"'}});
let complete;
const done = new Promise(resolve => { complete=resolve; });
const server = createServer((req,res) => {
  if (req.url === '/result') {
    let body='';req.on('data',d=>body+=d);req.on('end',()=>{res.end('ok');complete(body);});return;
  }
  res.setHeader('Content-Type',req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8');
  res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><body>RUNNING<script src="/test.js"></script></body>');
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const profile = mkdtempSync(join(tmpdir(),'virtugene-memory-verify-'));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless','--disable-gpu','--no-first-run',`--user-data-dir=${profile}`,'--remote-debugging-port=0',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
let output='';
browser.stdout.on('data',d=>output+=d);
browser.stderr.resume();
const timer=setTimeout(()=>complete('FAIL browser timeout'),45000);
const result=await done;
clearTimeout(timer);browser.kill();server.close();
console.log(result || 'FAIL browser produced no report');
if (!result.startsWith('PASS')) process.exitCode=1;
