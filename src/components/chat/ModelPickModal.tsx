import { useEffect, useState } from 'react';
import { LLM_MODELS, LLM_PROVIDERS, findModel, type ProviderId } from '../../lib/ai/llm';
import { loadSecret } from '../../lib/api-key-storage';
import { useAuthStore } from '../../store/auth-store';

/**
 * 首次进入聊天时的对话模型选择弹窗：
 * 仅列出「已配置 API Key 的服务商」的模型（DeepSeek 随账号；Qwen/MiMo 需已填 key）。
 * 选定后锁定到会话（聊天中不可再改）；选「默认」则用全局默认模型。
 */
export function ModelPickModal({ onPick, onClose }: { onPick: (model: { provider: string; model: string } | null) => void; onClose: () => void }) {
  const deepseekKey = useAuthStore((s) => s.apiKey);
  const [ready, setReady] = useState<Record<ProviderId, boolean>>({ deepseek: !!deepseekKey, qwen: false, mimo: false });

  useEffect(() => {
    void loadSecret('qwen-key').then((k) => setReady((r) => ({ ...r, qwen: !!k })));
    void loadSecret('mimo-key').then((k) => setReady((r) => ({ ...r, mimo: !!k })));
  }, []);

  const available = LLM_MODELS.filter((m) => ready[m.provider]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm glass-card rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <span className="text-sm font-medium text-ink">选择对话模型</span>
          <button onClick={onClose} className="text-gray-400 hover:text-ink text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-1">
          <p className="text-[11px] text-gray-500 mb-2">
            首次进入聊天需选定模型，之后该角色对话固定使用（聊天中不可改）。仅显示已配置 Key 的服务商；未配置的可在「我的 → API Key」添加。
          </p>
          {available.length === 0 && (
            <p className="text-xs text-gray-500 py-4 text-center">暂无可用的模型，请先在「我的 → API Key」配置</p>
          )}
          {available.map((m) => (
            <button
              key={m.id}
              onClick={() => onPick({ provider: m.provider, model: m.id })}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-line bg-panel/60 hover:border-gene-purple/40 text-left transition-colors"
            >
              <span className="text-xs text-ink">{m.label}</span>
              <span className="text-[10px] text-gray-400">{LLM_PROVIDERS[m.provider].name}</span>
            </button>
          ))}
          {available.length > 0 && (
            <button
              onClick={() => onPick(null)}
              className="w-full px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-ink transition-colors"
            >
              使用全局默认（{findModel('deepseek-v4-flash')?.label} 等）
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
