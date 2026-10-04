import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { persistSecret, loadSecret, clearSecret } from '../../lib/api-key-storage';
import { fetchProviderModels, getAvailableModels, getProviderKey, LLM_MODELS, LLM_PROVIDERS, validateProviderConnection, type LLMModel, type ProviderId } from '../../lib/ai/llm';
import { getProviderConfig, normalizeProviderBaseUrl, providerRequiresKey, saveProviderConfig } from '../../lib/ai/provider-config';
import { checkGatewayHealth, hasAiGatewayAccess } from '../../lib/ai/gateway';
import { CLOUD_ASR_KEY_NAME } from '../../lib/cloud-asr';
import { Modal } from '../ui/Modal';
import { notifyProviderCredentialsChanged, useModelCatalog } from './useModelCatalog';
import '../../styles/model-settings.css';

type Feedback = { tone: 'success' | 'error' | 'info'; text: string };
const PROVIDERS = Object.keys(LLM_PROVIDERS) as ProviderId[];
const MARKS: Record<ProviderId, string> = { deepseek: 'DS', qwen: 'Q', mimo: 'Mi', openai: 'AI', anthropic: 'C', gemini: 'G', moonshot: 'K', zhipu: 'GL', doubao: '豆', minimax: 'M', xai: 'x', siliconflow: 'SF', groq: 'Gr', openrouter: 'OR', custom: '↗' };

function connectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'config:invalid_url') return '地址格式不正确。请输入不含密钥、参数或账号信息的 HTTPS API 根地址；本机或局域网服务可使用 HTTP。';
  if (message === 'auth:invalid_key') return '密钥无效或缺少访问权限，请检查对应平台的 API Key。';
  if (message === 'billing:insufficient') return '账户余额不足，请在服务商平台检查账单。';
  if (message === 'rate:limited') return '请求过于频繁，请稍后重试。';
  if (message === 'timeout' || message === 'AbortError') return '连接超时，请检查网络和 API 地址后重试。';
  if (message === 'models:unsupported') return '此接口不提供模型列表，请按平台说明手动填写模型 ID。';
  if (message === 'provider:disabled') return '服务商已暂停，请开启后保存。';
  if (message.includes('model') || message.includes('not_found')) return '模型不可用。请核对准确的模型 ID、账户权限和 API 地址。';
  return '连接未完成，请检查 API 地址、网络和平台权限。浏览器直连还需要服务端允许跨域。';
}

function FeedbackLine({ feedback }: { feedback: Feedback | null }) {
  return feedback ? <p className="vg-provider-message" data-tone={feedback.tone} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</p> : null;
}

