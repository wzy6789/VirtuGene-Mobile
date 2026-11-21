import { db, type Character } from '../../src/db';
import { voiceCallRepo } from '../../src/db/voice-call-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { useAuthStore } from '../../src/store/auth-store';
import type { VoiceCallRecord } from '../../src/lib/voice-call/record';
import { collectSyncData, importSyncData } from '../../src/lib/sync';
import { summarizeVoiceCall, chunkCallSummary } from '../../src/lib/voice-call/summary';
import { projectCallMessages } from '../../src/lib/voice-call/record';
import { messageRepo } from '../../src/db/message-repo';
import { memorySourceTombstoneRepo } from '../../src/db/memory-source-tombstone-repo';
import Dexie from 'dexie';
async function main() {
  let checks = 0;
  function check(value: unknown, label: string) { if (!value) throw new Error(label); checks++; }
  await db.open(); useAuthStore.setState({ userId: 'call-owner' });
  const character: Character = { id: 'record-role', name: '阿遥', avatar: '🌙', createdBy: 'call-owner', createdAt: 1, isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '言辞简洁。' };
  await db.characters.put(character);
  await db.sessions.put({ id: 'record-session', characterId: character.id, userId: 'call-owner', title: '通话', type: 'single', createdAt: 1, updatedAt: 1, unreadCount: 0 });
  const record: VoiceCallRecord = { id: 'record-call', userId: 'call-owner', characterId: character.id, sessionId: 'record-session', startedAt: 1, endedAt: 100,
    voice: '茉莉', summaryState: 'pending', messageIds: [], exchanges: [{ turnId: 'turn-one', userText: '请记住我喜欢喝红茶', generatedText: '记住了。下周一起喝。', heardText: '不可信UI台词', interrupted: true,
      segments: [{ id: 'segment-one', turnId: 'turn-one', text: '记住了。', generatedAt: 2, playedAt: 3, playedFrames: 500, interrupted: false },
        { id: 'segment-two', turnId: 'turn-one', text: '下周一起喝。', generatedAt: 2, playedFrames: 100, interrupted: true }], metrics: { turnId: 'turn-one', stoppedAt: 2 } }] };
  const saved = await voiceCallRepo.save(record);
  check(saved.messageIds.length === 2 && saved.exchanges[0].heardText === '记住了。', 'atomic save recomputes heard facts');
  const messages = await db.messages.where('sessionId').equals(record.sessionId).toArray();
  check(messages.length === 2 && !messages.some(row => row.content.includes('下周一起喝')), 'unplayed promise is not a chat fact');
  const jobs = await db.memoryJobs.where('userId').equals(record.userId).toArray();
  check(jobs.length > 0 && jobs.every(job => job.sourceIds.every(id => messages.some(row => row.id === id && row.role === 'user'))), 'original memory worker receives only user evidence');
  await voiceCallRepo.save(record);
  check(await db.messages.where('sessionId').equals(record.sessionId).count() === 2, 'retry does not duplicate messages');
  check(await db.memoryJobs.where('userId').equals(record.userId).count() === jobs.length, 'retry does not duplicate memory jobs');
  await db.close(); await db.open();
  check((await voiceCallRepo.get(record.id, record.userId))?.exchanges[0].generatedText.includes('下周一起喝'), 'audit retains generated-only text separately after reopen');
  const archive = await collectSyncData(record.userId, null);
  check(archive.voiceCalls?.length === 1, 'backup export includes owned call audit');
  await db.voiceCalls.delete(record.id);
  const imported = await importSyncData(archive);
  check(imported.ok && !!(await db.voiceCalls.get(record.id)), 'audit imports only with matching projected messages');
  let summaries = 0;
  await summarizeVoiceCall(record.id, record.userId, new AbortController().signal, { api: { dialogue: async (messages, options) => {
    summaries++; check(!messages[1].content.includes('下周一起喝') && !messages[1].content.includes('不可信UI'), 'summary model receives only heard speech');
    await options.onText('用户表达喜欢喝红茶，角色说记住了。');
  } } });
  check((await db.voiceCalls.get(record.id))?.summaryState === 'ready' && summaries === 1, 'one summary request commits a completed result');
  await summarizeVoiceCall(record.id, record.userId, new AbortController().signal, { api: { dialogue: async () => { summaries++; } } });
  check(summaries === 1, 'completed summary is not charged again');
  useAuthStore.setState({ userId: 'another-owner' });
  check(!(await voiceCallRepo.get(record.id, record.userId)), 'account switch hides audit record');
  try { await voiceCallRepo.save({ ...record, id: 'another-call' }); throw new Error('accepted wrong account'); } catch (error) { check((error as Error).message === 'voice:account_changed', 'cross-account commit is rejected'); }
  useAuthStore.setState({ userId: 'call-owner' });
  await messageRepo.update(saved.messageIds[0], { content: '我改成喜欢白茶' });
  check(!(await db.voiceCalls.get(record.id)), 'editing source clears old audit and summary');
  const importedOld = await importSyncData(archive);
  check(importedOld.ok && !(await db.voiceCalls.get(record.id)), 'old audit cannot resurrect edited source facts');
  await voiceCallRepo.save({ ...record, id: 'session-cleanup-call' });
  let failedSummaries = 0;
  try {
    await summarizeVoiceCall('session-cleanup-call', record.userId, new AbortController().signal, { api: { dialogue: async () => { failedSummaries++; throw new Error('network'); } } });
    throw new Error('network accepted');
  } catch (error) { check((error as Error).message === 'network' && failedSummaries === 1, 'summary failure never retries paid request automatically'); }
  check((await db.voiceCalls.get('session-cleanup-call'))?.summaryState === 'failed', 'failed summary keeps underlying call record');
  const cleanup = await db.voiceCalls.get('session-cleanup-call');
  try {
    await summarizeVoiceCall('session-cleanup-call', record.userId, new AbortController().signal, { api: { dialogue: async (_messages, options) => {
      await messageRepo.deleteById(cleanup!.messageIds[0]); await options.onText('迟到摘要。');
    } } });
    throw new Error('late summary accepted');
  } catch (error) { check((error as Error).message === 'voice:record_changed', 'source deletion during generation rejects late summary'); }
  check(!(await db.voiceCalls.get('session-cleanup-call')), 'deleted source removes original audit data');
  const finalCall = { ...record, id: 'final-cleanup-call' };
  await voiceCallRepo.save(finalCall);
  const longCall: VoiceCallRecord = { ...record, id: 'long-call', exchanges: Array.from({ length: 16 }, (_, index) => ({
    turnId: `long-${index}`, userText: `第${index}段谈公园。${'长通话原文'.repeat(400)}`, generatedText: '未播放部分', heardText: '', interrupted: true, segments: [], metrics: { turnId: `long-${index}`, stoppedAt: index },
  })) };
  await voiceCallRepo.save(longCall);
  const chunks = chunkCallSummary(projectCallMessages(longCall));
  check(chunks.length > 4 && chunks.every(chunk => chunk.text.length <= 8000), 'long call chunks respect a per-request budget');
  check(chunks.flatMap(chunk => chunk.ids).length === 16 && new Set(chunks.flatMap(chunk => chunk.ids)).size === 16, 'long call covers each actual message exactly once');
  let longRequests = 0;
  const longApi = { dialogue: async (_messages: any[], options: any) => { longRequests++; options.onRequest?.(); await options.onText(`第${longRequests}部分整理完成。`); } };
  await summarizeVoiceCall(longCall.id, record.userId, new AbortController().signal, { api: longApi });
  const partialLong = await db.voiceCalls.get(longCall.id);
  check(longRequests === 4 && partialLong?.summaryState === 'partial' && partialLong.summaryParts?.length === 4, 'one long-summary run makes at most four requests and reports partial coverage');
  check(partialLong?.summaryTotalParts === chunks.length && partialLong.usage?.length === 4, 'partial coverage and real-request-shaped receipts persist');
  await summarizeVoiceCall(longCall.id, record.userId, new AbortController().signal, { api: longApi });
  check(longRequests === chunks.length && (await db.voiceCalls.get(longCall.id))?.summaryState === 'ready', 'continuation summarizes only missing chunks');
  await summarizeVoiceCall(longCall.id, record.userId, new AbortController().signal, { api: longApi });
  check(longRequests === chunks.length, 'completed long summary incurs no replacement requests');
  const abortCall = { ...record, id: 'aborted-summary-call' }; await voiceCallRepo.save(abortCall);
  const abortSummary = new AbortController();
  try {
    await summarizeVoiceCall(abortCall.id, record.userId, abortSummary.signal, { api: { dialogue: async (_messages, options) => { options.onRequest?.(); abortSummary.abort(); await options.onText('取消后不应提交的摘要'); } } });
    throw new Error('aborted summary accepted');
  } catch (error) { check((error as Error).name === 'AbortError', 'cancelled summary cannot commit text'); }
  const abortedAudit = await db.voiceCalls.get(abortCall.id);
  check(!abortedAudit?.summary && abortedAudit?.usage?.length === 1, 'cancelled paid-request-shaped attempt remains unknown in audit without late text');
  await voiceCallRepo.save({ ...record, id: 'paging-extra-call' });
  const pageOne = await voiceCallRepo.list(record.sessionId, record.userId, { limit: 2 });
  const pageTwo = await voiceCallRepo.list(record.sessionId, record.userId, { limit: 2, before: pageOne[1].endedAt, beforeId: pageOne[1].id });
  check(pageOne.length === 2 && pageTwo.length === 2 && new Set([...pageOne, ...pageTwo].map(row => row.id)).size === 4, 'history pagination handles shared timestamps without skipping or repeating records');
  const journal: VoiceCallRecord = { ...record, id: 'checkpoint-call', status: 'active', exchanges: [{ ...record.exchanges[0], recordedAt: 70 }] };
  await voiceCallRepo.save(journal);
  let activeRequests = 0;
  try {
    await summarizeVoiceCall(journal.id, record.userId, new AbortController().signal, { api: { dialogue: async () => { activeRequests++; } } });
    throw new Error('active call summarized');
  } catch (error) { check((error as Error).message === 'voice:call_active' && activeRequests === 0, 'unfinished checkpoint cannot trigger a billable summary'); }
  check((await db.voiceCalls.get(journal.id))?.summaryState === 'pending', 'rejecting an unfinished summary does not mark a valid checkpoint failed');
  const firstMessage = await db.messages.get(`voice:${journal.id}:turn-one:user`);
  await voiceCallRepo.save(journal);
  check((await db.voiceCalls.get(journal.id))?.exchanges.length === 1, 'active checkpoint retries do not duplicate turns');
  const appended = { ...journal, endedAt: 200, exchanges: [...journal.exchanges, { ...record.exchanges[0], turnId: 'turn-two', segments: [], userText: '第二轮真实输入', recordedAt: 180 }] };
  await voiceCallRepo.save(appended);
  check((await db.voiceCalls.get(journal.id))?.exchanges.length === 2 && (await db.messages.get(firstMessage!.id))?.createdAt === firstMessage?.createdAt, 'new checkpoint appends a turn without rewriting earlier message time');
  await voiceCallRepo.save(journal);
  check((await db.voiceCalls.get(journal.id))?.exchanges.length === 2, 'late short checkpoint cannot shrink saved history');
  await db.close(); await db.open();
  check((await db.voiceCalls.get(journal.id))?.status === 'active', 'unfinished-call recovery retains committed turns after reopen');
  await voiceCallRepo.save({ ...appended, status: 'ended' });
  check((await db.voiceCalls.get(journal.id))?.status === 'ended', 'hangup finalizes an already checkpointed call');
  await voiceCallRepo.save(journal);
  check((await db.voiceCalls.get(journal.id))?.status === 'ended', 'late active checkpoint cannot reopen an ended call');
  const finalizedArchive = await collectSyncData(record.userId, null);
  await db.voiceCalls.put({ ...journal, messageIds: projectCallMessages(journal).map(row => row.id) });
  check((await importSyncData(finalizedArchive)).ok && (await db.voiceCalls.get(journal.id))?.exchanges.length === 2 && (await db.voiceCalls.get(journal.id))?.status === 'ended', 'sync upgrades an active checkpoint to the verified final call');
  const failedLong = { ...longCall, id: 'failed-long-call' };
  await voiceCallRepo.save(failedLong);
  let attempts = 0;
  try {
    await summarizeVoiceCall(failedLong.id, record.userId, new AbortController().signal, { api: { dialogue: async (_messages, options) => {
      attempts++; options.onRequest?.(); if (attempts === 2) throw new Error('second-chunk-network'); await options.onText('第一段已保存。');
    } } });
    throw new Error('network ignored');
  } catch (error) { check((error as Error).message === 'second-chunk-network' && attempts === 2, 'failure on the second chunk stops without automatic retry'); }
  check((await db.voiceCalls.get(failedLong.id))?.summaryParts?.length === 1, 'successful paid chunk remains cached after later failure');
  await summarizeVoiceCall(failedLong.id, record.userId, new AbortController().signal, { api: { dialogue: async (_messages, options) => { attempts++; options.onRequest?.(); await options.onText('补齐缺失部分。'); } } });
  check(attempts <= 6, 'failure recovery retains the four-request run limit');
  if ((await db.voiceCalls.get(failedLong.id))?.summaryState !== 'ready') await summarizeVoiceCall(failedLong.id, record.userId, new AbortController().signal, { api: { dialogue: async (_messages, options) => { attempts++; options.onRequest?.(); await options.onText('最后缺失部分。'); } } });
  check(attempts === chunks.length + 1 && (await db.voiceCalls.get(failedLong.id))?.summaryState === 'ready', 'explicit continuation never regenerates the previously successful chunk');
  const summaryCommitRaceCases: { boundary: string; action: string; triggered: boolean; requests: number; error: string; summary?: string; partCount: number; usageCount: number; state?: string }[] = [];
  for (const boundary of ['bulkGet', 'last-tombstone', 'update'] as const) {
    for (const action of ['abort', 'account-switch'] as const) {
      const raceCall = await voiceCallRepo.save({ ...record, id: `summary-commit-${boundary}-${action}` });
      const cancel = new AbortController();
      let modelFinished = false, triggered = false, requests = 0, error = '';
      const lastSourceId = raceCall.messageIds[raceCall.messageIds.length - 1];
      const originalBulkGet = db.messages.bulkGet;
      const originalBlocksImport = memorySourceTombstoneRepo.blocksImport;
      const originalUpdate = db.voiceCalls.update;
      const trigger = () => {
        if (!modelFinished || triggered) return;
        triggered = true;
        if (action === 'abort') cancel.abort(); else useAuthStore.setState({ userId: 'another-owner' });
      };
      // Complete the real IndexedDB read, then change authority before the caller resumes.
      // This exercises the final transaction after the model has finished, without fake late model callbacks.
      db.messages.bulkGet = async (...args: Parameters<typeof originalBulkGet>) => {
        const rows = await originalBulkGet.apply(db.messages, args);
        if (boundary === 'bulkGet') trigger();
        return rows;
      };
      memorySourceTombstoneRepo.blocksImport = async input => {
        const blocked = await originalBlocksImport.call(memorySourceTombstoneRepo, input);
        if (boundary === 'last-tombstone' && input.sourceId === lastSourceId) trigger();
        return blocked;
      };
      db.voiceCalls.update = async (...args: Parameters<typeof originalUpdate>) => {
        const updated = await originalUpdate.apply(db.voiceCalls, args);
        if (boundary === 'update' && args[0] === raceCall.id) trigger();
        return updated;
      };
      try {
        await summarizeVoiceCall(raceCall.id, record.userId, cancel.signal, { api: { dialogue: async (_messages, options) => {
          requests++; options.onRequest?.(); await options.onText('请求已完成，但取消或切账号后不得提交这段摘要。'); modelFinished = true;
        } } });
      } catch (caught) { error = (caught as Error).name === 'AbortError' ? 'AbortError' : (caught as Error).message; }
      finally {
        db.messages.bulkGet = originalBulkGet; memorySourceTombstoneRepo.blocksImport = originalBlocksImport; db.voiceCalls.update = originalUpdate;
        useAuthStore.setState({ userId: record.userId });
      }
      const audit = await db.voiceCalls.get(raceCall.id);
      summaryCommitRaceCases.push({ boundary, action, triggered, requests, error, summary: audit?.summary,
        partCount: audit?.summaryParts?.length ?? 0, usageCount: audit?.usage?.length ?? 0, state: audit?.summaryState });
    }
  }
  // The no-source path has its own commit transaction and must obey the same cancellation rule.
  const emptyRace = await voiceCallRepo.save({ ...record, id: 'summary-empty-commit-abort', exchanges: [] });
  const emptyCancel = new AbortController();
  const originalEmptyBulkGet = db.messages.bulkGet;
  let emptyReads = 0, emptyRequests = 0, emptyError = '';
  db.messages.bulkGet = async (...args: Parameters<typeof originalEmptyBulkGet>) => {
    const rows = await originalEmptyBulkGet.apply(db.messages, args);
    if (++emptyReads === 2) emptyCancel.abort();
    return rows;
  };
  try {
    await summarizeVoiceCall(emptyRace.id, record.userId, emptyCancel.signal, { api: { dialogue: async () => { emptyRequests++; } } });
  } catch (caught) { emptyError = (caught as Error).name === 'AbortError' ? 'AbortError' : (caught as Error).message; }
  finally { db.messages.bulkGet = originalEmptyBulkGet; }
  const emptyAudit = await db.voiceCalls.get(emptyRace.id);
  summaryCommitRaceCases.push({ boundary: 'empty-source-bulkGet', action: 'abort', triggered: emptyCancel.signal.aborted,
    requests: emptyRequests, error: emptyError, summary: emptyAudit?.summary, partCount: emptyAudit?.summaryParts?.length ?? 0,
    usageCount: emptyAudit?.usage?.length ?? 0, state: emptyAudit?.summaryState });
  (window as any).voiceSummaryCommitRaceCases = summaryCommitRaceCases;
  for (const race of summaryCommitRaceCases) {
    const expectedError = race.action === 'abort' ? 'AbortError' : 'voice:account_changed';
    check(race.triggered && race.requests === (race.boundary === 'empty-source-bulkGet' ? 0 : 1) && race.error === expectedError,
      `${race.boundary}/${race.action}: authority loss during final real DB read/write rejects commit`);
    check(!race.summary && race.partCount === 0 && race.state === 'pending', `${race.boundary}/${race.action}: transaction does not commit late summary text`);
    check(race.usageCount === (race.action === 'abort' && race.requests ? 1 : 0), `${race.boundary}/${race.action}: cancellation retains known request attempt only for the current account`);
  }
  await sessionRepo.deleteById(record.sessionId);
  check(!(await db.voiceCalls.get(finalCall.id)), 'original session deletion removes call audit');
  check(!(await db.messages.where('sessionId').equals(record.sessionId).count()), 'session deletion removes projected chat facts');
  // This runner uses a fresh isolated browser origin; migration does not touch an application database.
  const currentVersion = db.verno;
  const legacySchema = Object.fromEntries(db.tables.filter(table => table.name !== 'voiceCalls').map(table => [table.name,
    [table.schema.primKey.src, ...table.schema.indexes.filter(index => table.name !== 'messages' || index.name !== '[sessionId+createdAt+id]').map(index => index.src)].join(',')]));
  await db.delete();
  const legacy = new Dexie(db.name); legacy.version(32).stores(legacySchema); await legacy.open();
  await legacy.table('characters').put(character);
  await legacy.table('messages').put({ id: 'legacy-voice-original', sessionId: 'legacy-voice-session', role: 'user', content: '升级前的真实原话', revision: 3, createdAt: 10 });
  await legacy.close(); await db.open();
  check(db.verno === currentVersion && (await db.characters.get(character.id))?.name === character.name, 'v32 migration to current schema preserves existing role data');
  const migratedMessage = await db.messages.get('legacy-voice-original');
  check(migratedMessage?.content === '升级前的真实原话' && migratedMessage.revision === 3, 'message index migration preserves original source content and revision');
  check(db.messages.schema.indexes.some(index => index.name === '[sessionId+createdAt+id]'), 'current message ordering index is created from the v32 fixture');
  check(await db.voiceCalls.count() === 0, 'migration creates an empty audit store without fabricating calls');
  return { checks, mode: 'browser-record-and-memory-jobs', summaryCommitRaceCases, realApiCalls: 0, modelTokens: 0, deviceTested: false };
}
main().then(result => { (window as any).voiceProfileResult = result; }).catch(error => { (window as any).voiceProfileResult = { error: String(error), summaryCommitRaceCases: (window as any).voiceSummaryCommitRaceCases }; });
