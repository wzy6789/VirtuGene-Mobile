import { useSettingsStore } from '../../store/settings-store';
import { DEFAULT_MODEL_ID, findModel, isProviderId, LLM_PROVIDERS } from '../../lib/ai/llm';
import { ModelList } from './ModelList';
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
    <p className="vg-settings-intro">为新会话选择默认模型。已经固定模型的角色会话保留原来的选择。未配置的模型可以先选定，再到服务商设置中完成连接。</p>
    <ModelList models={choices} ready={ready} value={defaultModel} includeDefault onChange={setDefaultModel} defaultDetail={systemModel?.label ?? '使用软件默认模型'} />
    {defaultModel && !ready[defaultModel.provider as keyof typeof ready] && !loading && <p className="vg-provider-message" data-tone="error">当前模型尚未连接。请先配置 {LLM_PROVIDERS[defaultModel.provider as keyof typeof LLM_PROVIDERS]?.name ?? '对应服务商'} 的 API，发送时将保留你的选择。</p>}
    {onManageProviders && <button type="button" onClick={onManageProviders} className="vg-provider-button mt-4">管理服务商与 API</button>}
    <div className="vg-model-guidance">
      <h3>选择前，了解两件事</h3>
      <p>标有「图片」的模型支持图片输入。模型能力和可用权限由服务商与账户决定；手动添加模型时，需要按服务商说明确认是否支持图片。</p>
      <p>模型 ID 需要与服务商一致。可以在服务商设置中查询可用模型或手动添加；自定义服务使用其实际提供的模型 ID。</p>
      <p>未指定模型的角色群聊等场景使用全局默认。接口费用由你所使用的服务商收取。</p>
    </div>
  </div>;
}
