import { createRoot } from 'react-dom/client';
import { db, type Message, type Character } from '../../src/db';
import { createSecretary, dismissSecretary } from '../../src/lib/secretary/character';
import { runSecretaryRequest, secretaryReply } from '../../src/lib/secretary/agent';
import { updateCharacterDispatch, messagingRecipients, parseDispatchRequest, readCharacterDispatchReplies, recoverCharacterDispatches } from '../../src/lib/secretary/character-messaging';
import { withChatSessionLock } from '../../src/lib/chat/request-coordinator';
import { sendRoleChatReply, type ChatRequest } from '../../src/lib/chat/send-service';
import { ChatReplyStream } from '../../src/lib/chat-stream';
import { messageRepo } from '../../src/db/message-repo';
import { importSecretaryTasks } from '../../src/lib/secretary/archive';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { webApi } from '../../src/lib/web-api';
import { fakeCharacter } from './world-harness';
import { SecretaryTaskCards } from '../../src/components/chat/SecretaryTaskCards';
import { ChatWindow } from '../../src/components/chat/ChatWindow';
import type { SecretaryTask } from '../../src/lib/secretary/types';

const userId = 'dispatch-test-owner';
let assistant: Character, sessionId: string, checks = 0;
let calls: any[] = [], fail = false, hook: (() => Promise<void>) | undefined;
let drafts = 0;
let draftText = '今晚有点事，要晚些回来。你不用等我，先休息。';
let draftHook: (() => Promise<void>) | undefined;
let partial = false;
let expressionReply: string | undefined;
let expressionStreaming = false;
const root = createRoot(document.getElementById('app')!);
webApi.chat.send = async params => {
  calls.push({ characterId: params.character?.id, prompt: params.systemPrompt, message: params.message, history: params.history, model: params.sessionModel });
  if (partial) {
    params.onDelta?.('这是已实际生成的部分回复。');
    await new Promise<void>(resolve => { if (params.signal?.aborted) resolve(); else params.signal?.addEventListener('abort', () => resolve(), { once: true }); });
    partial = false; return { content: '这是已实际生成的部分回复。', interrupted: true };
  }
  if (hook) { const run = hook; hook = undefined; await run(); }
  if (fail) return { error: 'server:error' };
  if (expressionReply !== undefined) {
    if (expressionStreaming) {
      for (const fragment of ['哈哈😂', '---', '怎么了？？', '谁说的？！']) params.onDelta?.(fragment);
    }
    return { content: expressionReply };
  }
  return { content: `实际角色回复${calls.length}：知道了，我会等你的消息。`, usage: { inputTokens: 12, outputTokens: 8 } };
};
webApi.memory.extract = async () => ({ memories: [] });
webApi.context.summarize = async () => ({ error: 'server:error' });
webApi.context.settle = async () => ({ error: 'server:error' });
window.fetch = (async (_input, init) => {
  const prompt = JSON.parse(String(init?.body ?? '{}')).messages?.find((m: any) => m.role === 'system')?.content ?? '';
  if (prompt.includes('只拟写用户要发给软件内角色')) { drafts++; if (draftHook) { const hook = draftHook; draftHook = undefined; await hook(); } }
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ content: draftText }) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;
function ok(value: unknown, label: string) { if (!value) throw new Error(label); checks++; console.log(`ok ${label}`); }
async function rejects(work: () => Promise<unknown>, label: string) { let rejected = false; try { await work(); } catch { rejected = true; } ok(rejected, label); }
function state(task: SecretaryTask) { return task.results[0]?.dispatch!; }
async function request(text: string) {
  const message: Message = { id: crypto.randomUUID(), sessionId, role: 'user', content: text, createdAt: Date.now(), isProactive: false };
  await messageRepo.create(message);
  const task = await runSecretaryRequest(userId, assistant.id, message);
  return { task, message };
}
async function latest(task: SecretaryTask) { return (await db.secretaryTasks.get(state(task).taskId))!; }
async function setup() {
  await db.delete(); await db.open();
  useAuthStore.getState().login(userId, '测试', 'sk-fake', '');
  useSettingsStore.setState({ diaryPin: null, aiVoiceMode: false, defaultModel: { provider: 'deepseek', model: 'deepseek-v4-flash' } });
  assistant = await createSecretary(userId, '晴');
  sessionId = 'assistant-session';
  const now = Date.now();
  await db.sessions.add({ id: sessionId, userId, characterId: assistant.id, title: '助理', createdAt: now, updatedAt: now, unreadCount: 0, modelAsked: true });
  const target = fakeCharacter('moon', '小月', userId, { systemPrompt: '小月专属人设：爱看星星，讲话简洁。', voice: undefined });
  await db.characters.bulkAdd([target, fakeCharacter('foreign', '别人', 'foreign'), fakeCharacter('preset', '模板', userId, { isPreset: true })]);
  await db.sessions.add({ id: 'moon-session', userId, characterId: target.id, title: '小月', createdAt: now, updatedAt: now, unreadCount: 0, modelAsked: true, model: { provider: 'deepseek', model: 'deepseek-v4-flash' } });
  useChatStore.setState({ selectedCharacterId: assistant.id, currentSessionId: sessionId, characters: [assistant, target], messages: [], charPreviews: {}, unreadByCharacter: {} });
  calls = []; drafts = 0; fail = false; hook = undefined; partial = false; expressionReply = undefined; expressionStreaming = false;
}
async function runChecks() {
  await setup(); checks = 0;
  ok((await messagingRecipients(userId)).map(c => c.id).join() === 'moon', 'recipient list excludes assistant, foreign account and unadded templates');
  for (const text of ['不要给小月发：你好', '例如给小月发：你好', '解释“给小月发：你好”', '朋友说给小月发：你好']) ok(!parseDispatchRequest(text), 'quoted or negated text cannot authorize sending');
  let { task, message } = await request('给小月发：我今晚晚点回来。');
  ok(state(task).state === 'replied', 'literal command commits actual recipient reply');
  const outbound = (await db.messages.get(state(task).outboundMessageId!))!;
  ok(outbound.content === '我今晚晚点回来。' && outbound.sessionId === 'moon-session', 'literal body preserved exactly in real target conversation');
  ok(outbound.secretaryDispatch?.assistantName === '晴', 'user message carries relay provenance without changing body');
  ok(calls.length === 1 && calls[0].characterId === 'moon' && calls[0].prompt.includes('小月专属人设'), 'target uses its own prompt, not secretary impersonation');
  ok(calls[0].model.model === 'deepseek-v4-flash', 'target conversation model respected');
  ok(!calls[0].prompt.includes('给小月发：') && calls[0].message === outbound.content, 'secretary instruction not injected as recipient history');
  ok(useChatStore.getState().currentSessionId === sessionId && useChatStore.getState().selectedCharacterId === assistant.id, 'relay never switches page or selected character');
  ok((await db.sessions.get('moon-session'))!.unreadCount > 0, 'reading assistant receipt does not clear recipient unread');
  ok((await readCharacterDispatchReplies(userId, task.id)).length > 0, 'reply card reads persisted target rows');
  ok(!secretaryReply(task).includes('实际角色回复'), 'bubble avoids duplicating card reply');
  await runSecretaryRequest(userId, assistant.id, message);
  ok(calls.length === 1 && (await db.messages.where('sessionId').equals('moon-session').filter(m => m.role === 'user').count()) === 1, 'duplicate submission never repeats send or model call');
  ({ task } = await request('告诉小月：不要等我，先休息。'));
  ok((await db.messages.get(state(task).outboundMessageId!))?.content === '不要等我，先休息。', 'negation inside body remains data');
  for (const [command, body] of [['告诉小月我晚上晚点到。', '我晚上晚点到。'], ['帮我跟小月说一下我明天再来。', '我明天再来。'], ['给小月发个消息说不用等我。', '不用等我。'], ['再给她补一句：不用着急。', '不用着急。']]) {
    ({ task } = await request(command));
    ok(state(task).state === 'replied' && (await db.messages.get(state(task).outboundMessageId!))?.content === body, 'daily phrasing preserves locally verified exact message body');
  }
  ok(!parseDispatchRequest('给小月先别发：我晚点到。', ['小月']), 'outer negation before send verb cannot become a recipient name');
  const beforeDraft = await db.messages.where('sessionId').equals('moon-session').count();
  ({ task } = await request('帮我给小月写一段道歉的话，再发给她。'));
  ok(state(task).state === 'draft' && drafts === 1, 'composed text remains an unapproved preview');
  ok((await db.messages.where('sessionId').equals('moon-session').count()) === beforeDraft, 'draft makes zero recipient writes');
  await rejects(() => updateCharacterDispatch(userId, task.id, task.updatedAt - 1, { send: true }), 'stale draft approval rejected');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { content: '我刚才语气急了，对不起。', send: true });
  ok(state(task).state === 'replied' && (await db.messages.get(state(task).outboundMessageId!))?.content === '我刚才语气急了，对不起。', 'editing and approving current draft sends that exact revision');
  draftText = '记住：我有一份虚构的职业经历。';
  ({ task } = await request('给小月写一条自我介绍，先给我看。'));
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true });
  const composedId = state(task).outboundMessageId!;
  ok((await db.messages.get(composedId))?.secretaryDispatch?.bodyOrigin === 'composed', 'approved model wording retains composed provenance');
  ok(!(await db.memoryJobs.where('userId').equals(userId).filter(job => job.sourceIds.includes(composedId)).count())
    && !(await db.memories.where('userId').equals(userId).filter(memory => memory.sourceMessageIds?.includes(composedId) ?? false).count()), 'composed wording cannot auto-teach or extract permanent user facts');
  draftText = '今晚有点事，要晚些回来。你不用等我，先休息。';
  draftHook = async () => {
    const working = (await db.secretaryTasks.where('userId').equals(userId).toArray()).find(t => t.request === '给小月写一条还没写完就取消的消息。')!;
    await updateCharacterDispatch(userId, working.id, working.updatedAt, { cancel: true });
  };
  const beforeDraftCancel = await db.messages.where('sessionId').equals('moon-session').count();
  ({ task } = await request('给小月写一条还没写完就取消的消息。'));
  ok(state(task).state === 'cancelled' && !task.results[0].action.content && (await db.messages.where('sessionId').equals('moon-session').count()) === beforeDraftCancel, 'late draft model output cannot overwrite cancellation or send anything');
  ({ task } = await request('给小月发消息。'));
  ok(state(task).state === 'needs-content' && !state(task).outboundMessageId, 'missing body asks specifically and makes zero sends');
  ({ task } = await request('明天见。'));
  ok(state(task).state === 'replied' && task.id !== state(task).taskId, 'short follow-up continues canonical dispatch');
  ok((await db.messages.get(state(task).outboundMessageId!))?.content === '明天见。', 'short answer is recipient body, not todo title');
  const previousCalls = calls.length;
  ({ task } = await request('她回我什么了？'));
  ok(calls.length === previousCalls && (await readCharacterDispatchReplies(userId, state(task).taskId)).length > 0, 'asking for actual reply causes neither resend nor extra model call');
  ({ task } = await request('给小月发消息。'));
  const beforeCancel = await db.messages.where('sessionId').equals('moon-session').count();
  ({ task } = await request('算了，不发了。'));
  ok(state(task).state === 'cancelled' && (await db.messages.where('sessionId').equals('moon-session').count()) === beforeCancel, 'cancel after missing-body question makes zero target writes');
  ({ task } = await request('给小月写一句晚安的话，先别发。'));
  ({ task } = await request('先放着。'));
  ok(state(task).state === 'paused', 'pause saves body and focus');
  ({ task } = await request('继续刚才那个。'));
  ok(state(task).state === 'draft', 'resume restores same draft without automatic sending');
  task = await latest(task);
  await messageRepo.update(task.messageId, { content: '源请求已改' });
  await rejects(() => updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true }), 'edited source invalidates approval');
  await db.characters.add(fakeCharacter('moon-two', '小月', userId, { voice: undefined, signature: '另一个同名角色' }));
  await db.sessions.add({ id: 'moon-two-session', characterId: 'moon-two', userId, title: '同名', createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0, modelAsked: true });
  ({ task } = await request('给小月发：你好。'));
  ok(state(task).state === 'needs-recipient' && state(task).candidates?.length === 2 && !state(task).outboundMessageId, 'duplicate names require explicit recipient choice');
  ({ task } = await request('第二个'));
  ok(state(task).state === 'replied' && state(task).recipientId === 'moon-two', 'ordinal recipient choice preserves body and authorization');
  await db.characters.delete('moon-two');
  fail = true;
  ({ task } = await request('给小月发：失败时也只发一次。'));
  ok(state(task).state === 'reply-failed' && !!state(task).outboundMessageId && !state(task).replyMessageIds.length, 'failed generation distinguished from saved outbound');
  const originalId = state(task).outboundMessageId, beforeRetry = await db.messages.where('sessionId').equals('moon-session').filter(m => m.role === 'user').count();
  fail = false;
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true });
  ok(state(task).state === 'replied' && state(task).outboundMessageId === originalId, 'retry produces reply on same outbound ID');
  ok((await db.messages.where('sessionId').equals('moon-session').filter(m => m.role === 'user').count()) === beforeRetry, 'retry makes zero duplicate user messages');
  const diaryBlock: { release?: () => void } = {};
  const diaryGate = withChatSessionLock('moon-session', () => new Promise<void>(resolve => { diaryBlock.release = resolve; }));
  while (!diaryBlock.release) await new Promise(resolve => setTimeout(resolve, 1));
  const diaryBefore = await db.messages.where('sessionId').equals('moon-session').count();
  const diaryShare = useChatStore.getState().shareDiaryToCharacter('moon', '这是用户明确分享的一段日记。');
  await new Promise(resolve => setTimeout(resolve, 50));
  ok((await db.messages.where('sessionId').equals('moon-session').count()) === diaryBefore, 'diary sharing does not leak next user body into an active turn');
  diaryBlock.release!(); await diaryGate; await diaryShare;
  const diaryMessage = await db.messages.where('sessionId').equals('moon-session').filter(m => m.role === 'user' && m.content === '这是用户明确分享的一段日记。').first();
  ok(diaryMessage && (await db.messages.where('replyToUserMessageId').equals(diaryMessage.id).count()) > 0 && !useChatStore.getState().pendingDiarySend, 'diary share completes queued real reply without transient page flag');
  useChatStore.setState({ currentSessionId: sessionId, selectedCharacterId: assistant.id, messages: [] });
  useAuthStore.setState({ apiKey: null });
  ({ task } = await request('给小月发：模型未连接时也不假装收到回复。'));
  ok(state(task).state === 'reply-unavailable' && !!state(task).outboundMessageId && !state(task).replyMessageIds.length, 'missing target model route reports recorded message and no generated reply');
  useAuthStore.setState({ apiKey: 'sk-fake' });
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true });
  ok(state(task).state === 'replied' && !state(task).error, 'repairing model route retries reply and clears obsolete error');
  partial = true;
  const partialWork = request('给小月发：中断时保留实际回复。');
  let partialTask: SecretaryTask | undefined;
  for (let i = 0; i < 100 && !partialTask; i++) { partialTask = (await db.secretaryTasks.where('userId').equals(userId).toArray()).find(t => t.request === '给小月发：中断时保留实际回复。' && state(t).state === 'generating'); await new Promise(resolve => setTimeout(resolve, 10)); }
  await new Promise(resolve => setTimeout(resolve, 60));
  partialTask = (await db.secretaryTasks.get(partialTask!.id))!;
  await updateCharacterDispatch(userId, partialTask.id, partialTask.updatedAt, { cancel: true });
  ({ task } = await partialWork);
  ok(state(task).state === 'interrupted' && state(task).replyMessageIds.length > 0, 'stop after a real token preserves interrupted role reply');
  ok((await readCharacterDispatchReplies(userId, task.id)).some(m => m.interrupted && m.content.includes('实际生成')), 'partial card quotes the committed partial instead of invented completion');
  const partialCalls = calls.length;
  await rejects(() => updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true }), 'existing partial reply cannot be silently regenerated or overwritten');
  ok(calls.length === partialCalls && state(await latest(task)).state === 'interrupted', 'rejecting partial retry preserves original interrupted status');
  const release: { run?: () => void } = {};
  const active = withChatSessionLock('moon-session', () => new Promise<void>(resolve => { release.run = resolve; }));
  while (!release.run) await new Promise(resolve => setTimeout(resolve, 1));
  const queued = request('给小月发：排队项不应该提前进入历史。');
  let queuedTask: SecretaryTask | undefined;
  for (let i = 0; i < 100 && !queuedTask; i++) { queuedTask = (await db.secretaryTasks.where('userId').equals(userId).toArray()).find(t => t.request === '给小月发：排队项不应该提前进入历史。'); await new Promise(resolve => setTimeout(resolve, 10)); }
  ok(queuedTask && state(queuedTask).state === 'queued' && !state(queuedTask).outboundMessageId, 'busy target queues before user message is committed');
  queuedTask = (await db.secretaryTasks.get(queuedTask!.id))!;
  const queueRows = await db.messages.where('sessionId').equals('moon-session').count();
  await updateCharacterDispatch(userId, queuedTask.id, queuedTask.updatedAt, { cancel: true });
  release.run!(); await active; const cancelled = await queued;
  ok(state(cancelled.task).state === 'cancelled' && (await db.messages.where('sessionId').equals('moon-session').count()) === queueRows, 'cancelling queued item yields zero writes after lock releases');
  await db.characters.add(fakeCharacter('new-target', '新人', userId, { voice: undefined }));
  ({ task } = await request('给新人发：新会话你好。'));
  ok(state(task).state === 'needs-model' && !state(task).outboundMessageId, 'new conversation model selection happens before any send');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { model: null, send: true });
  ok(state(task).state === 'replied' && (await db.sessions.get(state(task).targetSessionId!))?.modelAsked, 'default model pick continues saved message once');
  fail = true;
  ({ task } = await request('给小月发：之后删除原消息。'));
  await messageRepo.deleteById(state(task).outboundMessageId!);
  fail = false;
  const deleteCalls = calls.length;
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true });
  ok(calls.length === deleteCalls && state(task).state === 'invalid', 'deleted outbound cannot be recreated by reply retry');
  ({ task } = await request('给小月写一条想念的话，先给我看。'));
  const restore = structuredClone(task); restore.id = 'imported-dispatch'; restore.messageId = crypto.randomUUID(); restore.updatedAt += 1000;
  restore.results[0].dispatch!.taskId = restore.id; restore.results[0].dispatch!.approvedRevision = restore.results[0].dispatch!.draftRevision; restore.results[0].dispatch!.state = 'queued';
  await messageRepo.create({ id: restore.messageId, sessionId, role: 'user', content: restore.request, createdAt: Date.now(), isProactive: false });
  const importCalls = calls.length;
  await importSecretaryTasks(userId, [restore]);
  await recoverCharacterDispatches(userId, assistant.id);
  ok(calls.length === importCalls, 'backup import and recovery perform no network send');
  const restored = (await db.secretaryTasks.get(restore.id))!;
  ok(state(restored).state === 'paused' && !state(restored).approvedRevision, 'import invalidates old sending approval');
  hook = async () => { const source = (await db.secretaryTasks.where('userId').equals(userId).toArray()).find(t => t.request === '给小月发：生成时编辑原请求。')!; await messageRepo.update(source.messageId, { content: '生成期间已改口' }); };
  ({ task } = await request('给小月发：生成时编辑原请求。'));
  ok(!state(task).replyMessageIds.length && !(await readCharacterDispatchReplies(userId, task.id)).length, 'stale model reply cannot commit after source edit');
  ({ task } = await request('给小月写一条问候的话，先别发。'));
  await dismissSecretary(userId, assistant.id, task.employmentId!);
  const employmentCalls = calls.length;
  await rejects(() => updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true }), 'dismissed employment cannot approve old draft');
  ok(calls.length === employmentCalls, 'dismissal never sends pending draft');
  useAuthStore.setState({ userId: 'other' });
  ok((await readCharacterDispatchReplies(userId, task.id)).length === 0 && !(await messagingRecipients(userId)).length, 'switched account cannot view or send previous account dispatch');
  // Ordinary-chat regression through the extracted service with the actual DB.
  useAuthStore.setState({ userId });
  const normal: Message = { id: crypto.randomUUID(), sessionId: 'moon-session', role: 'user', content: '普通聊天依然正常。', createdAt: Date.now(), isProactive: false };
  await messageRepo.create(normal);
  const requestState: ChatRequest = { controller: new AbortController(), userId, stopped: false, completed: false, stream: new ChatReplyStream(normal.sessionId, () => undefined) };
  const moon = (await db.characters.get('moon'))!;
  await withChatSessionLock(normal.sessionId, () => sendRoleChatReply(moon, normal, requestState, { userId, text: normal.content })); requestState.stream.dispose();
  ok((await db.messages.where('sessionId').equals(normal.sessionId).filter(m => m.replyToUserMessageId === normal.id).count()) > 0, 'ordinary character chat still saves actual reply through shared pipeline');
  await runOptimizationChecks();
  await runExpressionPersistenceChecks();
  await runRhythmContinuityChecks();
  await setup(); ({ task } = await request('给小月写一条周末问候，先给我看。'));
  root.render(<SecretaryTaskCards taskId={task.id} />);
  return { checks, taskId: task.id };
}