function ProviderEditor({ provider, onBack, onChanged }: { provider: ProviderId; onBack: () => void; onChanged: () => void }) {
  const definition = LLM_PROVIDERS[provider];
  const owner = useAuthStore(s => s.userId);
  const accountKey = useAuthStore(s => s.apiKey);
  const initial = getProviderConfig(provider);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [models, setModels] = useState<LLMModel[]>(initial.models);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(provider === 'deepseek' && Boolean(accountKey));
  const [modelId, setModelId] = useState('');
  const [modelVision, setModelVision] = useState(false);
  const [testModel, setTestModel] = useState(initial.models[0]?.id ?? getAvailableModels(provider)[0]?.id ?? '');
  const [discovered, setDiscovered] = useState<LLMModel[]>([]);
  const [discoveredId, setDiscoveredId] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'discover' | 'clear' | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const live = useRef(true);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const isCurrent = (token: number) => live.current && token === sequence.current && useAuthStore.getState().userId === owner;

  useEffect(() => {
    live.current = true;
    const token = sequence.current;
    if (definition.keyStorage) void loadSecret(definition.keyStorage).then(key => { if (isCurrent(token)) setHasKey(Boolean(key)); });
    else setHasKey(Boolean(accountKey));
    return () => { live.current = false; sequence.current++; request.current?.abort(); };
  }, [owner, accountKey, definition.keyStorage]);

  const begin = (kind: NonNullable<typeof busy>) => {
    request.current?.abort();
    const token = ++sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setBusy(kind);
    setFeedback(null);
    return { token, controller };
  };
  const finish = (token: number) => { if (isCurrent(token)) { setBusy(null); request.current = null; } };
  const cancel = () => {
    sequence.current++;
    request.current?.abort();
    request.current = null;
    setBusy(null);
    setFeedback({ tone: 'info', text: '已取消本次请求。' });
  };

  const addModel = (model: Pick<LLMModel, 'id' | 'vision'>) => {
    const id = model.id.trim();
    if (!id || id.length > 240 || /[\r\n\u0000-\u001f]/.test(id)) {
      setFeedback({ tone: 'error', text: '请输入完整、有效的模型 ID。' });
      return;
    }
    setModels(current => [...current.filter(item => item.id !== id), { id, label: id, provider, vision: model.vision === true }]);
    setTestModel(id);
    setModelId('');
    setModelVision(false);
    setFeedback({ tone: 'info', text: '模型已加入待保存列表，保存配置后可在模型选择中使用。' });
  };

  const removeModel = (id: string) => {
    const remaining = models.filter(model => model.id !== id);
    setModels(remaining);
    if (testModel === id) setTestModel(remaining[0]?.id ?? LLM_MODELS.find(model => model.provider === provider && model.id !== id)?.id ?? '');
    setFeedback({ tone: 'info', text: '模型已从待保存列表中移除，保存配置后生效。' });
  };

  const save = async () => {
    const { token } = begin('save');
    try {
      const normalizedUrl = normalizeProviderBaseUrl(baseUrl, provider);
      const pendingModel = modelId.trim();
      if (pendingModel && (pendingModel.length > 240 || /[\r\n\u0000-\u001f]/.test(pendingModel))) {
        setFeedback({ tone: 'error', text: '模型 ID 格式不正确，配置尚未保存。' });
        return;
      }
      if (!isCurrent(token)) return;
      if (definition.keyStorage && apiKey.trim()) {
        const value = apiKey.trim();
        await persistSecret(definition.keyStorage, value);
        const stored = await loadSecret(definition.keyStorage);
        if (!isCurrent(token)) return;
        if (stored !== value) throw new Error('storage:failed');
        setHasKey(true);
        setApiKey('');
      }
      if (!isCurrent(token)) return;
      const nextModels = pendingModel ? [...models.filter(item => item.id !== pendingModel), { id: pendingModel, label: pendingModel, provider, vision: modelVision }] : models;
      saveProviderConfig(provider, { baseUrl: normalizedUrl, enabled, models: nextModels });
      setBaseUrl(normalizedUrl);
      setModels(getProviderConfig(provider).models);
      if (pendingModel) { setTestModel(pendingModel); setModelId(''); setModelVision(false); }
      notifyProviderCredentialsChanged();
      onChanged();
      setFeedback({ tone: 'success', text: '配置已保存，可通过测试确认连接。' });
    } catch (error) {
      if (isCurrent(token)) setFeedback({ tone: 'error', text: error instanceof Error && error.message === 'config:invalid_url' ? connectionError(error) : '配置或密钥未能保存，请重试。' });
    } finally { finish(token); }
  };

  const clearKey = async () => {
    if (!definition.keyStorage) return;
    const { token } = begin('clear');
    try {
      clearSecret(definition.keyStorage);
      const stored = await loadSecret(definition.keyStorage);
      if (!isCurrent(token)) return;
      if (stored) throw new Error('storage:failed');
      setHasKey(false);
      setApiKey('');
      notifyProviderCredentialsChanged();
      onChanged();
      setFeedback({ tone: 'success', text: '此服务商的设备密钥已清除，模型和地址配置保留。' });
    } catch {
      if (isCurrent(token)) setFeedback({ tone: 'error', text: '密钥未能清除，请重试。' });
    } finally { finish(token); }
  };

  const connect = async (kind: 'test' | 'discover') => {
    const { token, controller } = begin(kind);
    try {
      const url = normalizeProviderBaseUrl(baseUrl, provider);
      const key = apiKey.trim() || await getProviderKey(provider) || '';
      if (!isCurrent(token)) return;
      if (provider === 'deepseek' && !key && hasAiGatewayAccess()) {
        if (kind === 'discover') {
          setFeedback({ tone: 'info', text: '托管账号由网关提供模型。服务商模型列表需要该平台的直连 API Key。' });
          return;
        }
        const health = await checkGatewayHealth();
        if (isCurrent(token)) setFeedback(health === 'connected' ? { tone: 'success', text: '网关在线。模型可用权限以实际聊天请求为准。' } : { tone: 'error', text: '网关当前无法连接，请稍后重试。' });
        return;
      }
      if (providerRequiresKey(provider, url) && !key) {
        setFeedback({ tone: 'error', text: provider === 'deepseek' ? '请先绑定 DeepSeek 账号密钥，或使用已登录的托管账号。' : '请先填写 API Key。你可以使用未保存的密钥进行测试。' });
        return;
      }
      if (kind === 'discover') {
        const found = await fetchProviderModels(provider, { apiKey: key, baseUrl: url, signal: controller.signal });
        if (!isCurrent(token)) return;
        setDiscovered(found);
        setDiscoveredId(found[0]?.id ?? '');
        setFeedback(found.length ? { tone: 'success', text: `已读取 ${found.length} 个模型。选择需要的模型并加入配置。` } : { tone: 'info', text: '接口未返回可用模型，请按平台说明手动填写模型 ID。' });
      } else {
        await validateProviderConnection(provider, { apiKey: key, baseUrl: url, model: modelId.trim() || testModel, signal: controller.signal });
        if (!isCurrent(token)) return;
        setFeedback({ tone: 'success', text: provider === 'deepseek' ? 'DeepSeek Flash 实际调用成功。未保存的地址仍需要保存配置。' : definition.modelDiscovery ? '服务商已响应，密钥可读取模型列表。具体模型权限以实际调用为准。' : '服务商已响应，测试模型调用成功。未保存的内容仍需要保存配置。' });
      }
    } catch (error) {
      if (isCurrent(token)) setFeedback({ tone: 'error', text: connectionError(error) });
    } finally { finish(token); }
  };

  const options = new Map(LLM_MODELS.filter(model => model.provider === provider).map(model => [model.id, model]));
  for (const model of models) options.set(model.id, model);
  const gatewayOnly = provider === 'deepseek' && !accountKey && hasAiGatewayAccess();
  return <div>
    <button type="button" className="vg-provider-back" onClick={onBack}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 5-7 7 7 7"/></svg>返回服务商</button>
    <div className="vg-provider-heading"><span className="vg-provider-mark" aria-hidden="true">{MARKS[provider]}</span><div><h3>{definition.name}</h3><p>{definition.protocol === 'anthropic' ? '原生 Messages 接口' : definition.protocol === 'gemini' ? '原生 Gemini 接口' : 'OpenAI 兼容接口'}</p></div></div>
    <div className="vg-provider-editor">
      <section className="vg-provider-section" aria-label="连接配置">
        <h4>连接配置</h4>
        {provider === 'deepseek' ? <p className="vg-provider-note mb-4">{accountKey ? '使用当前登录账号绑定的 DeepSeek 密钥，无需重复填写。' : gatewayOnly ? '当前使用托管账号。此处的直连地址不会改变托管网关的模型配置。' : '使用登录账号绑定的 DeepSeek 密钥；请先完成账号连接。'}</p> : <>
          <div className="vg-provider-key-status"><span>{hasKey ? '设备密钥已保存' : '尚未保存设备密钥'}</span>{hasKey && <button type="button" onClick={() => void clearKey()} disabled={Boolean(busy)}>清除密钥</button>}</div>
          <label className="vg-provider-field"><span>API Key</span><input type="password" aria-label={`${definition.name} API Key`} value={apiKey} onChange={event => { setApiKey(event.target.value); setFeedback(null); }} placeholder={hasKey ? '填写新密钥可替换，留空保留原密钥' : `${definition.name} Key…`} autoComplete="off" spellCheck={false} disabled={Boolean(busy)} data-sensitive />
            <small>{provider === 'custom' ? '本机或局域网服务可留空；公开远程接口需要其对应密钥。' : '仅输入此服务商的密钥。已保存的密钥经过设备加密，不会回填显示。'}</small></label>
        </>}
        <label className="vg-provider-field"><span>API 根地址</span><input type="url" aria-label="API 根地址" value={baseUrl} onChange={event => { setBaseUrl(event.target.value); setFeedback(null); }} placeholder={definition.baseUrl} autoComplete="off" spellCheck={false} disabled={Boolean(busy)} /><small>填写根地址，软件会追加请求路径。区域、代理或本地服务可使用对应地址。</small></label>
        <label className="vg-provider-enabled"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={Boolean(busy)} />在模型列表中启用此服务商</label>
      </section>
      <section className="vg-provider-section" aria-label="模型配置">
        <h4>模型配置</h4>
        <p className="vg-provider-note">{provider === 'deepseek' ? '统一使用 DeepSeek V4.1 Flash，聊天、图片理解和辅助生成共用同一模型。旧会话的 DeepSeek 选择会自动接续到 Flash。' : '预设模型仅供选择，实际可用性取决于平台和账户。支持填写模型 ID 或推理接入点。'}</p>
        {options.size > 0 && <label className="vg-provider-field mt-3"><span>测试模型</span><select aria-label="测试模型" value={testModel} onChange={event => setTestModel(event.target.value)} disabled={Boolean(busy)}>{[...options.values()].map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>}
        {provider !== 'deepseek' && <>
        {models.length > 0 && <div className="vg-provider-models">{models.map(model => <div className="vg-provider-model-entry" key={model.id}><code>{model.id}</code>{model.vision && <span>图片</span>}<button type="button" aria-label={`移除模型 ${model.id}`} disabled={Boolean(busy)} onClick={() => removeModel(model.id)}>移除</button></div>)}</div>}
        <label className="vg-provider-field mt-3"><span>添加模型 ID</span><input type="text" aria-label="添加模型 ID" value={modelId} onChange={event => setModelId(event.target.value)} placeholder={definition.modelPlaceholder} autoComplete="off" spellCheck={false} maxLength={240} disabled={Boolean(busy)} /></label>
        <label className="vg-provider-model-vision"><input type="checkbox" checked={modelVision} onChange={event => setModelVision(event.target.checked)} disabled={Boolean(busy)} />此模型支持图片输入（请先根据服务商文档确认）</label>
        <div className="vg-provider-inline-actions"><button type="button" className="vg-provider-button" disabled={Boolean(busy) || !modelId.trim()} onClick={() => addModel({ id: modelId, vision: modelVision })}>添加模型</button>{definition.modelDiscovery && <button type="button" className="vg-provider-button" disabled={Boolean(busy)} onClick={() => void connect('discover')}>{busy === 'discover' ? '查询中…' : '查询可用模型'}</button>}</div>
        {discovered.length > 0 && <div className="mt-3"><label className="vg-provider-field"><span>平台返回的模型</span><select aria-label="平台返回的模型" value={discoveredId} onChange={event => setDiscoveredId(event.target.value)}>{discovered.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label><button type="button" className="vg-provider-button" disabled={Boolean(busy) || !discoveredId} onClick={() => { const selected = discovered.find(model => model.id === discoveredId); if (selected) addModel(selected); }}>添加所选模型</button><p className="vg-provider-note mt-2">模型列表不一定提供图片能力信息，必要时请手动确认并设置。</p></div>}
        </>}
      </section>
      <div className="vg-provider-actions">
        <div className="vg-provider-savebar"><button type="button" className="vg-provider-button is-primary" onClick={() => void save()} disabled={Boolean(busy)}>{busy === 'save' ? '保存中…' : '保存配置'}</button><button type="button" className="vg-provider-button" onClick={() => void connect('test')} disabled={Boolean(busy)}>{busy === 'test' ? '测试中…' : '测试连接'}</button>{(busy === 'test' || busy === 'discover') && <button type="button" className="vg-provider-button" onClick={cancel}>取消请求</button>}</div>
        {(!definition.modelDiscovery || provider === 'deepseek') && <p className="vg-provider-note mt-2">测试会向所选模型发送一个极短请求，可能产生少量接口费用。</p>}
        <FeedbackLine feedback={feedback}/>
      </div>
      <a className="vg-provider-docs" href={definition.docsUrl} target="_blank" rel="noreferrer">查看服务商 API 文档 ↗</a>
    </div>
  </div>;
}

function SpeechKeyEditor() {
  const owner = useAuthStore(s => s.userId);
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void loadSecret(CLOUD_ASR_KEY_NAME).then(key => { if (live.current && useAuthStore.getState().userId === owner) setSaved(Boolean(key)); });
    return () => { live.current = false; };
  }, [owner]);
  const update = async (remove: boolean) => {
    if (!remove && !value.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (remove) clearSecret(CLOUD_ASR_KEY_NAME);
      else await persistSecret(CLOUD_ASR_KEY_NAME, value.trim());
      const stored = await loadSecret(CLOUD_ASR_KEY_NAME);
      if (!live.current || useAuthStore.getState().userId !== owner) return;
      if (remove ? Boolean(stored) : stored !== value.trim()) throw new Error('storage:failed');
      setSaved(Boolean(stored));
      setValue('');
      setFeedback({ tone: 'success', text: remove ? '语音识别密钥已清除。' : '语音识别密钥已加密保存。' });
    } catch { if (live.current && useAuthStore.getState().userId === owner) setFeedback({ tone: 'error', text: '密钥未能保存或清除，请重试。' }); }
    finally { if (live.current && useAuthStore.getState().userId === owner) setBusy(false); }
  };
  return <section className="vg-provider-section" aria-label="语音识别密钥"><div className="vg-provider-key-status"><h4 className="!mb-0">硅基 SiliconFlow</h4><span className="vg-provider-status" data-ready={saved}>{saved ? '已配置' : '未配置'}</span></div><p className="vg-provider-note mb-3">用于云端语音转文字，与对话模型的密钥分别保存。</p><label className="vg-provider-field"><span>语音识别 API Key</span><input type="password" aria-label="语音识别 API Key" placeholder={saved ? '输入新密钥可替换' : '硅基 SiliconFlow Key…'} autoComplete="off" spellCheck={false} disabled={busy} data-sensitive value={value} onChange={event => setValue(event.target.value)} /></label><div className="vg-provider-inline-actions"><button type="button" className="vg-provider-button is-primary" disabled={busy || !value.trim()} onClick={() => void update(false)}>{busy ? '处理中…' : '保存语音密钥'}</button>{saved && <button type="button" className="vg-provider-button" disabled={busy} onClick={() => void update(true)}>清除语音密钥</button>}</div><FeedbackLine feedback={feedback}/></section>;
}

