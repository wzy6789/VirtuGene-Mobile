/** Adversarial audit, isolated browser database, all model boundaries stubbed. */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '../../src/db/index';
import { worldRepo } from '../../src/db/world-repo';
import { worldSceneRepo } from '../../src/db/world-scene-repo';
import { worldEventRepo } from '../../src/db/world-event-repo';
import { knowledgeRepo } from '../../src/db/knowledge-repo';
import { memoryRepo } from '../../src/db/memory-repo';
import { memoryLedgerRepo } from '../../src/db/memory-ledger-repo';
import { messageRepo } from '../../src/db/message-repo';
import { sessionRepo } from '../../src/db/session-repo';
import { diaryRepo } from '../../src/db/diary-repo';
import { setDiarySharing } from '../../src/lib/world/diary-visibility';
import { buildCharacterMemoryContext } from '../../src/lib/character-memory';
import { buildWorldContext, renderCharacterContext } from '../../src/lib/world/world-context';
import { finishSceneAndSettle } from '../../src/lib/world/scene-runtime';
import { recallHistoricalPrivateChat } from '../../src/lib/character-history-recall';
import { processMemoryJobs } from '../../src/lib/memory-jobs';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { webApi } from '../../src/lib/web-api';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { ChatWindow } from '../../src/components/chat/ChatWindow';