async function runExpressionPersistenceChecks() {
  for (const streamed of [false, true]) {
    await setup();
    expressionReply = '哈哈😂---怎么了？？谁说的？！';
    expressionStreaming = streamed;
    const moon = (await db.characters.get('moon'))!;
    const send = async (text: string) => {
      const source: Message = { id: crypto.randomUUID(), sessionId: 'moon-session', role: 'user', content: text, createdAt: Date.now(), isProactive: false };
      await messageRepo.create(source);
      const stream = new ChatReplyStream(source.sessionId, () => undefined);
      const requestState: ChatRequest = { controller: new AbortController(), userId, stopped: false, completed: false, stream };
      try { await withChatSessionLock(source.sessionId, () => sendRoleChatReply(moon, source, requestState, { userId, text })); }
      finally { stream.dispose(); }
      return source;
    };
    const source = await send('今天有件离谱的事想跟你说');
    const replies = await db.messages.where('sessionId').equals(source.sessionId).filter(m => m.replyToUserMessageId === source.id).sortBy('createdAt');
    ok(replies.length === 2 && replies[0].content === '哈哈😂' && replies[1].content === '怎么了？？谁说的？！', `${streamed ? 'streamed' : 'buffered'} ordinary pipeline persists separate reaction, emoji and question intensity`);
    ok(calls.length === 1 && replies.every(m => !m.content.includes('\n')), 'natural reaction saves once without quality retry or bubble newline');
    expressionReply = '嗯'; expressionStreaming = false;
    await send('接着聊刚才那件事');
    const history = calls.at(-1).history;
    ok(history.some((m: any) => m.role === 'assistant' && m.content === '哈哈😂') && history.some((m: any) => m.role === 'assistant' && m.content === '怎么了？？谁说的？！'), 'next actual service turn reads preserved expressive bubbles from IndexedDB');
    ok(calls.at(-1).prompt.includes('[人物声音卡]') && !calls.at(-1).prompt.includes('[人物心意：') && !calls.at(-1).prompt.includes('[你的口头禅]'), 'actual ordinary context carries one voice direction without duplicate intent and catchphrase blocks');
  }
}

