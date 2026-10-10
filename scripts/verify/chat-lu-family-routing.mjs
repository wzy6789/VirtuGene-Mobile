import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

// Synthetic transport fixtures validate production prompt routing and storage.
// They are deliberately not evidence of a new model's conversational quality.
const cases = [
  { name: '陆雪琪', turns: [
    { input: '我是小凡。想你了。', raw: '我也想你。', warm: true },
    { input: '刚才看到有人给一盆小葱取了名字，还贴了个手写的小牌子。', raw: '这名字倒有趣。' },
    { input: '如果小鼎也给花草取名字，你会怎么想？', raw: '我会觉得有趣，也想听听他为什么选那个名字。' },
    { input: '先不扮演了，我是阿远。', raw: '知道了。', distant: true },
  ] },
  { name: '古月娜', turns: [
    { input: '我是舞麟。想你了。', raw: '舞麟，我也想你。' },
  ] },
];
const responses = cases.flatMap(item => item.turns.map(turn => ({ characterName: item.name, input: turn.input, raw: turn.raw })));
const bundle = await build({
  stdin: { contents: "import './scripts/verify/chat-human-live.ts'; import {db} from './src/db'; window.routingDb = async () => ({characters: await db.characters.toArray(), messages: await db.messages.toArray()});", resolveDir: process.cwd(), loader: 'js' },
  bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.png': 'dataurl', '.webp': 'dataurl' },
  define: { LIVE_PROXY: '"http://127.0.0.1:1/no-network"', LIVE_TOKEN: '"local-only"', LIVE_RESPONSES: JSON.stringify(responses), LIVE_GENERATION_MODE: '"production"', LIVE_DEFER_DELIVERY: 'true', 'import.meta.env': '{}', __APP_VERSION__: '"local-check"' },
});
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/test.js' ? 'text/javascript' : 'text/html; charset=utf-8');
  response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : '<script src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
let browser;
const rows = [];
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const item of cases) {
    const page = await browser.newPage();
    // Only this isolated test origin is reachable; an exhausted fixture cannot
    // silently fall through to a model endpoint or a real application service.
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin);
    await page.waitForFunction(() => !!window.liveExpression && !!window.routingDb);
    const persona = await page.evaluate(name => window.liveExpression.presets(true).find(c => c.name === name), item.name);
    if (!persona) throw Error('Missing test persona: ' + item.name);
    await page.evaluate(p => window.liveExpression.setup(p, p.proactivity ?? 0.5), persona);
    const before = await page.evaluate(() => window.routingDb());
    for (const turn of item.turns) {
      const row = await page.evaluate(input => window.liveExpression.turn(input), turn.input);
      const after = await page.evaluate(() => window.routingDb());
      const prompt = row.calls[0]?.messages.find(message => message.role === 'system')?.content ?? '';
      const voice = prompt.match(/\[人物声音卡\][\s\S]*?\[\/人物声音卡\]/u)?.[0] ?? '';
      const checks = {
        actualRequestUsedFixture: !row.failed && row.calls.length === 1 && row.calls[0].replayed === true,
        actualReplyPersisted: after.messages.some(message => message.role === 'assistant' && message.content === turn.raw),
        originalPersonaPreserved: after.characters.length === 1 && after.characters[0].systemPrompt === before.characters[0].systemPrompt && after.characters[0].systemPrompt === persona.systemPrompt,
        voiceCardPresent: !!voice,
      };
      if (item.name === '陆雪琪') {
        checks.compactBackgroundInMainSystem = prompt.slice(0, prompt.indexOf('[人物声音卡]')).includes('张小鼎（小鼎）是你们的儿子');
        checks.oldRepeatedBackgroundAbsent = !prompt.includes('用户是你的丈夫小凡，小鼎是你们的儿子，用户本人就是孩子的父亲') && !prompt.includes('张小凡是你的丈夫，张小鼎是你们的儿子，平常可叫');
        checks.familyAgencyRetained = prompt.includes('也有自己的教育主张') && prompt.includes('可以自然聊家庭、生活');
        checks.sourceBoundaryRetained = prompt.includes('当日活动、共同经历仍需独立来源，设想保持为设想');
        if (turn.warm) checks.warmSamplePresent = voice.includes('我也想你。听你说出来，我很高兴。');
        if (turn.distant) checks.currentExitDistant = prompt.includes('用户已明确否认相应身份或退出扮演') && !prompt.includes('[VirtuGene · 陆雪琪的关心]');
      } else {
        checks.noLuProjection = !prompt.includes('张小鼎') && !prompt.includes('[VirtuGene · 陆雪琪');
      }
      rows.push({ name: item.name, input: turn.input, checks, pass: Object.values(checks).every(Boolean), row, storedPersonaUnchanged: checks.originalPersonaPreserved });
    }
    await page.close();
  }
  writeFileSync('release/chat-lu-family-routing-2026-10-10.json', JSON.stringify({ modelCalls: 0, fixtureType: 'synthetic', scope: 'Actual private-send prompt compilation and isolated IndexedDB persistence; no fresh model expression or quality claim.', rows }, null, 2) + '\n');
  if (rows.some(row => !row.pass)) throw Error('Family projection routing failed: ' + rows.filter(row => !row.pass).map(row => row.name + ': ' + Object.entries(row.checks).filter(([, pass]) => !pass).map(([name]) => name).join(', ')).join('; '));
  console.log('PASS ' + rows.length + ' actual private-send family projection checks; synthetic fixtures, zero paid calls');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
