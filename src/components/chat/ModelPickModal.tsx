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
      <p className="vg-settings-intro">选定后，本会话固定使用该模型。</p>
      {loading ? <p className="vg-model-empty" role="status">正在读取可用模型…</p> : <>
        {available.length === 0 && <p className="vg-model-empty">暂无模型，请在“我的”中配置“AI 连接”。</p>}
        <ModelList mode="button" models={available} ready={ready} onChange={onPick} includeDefault={available.length > 0 || defaultReady} defaultLabel="使用全局默认" defaultDetail={resolvedDefault?.label ?? currentDefault.model} defaultUnavailable={!defaultReady} />
        {available.length > 0 && !defaultReady && <p className="vg-provider-note mt-4">全局默认模型尚未连接。</p>}
      </>}
    </div>
  </Modal>;
}
