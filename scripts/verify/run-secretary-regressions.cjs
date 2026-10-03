const { createRequire } = require('module');
const path = require('path');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
const http = require('http');
const fs = require('fs');
const reports = new Map();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/result') {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { const suite = url.searchParams.get('suite') || path.basename(new URL(req.headers.referer).pathname, '.html'); reports.set(suite, body); res.end('ok'); }); return;
  }
  const file = path.join(__dirname, path.basename(url.pathname));
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'); res.end(data); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const suites = process.argv.slice(2).length ? process.argv.slice(2) : ['character-create', 'moments', 'memory-unified'];
    for (const suite of suites) {
      if (!/^[a-zA-Z0-9-]+$/.test(suite)) throw new Error('invalid regression suite name');
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      page.on('pageerror', e => console.error(`${suite}: ${e.message}`));
      await page.goto(`http://127.0.0.1:${server.address().port}/${suite}.html`);
      const deadline = Date.now() + 60000;
      const finished = () => /ALL PASS|FAILED|^FAIL|^PAGE ERROR|^UNHANDLED REJECTION/m.test(reports.get(suite) || '');
      while (!finished() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      const report = reports.get(suite) || await page.locator('body').innerText();
      fs.writeFileSync(path.join(__dirname, `.last-result-${suite}.txt`), report, 'utf8');
      if (!report.includes('ALL PASS') || /FAILED|^FAIL/m.test(report)) throw new Error(`${suite}: ${report}`);
      if (suite === 'secretary-memory') {
        await page.evaluate(() => window.secretaryMemoryPreview());
        await page.getByRole('button', { name: '纠正：我喜欢桂花茶', exact: true }).waitFor();
        for (const width of [320, 390, 430]) {
          await page.setViewportSize({ width, height: 844 });
          if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw new Error('assistant memory modal overflows at ' + width);
        }
        await page.setViewportSize({ width: 320, height: 844 });
        await page.getByRole('button', { name: '纠正：我喜欢桂花茶', exact: true }).click();
        await page.getByRole('textbox', { name: '纠正记忆内容', exact: true }).waitFor();
        if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) throw new Error('assistant memory editor overflows');
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(__dirname, 'secretary-memory.png') });
        console.log('PASS secretary-memory: 4 narrow-screen layout checks');
      }
      const assertions = Number(report.match(/ok\s+(\d+)\s+assertions/)?.[1]) || (report.match(/^ok\s/gm) || []).length;
      console.log(`PASS ${suite}: ${assertions || report.split('\n')[0]} checks`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
