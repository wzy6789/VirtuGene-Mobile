import { createRoot } from 'react-dom/client';
import { db, type Character, type Message } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { fakeCharacter } from './world-harness';
import { CreateGeneTab } from '../../src/components/character/CreateGeneTab';
import { refreshVoiceSamples, readVoiceSampleCharacter } from '../../src/lib/chat/voice-sample-cache';
import { normalizeVoiceLines, validVoiceSamples, voicePromptRevision, voiceSampleBlock, stripVoiceSampleBlock } from '../../src/lib/character-voice';
import { buildHumanConversationContext } from '../../src/lib/chat-humanizer';
import { cleanupDifference, recordChatQuality, chatQualityReport } from '../../src/lib/chat-quality-metrics';
import { sendRoleChatReply, type ChatRequest } from '../../src/lib/chat/send-service';
import { withChatSessionLock } from '../../src/lib/chat/request-coordinator';
import { ChatReplyStream } from '../../src/lib/chat-stream';
import { webApi } from '../../src/lib/web-api';
import { sendMessage } from '../../src/lib/ai/deepseek';
import { collectSyncData, importSyncData } from '../../src/lib/sync';
import { generateVoiceSamples } from '../../src/lib/ai/character-voice-generator';
import { setGatewayAccessToken } from '../../src/lib/ai/gateway';

