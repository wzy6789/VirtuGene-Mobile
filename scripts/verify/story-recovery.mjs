import { build } from 'esbuild';
import assert from 'node:assert/strict';

const bundle = await build({
  stdin: { contents: 'export { actAsCharacter, buildActorSystem, parseActorOutput } from "./src/lib/world/world-actor";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'esm',
  define: { 'import.meta.env': '{}', __APP_VERSION__: '"test"' },
});
const { actAsCharacter, buildActorSystem, parseActorOutput } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const ctx = {
  presence: ['a'], place: '钟楼', timeLabel: '黄昏', mood: '安静', objects: [], recentEntries: [],
  nameOf: () => '星遥',
  perCharacter: { a: { name: '星遥', persona: '修钟匠，说话直率，讨厌虚张声势', facts: [], memories: [], diaries: [], scenes: [], threads: [], todos: [] } },
};
const params = { ctx, speaker: { characterId: 'a', intent: '查看钟摆', mode: 'both' }, userText: '看看里面' };
assert.match(buildActorSystem(params), /修钟匠/);
assert.equal(parseActorOutput('{"speech":"先别碰齿轮。"}', 'a').dialogue, '先别碰齿轮。');
let calls = 0;
let result = await actAsCharacter({ ...params, call: async () => { calls++; return { content: '{"action":"扶住摇晃的梯子"}' }; } });
assert.equal(calls, 1); assert.equal(result.via, 'json');
calls = 0;
result = await actAsCharacter({ ...params, call: async (request) => {
  calls++;
  if (calls === 1) return { content: '{}' };
  assert.equal(request.jsonMode, undefined);
  return { content: '先别碰，我看看卡在哪里。' };
} });
assert.equal(calls, 2); assert.equal(result.via, 'salvaged');
calls = 0;
result = await actAsCharacter({ ...params, call: async () => { calls++; if (calls === 1) throw new Error('timeout'); return { content: '这里少了一枚齿轮。' }; } });
assert.equal(calls, 2); assert.equal(result.via, 'salvaged');
calls = 0;
result = await actAsCharacter({ ...params, call: async () => { calls++; throw new Error('auth:invalid_key'); } });
assert.equal(calls, 1); assert.equal(result.via, 'none');
calls = 0;
result = await actAsCharacter({ ...params, call: async () => { calls++; return { content: '' }; } });
assert.equal(calls, 2); assert.equal(result.via, 'none');
console.log('PASS: persona, alternate fields, action-only, empty recovery, timeout recovery, auth fail-fast, bounded failure. No network.');
