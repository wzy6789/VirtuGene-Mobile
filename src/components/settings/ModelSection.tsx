import { useSettingsStore } from '../../store/settings-store';
import { useAuthStore } from '../../store/auth-store';
import { LLM_MODELS, LLM_PROVIDERS } from '../../lib/ai/llm';

/** 对话模型设置（手机端）：默认模型选择 + 使用规则说明（API Key 配置在「我的 → API Key」） */
export function ModelSection() {
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const deepseekKey = useAuthStore((s) => s.apiKey);

  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-3">对话模型</h3>
      <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
        {/* 默认模型选择 */}
        <div>
          <p className="text-xs text-ink mb-2">默认对话模型</p>
          <p className="text-[10px] text-gray-500 mb-2">
            首次进入某角色聊天时会让你选模型并锁定（聊天中不可改）；这里设的是默认值。API Key 在「我的 → API Key」配置。
          </p>
          <div className="space-y-1">
            {LLM_MODELS.map((m) => {
              const ready = m.provider === 'deepseek' ? !!deepseekKey : null;
              const active = defaultModel?.model === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setDefaultModel(active ? null : { provider: m.provider, model: m.id })}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors ${
                    active
                      ? 'bg-gene-purple/15 border-gene-purple/40 text-gene-purple'
                      : 'bg-panel/60 border-line text-sub hover:border-gene-purple/40'
                  }`}
                >
                  <span>{m.label}</span>
                  {active ? (
                    <span className="text-[10px] text-gene-purple">使用中</span>
                  ) : ready === false ? (
                    <span className="text-[10px] text-gray-400">未登录</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-px bg-line" />

        {/* 使用规则说明 */}
        <div className="rounded-lg bg-panel/60 border border-line px-3 py-2.5 space-y-1.5">
          <p className="text-[11px] text-ink">什么时候用哪个模型</p>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            · <span className="text-sub">发图片</span>：自动用 DeepSeek 识图模型看图片；千问 / MiMo 发图会降级为"[图片]"文字
          </p>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            · <span className="text-sub">纯文字对话</span>：用你选的模型（DeepSeek 会先思考再回答，质量优先）
          </p>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            · <span className="text-sub">DeepSeek</span>：文字轮思考、看图轮不思考（识图快）；<span className="text-sub">MiMo</span> 思考模式默认开启
          </p>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            · <span className="text-sub">角色群聊</span>：用全局默认模型生成
          </p>
          <p className="text-[10px] text-gray-400 leading-relaxed">
            服务商：{LLM_PROVIDERS.deepseek.name} / {LLM_PROVIDERS.qwen.name} / {LLM_PROVIDERS.mimo.name}
          </p>
        </div>
      </div>
    </div>
  );
}
