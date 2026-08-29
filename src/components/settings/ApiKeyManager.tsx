import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { persistSecret, loadSecret, clearSecret } from '../../lib/api-key-storage';
import { LLM_MODELS, llmChat, type ProviderId } from '../../lib/ai/llm';
import { CLOUD_ASR_KEY_NAME } from '../../lib/cloud-asr';

/** API Key 管理（手机端「我的」页）：DeepSeek 随账号 / 千问 / 小米 MiMo / 硅基（语音转文字） */
export function ApiKeyManager({ onClose }: { onClose: () => void }) {
  const deepseekKey = useAuthStore((s) => s.apiKey);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const KEYS: { name: string; storage: string; provider?: ProviderId; note: string }[] = [
    { name: 'DeepSeek', storage: '', provider: 'deepseek', note: '随登录账号，无需单独配置' },
    { name: '千问 Qwen', storage: 'qwen-key', provider: 'qwen', note: '阿里云百炼（dashscope）' },
    { name: '小米 MiMo', storage: 'mimo-key', provider: 'mimo', note: 'api.xiaomimimo.com' },
    { name: '硅基 SiliconFlow', storage: CLOUD_ASR_KEY_NAME, note: '语音转文字（OPPO 等无系统识别手机用）' },
  ];

  useEffect(() => {
    for (const k of KEYS) {
      if (!k.storage) continue;
      void loadSecret(k.storage).then((v) => setStatus((s) => ({ ...s, [k.name]: !!v })));
    }
  }, []);

  const save = (name: string, storage: string) => {
    const v = (inputs[name] ?? '').trim();
    if (!v || !storage) return;
    void persistSecret(storage, v);
    setInputs((s) => ({ ...s, [name]: '' }));
    setStatus((s) => ({ ...s, [name]: true }));
  };

  const clear = (name: string, storage: string) => {
    if (!storage) return;
    void clearSecret(storage);
    setStatus((s) => ({ ...s, [name]: false }));
  };

  const test = async (provider: ProviderId) => {
    setTesting(provider);
    setTestResult(null);
    const key = provider === 'deepseek' ? deepseekKey : await loadSecret(provider === 'qwen' ? 'qwen-key' : 'mimo-key');
    const model = LLM_MODELS.find((m) => m.provider === provider);
    if (!key || !model) {
      setTestResult('请先填写并保存 Key');
      setTesting(null);
      return;
    }
    try {
      await llmChat({
        provider,
        model: model.id,
        apiKey: key,
        messages: [{ role: 'user', content: '你好，请回复"连接正常"' }],
        timeoutMs: 15_000,
      });
      setTestResult(`${provider === 'deepseek' ? 'DeepSeek' : provider === 'qwen' ? '千问' : 'MiMo'} 连接正常 ✅`);
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      setTestResult(msg === 'auth:invalid_key' ? 'Key 无效' : `连接失败（${msg}）`);
    } finally {
      setTesting(null);
    }
  };

  const rowCls = 'w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-line bg-panel/60 hover:border-gene-purple/40 transition-colors';

  return (
    <div className="fixed inset-0 z-[85] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm glass-card rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <span className="text-sm font-medium text-ink">API Key 管理</span>
          <button onClick={onClose} className="text-gray-400 hover:text-ink text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-[11px] text-gray-500">所有 Key 设备加密保存，不落明文。DeepSeek 随登录账号；其余按需填写。</p>

          {KEYS.map((k) => (
            <div key={k.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-ink">{k.name}</span>
                <span className="text-[10px] text-life-cyan">
                  {k.provider === 'deepseek' ? '账号已绑定' : status[k.name] ? '已配置' : '未配置'}
                </span>
              </div>
              {k.provider === 'deepseek' ? (
                <div className={rowCls}>
                  <span className="text-[11px] text-gray-500">{k.note}</span>
                  <button onClick={() => void test('deepseek')} disabled={testing === 'deepseek'} className="text-[11px] text-gray-400 hover:text-life-cyan disabled:opacity-40">
                    {testing === 'deepseek' ? '测试中…' : '测试连接'}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="password"
                      value={inputs[k.name] ?? ''}
                      onChange={(e) => setInputs((s) => ({ ...s, [k.name]: e.target.value }))}
                      placeholder={`${k.name} Key…`}
                      autoComplete="off"
                      className="flex-1 min-w-0 bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder-gray-500 outline-none focus:border-gene-purple transition-colors"
                    />
                    <button onClick={() => save(k.name, k.storage)} className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] bg-gene-purple/15 text-gene-purple hover:bg-gene-purple/25 transition-colors">
                      保存
                    </button>
                    {status[k.name] && (
                      <>
                        {k.provider && (
                          <button onClick={() => void test(k.provider!)} disabled={testing === k.provider} className="shrink-0 px-2 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-life-cyan transition-colors disabled:opacity-40">
                            {testing === k.provider ? '测试中…' : '测试'}
                          </button>
                        )}
                        <button onClick={() => clear(k.name, k.storage)} className="shrink-0 px-2 py-1.5 rounded-lg text-[11px] text-gray-400 hover:text-red-400 transition-colors">
                          清除
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{k.note}</p>
                </>
              )}
            </div>
          ))}

          {testResult && <p className="text-[11px] text-life-cyan">{testResult}</p>}
        </div>
      </div>
    </div>
  );
}
