import { DEEPSEEK_MODEL_ID, LEGACY_DEEPSEEK_MODEL_IDS, findModel, resolveModel, llmChat, llmChatStream, fetchProviderModels, validateProviderConnection, saveProviderConfig, getProviderConfig, getAvailableModels } from '../../src/lib/ai/llm';
import { sendMessage, validateApiKey } from '../../src/lib/ai/deepseek';
import { gatewayChat } from '../../src/lib/ai/gateway';
import { modelChoiceKey } from '../../src/components/settings/ModelList';
import { useSettingsStore } from '../../src/store/settings-store';

/** Real adapters/selection logic; synthetic responses and isolated browser storage. */
export async function runDeepseekFlashChecks(check: (value: unknown, name: string) => void) {
  const previousConfig = localStorage.getItem('virtugene-ai-provider-config-v1');
  const json = (content = 'OK', status = 200) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status, headers: { 'Content-Type': 'application/json' } });
  const requests: Array<{ url: string; body: any }> = [];
  const capture = (reply: () => Response = () => json()) => {
    requests.length = 0;
    window.fetch = (async (input, init) => { requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) }); return reply(); }) as typeof fetch;
  };
  const aliases = [DEEPSEEK_MODEL_ID, ...LEGACY_DEEPSEEK_MODEL_IDS, 'deepseek-future-pro'];
  for (const id of aliases) {
    useSettingsStore.setState({ defaultModel: { provider: 'deepseek', model: id } });
    check(resolveModel().id === DEEPSEEK_MODEL_ID && resolveModel().vision === true, `${id}: persisted global selection uses image-capable Flash`);
    check(resolveModel({ model: { provider: 'deepseek', model: id } }).id === DEEPSEEK_MODEL_ID, `${id}: character selection uses Flash`);
    check(resolveModel(null, { provider: 'deepseek', model: id }).id === DEEPSEEK_MODEL_ID, `${id}: locked session uses Flash`);
    check(modelChoiceKey('deepseek', id) === modelChoiceKey('deepseek', DEEPSEEK_MODEL_ID), `${id}: model menu highlights canonical selection`);
    capture();
    await llmChat({ provider: 'deepseek', model: id, apiKey: 'fixture', messages: [{ role: 'user', content: 'Hello' }] });
    check(requests[0].body.model === DEEPSEEK_MODEL_ID && requests[0].body.thinking.type === 'enabled' && requests[0].body.reasoning_effort === 'low' && !('temperature' in requests[0].body), `${id}: actual direct request uses Flash and supported low reasoning parameters`);
  }
  useSettingsStore.setState({ defaultModel: null });
  saveProviderConfig('deepseek', { models: [{ id: 'deepseek-v4-pro', vision: false }, { id: DEEPSEEK_MODEL_ID, label: 'Override', vision: false }] });
  const catalog = getAvailableModels('deepseek');
  check(catalog.length === 1 && catalog[0].id === DEEPSEEK_MODEL_ID && catalog[0].vision === true && catalog[0].label === 'DeepSeek V4.1 Flash', 'legacy/custom catalog cannot restore Pro or remove Flash vision');
  // Simulate rehydrating a configuration written by an old app, without the new save sanitizer.
  localStorage.setItem('virtugene-ai-provider-config-v1', JSON.stringify({ deepseek: { enabled: true, baseUrl: 'https://flash-fixture.invalid/v1', models: [{ id: 'deepseek-v4-pro', vision: false }] } }));
  check(getAvailableModels('deepseek').length === 1 && getProviderConfig('deepseek').baseUrl === 'https://flash-fixture.invalid/v1', 'old persisted catalog normalizes while preserving configured endpoint');
  check(findModel('deepseek-v4-pro')?.id === DEEPSEEK_MODEL_ID, 'unscoped legacy metadata lookup resolves Flash');
  saveProviderConfig('custom', { models: [{ id: 'deepseek-v4-pro', vision: false }] });
  check(findModel('deepseek-v4-pro', 'custom')?.id === 'deepseek-v4-pro', 'another provider retains its exact model ID');

  capture(() => new Response(JSON.stringify({ data: aliases.map(id => ({ id })) })));
  const found = await fetchProviderModels('deepseek', { apiKey: 'fixture' });
  check(found.length === 1 && found[0].id === DEEPSEEK_MODEL_ID && found[0].vision === true, 'discovered Flash aliases deduplicate; other DeepSeek models stay excluded');
  capture(() => new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-pro' }] })));
  check((await fetchProviderModels('deepseek', { apiKey: 'fixture' })).length === 0, 'catalog discovery does not fabricate Flash access');
  capture();
  await validateProviderConnection('deepseek', { apiKey: 'fixture', model: 'deepseek-v4-pro', baseUrl: 'https://draft-fixture.invalid/v1' });
  check(requests.length === 1 && requests[0].url === 'https://draft-fixture.invalid/v1/chat/completions' && requests[0].body.model === DEEPSEEK_MODEL_ID && requests[0].body.max_tokens === 16 && requests[0].body.thinking.type === 'disabled', 'connection test performs one small real Flash generation at draft endpoint');
  capture();
  check((await validateApiKey('fixture')).valid && requests[0].url.startsWith('https://flash-fixture.invalid/v1/'), 'account validation uses configured endpoint and actual Flash generation');
  for (const [status, text] of [[401, '验证失败'], [402, '余额不足'], [429, '过于频繁']] as const) {
    capture(() => json('', status));
    const result = await validateApiKey('fixture');
    check(!result.valid && result.error?.includes(text), `account validation preserves ${status} error meaning`);
  }
  capture(() => json(''));
  check(!(await validateApiKey('fixture')).valid, 'empty generation does not report a healthy Flash connection');

  const image = 'data:image/png;base64,aGVsbG8=';
  capture();
  await llmChat({ provider: 'deepseek', model: 'deepseek-v4-pro', apiKey: 'fixture', jsonMode: true, messages: [{ role: 'user', content: 'Return JSON' }] });
  check(requests[0].body.thinking.type === 'disabled' && requests[0].body.response_format.type === 'json_object' && !requests[0].body.reasoning_effort, 'JSON generation disables thinking automatically');
  capture();
  const vision = await sendMessage({ apiKey: 'fixture', systemPrompt: 'Look', message: 'Image?', image, history: [], sessionModel: { provider: 'deepseek', model: 'deepseek-v4-pro' } });
  check(vision.modelId === DEEPSEEK_MODEL_ID && requests.length === 1 && requests[0].body.messages.at(-1).content[1].image_url.url === image, 'legacy Pro session sends native images directly to Flash');
  let attempts = 0;
  capture(() => json(++attempts === 1 ? '' : 'Recovered'));
  const recovered = await sendMessage({ apiKey: 'fixture', systemPrompt: 'Look', message: 'Image?', image, history: [] });
  check(recovered.content === 'Recovered' && requests.length === 2 && requests.every(request => request.body.model === DEEPSEEK_MODEL_ID && request.body.messages.at(-1).content[1].image_url.url === image), 'bounded recovery retains model and original image evidence');
  capture(() => json('', 429));
  await sendMessage({ apiKey: 'fixture', systemPrompt: 's', message: 'Hi', history: [] }).catch(() => undefined);
  check(requests.length === 1, 'rate limit does not trigger duplicate paid recovery');

  const frames = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hidden' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: '你好' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
  capture(() => new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } }));
  const seen: string[] = [];
  const streamed = await llmChatStream({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'fixture', messages: [{ role: 'user', content: 'Hi' }], onDelta: all => seen.push(all) });
  check(streamed.content === '你好' && seen.join('|') === '你好' && requests[0].body.model === DEEPSEEK_MODEL_ID && requests[0].body.stream_options.include_usage, 'legacy streaming uses Flash, preserves usage and hides reasoning');
  capture(() => new Response(JSON.stringify({ content: 'Recovered', modelId: DEEPSEEK_MODEL_ID })));
  await gatewayChat({ apiKey: '', systemPrompt: 's', message: 'Hi', history: [], disableThinking: true }, { baseUrl: 'http://gateway-fixture.invalid' });
  check(requests[0].body.disableThinking === true, 'nonstream gateway recovery transmits thinking switch');
  if (previousConfig === null) localStorage.removeItem('virtugene-ai-provider-config-v1');
  else localStorage.setItem('virtugene-ai-provider-config-v1', previousConfig);
}