async function runRhythmContinuityChecks() {
  await setup();
  let moon = (await db.characters.get('moon'))!;
  const send = async () => {
    const source: Message = { id: crypto.randomUUID(), sessionId: 'moon-session', role: 'user', content: '说说你今天想聊的事', createdAt: Date.now(), isProactive: false };
    await messageRepo.create(source);
    const stream = new ChatReplyStream(source.sessionId, () => undefined);
    const requestState: ChatRequest = { controller: new AbortController(), userId, stopped: false, completed: false, stream };
    try { await withChatSessionLock(source.sessionId, () => sendRoleChatReply(moon, source, requestState, { userId, text: source.content })); }
    finally { stream.dispose(); }
  };
  for (const body of ['今天去附近那家书店看看新出的绘本', '这周想去公园走走，看看花开得怎么样', '刚刚听的那首歌不错，我还想再听一遍']) {
    expressionReply = `嗯---${body}`; await send();
  }
  await new Promise(resolve => setTimeout(resolve, 150));
  db.close(); await db.open();
  useChatStore.setState({ messages: [] });
  await db.characters.update('moon', { tags: ['高冷'], catchphrase: '先说正事', systemPrompt: '你是小月。\n称呼：叫用户小友。\n判断习惯：核对事实，不猜别人动机。' });
  moon = (await db.characters.get('moon'))!;
  expressionReply = '行，接着聊。'; await send();
  const prompt = calls.at(-1).prompt;
  ok(prompt.includes('最近三轮都先短后长') && prompt.includes('有真实反应仍可以连发'), 'reopened actual service reads three persisted reply turns and gives optional shape guidance');
  ok(prompt.includes('叫用户小友') && prompt.includes('核对事实，不猜别人动机') && prompt.includes('先说正事'), 'latest edited character voice wins over prior conversation after database reopen');
  ok(calls.length === 4, 'four-turn shape guidance causes no extra generation or quality retry');
  ok((await db.sessions.get('moon-session'))?.conversation?.turnCount === 4 && (await db.messages.where('sessionId').equals('moon-session').filter(m => m.role === 'user').count()) === 4, 'rhythm refinement preserves actual turn state and makes no extra user writes');
}

