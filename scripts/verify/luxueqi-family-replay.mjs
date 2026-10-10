import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const inputs = ['我是张小凡。想听你说句话。', '小鼎现在睡了吗？', '我想和你聊聊。', '再聊一句。'];
const drafts = [
  ['我也想你。小鼎刚出去玩了。', '我也想你。'],
  ['不知道，去问他爹。', '不知道他现在有没有睡。'],
  ['我也想你。阿璃在旁边。', '我也想你。阿璃在旁边。'],
  ['小鼎刚出去玩了。', '小鼎刚出去玩了。'],
];
const responses = drafts.flatMap((pair, i) => pair.map(raw => ({ input: inputs[i], raw })));
const bundle = await build({ entryPoints: ['scripts/verify/chat-human-live.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: {
  LIVE_PROXY: '"http://127.0.0.1:1/no-network"', LIVE_TOKEN: '"local-replay-only"', LIVE_RESPONSES: JSON.stringify(responses), LIVE_VOICE_EARLIER: 'false', LIVE_EMOTION_COMPACT: 'false', LIVE_GENERATION_MODE: '"production"', LIVE_DEFER_DELIVERY: 'true', 'import.meta.env': '{}', __APP_VERSION__: '"local-replay"',
} });
const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/test.js' ? 'text/javascript' : 'text/html; charset=utf-8'); response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : '<script src="/test.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => !!window.liveExpression);
  const persona = await page.evaluate(() => window.liveExpression.presets(true).find(c => c.name === '陆雪琪'));
  await page.evaluate(p => window.liveExpression.setup(p, p.proactivity), persona);
  const rows = [];
  for (const input of inputs) rows.push(await page.evaluate(text => window.liveExpression.turn(text), input));
  const pass = rows.every(row => row.calls.length === 2 && row.calls.every(call => call.replayed))
    && rows[0].replies.join('') === '我也想你。'
    && rows[1].replies.join('') === '不知道他现在有没有睡。'
    && rows[2].replies.join('') === '我也想你。'
    && rows[3].failed && !rows[3].replies.length;
  writeFileSync('docs/LUXUEQI-FAMILY-REPLAY-2026-10-10.json', JSON.stringify({ date: new Date().toISOString(), pass, rows, modelCalls: 0, scope: 'Actual private send and IndexedDB with deterministic response fixtures; unpublished drafts only. Exercises the existing single retry, sentence omission and ordinary failure path. Does not evaluate model warmth.' }, null, 2));
  if (!pass) throw Error('Family guard integration did not preserve the intended save/retry behavior');
  console.log('PASS family-replay: 4 private-send cases, 8 fixture responses, zero model calls');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
