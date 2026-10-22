import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const fixtureKey = '__vgCharacterChatScopeFixture';
const bundled = await build({ entryPoints: ['src/lib/character-chat.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'isolated-io', setup(builder) {
  builder.onResolve({ filter: /^\.\.\/(db\/character-repo|store\/auth-store|store\/chat-store)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
    const name = args.path.endsWith('character-repo') ? 'characterRepo' : args.path.endsWith('auth-store') ? 'useAuthStore' : 'useChatStore';
    return { contents: `export const ${name} = globalThis.${fixtureKey}.${name};`, loader: 'js' };
  });
} }] });
let serial = 0;
const source = { id: 'resource', name: '同名角色', systemPrompt: '公开设定', isPreset: true, createdBy: 'catalog', published: true };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function setup(rows) {
  const records = new Map(rows.map(row => [row.id, structuredClone(row)]));
  const listeners = new Set(), creationOptions = []; let owner = 'A', creates = 0, reads = 0, heldRead, heldCreate;
  const state = () => ({ userId: owner });
  const fixture = {
    useAuthStore: { getState: state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
    characterRepo: {
      async getById(id) { reads++; const wait = heldRead; heldRead = undefined; if (wait) { wait.entered.resolve(); await wait.release.promise; } return records.get(id); },
      async getByCreator(id) { reads++; return [...records.values()].filter(row => row.createdBy === id); },
    },
    useChatStore: { getState: () => ({ async createCharacter(data, options) {
      creates++; creationOptions.push(options); const created = { ...data, id: `created-${creates}`, createdBy: owner };
      const wait = heldCreate; heldCreate = undefined; if (wait) { wait.entered.resolve(); await wait.release.promise; }
      records.set(created.id, created); return created;
    } }) },
  };
  globalThis[fixtureKey] = fixture;
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + `\n// fixture ${++serial}`).toString('base64')}`);
  return { ...module, records, listeners, creationOptions,
    owner(value) { const previous = state(); owner = value; for (const listener of [...listeners]) listener(state(), previous); },
    holdRead() { heldRead = { entered: deferred(), release: deferred() }; return heldRead; },
    holdCreate() { heldCreate = { entered: deferred(), release: deferred() }; return heldCreate; },
    counts: () => ({ creates, reads, subscriptions: listeners.size }),
  };
}
const report = { at: new Date().toISOString(), entry: 'src/lib/character-chat.ts', isolation: 'actual production module; repository/auth/create IO only injected; no model, messages or memory', checks: [] };
async function check(name, action) { try { const evidence = await action(); report.checks.push({ name, pass: true, evidence }); } catch (error) { report.checks.push({ name, pass: false, error: String(error) }); } }
const own = { ...source, id: 'owned-A', isPreset: false, published: false, createdBy: 'A', sourcePresetId: source.id };
await check('withdrawn source resolves existing owned copy without creation', async () => {
  const f = await setup([own]); assert.equal((await f.resolveOwnedChatCharacter(source, 'A')).id, own.id); assert.equal((await f.ensureOwnedChatCharacter(source, 'A')).id, own.id); assert.equal(f.counts().creates, 0); assert.equal(f.listeners.size, 0); return f.counts();
});
await check('deleted owned row is never replaced by another same-name character', async () => {
  const f = await setup([source, { ...own, id: 'other-copy' }]); assert.equal(await f.resolveOwnedChatCharacter(own, 'A'), undefined); await assert.rejects(f.ensureOwnedChatCharacter(own, 'A')); assert.equal(f.counts().creates, 0); assert.equal(f.listeners.size, 0); return f.counts();
});
await check('other account gets no private character or owned copy', async () => {
  const f = await setup([own]); f.owner('B'); assert.equal(await f.resolveOwnedChatCharacter(own, 'B'), undefined); await assert.rejects(f.ensureOwnedChatCharacter(own, 'B')); await assert.rejects(f.resolveOwnedChatCharacter(source, 'A')); assert.equal(f.counts().creates, 0); assert.equal(f.listeners.size, 0); return f.counts();
});
await check('double activation of same resource creates one owned row', async () => {
  const f = await setup([source]); const gate = f.holdRead(); const first = f.ensureOwnedChatCharacter(source, 'A'); await gate.entered.promise; const second = f.ensureOwnedChatCharacter(source, 'A'); gate.release.resolve(); const result = await Promise.all([first, second]); assert.equal(result[0].id, result[1].id); assert.equal(f.counts().creates, 1); assert.equal(f.listeners.size, 0); return f.counts();
});
await check('A to B to A invalidates a delayed read', async () => {
  const f = await setup([own]); const gate = f.holdRead(); const pending = f.resolveOwnedChatCharacter(own, 'A'); const rejected = assert.rejects(pending, /账号|登录/); await gate.entered.promise; f.owner('B'); f.owner('A'); gate.release.resolve(); await rejected; assert.equal(f.listeners.size, 0); return f.counts();
});
await check('A to B to A rejects delayed creation result and releases its subscription', async () => {
  const f = await setup([source]); const gate = f.holdCreate(); const pending = f.ensureOwnedChatCharacter(source, 'A'); const rejected = assert.rejects(pending, /账号|登录/); await gate.entered.promise; f.owner('B'); f.owner('A'); gate.release.resolve(); await rejected; assert.deepEqual(f.creationOptions, [{ deferActivation: true }]); assert.equal(f.listeners.size, 0); return f.counts();
});
await check('fresh A operation revalidates an old pending write without duplicate creation or lost lock', async () => {
  const f = await setup([source]); const gate = f.holdCreate(); const stale = f.ensureOwnedChatCharacter(source, 'A'); const rejected = assert.rejects(stale, /账号|登录/); await gate.entered.promise;
  f.owner('B'); f.owner('A'); const freshRead = f.holdRead(); const fresh = f.ensureOwnedChatCharacter(source, 'A'); assert.notEqual(fresh, stale); assert.equal(f.counts().reads, 2, 'fresh adoption waits for the already-started write before re-reading');
  gate.release.resolve(); await rejected; await freshRead.entered.promise;
  const duplicate = f.ensureOwnedChatCharacter(source, 'A'); assert.equal(duplicate, fresh);
  freshRead.release.resolve(); const result = await Promise.all([fresh, duplicate]); assert.equal(result[0].id, result[1].id); assert.equal(f.counts().creates, 1); assert.equal(f.listeners.size, 0); return f.counts();
});
delete globalThis[fixtureKey];
report.pass = report.checks.every(check => check.pass);
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0) { const path = process.argv[reportIndex + 1]; mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