async function runOptimizationChecks() {
  await setup();
  let { task } = await request('给小月写一句明天见，先给我看。');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { content: '改过的草稿要保留。' });
  ok(state(task).state === 'draft' && task.results[0].action.content === '改过的草稿要保留。' && !state(task).approvedRevision, 'save edited draft persists exact text without approval');
  ok(!(await db.messages.where('sessionId').equals('moon-session').count()) && !calls.length, 'saving a draft creates zero target messages and model replies');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { content: '暂停时刚刚编辑的新内容。', pause: true });
  ok(state(task).state === 'paused' && task.results[0].action.content === '暂停时刚刚编辑的新内容。', 'pause atomically saves current unsent edits');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { content: '暂停期间又改了一次。' });
  ok(state(task).state === 'paused' && task.results[0].action.content === '暂停期间又改了一次。', 'saving paused draft keeps it paused');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { resume: true });
  ok(state(task).state === 'draft' && !state(task).approvedRevision && !calls.length, 'resume editing never approves or sends');
  const stale = task.updatedAt;
  ({ task } = await request('正文改为：算了，不用了。'));
  task = await latest(task);
  ok(state(task).state === 'draft' && task.results[0].action.content === '算了，不用了。', 'explicit body change treats cancellation words as literal data');
  await rejects(() => updateCharacterDispatch(userId, task.id, stale, { send: true }), 'conversational draft edit invalidates old displayed approval');
  ({ task } = await request('再补一句：你先休息。'));
  task = await latest(task);
  ok(task.results[0].action.content === '算了，不用了。\n你先休息。' && !calls.length, 'append to unsent draft preserves previous text without sending');
  await db.characters.add(fakeCharacter('star', '小星', userId, { voice: undefined }));
  await db.sessions.add({ id: 'star-session', characterId: 'star', userId, title: '小星', createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0, modelAsked: true });
  ({ task } = await request('不是给小月，是给小星。'));
  task = await latest(task);
  ok(state(task).recipientId === 'star' && state(task).state === 'draft' && task.results[0].action.content?.includes('你先休息'), 'recipient correction preserves body and requires approval');
  ({ task } = await request('发吧'));
  ok(state(task).state === 'replied' && (await db.messages.get(state(task).outboundMessageId!))?.sessionId === 'star-session'
    && !(await db.messages.where('sessionId').equals('moon-session').count()), 'confirmation sends corrected recipient only, original recipient gets zero writes');
  const readCalls = calls.length;
  ({ task } = await request('发出去了吗？'));
  ok(state(task).state === 'replied' && calls.length === readCalls, 'send status is read from actual dispatch without any resend');
  ({ task } = await request('她回了吗？'));
  ok(state(task).state === 'replied' && calls.length === readCalls, 'natural reply status question remains read only');
  ({ task } = await request('给小月发消息。'));
  ({ task } = await request('正文：明天见。'));
  ok(state(task).state === 'replied' && (await db.messages.get(state(task).outboundMessageId!))?.content === '明天见。', 'missing-body answer strips explicit field prefix without copying it into chat');
  ({ task } = await request('给小月写一句晚安，先给我看。'));
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { content: '', recipientId: '', pause: true });
  ok(state(task).state === 'paused' && !task.results[0].action.content && !state(task).recipientId, 'incomplete paused draft can be saved without invented fields');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { resume: true });
  ok(state(task).state === 'needs-recipient' && !state(task).outboundMessageId, 'resume incomplete draft asks the actual missing field');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { recipientId: 'moon', content: '' });
  ok(state(task).state === 'needs-content', 'empty saved body has explicit missing-content state');
  const incompleteRows = await db.messages.where('sessionId').equals('moon-session').count();
  await rejects(() => updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true }), 'cannot approve an empty saved body');
  ok((await db.messages.where('sessionId').equals('moon-session').count()) === incompleteRows, 'empty body rejection creates zero target records');
  fail = true;
  ({ task } = await request('给小月发：仅重试角色回复。'));
  const outboundId = state(task).outboundMessageId;
  const retryRows = await db.messages.where('sessionId').equals('moon-session').filter(m => m.role === 'user').count();
  fail = false;
  ({ task } = await request('只重试回复'));
  ok(state(task).state === 'replied' && state(task).outboundMessageId === outboundId, 'spoken reply retry continues canonical dispatch and original message');
  ok((await db.messages.where('sessionId').equals('moon-session').filter(m => m.role === 'user').count()) === retryRows, 'spoken reply retry does not duplicate user message');
  await db.characters.add(fakeCharacter('new-edit-target', '小云', userId, { voice: undefined }));
  ({ task } = await request('给小云发：还未选模型的原话。'));
  ok(state(task).state === 'needs-model', 'new target waits for model before editing');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { content: '选模型前已修改正文。' });
  ok(state(task).state === 'draft' && !state(task).approvedRevision && !state(task).outboundMessageId, 'saving model-pending edits revokes old literal approval');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { send: true });
  ok(state(task).state === 'needs-model' && !state(task).outboundMessageId, 'confirming edited new-session draft still requires model choice');
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { model: null, content: '选模型时最后修改的正文。', send: true });
  ok(state(task).state === 'replied' && (await db.messages.get(state(task).outboundMessageId!))?.content === '选模型时最后修改的正文。', 'model choice sends exactly final displayed edited body');
  await db.characters.add(fakeCharacter('final-target', '小雨', userId, { voice: undefined }));
  ({ task } = await request('给小云写一句问候，先给我看。'));
  const oldCloud = (await db.sessions.get((await db.sessions.where('[characterId+userId]').equals(['new-edit-target', userId]).first())!.id))!;
  task = await updateCharacterDispatch(userId, task.id, task.updatedAt, { recipientId: 'final-target', content: '实际上给小雨的内容。', model: { provider: 'deepseek', model: 'deepseek-v4-flash' }, send: true });
  ok(state(task).state === 'replied' && state(task).recipientId === 'final-target' && (await db.messages.get(state(task).outboundMessageId!))?.content === '实际上给小雨的内容。', 'recipient and model changes atomically bind final approval to final target');
  ok((await db.sessions.get(oldCloud.id))?.model?.model === oldCloud.model?.model && (await db.sessions.get(state(task).targetSessionId!))?.characterId === 'final-target', 'changing recipient with model selection leaves original conversation model untouched');
}
(window as any).characterMessaging = { runChecks, setup, request, state, calls: () => calls, records: (session = 'moon-session') => db.messages.where('sessionId').equals(session).toArray(),
  mountCard: (taskId: string) => root.render(<SecretaryTaskCards taskId={taskId} />),
  remountCard: async (taskId: string) => { root.render(<div />); await new Promise(resolve => setTimeout(resolve, 50)); root.render(<SecretaryTaskCards taskId={taskId} />); },
  mountChat: async () => { useChatStore.setState({ messages: await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt') }); root.render(<ChatWindow />); },
  task: (id: string) => db.secretaryTasks.get(id),
  newerSession: async () => { await db.sessions.add({ id: 'newer-moon-session', userId, characterId: 'moon', title: '后来的聊天', createdAt: Date.now() + 1000, updatedAt: Date.now() + 1000, unreadCount: 0, modelAsked: true }); },
  selectedSession: () => useChatStore.getState().currentSessionId,
  mountCurrentChat: () => root.render(<ChatWindow />),
  disableAssistantRoute: async () => {
    assistant = { ...assistant, model: { provider: 'qwen', model: 'qwen3.7-plus' } };
    await db.characters.put(assistant);
    useChatStore.setState(s => ({ characters: s.characters.map(c => c.id === assistant.id ? assistant : c) }));
  },
};
