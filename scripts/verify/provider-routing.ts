import { diaryAssist } from '../../src/lib/ai/diary-assistant';
import { generateCharacterPrompt } from '../../src/lib/ai/character-generator';
import { fuseSouls } from '../../src/lib/ai/fusion';
import { assignVoice } from '../../src/lib/ai/voice-assigner';
import { analyzeEmotion } from '../../src/lib/ai/emotion-analyzer';
import { consolidateContext } from '../../src/lib/ai/context-consolidator';
import { extractMemories } from '../../src/lib/ai/memory-consolidator';
import { summarizeContext } from '../../src/lib/ai/context-summarizer';
import { generateProactiveMessage } from '../../src/lib/ai/proactive-chat';
import { generateGroupTurn } from '../../src/lib/ai/group-chat';
import { worldChat, worldAiAvailability } from '../../src/lib/world/world-ai-client';
import { canUseAi } from '../../src/lib/ai/availability';
import { useAuthStore } from '../../src/store/auth-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { clearSecret, persistSecret } from '../../src/lib/api-key-storage';
import { saveProviderConfig, getProviderConfig } from '../../src/lib/ai/provider-config';
import { LLM_PROVIDERS, type ProviderId } from '../../src/lib/ai/provider-registry';
import { voiceGender } from '../../src/lib/voice-map';

type Check = (condition: unknown, name: string) => void;
const respond = (provider: ProviderId, content: string): Response => new Response(JSON.stringify(
  provider === 'anthropic' ? { content: [{ type: 'text', text: content }], stop_reason: 'end_turn' }
  : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }] }
  : { choices: [{ message: { content }, finish_reason: 'stop' }] },
), { headers: { 'Content-Type': 'application/json' } });
const history = [{ role: 'user', content: 'I prefer tea.', sourceId: 'source-1' }, { role: 'assistant', content: 'We can drink tea tomorrow.', sourceId: 'source-2' }];
const emotion = { valence: 7, arousal: 5, intimacy: 6, engagement: 8, expressiveness: 4, stability: 9, dominantEmotion: '平静满足', summary: '角色保持平静。' };

