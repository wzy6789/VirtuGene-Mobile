import { DEFAULT_MODEL_ID, findModel, isProviderId } from '../../lib/ai/llm';
import { Modal } from '../ui/Modal';
import { useSettingsStore } from '../../store/settings-store';
import { ModelList } from '../settings/ModelList';
import { useModelCatalog } from '../settings/useModelCatalog';
import '../../styles/model-settings.css';

/** Lock a configured provider/model pair to this conversation. */
export function ModelPickModal({ onPick, onClose }: { onPick: (model: { provider: string; model: string } | null) => void; onClose: () => void }) {
  const defaultModel = useSettingsStore(s => s.defaultModel);
  const { models, ready, loading } = useModelCatalog();
  const available = models.filter(model => ready[model.provider]);
  const currentDefault = defaultModel ?? { provider: 'deepseek', model: DEFAULT_MODEL_ID };
  const resolvedDefault = isProviderId(currentDefault.provider) ? findModel(currentDefault.model, currentDefault.provider) : undefined;
  const defaultReady = Boolean(ready[currentDefault.provider as keyof typeof ready]);

  return <Modal open onClose={onClose} title="选择对话模型" panelClassName="vg-settings-panel" mobileFullHeight canSnapshotOnExit={() => false}>
    <div className="vg-settings-design vg-model-settings">
      <p className="vg-settings-intro">选定后，这个角色会话将固定使用该模型。这里只显示已配置的服务商；可在「我的 → 设置 → AI 连接」添加或调整。</p>
      {loading ? <p className="vg-model-empty" role="status">正在读取可用模型…</p> : <>
        {available.length === 0 && <p className="vg-model-empty">暂无可用的模型，请先在「我的 → 设置 → AI 连接」配置 API。</p>}
        <ModelList mode="button" models={available} ready={ready} onChange={onPick} includeDefault={available.length > 0 || defaultReady} defaultLabel="使用全局默认" defaultDetail={resolvedDefault?.label ?? currentDefault.model} defaultUnavailable={!defaultReady} />
        {available.length > 0 && !defaultReady && <p className="vg-provider-note mt-4">全局默认模型尚未连接。你可以直接选择上方可用模型。</p>}
      </>}
    </div>
  </Modal>;
}
