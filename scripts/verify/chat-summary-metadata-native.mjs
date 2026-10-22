import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Synthetic browser benchmark only. Does not import or start the application.
const localRequire = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright')); }
catch { ({ chromium } = localRequire('playwright')); }
const dexieSource = readFileSync(localRequire.resolve('dexie/dist/dexie.js'));
const outputDir = resolve('release/chat-summary-covered-prefix-20261019');
mkdirSync(outputDir, { recursive: true });
const stamp = Date.now();
const outputPath = join(outputDir, `native-perf-${stamp}.json`);
const screenshotPath = join(outputDir, `native-perf-${stamp}.png`);
const counts = process.env.NATIVE_PERF_COUNTS?.split(',').map(Number) ?? [1000, 10000, 50000];
const repeats = Number(process.env.NATIVE_PERF_REPEATS ?? 3);
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/dexie.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(dexieSource); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><meta charset="utf-8"><title>Isolated IndexedDB metadata benchmark</title><body style="font:16px system-ui;background:#f8fafc;color:#162338;margin:32px"><h1>Isolated IndexedDB metadata benchmark</h1><p>Synthetic data · no app, model, microphone or external network</p><pre id="report">Running…</pre><script src="/dexie.js"></script>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let report = {
  complete: false,
  generatedAt: new Date().toISOString(),
  scriptSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  actualModel: '未确认', actualReasoningEffort: '未确认', paidCalls: 0,
  scope: 'Fresh browser context at a temporary loopback origin. Synthetic native IndexedDB and local Dexie runtime only. No application import, private data, API, microphone, Android or production schema changes.',
  heapCaveat: 'Heap samples are usedJSHeapSize before/after each scan, not peaks; no garbage collection is forced. JS heap is not total process, IndexedDB backend, disk or native memory.',
  rawSourcePreservationScope: 'Three representative source value snapshots (first/middle/last), plus full row count and scan order/content-length checks. This is not a full per-value migration audit.',
  rowMetricMeaning: 'keyRows counts rows consumed without source bodies; bodyRows counts returned source values including getAllRecords.value. contentChars sums represented lengths, whether obtained from bodies or index tuples.',
  fallbackAssessment: 'getAllRecords can be feature-detected and its tuples can fall back to openKeyCursor, but the supported path always includes full values. For a strictly body-free API use bounded openKeyCursor directly. Missing schema or invalid/unindexed data require an explicit body-reading safety fallback; this benchmark does not establish source authorization/revision/failure checks.',
  counts, repeats,
};
try {
  browser = await chromium.launch({ channel: process.env.NATIVE_PERF_BROWSER_CHANNEL ?? 'chrome', headless: true, args: ['--enable-precise-memory-info'] });
  const context = await browser.newContext({ permissions: [], viewport: { width: 1440, height: 1000 } });
  let blockedRequests = 0;
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    blockedRequests++; return route.abort();
  });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'log') console.log(message.text()); });
  await page.goto(origin);
  const result = await page.evaluate(async ({ counts, repeats }) => {
    const chronologicalIndex = '[sessionId+createdAt+id]';
    const metadataIndex = '[sessionId+createdAt+id+content.length]';
    const sid = 'synthetic-target';
    const requestResult = request => new Promise((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    const complete = transaction => new Promise((done, reject) => {
      transaction.oncomplete = done;
      transaction.onabort = () => reject(transaction.error ?? Error('transaction aborted'));
      transaction.onerror = () => {};
    });
    const heap = () => performance.memory?.usedJSHeapSize ?? null;
    const rounded = value => Math.round(value * 100) / 100;
    const results = [];
    const methods = [
      { name: 'dexie-body-64', type: 'dexie-body', pageSize: 64 },
      { name: 'native-body-64', type: 'native-body', pageSize: 64 },
      { name: 'dexie-keys-512', type: 'dexie-keys', pageSize: 512 },
      { name: 'dexie-keys-2048', type: 'dexie-keys', pageSize: 2048 },
      { name: 'native-key-cursor-512', type: 'native-key-cursor', pageSize: 512 },
      { name: 'native-key-cursor-2048', type: 'native-key-cursor', pageSize: 2048 },
    ];
    const supportsRecords = typeof IDBIndex.prototype.getAllRecords === 'function';
    if (supportsRecords) methods.push({ name: 'native-get-all-records-512', type: 'native-records', pageSize: 512 });
    for (const count of counts) {
      const db = new Dexie(`isolated-summary-metadata-perf-${crypto.randomUUID()}`);
      const initialSchema = `id,sessionId,${chronologicalIndex}`;
      db.version(1).stores({ messages: initialSchema });
      await db.open();
      const makeRow = i => ({
        id: `m-${String(i).padStart(8, '0')}`, sessionId: sid,
        createdAt: Math.floor(i / 3), role: i % 2 ? 'assistant' : 'user',
        content: '这是一段仅用于隔离测试的合成中文内容没有任何私人聊天原文'.repeat(20).slice(0, 320 + i % 7),
        ...(i % 31 ? { revision: 1 } : {}),
        ...(i % 97 === 0 ? { failed: true, extension: { keepRaw: true, arbitrary: ['raw-source', i] } } : {}),
      });
      let rows = Array.from({ length: count }, (_, i) => makeRow(i));
      const imageIds = [0, Math.floor(count / 2), count - 1].map(i => rows[i].id);
      const rawSourceBefore = await Promise.resolve(imageIds.map(id => rows.find(row => row.id === id)));
      const expectedChars = rows.reduce((sum, row) => sum + row.content.length, 0);
      await db.messages.bulkAdd(rows);
      await db.messages.bulkAdd(Array.from({ length: 17 }, (_, i) => ({ ...makeRow(i), id: `unrelated-${i}`, sessionId: 'unrelated-session' })));
      rows = null;
      db.close();
      db.version(2).stores({ messages: `${initialSchema},${metadataIndex}` });
      const migrationStarted = performance.now();
      await db.open();
      const indexUpgradeMs = rounded(performance.now() - migrationStarted);
      const rawSourceAfter = await db.messages.bulkGet(imageIds);
      const rawSourcePreserved = JSON.stringify(rawSourceBefore) === JSON.stringify(rawSourceAfter);
      if (!rawSourcePreserved || await db.messages.count() !== count + 17) throw Error('Schema-only index upgrade changed source values');
      const native = db.backendDB();
      const bounds = (last, metadata) => IDBKeyRange.bound(
        last ?? (metadata ? [sid, -Infinity, '', -Infinity] : [sid, -Infinity, '']),
        metadata ? [sid, Infinity, [], Infinity] : [sid, Infinity, []], Boolean(last), false,
      );
      let recordsSample = null;
      if (supportsRecords) {
        const tx = native.transaction('messages', 'readonly');
        const done = complete(tx);
        const sample = await requestResult(tx.objectStore('messages').index(metadataIndex).getAllRecords({ count: 1, query: bounds(null, true) }));
        await done;
        recordsSample = {
          fields: ['key', 'primaryKey', 'value'].filter(field => field in sample[0]), key: sample[0].key, primaryKey: sample[0].primaryKey,
          includesFullBody: sample[0].value?.content === rawSourceBefore[0].content,
          bodyChars: sample[0].value?.content?.length ?? null,
        };
      }
      const scan = async method => {
        let last = null;
        const stats = { method: method.name, pageSize: method.pageSize, rows: 0, keyRows: 0, bodyRows: 0, contentChars: 0, pages: 0, requests: 0, cursorSuccessEvents: method.type === 'dexie-keys' ? null : 0, maximumRetainedPageRows: 0, orderedExact: true, checksum: 0 };
        const consume = (key, body) => {
          const index = Number(key[2].slice(2));
          if (key[0] !== sid || index !== stats.rows || key[1] !== Math.floor(index / 3)) throw Error(`Ordering/session leakage in ${method.name}: ${JSON.stringify(key)}`);
          const length = key.length === 4 ? key[3] : body.content.length;
          if (length !== 320 + index % 7) throw Error('Unexpected source length');
          stats.rows++; stats.keyRows += Number(!body); stats.bodyRows += Number(!!body);
          stats.contentChars += length;
          stats.checksum = (stats.checksum + Math.imul(index + 1, length)) >>> 0;
        };
        const heapBefore = heap();
        const started = performance.now();
        while (true) {
          let batch;
          stats.requests++;
          if (method.type === 'dexie-body' || method.type === 'dexie-keys') {
            const metadata = method.type === 'dexie-keys';
            const query = db.messages.where(metadata ? metadataIndex : chronologicalIndex).between(
              last ?? (metadata ? [sid, Dexie.minKey, Dexie.minKey, Dexie.minKey] : [sid, Dexie.minKey, Dexie.minKey]),
              metadata ? [sid, Dexie.maxKey, Dexie.maxKey, Dexie.maxKey] : [sid, Dexie.maxKey, Dexie.maxKey], !last, true,
            ).limit(method.pageSize);
            batch = metadata ? await query.keys() : await query.toArray();
            for (const row of batch) consume(metadata ? row : [row.sessionId, row.createdAt, row.id], metadata ? null : row);
            if (batch.length) {
              const row = batch.at(-1);
              last = metadata ? row : [row.sessionId, row.createdAt, row.id];
            }
          } else {
            const metadata = method.type !== 'native-body';
            const tx = native.transaction('messages', 'readonly');
            const done = complete(tx);
            const index = tx.objectStore('messages').index(metadata ? metadataIndex : chronologicalIndex);
            if (method.type === 'native-key-cursor') {
              batch = await new Promise((resolve, reject) => {
                const values = [];
                const request = index.openKeyCursor(bounds(last, true));
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                  stats.cursorSuccessEvents++;
                  const cursor = request.result;
                  if (!cursor) return resolve(values);
                  values.push(cursor.key);
                  if (values.length >= method.pageSize) return resolve(values);
                  cursor.continue();
                };
              });
              for (const key of batch) consume(key, null);
              if (batch.length) last = batch.at(-1);
            } else if (method.type === 'native-records') {
              batch = await requestResult(index.getAllRecords({ count: method.pageSize, query: bounds(last, true) }));
              for (const record of batch) consume(record.key, record.value);
              if (batch.length) last = batch.at(-1).key;
            } else {
              batch = await requestResult(index.getAll(bounds(last, false), method.pageSize));
              for (const row of batch) consume([row.sessionId, row.createdAt, row.id], row);
              if (batch.length) { const row = batch.at(-1); last = [row.sessionId, row.createdAt, row.id]; }
            }
            await done;
          }
          if (batch.length) stats.pages++;
          stats.maximumRetainedPageRows = Math.max(stats.maximumRetainedPageRows, batch.length);
          if (batch.length < method.pageSize) break;
        }
        const elapsedMs = rounded(performance.now() - started);
        const heapAfter = heap();
        if (stats.rows !== count || stats.contentChars !== expectedChars) throw Error(`Lost/repeated rows in ${method.name}`);
        return { ...stats, elapsedMs, heapBeforeBytes: heapBefore, heapAfterBytes: heapAfter, heapDeltaBytes: heapBefore === null ? null : heapAfter - heapBefore };
      };
      const samples = [];
      // Rotate each round so no method always gets the same cache/order position.
      for (let repeat = 0; repeat < repeats; repeat++) {
        const order = methods.slice(repeat % methods.length).concat(methods.slice(0, repeat % methods.length));
        for (const method of order) {
          const sample = await scan(method);
          samples.push({ repeat, ...sample });
          console.log(JSON.stringify({ count, repeat, method: method.name, elapsedMs: sample.elapsedMs, bodyRows: sample.bodyRows, keyRows: sample.keyRows }));
        }
      }
      const medians = methods.map(method => {
        const selected = samples.filter(row => row.method === method.name);
        const times = selected.map(row => row.elapsedMs).sort((a, b) => a - b);
        return { method: method.name, medianMs: times[Math.floor(times.length / 2)], minMs: times[0], maxMs: times.at(-1), bodyRows: selected[0].bodyRows, keyRows: selected[0].keyRows, pages: selected[0].pages };
      });
      const baseline = medians.find(row => row.method === 'dexie-body-64').medianMs;
      for (const row of medians) row.relativeToBody64 = rounded(row.medianMs / baseline);
      results.push({ count, unrelatedRows: 17, chineseBodyCharacters: '320–326', expectedChars, indexUpgradeMs, rawSourcePreserved, rawSourceImage: { before: rawSourceBefore, after: rawSourceAfter }, recordsSample, medians, samples });
      db.close(); await db.delete();
    }
    return { supportsRecords, getAllRecordsCaveat: 'IDBIndex.getAllRecords returns key, primaryKey and full value, so this path reads/deserializes source bodies and is not a key-only metadata API.', dexieVersion: Dexie.semVer, userAgent: navigator.userAgent, results };
  }, { counts, repeats });
  report = { ...report, ...result, complete: true, browserVersion: browser.version(), blockedRequests };
  const overview = report.results.map(result => ({ count: result.count, indexUpgradeMs: result.indexUpgradeMs, rawSourcePreserved: result.rawSourcePreserved, medians: result.medians }));
  await page.evaluate(({ overview, supportsRecords, browserVersion, dexieVersion }) => {
    const container = document.querySelector('#report');
    const heading = document.createElement('p');
    heading.textContent = `Chrome ${browserVersion} · Dexie ${dexieVersion} · 3 trials/method · 320–326 Chinese characters/body`;
    container.replaceWith(heading);
    const explanation = document.createElement('p');
    explanation.textContent = `Median milliseconds; heap is before/after snapshots, not peak. getAllRecords supported: ${supportsRecords}; it returns full bodies.`;
    heading.after(explanation);
    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;width:100%;background:white;font-variant-numeric:tabular-nums';
    const header = table.insertRow();
    for (const text of ['Method', '1,000 rows', '10,000 rows', '50,000 rows', 'Body rows at 50k', 'Key-only rows at 50k']) {
      const cell = document.createElement('th'); cell.textContent = text; cell.style.cssText = 'padding:14px;border-bottom:2px solid #cbd5e1;text-align:left'; header.append(cell);
    }
    for (const method of overview[0].medians.map(row => row.method)) {
      const row = table.insertRow();
      const medians = overview.map(scale => scale.medians.find(row => row.method === method));
      for (const text of [method, ...medians.map(row => row.medianMs.toFixed(1)), medians.at(-1).bodyRows, medians.at(-1).keyRows]) {
        const cell = row.insertCell(); cell.textContent = String(text); cell.style.cssText = 'padding:14px;border-bottom:1px solid #e2e8f0';
      }
    }
    explanation.after(table);
    const note = document.createElement('p');
    note.textContent = 'Every scan checked exact row order, session scope, length and row count. Schema-only upgrade preserved three representative raw source snapshots. Synthetic desktop measurements do not establish Android latency or source authorization correctness.';
    table.after(note);
  }, { overview, supportsRecords: report.supportsRecords, browserVersion: report.browserVersion, dexieVersion: report.dexieVersion });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  report.evidenceScreenshot = screenshotPath;
} catch (error) {
  report.error = error.stack; process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ path: outputPath, complete: report.complete, error: report.error, browserVersion: report.browserVersion, supportsRecords: report.supportsRecords, overview: report.results?.map(row => ({ count: row.count, indexUpgradeMs: row.indexUpgradeMs, medians: row.medians })) }));
}