/** Real exported feature functions, real adapter boundary, isolated mock responses only. */
export async function runProviderRoutingChecks(check: Check): Promise<void> {
  const cases: Array<{ provider: ProviderId; model: string }> = [
    { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    { provider: 'gemini', model: 'gemini-3.8-flash' },
    { provider: 'custom', model: 'isolated-local-model' },
  ];
  for (const selection of cases) {
    // Only the selected provider may have a credential; never leave DeepSeek as a fallback.
    useAuthStore.setState({ apiKey: null, userId: 'routing-test' });
    for (const meta of Object.values(LLM_PROVIDERS)) if (meta.keyStorage) clearSecret(meta.keyStorage);
    saveProviderConfig('deepseek', { enabled: false });
    saveProviderConfig(selection.provider, { enabled: true, ...(selection.provider === 'custom' ? { baseUrl: 'http://127.0.0.1:11434/v1', models: [{ id: selection.model, vision: true }] } : {}) });
    const credential = `isolated-${selection.provider}-credential`;
    if (selection.provider !== 'custom') await persistSecret(LLM_PROVIDERS[selection.provider].keyStorage!, credential);
    useSettingsStore.setState({ defaultModel: selection });
    check(canUseAi(), `${selection.provider}: app availability works without an unrelated DeepSeek credential`);
    check((await worldAiAvailability()).status === 'AVAILABLE', `${selection.provider}: world availability works without DeepSeek`);
    let queue: string[] = [];
    const requests: Array<Record<string, any>> = [];
    window.fetch = (async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      check(url.startsWith(getProviderConfig(selection.provider).baseUrl + '/'), `${selection.provider}: feature data reaches only selected endpoint`);
      check(selection.provider === 'gemini' ? url.includes(`/models/${selection.model}:`) : body.model === selection.model, `${selection.provider}: feature preserves exact model ID`);
      const headers = new Headers(init?.headers);
      check(selection.provider === 'custom' ? !headers.has('Authorization') : headers.get(selection.provider === 'anthropic' ? 'x-api-key' : 'x-goog-api-key') === credential, `${selection.provider}: feature uses corresponding encrypted credential or keyless route`);
      requests.push(body);
      const next = queue.shift();
      if (next === undefined) throw new Error(`Unexpected ${selection.provider} feature request`);
      return respond(selection.provider, next);
    }) as typeof fetch;
    const fixture = (values: Array<string | object>) => { queue = values.map(value => typeof value === 'string' ? value : JSON.stringify(value)); requests.length = 0; };
    const assertSingle = (name: string) => check(requests.length === 1 && queue.length === 0, `${selection.provider}: ${name} succeeds with one intended call`);

    fixture([{ title: '一杯茶', content: '今天我喝了茶。', tags: ['日常'] }]);
    const diary = await diaryAssist({ apiKey: '', mode: 'auto', text: '今天喝了茶。' });
    check(diary.text === '今天我喝了茶。' && diary.title === '一杯茶' && !diary.error, `${selection.provider}: diaryAssist parses structured result`); assertSingle('diaryAssist');

    fixture([{ tags: ['安静'], signature: '先喝茶', greeting: '茶泡好了。', systemPrompt: '你是实验角色，只聊茶。' }]);
    const character = await generateCharacterPrompt({ apiKey: '', characterName: '实验角色', fields: { identity: '茶友', speechExamples: '茶泡好了。' } });
    check(character.systemPrompt === '你是实验角色，只聊茶。' && character.tags[0] === '安静', `${selection.provider}: generateCharacterPrompt preserves fields`); assertSingle('generateCharacterPrompt');

    fixture([{ name: '新角色', signature: '慢一点', greeting: '先坐下。', systemPrompt: '你是融合实验角色。', tags: ['克制'] }]);
    const fused = await fuseSouls({ name: 'A', systemPrompt: '外向', tags: ['外向'] }, { name: 'B', systemPrompt: '内向', tags: ['内向'] });
    check(fused.data?.systemPrompt === '你是融合实验角色。' && !fused.error, `${selection.provider}: fuseSouls works with only selected key`); assertSingle('fuseSouls');

    fixture([{ voice: 'zh-CN-XiaoxiaoNeural', band: 'mid', gender: 'male', rate: '+0%', pitch: '+0Hz' }]);
    const voice = await assignVoice({ apiKey: '', characterId: 'test-character', character: { name: '实验角色', systemPrompt: '成年男性' } });
    check(!!voice.voice && voiceGender(voice.voice.voice) === 'male', `${selection.provider}: assignVoice preserves gender/voice validation`); assertSingle('assignVoice');

    fixture([emotion]);
    const analyzed = await analyzeEmotion({ apiKey: '', history, characterName: '实验角色' });
    check(analyzed.dimensions?.valence === 7 && !analyzed.error, `${selection.provider}: analyzeEmotion parses dimensions`); assertSingle('analyzeEmotion');

    fixture([{ ...emotion, memories: [{ content: '用户喜欢茶。', evidence: [0, 88, -1] }], threads: [{ action: 'create', kind: 'plan', title: '明天喝茶', evidence: [1, 88] }], userEmotion: '平静' }]);
    const settled = await consolidateContext({ apiKey: '', history, characterName: '实验角色' });
    check(settled.memories?.[0].evidence.join(',') === '0' && settled.threads?.[0].evidence.join(',') === '1' && settled.dimensions?.valence === 7, `${selection.provider}: consolidateContext preserves evidence bounds and state validation`); assertSingle('consolidateContext');

    fixture([[{ content: '用户喜欢茶。', sourceIds: ['source-1'] }, { content: '无依据的猜测。', sourceIds: ['fabricated-source'] }]]);
    const memories = await extractMemories({ apiKey: '', history });
    check(memories.memories?.length === 1 && memories.evidence?.[0].sourceIds[0] === 'source-1', `${selection.provider}: extractMemories rejects fabricated source IDs`); assertSingle('extractMemories');

    fixture(['长期记住：用户喜欢茶。']);
    const summary = await summarizeContext({ apiKey: '', history, protectedMemories: ['用户喜欢茶。'] });
    check(summary.complete === true && summary.summary === '长期记住：用户喜欢茶。', `${selection.provider}: summarizeContext completes AI compression`); assertSingle('summarizeContext');

    fixture(['茶凉了，我又泡了一杯。']);
    check((await generateProactiveMessage({ apiKey: '', systemPrompt: '你是茶友。', characterName: '茶友', lastMessages: history })).includes('茶凉了'), `${selection.provider}: generateProactiveMessage works`); assertSingle('generateProactiveMessage');

    const privateA = 'PRIVATE_MARKER_A_5301';
    const privateB = 'PRIVATE_MARKER_B_9610';
    fixture([{ turns: [{ speaker: 'A', content: '公开的导演草稿。' }] }, `I know ${privateA}`, { safe: false }, '茶泡好了，大家来喝。']);
    const group = await generateGroupTurn({ apiKey: '', groupName: '隔离测试群', userMessage: '喝茶吗？', history: [], members: [
      { id: 'actor-a', name: 'A', publicPersona: '茶友 A', persona: '角色 A 的完整人设', privateMemory: privateA },
      { id: 'actor-b', name: 'B', publicPersona: '茶友 B', persona: '角色 B 的完整人设', privateMemory: privateB },
    ] });
    check(group.turns[0]?.senderId === 'actor-a' && group.turns[0].content === '茶泡好了，大家来喝。' && !group.error, `${selection.provider}: generateGroupTurn rejects private actor draft and regenerates public text`);
    check(requests.length === 4 && !JSON.stringify(requests[0]).includes(privateA) && !JSON.stringify(requests[0]).includes(privateB), `${selection.provider}: shared speaker selection contains no private actor facts`);
    check(JSON.stringify(requests[1]).includes(privateA) && !JSON.stringify(requests[1]).includes(privateB) && !JSON.stringify(requests[3]).includes(privateA), `${selection.provider}: actor memory stays isolated and public retry omits it`);

    fixture([{ turns: [{ speaker: 'Unknown speaker', content: '伪造成员' }] }, { turns: [{ speaker: 'Unknown speaker', content: '伪造成员' }] }]);
    const unknown = await generateGroupTurn({ apiKey: '', groupName: '隔离测试群', userMessage: 'Hi', history: [], members: [{ id: 'actor-a', name: 'A', persona: '茶友' }] });
    check(unknown.turns.length === 0 && !!unknown.error && requests.length === 2, `${selection.provider}: group rejects unknown speaker after bounded same-model formatting retry`);

    fixture(['{"dialogue":"你好"}']);
    const world = await worldChat({ messages: [{ role: 'system', content: 'Return stage JSON.' }, { role: 'user', content: 'Hello' }], jsonMode: true });
    check(world.content === '{"dialogue":"你好"}' && world.route === 'byok', `${selection.provider}: worldChat routes through configured model`); assertSingle('worldChat');
  }
}
