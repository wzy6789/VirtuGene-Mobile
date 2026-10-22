import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Isolated native index characterization</title>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let report;
try {
  const context = await browser.newContext({ permissions: [] });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(origin);
  report = await page.evaluate(async () => {
    const name = 'summary-native-keypath-characterization-' + crypto.randomUUID();
    const requestResult = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const completed = transaction => new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error ?? Error('transaction aborted')); transaction.onerror = () => {}; });
    const open = version => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => {
        if (version === 42) {
          const messages = request.result.createObjectStore('messages', { keyPath: 'id' });
          messages.createIndex('sourceEvidenceKey', 'sourceEvidenceKey');
        } else {
          const messages = request.transaction.objectStore('messages');
          messages.createIndex('summaryNativeLength', ['sessionId', 'id', 'content.length']);
          messages.createIndex('nativeBoolean', ['sessionId', 'id', 'failed']);
        }
      };
      return requestResult(request);
    };
    let database = await open(42);
    const original = { id: 'chosen', sessionId: 's', content: '正文🌙'.repeat(1000), sourceEvidenceKey: JSON.stringify(['s', 1, true, 'chosen']), extension: { preserve: true } };
    const initial = database.transaction('messages', 'readwrite');
    initial.objectStore('messages').put(original);
    await completed(initial);
    database.close();
    database = await open(43);
    const keys = async indexName => {
      const transaction = database.transaction('messages', 'readonly');
      return requestResult(transaction.objectStore('messages').index(indexName).getAllKeys());
    };
    const hasLength = async length => {
      const transaction = database.transaction('messages', 'readonly');
      return !!await requestResult(transaction.objectStore('messages').index('summaryNativeLength').getKey(['s', 'chosen', length]));
    };
    const read = async () => {
      const transaction = database.transaction('messages', 'readonly');
      return requestResult(transaction.objectStore('messages').get('chosen'));
    };
    const write = async value => {
      const transaction = database.transaction('messages', 'readwrite');
      transaction.objectStore('messages').put(value);
      await completed(transaction);
    };
    const migrated = await read();
    const afterUpgrade = { indexExists: database.transaction('messages').objectStore('messages').indexNames.contains('summaryNativeLength'), lengthKeyExists: await hasLength(original.content.length), rawRecordPreserved: JSON.stringify(migrated) === JSON.stringify(original), missingRevisionPreserved: !Object.hasOwn(migrated, 'revision') };
    await write({ ...original, content: '短' });
    const afterShortening = { oldLengthKeyExists: await hasLength(original.content.length), newLengthKeyExists: await hasLength(1), storedLength: (await read()).content.length };
    await write({ ...original, failed: false });
    const afterFalse = { nativeBooleanRows: (await keys('nativeBoolean')).length };
    await write({ ...original, failed: true });
    const afterFailure = { staleEvidenceStillFindsSource: (await keys('sourceEvidenceKey')).includes('chosen'), lengthKeyStillFindsSource: await hasLength(original.content.length), nativeBooleanRows: (await keys('nativeBoolean')).length, storedFailed: (await read()).failed };
    database.close();
    await requestResult(indexedDB.deleteDatabase(name));
    if (!afterUpgrade.lengthKeyExists || !afterUpgrade.rawRecordPreserved || afterShortening.oldLengthKeyExists || !afterShortening.newLengthKeyExists || !afterFailure.staleEvidenceStillFindsSource || afterFailure.nativeBooleanRows !== 0) throw Error('Unexpected native IndexedDB semantics; inspect report');
    return { complete: true, afterUpgrade, afterShortening, afterFalse, afterFailure, conclusion: 'Native content.length indexing works with no record rewrite. A boolean failed field cannot be indexed; raw native writes retaining stale derived sourceEvidenceKey cannot be detected by the length index.', paidCalls: 0, scope: 'Fresh browser profile, synthetic IndexedDB only; no application source imported or changed, no model/microphone/Android access.' };
  });
} catch (error) { report = { complete: false, error: error.stack, paidCalls: 0 }; process.exitCode = 1; }
finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  const directory = 'release/chat-summary-source-index-20261019';
  mkdirSync(directory, { recursive: true });
  const path = `${directory}/native-characterization-${Date.now()}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ path, ...report }));
}
