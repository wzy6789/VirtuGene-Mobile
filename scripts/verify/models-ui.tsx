import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiKeyManager } from '../../src/components/settings/ApiKeyManager';
import { ModelSection } from '../../src/components/settings/ModelSection';
import { ModelPickModal } from '../../src/components/chat/ModelPickModal';
import { Modal } from '../../src/components/ui/Modal';
import { useAuthStore } from '../../src/store/auth-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { getProviderConfig, saveProviderConfig, getAvailableModels } from '../../src/lib/ai/provider-config';
import { LLM_PROVIDERS } from '../../src/lib/ai/llm';
import { loadSecret } from '../../src/lib/api-key-storage';

const root = createRoot(document.getElementById('root')!);
const picks: Array<{ provider: string; model: string } | null> = [];
let mountId = 0;
function Fixture({ mode }: { mode: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return <p>已关闭</p>;
  return <div className="mobile-layout" style={{ height: '100dvh' }}>
    {mode === 'picker' ? <ModelPickModal onClose={() => setOpen(false)} onPick={model => picks.push(model)}/> : mode === 'default' ? <Modal open title="默认对话模型" panelClassName="vg-settings-panel" mobileFullHeight onClose={() => setOpen(false)}><div className="vg-settings-design"><ModelSection/></div></Modal> : <ApiKeyManager onClose={() => setOpen(false)} onlySpeech={mode === 'speech'}/>}
  </div>;
}
useAuthStore.setState({ userId: 'models-ui-owner', apiKey: null, gatewayAccessToken: null });
(window as any).modelsUITest = {
  useAuthStore, useSettingsStore, getProviderConfig, saveProviderConfig, getAvailableModels, LLM_PROVIDERS, loadSecret, picks,
  mount(mode = 'providers') { root.render(<Fixture key={++mountId} mode={mode}/>); },
};
document.documentElement.dataset.modelsReady = 'true';