const report = window.fetch.bind(window);
const lines: string[] = [];
let failures = 0;
let controls = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++; else controls++;
  lines.push(`${ok ? 'ok' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const U = 'audit-user'; const A = 'audit-a'; const B = 'audit-b';
let now = Date.now(); let worldId = ''; let prompt = ''; let calls = 0;
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement | undefined;
const character = (id: string) => ({ id, createdBy: U, name: id, systemPrompt: '你说话直接。', avatar: '🌙', voice: { ...DEFAULT_VOICE }, tags: [], proactivity: 0, isCustom: true, isPreset: false, published: false, signature: '', greeting: '', createdAt: now });
const recall = (id: string, topic: string, extra: object = {}) => buildCharacterMemoryContext({ userId: U, characterId: id, topic, ...extra });
const closeUI = () => { root?.unmount(); host?.remove(); root = undefined; host = undefined; };
async function sendUI(text: string, previousReferences: { source: string; id: string }[] = []) {
  closeUI();
  const sid = `audit-ui-${calls}-${Date.now()}`;
  await db.sessions.put({ id: sid, characterId: A, userId: U, createdAt: now, updatedAt: now } as any);
  const previousMessages = previousReferences.length ? [{ id: `prior-${sid}`, sessionId: sid, role: 'assistant', content: '刚刚聊过这个安排。', createdAt: now - 10, contextTrace: { crossChannelReferences: previousReferences } }] : [];
  await db.messages.bulkPut(previousMessages as any);
  useAuthStore.setState({ userId: U, username: '测试', apiKey: 'sk-fake', isLoggedIn: true } as any);
  useChatStore.setState({ characters: [character(A), character(B)], selectedCharacterId: A, currentSessionId: sid, messages: previousMessages, hasMoreMessages: false, sending: false } as any);
  host = document.createElement('div'); host.style.height = '900px'; document.body.appendChild(host);
  root = createRoot(host); root.render(createElement(ChatWindow));
  await sleep(700);
  const ta = host.querySelector('textarea')!;
  if (!ta) throw new Error('Fixture: ChatWindow textarea absent');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true })); await sleep(70);
  const before = calls; prompt = '';
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  for (let i = 0; i < 80 && calls === before; i++) await sleep(100);
  if (calls === before) throw new Error('Fixture: real ChatWindow never called the model');
  await sleep(250); const result = prompt; closeUI(); return result;
}

async function run() {
  window.fetch = (() => Promise.reject(new Error('Network prohibited by audit'))) as typeof fetch;
  (webApi.chat as any).send = async (p: any) => { prompt = p.systemPrompt; calls++; return { content: `这是测试回复编号${calls}，今天想去附近走走。`, usage: { inputTokens: 1, outputTokens: 1 }, modelId: 'stub' }; };
  await db.open(); await db.characters.bulkPut([character(A), character(B)] as any);
  worldId = (await worldRepo.ensureDefaultWorld(U)).id;

  // 1. Bringing one's own memory must not grant an earlier private scene transcript.
  const sid = await worldSceneRepo.createScene({ userId: U, worldId, title: '旧片段', place: '屋顶', timeLabel: '晚上', mood: '安静', characterIds: [A], participants: [{ characterId: A, goals: [], knowsEventIds: [], secrets: [], entryMemoryMode: 'memory', enteredAt: now - 1000 }] });
  await worldSceneRepo.setSceneStatus(sid, 'active');
  const secret = 'AUDIT_PREJOIN_SECRET 紫色保险柜密码';
  await worldSceneRepo.appendEntry(sid, { kind: 'user_input', content: secret });
  await sleep(15); await worldSceneRepo.addParticipant(sid, B, { entryMemoryMode: 'memory' });
  const newcomer = await recall(B, '现在聊点什么');
  check('P1 新加入者不能把入场前仅 A 听到的原话当自己记忆', !newcomer.text.includes('AUDIT_PREJOIN_SECRET'));
  await worldSceneRepo.removeParticipant(sid, A);
  const departed = await recall(A, '之前的紫色保险柜密码是什么');
  check('P2 离开星域后 A 仍能回忆自己亲历的原话', departed.text.includes('AUDIT_PREJOIN_SECRET'));
  await worldSceneRepo.appendEntry(sid, { kind: 'user_input', content: 'AUDIT_AFTER_LEAVE 只有留在场上的 B 听到了新的安排。' });
  check('离场期间的新正文不会进入 A 的记忆', !(await recall(A, '还记得新的安排吗')).text.includes('AUDIT_AFTER_LEAVE'));
  await worldSceneRepo.addParticipant(sid, A, { entryMemoryMode: 'memory' });
  const returned = await recall(A, '还记得紫色保险柜和新的安排吗');
  check('重入携带自己的早期记忆', returned.text.includes('AUDIT_PREJOIN_SECRET'));
  check('重入不补齐离场期间别人的记忆', !returned.text.includes('AUDIT_AFTER_LEAVE'));
  await worldSceneRepo.removeParticipant(sid, A);
  const ended = await finishSceneAndSettle({ userId: U, sceneId: sid, apiKey: 'sk-fake',
    callLlm: async () => ({ content: JSON.stringify({ summary: 'B 听到了新的安排。' }) }) });
  check('真实结算成功', Boolean(ended.worldEventId));
  check('结算后离场角色仍能读自己的原话', (await recall(A, '还记得紫色保险柜吗')).text.includes('AUDIT_PREJOIN_SECRET'));
  check('结算后离场角色没有取得全场摘要知情', (await knowledgeRepo.getForCharacterEvent(A, ended.worldEventId!))?.knowledgeLevel === 'partial');
  check('结算后离场角色仍不知后续原话', !(await recall(A, '还记得新的安排吗')).text.includes('AUDIT_AFTER_LEAVE'));
  await worldSceneRepo.deleteScene(sid);

  // 2. Ended scene raw detail is available in the service but omitted by the actual ChatWindow.
  const fs = await worldSceneRepo.createScene({ userId: U, worldId, title: '去哪里', place: '家中', timeLabel: '午后', mood: '平静', characterIds: [A], participants: [{ characterId: A, goals: [], knowsEventIds: [], secrets: [], entryMemoryMode: 'memory', enteredAt: now - 1000 }] });
  const destinationEntry = await worldSceneRepo.appendEntry(fs, { kind: 'user_input', content: '我等下打算去 AUDIT_DESTINATION 商场东门。' });
  const eid = await worldEventRepo.create({ userId: U, worldId, type: 'stage', title: '去哪里', summary: '在家里聊了一会儿。', participants: [`character:${A}`], timestamp: now, sourceType: 'scene', sourceId: fs, visibility: 'selected', visibleTo: [A], resolved: true });
  await knowledgeRepo.upsert({ userId: U, worldId, characterId: A, eventId: eid, knowledgeLevel: 'full', canMention: true });
  await worldSceneRepo.finishScene(fs, eid);
  check('Fixture 统一服务确实读到了已结束星域的原话', (await recall(A, '我等下打算去哪里？', { scene: { worldId } })).text.includes('AUDIT_DESTINATION'));
  check('真实私聊上一轮已用过的星域安排不会在下一轮消失', (await sendUI('我等下打算去哪里？', [{ source: 'world', id: destinationEntry.id }])).includes('AUDIT_DESTINATION'));
  const actual = await sendUI('我等下打算去哪里？');
  check('P3 真实私聊提示词应保留统一服务已召回的星域原话', actual.includes('AUDIT_DESTINATION'));
  check('Control 未参与角色不会收到已结束星域的原话', !(await recall(B, '我等下打算去哪里？', { worldId })).text.includes('AUDIT_DESTINATION'));

  // 3. Old authorized diary: production caller passes scene.worldId, service checks p.worldId only.
  const did = await diaryRepo.create({ userId: U, date: '2025-01-01', title: '旧记录', content: 'AUDIT_OLD_DIARY 今天见了蓝鲸展览。', mood: 3, tags: [] });
  await setDiarySharing({ userId: U, diaryId: did, visibility: 'selected', visibleTo: [A] });
  for (let i = 0; i < 9; i++) {
    const id = await diaryRepo.create({ userId: U, date: `2026-09-${String(i + 10).padStart(2, '0')}`, title: `新记录${i}`, content: '普通生活流水', mood: 3, tags: [] });
    await setDiarySharing({ userId: U, diaryId: id, visibility: 'selected', visibleTo: [A] });
  }
  check('Fixture worldId 口径能检索旧日记', (await recall(A, '还记得日记的蓝鲸展览吗', { worldId })).text.includes('AUDIT_OLD_DIARY'));
  check('P4 scene.worldId 口径也应检索同一份旧日记', (await recall(A, '还记得日记的蓝鲸展览吗', { scene: { worldId } })).text.includes('AUDIT_OLD_DIARY'));
  const diaryPrompt = await sendUI('还记得我日记的蓝鲸展览吗？');
  check('P4b 真实私聊追问旧日记时应出现被明确授权的正文', diaryPrompt.includes('AUDIT_OLD_DIARY'));

  // 4. User correction does not retire old ledger claim or raw history recall.
  await db.sessions.put({ id: 'audit-history', userId: U, characterId: A, createdAt: now, updatedAt: now } as any);
  await messageRepo.create({ id: 'audit-old-turn', sessionId: 'audit-history', role: 'user', content: 'AUDIT_WRONG_CITY 我住在南京。', createdAt: now - 1000, isProactive: false });
  await memoryRepo.create({ id: 'audit-fact', userId: U, characterId: A, type: 'auto', memoryKind: 'fact', content: 'AUDIT_WRONG_CITY 用户住在南京。', sourceSessionId: 'audit-history', sourceMessageIds: ['audit-old-turn'], createdAt: now, updatedAt: now } as any);
  await memoryLedgerRepo.record({ userId: U, value: 'AUDIT_WRONG_CITY 用户住在南京。', memoryKind: 'fact',
    characterIds: [B], source: { type: 'legacy', id: 'audit-independent-B', revision: 1 } });
  await memoryRepo.correctContent('audit-fact', '用户现在住在苏州。', U);
  check('P5 纠正后账本不应仍把南京列为有效事实', !(await memoryLedgerRepo.claimsKnownBy(U, A)).some(x => x.value.includes('AUDIT_WRONG_CITY')));
  check('A 的纠正不撤回 B 独立获得的证据', (await memoryLedgerRepo.claimsKnownBy(U, B)).some(x => x.value.includes('AUDIT_WRONG_CITY')));
  await memoryRepo.deleteById('audit-fact');
  const oldHits = await recallHistoricalPrivateChat({ userId: U, characterId: A, query: '还记得之前我住在南京吗' });
  check('P5b 被纠正/遗忘的事实不能经旧原文不加说明地回流', !oldHits.some(x => x.content.includes('AUDIT_WRONG_CITY')));

  // 5. A delayed summarizer result must recheck source revisions at commit time.
  await messageRepo.create({ id: 'audit-race-msg', sessionId: 'audit-history', role: 'user', content: 'AUDIT_STALE_SUMMARY 旧安排是南京。', createdAt: now, isProactive: false });
  await messageRepo.update('audit-race-msg', { content: '新安排是苏州。' });
  await sessionRepo.updateSummary('audit-history', 'AUDIT_STALE_SUMMARY 旧安排是南京。', undefined, ['audit-race-msg'], { 'audit-race-msg': 1 });
  check('P6 旧 revision 的异步摘要不得在消息修改后写回', !(await db.sessions.get('audit-history'))?.summary?.includes('AUDIT_STALE_SUMMARY'));
  const currentMessage = (await db.messages.get('audit-race-msg'))!;
  check('当前 revision 的合法摘要仍可写入', await sessionRepo.updateSummary('audit-history', '新安排是苏州。', undefined,
    ['audit-race-msg'], { 'audit-race-msg': currentMessage.revision ?? 1 }) === 1);
  const previous = (await db.sessions.get('audit-history'))?.summary;
  let deliver!: () => void;
  const delayed = new Promise<void>(resolve => { deliver = resolve; });
  const pendingWrite = delayed.then(() => sessionRepo.updateSummary('audit-history', '过期异步内容', undefined,
    ['audit-race-msg'], { 'audit-race-msg': currentMessage.revision ?? 1 }, {}, { previousSummary: previous }));
  await messageRepo.update('audit-race-msg', { content: '最后安排是杭州。' }); deliver();
  check('真正异步返回晚于编辑时拒绝写回', await pendingWrite === 0);
  await sessionRepo.update('audit-history', { summary: undefined });

  // 6. Every extracted fact is attached to every batch source, even unrelated ones.
  await db.memoryJobs.clear();
  await db.sessions.put({ id: 'audit-batch', userId: U, characterId: A, createdAt: now, updatedAt: now } as any);
  await messageRepo.create({ id: 'audit-batch-fact', sessionId: 'audit-batch', role: 'user', content: 'AUDIT_BATCH_FACT 我的备用手机号是13800000000。', createdAt: now, isProactive: false });
  await messageRepo.create({ id: 'audit-batch-unrelated', sessionId: 'audit-batch', role: 'user', content: '你好，今天天气不错。', createdAt: now + 1, isProactive: false });
  window.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(['AUDIT_BATCH_FACT 用户备用手机号是13800000000。']) } }] }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  await processMemoryJobs(U, 'sk-audit-fake', 1);
  window.fetch = (() => Promise.reject(new Error('Network prohibited by audit'))) as typeof fetch;
  const batch = (await memoryRepo.getByCharacter(A, U)).find(x => x.content.includes('AUDIT_BATCH_FACT'));
  check('兼容无逐条证据的模型返回时标记整批依赖', !!batch && batch.sourceEvidenceMode === 'dependent');
  await messageRepo.deleteById('audit-batch-fact');
  check('P7 删除唯一真实来源后无关寒暄不能支撑旧事实', !(await memoryRepo.getByCharacter(A, U)).some(x => x.content.includes('AUDIT_BATCH_FACT') && (x.status ?? 'active') === 'active'));
  await db.memoryJobs.clear();
  await messageRepo.create({ id: 'audit-precise-fact', sessionId: 'audit-batch', role: 'user', content: '我喜欢薰衣草。', createdAt: now + 2, isProactive: false });
  await messageRepo.create({ id: 'audit-precise-unrelated', sessionId: 'audit-batch', role: 'user', content: '晚上好。', createdAt: now + 3, isProactive: false });
  window.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([
    { content: 'AUDIT_PRECISE 用户喜欢薰衣草。', sourceIds: ['audit-precise-fact'] },
    { content: 'AUDIT_FORGED 假证据事实。', sourceIds: ['outside-this-batch'] },
  ]) } }] }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  await processMemoryJobs(U, 'sk-audit-fake', 1);
  window.fetch = (() => Promise.reject(new Error('Network prohibited by audit'))) as typeof fetch;
  const precise = (await memoryRepo.getByCharacter(A, U)).find(m => m.content.includes('AUDIT_PRECISE'));
  check('结构化提炼只绑定真正指定的来源', precise?.sourceMessageIds?.join(',') === 'audit-precise-fact');
  check('拒绝模型编造的批次外证据', !(await memoryRepo.getByCharacter(A, U)).some(m => m.content.includes('AUDIT_FORGED')));
  await messageRepo.deleteById('audit-precise-unrelated');
  check('删除无关原话不误伤准确提炼的事实', (await db.memories.get(precise!.id))?.status === 'active');
  await messageRepo.deleteById('audit-precise-fact');
  check('删除精确来源后事实失效', (await db.memories.get(precise!.id))?.status === 'superseded');

  // 7. Unified memory has own posts / reactions; ChatWindow drops all moment references.
  await db.moments.put({ id: 'audit-post', userId: U, authorCharacterId: A, text: 'AUDIT_OWN_POST 我刚买到一本绝版诗集。', mediaIds: [], visibility: 'all', audienceCharacterIds: [A, B], createdAt: now, updatedAt: now } as any);
  await db.momentViews.put({ id: 'audit-view', userId: U, characterId: A, momentId: 'audit-post', viewedAt: now } as any);
  check('Fixture 统一服务能读到角色自己的动态', (await recall(A, '朋友圈你发的诗集是什么')).text.includes('AUDIT_OWN_POST'));
  check('P8 真实私聊不能漏掉角色本人已发布的动态', (await sendUI('朋友圈里，你发的绝版诗集是什么？')).includes('AUDIT_OWN_POST'));

  // 8. Current scene excludes its live data and does not enable non-explicit history lookup.
  const long = await worldSceneRepo.createScene({ userId: U, worldId, title: '长片段', place: '屋顶', timeLabel: '晚上', mood: '安静', characterIds: [A], participants: [{ characterId: A, goals: [], knowsEventIds: [], secrets: [], entryMemoryMode: 'memory', enteredAt: now - 1000 }] });
  await worldSceneRepo.setSceneStatus(long, 'active');
  await worldSceneRepo.appendEntry(long, { kind: 'user_input', content: 'AUDIT_EARLY_GIFT 这盒桂花糕是给你的。' });
  for (let i = 0; i < 65; i++) await worldSceneRepo.appendEntry(long, { kind: 'dialogue', speakerId: A, content: `普通的风景闲谈第${i}段` });
  const sc = (await worldSceneRepo.getScene(long))!;
  const ctx = await buildWorldContext({ userId: U, worldId, scene: sc, characters: [character(A)] as any, userText: '桂花糕给谁的？' });
  check('P9 当前星域普通追问也应回查窗口外的相关原话', renderCharacterContext(ctx, A).includes('AUDIT_EARLY_GIFT') || ctx.recentEntries.some(x => x.content.includes('AUDIT_EARLY_GIFT')));
  const explicitCtx = await buildWorldContext({ userId: U, worldId, scene: sc, characters: [character(A)] as any, userText: '还记得桂花糕给谁的吗？' });
  check('Control 加上还记得即可检索到同一条原话', renderCharacterContext(explicitCtx, A).includes('AUDIT_EARLY_GIFT'));
}

run().catch(e => { failures++; lines.push(`FAIL HARNESS_ERROR ${String(e)} ${(e as Error).stack ?? ''}`); }).finally(async () => {
  closeUI(); const output = `Adversarial memory audit: production unchanged, isolated IndexedDB, stubbed models.\n${lines.join('\n')}\nControls passed=${controls}; failed product requirements=${failures}\n${failures ? `${failures} FAILED` : 'ALL PASS'}`;
  document.body.textContent = output;
  await report('/result?suite=memory-audit-20260926', { method: 'POST', body: output });
});
