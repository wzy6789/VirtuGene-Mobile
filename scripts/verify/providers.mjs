import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Fresh browser profile and random loopback origin isolate all keys and app storage.
const bundle = await build({ entryPoints: ['scripts/verify/providers.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.webp': 'dataurl', '.png': 'dataurl' }, define: { 'import.meta.env': '{}', __APP_VERSION__: '"protocol-test"' } });
let complete;
const done = new Promise(resolve => { complete = resolve; });
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { res.end('ok'); complete(body); });
    return;
  }
  res.setHeader('Content-Type', req.url === '/test.js' ? 'application/javascript' : 'text/html; charset=utf-8');
  res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><body>RUNNING<script src="/test.js"></script></body>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = mkdtempSync(join(tmpdir(), 'virtugene-provider-protocols-'));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `http://127.0.0.1:${server.address().port}`], { windowsHide: true });
browser.stderr.resume();
browser.on('error', error => complete(`FAIL browser launch: ${error.message}`));
const timer = setTimeout(() => complete('FAIL browser timeout'), 45_000);
const result = await done;
clearTimeout(timer);
browser.kill();
server.close();
console.log(result || 'FAIL browser produced no report');
if (!result.startsWith('PASS')) process.exitCode = 1;