/** The provider directory keeps advanced forms out of the everyday settings screen. */
export function ApiKeyManager({ onClose, embedded = false, onlySpeech = false }: { onClose: () => void; embedded?: boolean; onlySpeech?: boolean }) {
  const { owner, ready, loading } = useModelCatalog();
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [query, setQuery] = useState('');
  const [configuredOnly, setConfiguredOnly] = useState(false);
  const [revision, setRevision] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const directoryScroll = useRef(0);
  const scrollOwner = useRef(owner);
  useLayoutEffect(() => {
    const scroll = surfaceRef.current?.closest<HTMLElement>('[data-modal-scroll]');
    if (scrollOwner.current !== owner) { scrollOwner.current = owner; directoryScroll.current = 0; }
    if (scroll) scroll.scrollTop = provider ? 0 : directoryScroll.current;
  }, [provider, owner]);
  useEffect(() => { setProvider(null); setQuery(''); setConfiguredOnly(false); }, [owner]);
  const openProvider = (id: ProviderId) => {
    directoryScroll.current = surfaceRef.current?.closest<HTMLElement>('[data-modal-scroll]')?.scrollTop ?? 0;
    setProvider(id);
  };
  const search = query.trim().toLocaleLowerCase();
  const filtered = PROVIDERS.filter(id => (!configuredOnly || ready[id]) && `${LLM_PROVIDERS[id].name} ${id}`.toLocaleLowerCase().includes(search));
  const configured = PROVIDERS.filter(id => ready[id]).length;
  const content = <div ref={surfaceRef} className="vg-settings-design vg-provider-settings">
    {onlySpeech ? <><p className="vg-settings-intro">云端识别在设备没有系统识别服务时使用。密钥仅保存在此设备，对话模型和语音服务分开管理。</p><SpeechKeyEditor key={owner}/></> : provider ? <ProviderEditor key={`${owner}:${provider}`} provider={provider} onBack={() => setProvider(null)} onChanged={() => setRevision(value => value + 1)}/> : <>
      <div className="vg-provider-intro"><h3>连接你习惯的 AI</h3><p>选择服务商，配置密钥和模型。支持官方接口、区域地址以及本机或局域网的兼容服务。</p></div>
      <label className="vg-model-search"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" aria-label="搜索服务商" placeholder="搜索服务商，如 Claude、Kimi" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="vg-provider-filters" aria-label="服务商筛选"><button type="button" aria-pressed={!configuredOnly} onClick={() => setConfiguredOnly(false)}>全部服务商 · {PROVIDERS.length}</button><button type="button" aria-pressed={configuredOnly} onClick={() => setConfiguredOnly(true)}>已配置 · {loading ? '…' : configured}</button></div>
      <div className="vg-provider-directory" key={revision}>{filtered.map(id => <button type="button" className="vg-provider-row" key={id} onClick={() => openProvider(id)} aria-label={`配置 ${LLM_PROVIDERS[id].name}`}><span className="vg-provider-mark" aria-hidden="true">{MARKS[id]}</span><span className="vg-provider-copy"><strong>{LLM_PROVIDERS[id].name}</strong><small>{id === 'deepseek' ? '使用登录账号连接' : id === 'custom' ? '本地模型、代理及兼容服务' : LLM_PROVIDERS[id].protocol === 'openai' ? '兼容接口 · 可自定义模型' : '原生接口 · 可自定义模型'}</small></span><span className="vg-provider-status" data-ready={Boolean(ready[id])}>{loading ? '读取中' : getProviderConfig(id).enabled === false ? '已暂停' : ready[id] ? '已配置' : '待配置'}</span><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m9 5 7 7-7 7"/></svg></button>)}</div>
      {filtered.length === 0 && <p className="vg-model-empty">{configuredOnly ? '没有符合条件的已配置服务商。切换到全部服务商即可添加。' : '没有找到匹配的服务商。兼容接口可通过「自定义」接入。'}</p>}
      <section className="vg-provider-speech"><h3>语音服务</h3><SpeechKeyEditor key={owner}/></section>
    </>}
  </div>;
  return embedded ? content : <Modal open onClose={onClose} title={onlySpeech ? '语音识别密钥' : '服务商与 API'} mobileFullHeight panelClassName="vg-settings-panel" canSnapshotOnExit={() => false}>{content}</Modal>;
}
