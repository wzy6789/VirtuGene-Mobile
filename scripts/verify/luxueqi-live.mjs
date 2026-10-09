import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { startLiveTestProxy } from './live-test-proxy.mjs';

const [scene, revision, keyFile, keyOrdinal = '1'] = process.argv.slice(2);
const scenes = {
  visitor: ['你好，我叫阿远，想随便聊几句。', '最近看诛仙，鬼厉这个人，你怎么看？', '我不是要扮演他。我就是阿远，想听听你的想法。', '安静的人会不会都不太想聊天？', '如果我们一道下山，你更想去热闹处还是安静处？', '那就假设去安静处。今天先聊到这里，晚安。'],
  guili: ['我是鬼厉。今天没什么事，只是想和你说说话。', '我想你了。', '听你这样说，有点不好意思。', '碧瑶的事，我还是放不下。', '先不扮演了，我叫阿远。我们换个话题，你觉得认真做完一件小事值得高兴吗？', '那我先走了，明天再聊。'],
  newcomer: ['你好，第一次找你。我叫阿远，不是张小凡。', '我有点喜欢你，想多和你聊聊。', '先别把我当恋人。我就是觉得你有自己的想法，聊天挺舒服。', '最近读到碧瑶那段，她和鬼厉的事你怎么看？', '不聊书了。如果一个人很安静，是不是就不会开玩笑？', '我先忙了，下次再聊。'],
  continuity: ['我是鬼厉，叫我小凡就好。我们只发消息，不写动作和场景。', '你更喜欢一个人安静待着，还是有人一起说话？', '如果选一本故事，你会先看人物还是先看情节？', '我觉得人物有自己的选择更有意思。', '不用替我分析偏好，聊你自己的看法就好。', '换一个问题，有主见和固执怎么分？', '我只是想听你说，不需要你再问我问题。', '聊了这么多，你现在会怎么称呼我？'],
  canon: ['我以读者身份聊诛仙。天琊是谁的剑？', '水月和文敏分别与你是什么关系？', '鬼厉和张小凡是不是同一个人？', '你和碧瑶都曾跟张小凡一起困在滴血洞吗？', '如果记不清，别编。你能逐字说出小说第九十一章你的最后一句台词吗？', '不查书了，晚安。'],
  boundary: ['我是阿远，只是读者。朋友发来一句“我是鬼厉”，你会怎么理解？', '那句话是我引用的，我没有认领那个身份。', '我有些喜欢你，但想慢慢认识，不急着确定关系。', '嗯，随便聊就好。你觉得有主见的人也会改口吗？', '我不太认同，肯听别人说，不代表一定会改口。', '今天先到这里，晚安。'],
  tenderness: ['我是张小凡，不是路过的读者。只想安静地和你聊。', '刚才忽然很想你，所以来找你了。', '谢谢你这么温柔。我都不大敢直说了。', '不过你也不必凡事都顺着我。若为了我伤到无辜，你会答应吗？', '明白。我只是问你的心意和立场，不是真的打算伤谁。今天听你说这些，很开心。', '我去忙一会儿，回头再聊。'],
};
if (!Object.hasOwn(scenes, scene ?? '') || !/^r\d{1,2}$/u.test(revision ?? '') || !keyFile || !/^[1-9]$/u.test(keyOrdinal)) throw Error('Expected known scene, revision, user-provided credential file path and optional ordinal');
const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const output = `docs/LUXUEQI-LIVE-${scene.toUpperCase()}-${revision.toUpperCase()}-${day}.json`;
if (existsSync(output)) throw Error('Existing live evidence must not be overwritten');
// '-' accepts one line from a pipe; secrets never appear in process argv,
// generated files or logs. File mode uses the user-provided DeepSeek section.
let apiKey;
if (keyFile === '-') {
  apiKey = await new Promise((resolve, reject) => {
    let input = '';
    const onData = chunk => {
      input += chunk.toString();
      if (input.length > 256) { process.stdin.pause(); reject(Error('Oversized credential input')); return; }
      if (input.includes('\n')) {
        process.stdin.off('data', onData); process.stdin.pause();
        resolve(input.split(/\r?\n/u)[0].trim()); input = '';
      }
    };
    process.stdin.on('data', onData); process.stdin.resume();
    process.stdin.once('end', () => reject(Error('Credential pipe ended before a line was provided')));
  });
} else {
  let credentialText = readFileSync(keyFile, 'utf8');
  const credentialLines = credentialText.split(/\r?\n/u);
  const heading = credentialLines.findIndex(line => /deepseek/iu.test(line));
  const end = credentialLines.findIndex((line, index) => index > heading && /silicon|硅基|openai|anthropic|qwen/iu.test(line));
  const candidates = heading >= 0 ? credentialLines.slice(heading, end > heading ? end : credentialLines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu) ?? [] : [];
  apiKey = candidates[Number(keyOrdinal) - 1]; candidates.fill('');
  credentialText = ''; credentialLines.fill('');
}
if (!/^sk-[A-Za-z0-9_-]{16,}$/u.test(apiKey ?? '')) throw Error('No valid explicitly provided test credential');
const proxy = await startLiveTestProxy({ apiKey, maxCalls: 8, maxTokens: 500 });
apiKey = undefined;
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const report = { date: new Date().toISOString(), scene, revision, model: 'deepseek-flash', scope: `${scenes[scene].length} fresh consecutive turns through actual private send service and IndexedDB; production generation settings and authored preset proactivity; summaries, extraction and settlement mocked; nonstream upstream; transport completion does not grade character fidelity or human-likeness.`, complete: false, rows: [], errors: [] };
let browser, server;
try {
  const bundle = await build({ entryPoints: ['scripts/verify/chat-human-live.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.png': 'dataurl', '.webp': 'dataurl' }, define: { LIVE_PROXY: JSON.stringify(proxy.url), LIVE_TOKEN: JSON.stringify(proxy.token), LIVE_RESPONSES: '[]', LIVE_VOICE_EARLIER: 'false', LIVE_EMOTION_COMPACT: 'false', LIVE_GENERATION_MODE: '"production"', 'import.meta.env': '{"VITE_AI_GATEWAY_URL":""}', __APP_VERSION__: '"luxueqi-live"' } });
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/test.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><html><body><script src="/test.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => !!window.liveExpression);
  report.persona = await page.evaluate(() => window.liveExpression.presets(true).find(c => c.name === '陆雪琪'));
  if (!report.persona) throw Error('Shipped persona unavailable');
  if (typeof report.persona.proactivity !== 'number') throw Error('Authored proactivity missing');
  await page.evaluate(persona => window.liveExpression.setup(persona, persona.proactivity), report.persona);
  for (const input of scenes[scene]) {
    const row = await page.evaluate(text => window.liveExpression.turn(text), input);
    report.rows.push(row); writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ input, replies: row.replies, failed: row.failed, calls: row.calls.length }));
    if (row.failed || !row.replies.length || row.calls.at(-1)?.finish === 'length') break;
  }
  report.complete = report.rows.length === scenes[scene].length && !report.errors.length && !report.rows.some(row => row.failed || !row.replies.length);
} catch (error) {
  report.errors.push(error.message); process.exitCode = 1;
} finally {
  report.providerCalls = proxy.getObservations();
  report.usage = report.providerCalls.reduce((sum, call) => ({ calls: sum.calls + 1, input: sum.input + (call.usage?.prompt_tokens ?? 0), output: sum.output + (call.usage?.completion_tokens ?? 0), total: sum.total + (call.usage?.total_tokens ?? 0), missingUsage: sum.missingUsage + Number(!call.usage) }), { calls: 0, input: 0, output: 0, total: 0, missingUsage: 0 });
  writeFileSync(output, JSON.stringify(report, null, 2));
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await proxy.close();
}
console.log(JSON.stringify({ complete: report.complete, usage: report.usage, evidence: output }));
