import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../store/settings-store';
import { useAuthStore } from '../../store/auth-store';
import { persistSecret, loadSecret, clearSecret } from '../../lib/api-key-storage';
import { LLM_MODELS, LLM_PROVIDERS, llmChat, type ProviderId } from '../../lib/ai/llm';

/** 对话模型设置（手机端）：服务商 Key 配置 + 测试连接 + 默认模型选择 */
export function ModelSection() {
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const deepseekKey = useAuthStore((s) => s.apiKey);

  const [qwenKey, setQwenKey] = useState('');
  const [mimoKey, setMimoKey] = useState('');
  const [hasQwen, setHasQwen] = useState(false);
  const [hasMimo, setHasMimo] = useState(false);
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void loadSecret('qwen-key').then((k) => setHasQwen(!!k));
    void loadSecret('mimo-key').then((k) => setHasMimo(!!k));
  }, []);

  /** 测试服务商连接（最小 chat 调用） */
  const testProvider = async (provider: ProviderId, apiKey: string) => {
    setTesting(provider);
    setTestResult(null);
    const model = LLM_MODELS.find((m) => m.provider === provider);
    try {
      await llmChat({
        provider,
        model: model?.id ?? '',
        apiKey,
        messages: [{ role: 'user', content: '你好，请回复"连接正常"' }],
        timeoutMs: 15_000,
      });
      setTestResult(`${LLM_PROVIDERS[provider].name} 连接正常 ✅`);
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      setTestResult(
        msg === 'auth:invalid_key'
          ? `${LLM_PROVIDERS[provider].name} Key 无效`
          : `${LLM_PROVIDERS[provider].name} 连接失败（${msg}）`,
      );
    } finally {
      setTesting(null);
    }
  };

  const saveKey = (provider: ProviderId, key: string) => {
    const k = key.trim();
    if (!k) return;
    void persistSecret(provider === 'qwen' ? 'qwen-key' : 'mimo-key', k);
    if (provider === 'qwen') {
      setQwenKey('');
      setHasQwen(true);
    } else {
      setMimoKey('');
      setHasMimo(true);
    }
  };

  const clearKey = (provider: ProviderId) => {
    void clearSecret(provider === 'qwen' ? 'qwen-key' : 'mimo-key');
    if (provider === 'qwen') setHasQwen(false);
    else setHasMimo(false);
    // 清掉依赖该服务商的默认模型选择
    if (defaultModel?.provider === provider) setDefaultModel(null);
  };

  /** 该服务商是否可用（key 已配置） */
  const providerReady = (provider: ProviderId): boolean =>
    provider === 'deepseek' ? !!deepseekKey : provider === 'qwen' ? hasQwen : hasMimo;

  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-3">对话模型</h3>
      <div className="p-4 rounded-xl bg-surface border border-line space-y-4">
        {/* 服务商 Key */}
        <div className="space-y-3">
          <p className="text-[11px] text-gray-500">配置各服务商的 API Key（设备加密保存）。选择模型后可切换对话使用的 AI。</p>

          {/* DeepSeek（随账号） */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink">DeepSeek</span>
            <span className="text-[10px] text-life-cyan">账号已绑定</span>
          </div>

          {/* 千问 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-ink">千问 Qwen</span>
              <span className="text-[10px] text-life-cyan">{hasQwen ? '已配置' : '未配置'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                value={qwenKey}
                onChange={(e) => setQwenKey(e.target.value)}
                placeholder="sk-…（阿里云百炼）"
                autoComplete="off"
                className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder-gray-500 outline-none focus:border-gene-purple transition-colors"
              />
              <button
                onClick={() => saveKey('qwen', qwenKey)}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] bg-gene-purple/15 text-gene-purple hover:bg-gene-purple/25 transition-colors"
              >
                保存
              </button>
              {hasQwen && (
                <>
                  <button
                    onClick={() => void (async () => {
                      const k = await loadSecret('qwen-key');
                      if (k) void testProvider('qwen', k);
                    })()}
                    disabled={testing === 'qwen'}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-life-cyan transition-colors disabled:opacity-40"
                  >
                    {testing === 'qwen' ? '测试中…' : '测试'}
                  </button>
                  <button
                    onClick={() => clearKey('qwen')}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-red-400 transition-colors"
                  >
                    清除
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 小米 MiMo */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-ink">小米 MiMo</span>
              <span className="text-[10px] text-life-cyan">{hasMimo ? '已配置' : '未配置'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                value={mimoKey}
                onChange={(e) => setMimoKey(e.target.value)}
                placeholder="key…（api.xiaomimimo.com）"
                autoComplete="off"
                className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder-gray-500 outline-none focus:border-gene-purple transition-colors"
              />
              <button
                onClick={() => saveKey('mimo', mimoKey)}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] bg-gene-purple/15 text-gene-purple hover:bg-gene-purple/25 transition-colors"
              >
                保存
              </button>
              {hasMimo && (
                <>
                  <button
                    onClick={() => void (async () => {
                      const k = await loadSecret('mimo-key');
                      if (k) void testProvider('mimo', k);
                    })()}
                    disabled={testing === 'mimo'}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-life-cyan transition-colors disabled:opacity-40"
                  >
                    {testing === 'mimo' ? '测试中…' : '测试'}
                  </button>
                  <button
                    onClick={() => clearKey('mimo')}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-red-400 transition-colors"
                  >
                    清除
                  </button>
                </>
              )}
            </div>
          </div>

          {testResult && <p className="text-[11px] text-life-cyan">{testResult}</p>}
        </div>

        <div className="h-px bg-line" />

        {/* 默认模型选择 */}
        <div>
          <p className="text-xs text-ink mb-2">默认对话模型</p>
          <p className="text-[10px] text-gray-500 mb-2">所有角色默认使用；角色可单独指定（资料卡中设置）。</p>
          <div className="space-y-1">
            {LLM_MODELS.map((m) => {
              const ready = providerReady(m.provider);
              const active = defaultModel?.model === m.id;
              return (
                <button
                  key={m.id}
                  disabled={!ready}
                  onClick={() => setDefaultModel(active ? null : { provider: m.provider, model: m.id })}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors disabled:opacity-40 ${
                    active
                      ? 'bg-gene-purple/15 border-gene-purple/40 text-gene-purple'
                      : 'bg-panel/60 border-line text-sub hover:border-gene-purple/40'
                  }`}
                >
                  <span>{m.label}</span>
                  {active ? (
                    <span className="text-[10px] text-gene-purple">使用中</span>
                  ) : !ready ? (
                    <span className="text-[10px] text-gray-400">未配置 Key</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