const owner = 'voice-test-owner';
const lines = ['称呼：你', '判断习惯：先听具体经过，不猜别人的动机。', '对话样本：用户说今天好累 → 你说今天哪件事最耗神？---先坐一会儿。', '对话样本：用户说真好笑 → 你说哈哈哈😂'];
let checks = 0, calls = 0, malformed = false, closed = false;
let beforeResponse: (() => Promise<void>) | undefined;
let lastSignal: AbortSignal | undefined;
let releaseHeld: (() => void) | undefined;
const bodies: any[] = [];
const prompts: string[] = [];
let retryOnce = false;
function ok(value: unknown, label: string) { if (!value) throw Error(label); checks++; console.log(`ok ${label}`); }
const login = () => useAuthStore.getState().login(owner, '测试', 'sk-fixture', '');
const root = createRoot(document.getElementById('app')!);
window.fetch = (async (_url, init) => {
  calls++; bodies.push(JSON.parse(String(init?.body))); lastSignal = init?.signal ?? undefined;
  if (beforeResponse) { const hook = beforeResponse; beforeResponse = undefined; await hook(); }
  const content = JSON.stringify({ lines: malformed ? ['称呼：你'] : lines });
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;
webApi.chat.send = async params => {
  prompts.push(params.systemPrompt);
  const content = retryOnce ? '很高兴为您服务。' : ['嗯', '啊？', '确实', '哈哈', '好呀'][prompts.length % 5];
  retryOnce = false; params.onRawResponse?.(content); return { content };
};
webApi.context.summarize = async () => ({ error: 'server:error' });
webApi.context.settle = async () => ({ error: 'server:error' });
webApi.memory.extract = async () => ({ memories: [] });
async function legacy(id: string): Promise<Character> {
  const character = fakeCharacter(id, '旧角色', owner, { systemPrompt: '你是安静但有主见的旧角色，不替人猜动机。', greeting: '来了呀', catchphrase: '先听你说', voice: undefined });
  await db.characters.add(character); return character;
}
async function turn(character: Character, text: string) {
  const source: Message = { id: crypto.randomUUID(), sessionId: 'voice-session', role: 'user', content: text, createdAt: Date.now(), isProactive: false };
  await db.messages.add(source);
  useChatStore.getState().addMessage(source);
  const stream = new ChatReplyStream(source.sessionId, () => undefined);
  const request: ChatRequest = { userId: owner, controller: new AbortController(), stream, completed: false, stopped: false };
  try { await withChatSessionLock(source.sessionId, () => sendRoleChatReply(character, source, request, { userId: owner, text })); }
  finally { stream.dispose(); }
}
async function run() {
  await db.delete(); await db.open(); login();
  useSettingsStore.setState({ defaultModel: { provider: 'deepseek', model: 'deepseek-v4-flash' }, aiVoiceMode: false, ttsEnabled: false });
  localStorage.removeItem(`virtugene-chat-quality:${owner}`);
  const old = await legacy('five-rounds');
  const now = Date.now();
  await db.sessions.add({ id: 'voice-session', characterId: old.id, userId: owner, title: old.name, createdAt: now, updatedAt: now, modelAsked: true });
  useChatStore.setState({ characters: [old], currentSessionId: 'voice-session', selectedCharacterId: old.id, messages: [] });
  for (let i = 0; i < 5; i++) { await turn(old, `今天聊第${i}件事`); await refreshVoiceSamples(owner, old.id, 'sk-fixture'); }
  const cached = (await db.characters.get(old.id))!;
  ok(calls === 1 && prompts.length === 5, 'five real DB chat rounds generate legacy voice once, without extra ordinary planning calls');
  ok(prompts.slice(1).every(prompt => prompt.includes('[角色声音样本]') && prompt.includes('称呼：你') && prompt.includes('用户说真好笑 → 你说哈哈哈😂')), 'rounds two through five use specific cached voice examples in compiled prompts');
  ok(cached.systemPrompt === old.systemPrompt && !!validVoiceSamples(cached), 'cache never rewrites user persona');
  ok(bodies[0].response_format?.type === 'json_object' && !bodies[0].messages[0].content.includes('[手机私聊表达契约]'), 'voice task uses isolated structured JSON instead of private chat contract');
  ok((await db.messages.toArray()).filter(m => m.role === 'assistant').length === 5 && !(await db.messages.toArray()).some(m => 'rawContent' in m), 'displayed replies persisted with no raw-content dual write');
  db.close(); await db.open();
  ok(!!validVoiceSamples((await db.characters.get(old.id))!), 'voice cache survives database reopening without schema migration');
  const archive = await collectSyncData(owner, '测试'); const beforeImport = calls;
  ok(archive.characters.find(c => c.id === old.id)?.voiceSamples?.lines.length === 4, 'account sync export preserves independent cache fields');
  await db.characters.delete(old.id); const imported = await importSyncData(JSON.parse(JSON.stringify(archive)));
  ok(imported.ok && !!validVoiceSamples((await db.characters.get(old.id))!) && calls === beforeImport, 'sync import restores legacy cache without generation or automatic chat');
  const block = voiceSampleBlock(cached);
  ok(stripVoiceSampleBlock(old.systemPrompt + '\n' + block) === old.systemPrompt, 'own marked reference block can be removed without editing original text');
  for (const patch of [{ name: '新名字' }, { greeting: '你好' }, { tags: ['温柔'] }, { systemPrompt: '新设定' }, { catchphrase: '新口癖' }]) ok(!validVoiceSamples({ ...cached, ...patch }), 'persona or voice source changes invalidate cached examples');
  ok(voicePromptRevision({ ...old, greeting: '😀' }) !== voicePromptRevision({ ...old, greeting: '😁' }), 'emoji changes include both UTF-16 units in source revision');
  ok(!buildHumanConversationContext('你好', [], { ...cached, systemPrompt: old.systemPrompt + '\n对话样本：用户说你好 → 你说原文优先。' }).includes('[角色声音样本]'), 'original reviewed persona examples take priority over generated cache');
  let rejected = false; try { normalizeVoiceLines(['称呼：你']); } catch { rejected = true; }
  ok(rejected, 'incomplete generated samples are rejected');
  rejected = false; try { normalizeVoiceLines([...lines.slice(0, 3), '对话样本：用户说你好 → 你说（微笑）你好']); } catch { rejected = true; }
  ok(rejected, 'roleplay stage directions never enter cached examples');
  const parallel = await legacy('parallel'); const count = calls;
  await Promise.all([refreshVoiceSamples(owner, parallel.id, 'sk-fixture'), refreshVoiceSamples(owner, parallel.id, 'sk-fixture')]);
  ok(calls === count + 1, 'concurrent voice cache requests share one task');
  const edited = await legacy('edited');
  beforeResponse = async () => { await db.characters.update(edited.id, { systemPrompt: '用户后来改过的人设' }); };
  await refreshVoiceSamples(owner, edited.id, 'sk-fixture');
  ok(!(await db.characters.get(edited.id))?.voiceSamples, 'late task result cannot overwrite a changed persona');
  const switched = await legacy('switched');
  beforeResponse = async () => { useAuthStore.getState().login('other-owner', '别人', 'sk-fixture', ''); };
  await refreshVoiceSamples(owner, switched.id, 'sk-fixture');
  ok(lastSignal?.aborted && !(await db.characters.get(switched.id))?.voiceSamples, 'account switch aborts generation and prevents cache writes');
  ok(!(await readVoiceSampleCharacter(cached, owner)).voiceSamples, 'wrong account cannot read owner voice cache'); login();
  const deleted = await legacy('deleted'); beforeResponse = async () => { await db.characters.delete(deleted.id); };
  await refreshVoiceSamples(owner, deleted.id, 'sk-fixture');
  ok(!(await db.characters.get(deleted.id)), 'late generation never resurrects deleted character');
  const invalid = await legacy('invalid'); malformed = true; const countBad = calls;
  await refreshVoiceSamples(owner, invalid.id, 'sk-fixture'); await refreshVoiceSamples(owner, invalid.id, 'sk-fixture'); malformed = false;
  ok(calls === countBad + 1 && !(await db.characters.get(invalid.id))?.voiceSamples, 'invalid generation is uncached and short cooldown prevents per-turn request storms');
  ok(cleanupDifference('哈哈😂---真的吗？？', '哈哈😂真的吗？？').ratio === 0, 'separators are excluded while emoji and punctuation remain comparison content');
  ok(cleanupDifference('{"messages":["嗯","真的吗？？"]}', '嗯真的吗？？').ratio === 0, 'JSON transport formatting does not inflate cleanup difference');
  ok(cleanupDifference('（笑）哈哈', '哈哈').ratio > .15, 'actual action stripping crossing fifteen percent raises observation threshold');
  ok(cleanupDifference('怎么了？？谁说的？！', '怎么了。谁说的。').ratio > .15, 'flattened punctuation would be detected by cleanup metric');
  ok(cleanupDifference('甲'.repeat(1000), '乙'.repeat(1000)).approximate, 'large unmatched texts report bounded approximation honestly');
  recordChatQuality(owner, '（笑）哈哈', '哈哈', 1, true);
  ok(chatQualityReport().alerts === 1 && chatQualityReport().measuredTurns === 6, 'persistent report combines true raw capture with threshold alert');
  ok(!localStorage.getItem(`virtugene-chat-quality:${owner}`)?.includes('哈哈'), 'numeric diagnostic storage contains no chat text');
  const measured = chatQualityReport().turns;
  useAuthStore.getState().login('metrics-other', '别人', 'sk-fixture', '');
  recordChatQuality(owner, '不该写', '不该写', 0, true);
  ok(chatQualityReport().turns === 0, 'reports and writes remain account isolated'); login();
  ok(chatQualityReport().turns === measured, 'switching back restores only own numerical history');
  retryOnce = true; await turn(old, '说点别的');
  ok(chatQualityReport().samples.at(-1)?.retries === 1, 'actual shared send pipeline records a single quality retry');
  const regularSend=webApi.chat.send;
  const stage='我听见了。不是隔着门板混着风声的那种听见。进来吧，把门带上。今晚这句话，你当面说的，我收下了。';
  let stageCalls=0;const hints:string[]=[];let affectionPrompt='';
  const beforeStage=new Set((await db.messages.toArray()).map(m=>m.id));
  await db.sessions.update('voice-session',{sceneTimeOfDay:'night',scenePlace:'房间',sceneAtmosphere:'close'});
  webApi.chat.send=async params=>{affectionPrompt=params.systemPrompt;stageCalls++;hints.push(params.retryHint??'');return {content:stageCalls===1?stage:'突然这么认真……我有点开心。'};};
  try{
    await turn(old,'我爱你');
    ok(stageCalls===2&&hints[1].includes('不是同处一室'),'actual private pipeline retries screenshot staging once with a concrete repair');
    const saved=(await db.messages.toArray()).filter(m=>!beforeStage.has(m.id)&&m.role==='assistant');
    ok(saved.length===1&&saved[0].content==='突然这么认真……我有点开心。','real database stores the repaired reply once without the rejected scene draft');
    ok(affectionPrompt.includes('不证明你与用户同处一室')&&affectionPrompt.includes('用户直接表达了心意')&&!affectionPrompt.includes('用户说得很短，可以只回'),'actual prompt combines ambient limits with affection instead of generic short-reaction padding');
    stageCalls=0;
    webApi.chat.send=async params=>{stageCalls++;params.onDelta?.(stage);await new Promise(resolve=>setTimeout(resolve,60));return {content:stage};};
    await turn(old,'我想你');
    ok(stageCalls===1&&chatQualityReport().samples.at(-1)?.issue==='uninvited-staging'&&chatQualityReport().samples.at(-1)?.streamed,'published stage prose is measured honestly instead of secretly regenerated');
    webApi.chat.send=async params=>{affectionPrompt=params.systemPrompt;return {content:'我也想跟你再聊会儿。'};};
    await turn(old,'好想你');
    ok(affectionPrompt.includes('历史里的门、动作和氛围不是现在同处一室的证据'),'next actual chat turn corrects inherited scene drift without deleting history');
    const emotional={...(await db.characters.get(old.id))!,tags:['温柔']};
    emotional.voiceSamples={generatedAt:Date.now(),promptRevision:voicePromptRevision(emotional),lines:['称呼：你','判断习惯：先听具体经过',
      '对话样本：用户说你好 → 你说在呢。','对话样本：用户说你好棒 → 你说有点开心。','对话样本：用户说我不同意 → 你说你说说哪一点。','对话样本：用户说对不起 → 你说我们把误解说清。','对话样本：用户说今天好累 → 你说今天先别费劲解释了。']};
    await db.characters.put(emotional);
    stageCalls=0;
    webApi.chat.send=async params=>{stageCalls++;affectionPrompt=params.systemPrompt;return {content:'今天先少费点神吧。'};};
    await turn(emotional,'今天好累');
    ok(stageCalls===1&&affectionPrompt.includes('今天先别费劲解释了')&&affectionPrompt.includes('本轮疲惫')&&!affectionPrompt.includes('用户说对不起 →'),'actual private prompt selects a relevant fifth cached sample without an extra planning call');
    await turn(emotional,'你理解错了');
    await turn(emotional,'对不起，我刚才说重了');
    ok(affectionPrompt.includes('前面有明确分歧')&&affectionPrompt.includes('不假定角色已经生气'),'actual multi-turn chat carries user-sourced clarification without manufactured anger');
    await turn(emotional,'换个话题，今天吃什么');
    ok(!affectionPrompt.includes('前面有明确分歧'),'actual topic change leaves the emotion transition behind');
  }finally{webApi.chat.send=regularSend;}
  const originalFetch = window.fetch;
  window.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '（笑）哈哈😂' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  let raw = '';
  try { const result = await sendMessage({ apiKey: 'sk-fixture', message: '你好', history: [], systemPrompt: '你是旧角色', onRawResponse: value => { raw = value; } }); ok(raw === '（笑）哈哈😂' && result.content === '哈哈😂', 'real transport raw hook captures ephemeral text before action cleanup'); }
  finally { window.fetch = originalFetch; }
  useAuthStore.setState({ apiKey: null }); setGatewayAccessToken('fixture-token');
  let gatewayBody: any, forwarded: AbortSignal | undefined;
  window.fetch = async (_url, init) => {
    gatewayBody = JSON.parse(String(init?.body)); forwarded = init?.signal ?? undefined;
    return new Response(JSON.stringify({ content: JSON.stringify({ lines }) }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const sample = await generateVoiceSamples(old, '');
    ok(sample.lines.length === 4 && gatewayBody.structuredOutput === true && gatewayBody.disableThinking === true && gatewayBody.maxTokens === 900 && !!forwarded, 'gateway auxiliary task forwards JSON mode, expanded example budget and cancellation signal');
    const abort = new AbortController();
    window.fetch = async (_url, init) => { forwarded = init?.signal ?? undefined; abort.abort(); return new Response(JSON.stringify({ content: JSON.stringify({ lines }) }), { headers: { 'Content-Type': 'application/json' } }); };
    let stopped = false; try { await generateVoiceSamples(old, '', abort.signal); } catch { stopped = true; }
    ok(stopped && forwarded?.aborted, 'gateway voice generation abort cannot yield an adoptable sample even if endpoint returns late');
  } finally { window.fetch = originalFetch; setGatewayAccessToken(''); login(); }
  const manual = await legacy('manual');
  useChatStore.setState({ characters: [manual], selectedCharacterId: manual.id });
  root.render(<CreateGeneTab editCharacter={manual} onClose={() => { closed = true; }} />);
  return { checks, manualId: manual.id, originalPersona: manual.systemPrompt };
}
(window as any).chatPolicy = { run, record: (id: string) => db.characters.get(id), closed: () => closed, calls: () => calls, voicePromptRevision,
  holdNext: () => { beforeResponse = () => new Promise<void>(resolve => { releaseHeld = resolve; }); }, held: () => !!releaseHeld,
  release: () => { releaseHeld?.(); releaseHeld = undefined; },
};
