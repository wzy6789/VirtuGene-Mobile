import { FeedbackNotice } from '../ui/FeedbackNotice';
import { useSettingsStore } from '../../store/settings-store';
import { DEFAULT_MODEL_ID, findModel, isProviderId, LLM_PROVIDERS } from '../../lib/ai/llm';
import { ModelList } from './ModelList';
import { SettingsExplanation } from './SettingsUI';
import { useModelCatalog } from './useModelCatalog';
import '../../styles/model-settings.css';

export function ModelSection({ onManageProviders }: { onManageProviders?: () => void }) {
  const defaultModel = useSettingsStore(s => s.defaultModel);
  const setDefaultModel = useSettingsStore(s => s.setDefaultModel);
  const { models, ready, loading } = useModelCatalog();
  // Retain a previously selected exact ID, including models later removed from the directory.
  const current = defaultModel && isProviderId(defaultModel.provider) ? findModel(defaultModel.model, defaultModel.provider) ?? { id: defaultModel.model, label: defaultModel.model, provider: defaultModel.provider } : null;
  const choices = current && !models.some(model => model.id === current.id && model.provider === current.provider) ? [current, ...models] : models;
  const systemModel = findModel(DEFAULT_MODEL_ID, 'deepseek');
  return <div className="vg-model-settings">
    <p className="vg-settings-intro">用于新会话；已有非 DeepSeek 会话沿用原选择。</p>
    <ModelList models={choices} ready={ready} value={defaultModel} includeDefault onChange={setDefaultModel} defaultDetail={systemModel?.label ?? '使用软件默认模型'} />
    {defaultModel && !ready[defaultModel.provider as keyof typeof ready] && !loading && <FeedbackNotice className="mt-3" tone="error" message={`当前模型尚未连接。请先配置 ${LLM_PROVIDERS[defaultModel.provider as keyof typeof LLM_PROVIDERS]?.name ?? '对应服务商'} 的 API，发送时将保留你的选择。`} />}
    {onManageProviders && <button type="button" onClick={onManageProviders} className="vg-provider-button mt-4">管理服务商与 API</button>}
    <p className="vg-provider-note mt-4">接口费用由所选服务商收取。</p>
    <SettingsExplanation title="模型选择与会话范围">
      <p>DeepSeek 统一使用 Flash，旧会话自动接续；其他服务商的已有会话沿用固定模型。</p>
      <p>未配置的模型可先选定，再到服务商设置完成连接。模型 ID 须与服务商一致。</p>
      <p>「图片」表示支持图片输入；手动添加时需按服务商说明确认能力和权限。</p>
      <p>未指定模型的角色群聊等场景使用全局默认。</p>
    </SettingsExplanation>
  </div>;
}
