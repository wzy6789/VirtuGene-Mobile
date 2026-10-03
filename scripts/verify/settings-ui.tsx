import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Character } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { useThemeStore } from '../../src/store/theme-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { SettingsPanel } from '../../src/components/settings/SettingsPanel';
import { ChatHeaderMoreMenu } from '../../src/components/chat/ChatHeaderMoreMenu';
import { WorldControlSheet, type WorldControlAction } from '../../src/components/world/WorldControls';
import { WorldSettingsPage } from '../../src/components/world/WorldSettingsPage';
import { MomentsPage } from '../../src/components/moments/MomentsPage';
import { ModelPickModal } from '../../src/components/chat/ModelPickModal';
import { worldRepo } from '../../src/db/world-repo';
import { upsertWorldFactWithReconcile } from '../../src/lib/world/world-facts';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import { useSlideOutCancel } from '../../src/components/ui/useSlideOutCancel';

const root = createRoot(document.getElementById('root')!);
const owner = 'settings-ui-owner';
const character = { id: 'settings-ui-character', name: '知微', avatar: '🌌', createdBy: owner, voice: DEFAULT_VOICE, systemPrompt: '', tags: [], greeting: '', isPreset: false, isCustom: true, published: false, proactivity: 0, signature: '', createdAt: 1 } as Character;
const actions: WorldControlAction[] = [];
function SettingsFixture({ mode }: { mode: string }) {
  useSlideOutCancel();
  const [open, setOpen] = useState(true);
  const [memory, setMemory] = useState<'memory' | 'present' | 'amnesiac'>('memory');
  const activeView = useUIStore(s => s.activeView);
  return <div className="mobile-layout" style={{ height: '100dvh' }}>
    {activeView === 'moments' || mode === 'moments' ? <MomentsPage /> : mode === 'settings' ? <SettingsPanel open={open} onClose={() => setOpen(false)} /> : mode === 'chat' ? <ChatHeaderMoreMenu character={character} modelLabel="已选会话模型" cost={{ calls: 4, inputTokens: 1200, outputTokens: 450, cost: .005 }} /> : mode === 'world' ? <WorldControlSheet open={open} scene={null} onClose={() => setOpen(false)} busy={false} entryMemoryMode={memory} onAction={action => { actions.push(action); if (action.kind === 'entry_mode') setMemory(action.mode); }} /> : mode === 'facts' ? <WorldSettingsPage /> : <ModelPickModal onClose={() => setOpen(false)} onPick={() => setOpen(false)} />}
  </div>;
}
useThemeStore.subscribe(state => document.documentElement.classList.toggle('dark', state.theme === 'dark'));
async function setup() {
  useAuthStore.setState({ userId: owner, username: '小林', apiKey: '' });
  useSettingsStore.setState({ chatFontSize: 14, ttsEnabled: true, aiVoiceMode: false, ttsSpeed: 1, ttsEngine: 'edge', diaryPin: null, diaryReminderEnabled: false, diaryReminderTime: '21:00', diaryAiEnabled: true, defaultModel: null });
  useThemeStore.setState({ theme: 'dark' });
  useChatStore.setState({ characters: [character] });
  await db.characters.put(character);
  const world = await worldRepo.ensureDefaultWorld(owner);
  await upsertWorldFactWithReconcile({ userId: owner, worldId: world.id, category: 'rule', content: '这里一直是秋天。', visibility: 'world', sourceType: 'user', sourceId: 'settings-demo-rule' });
}
(window as any).settingsUITest = {
  db, useSettingsStore, useThemeStore, useUIStore, actions,
  mount: async (mode: string) => { await setup(); actions.length = 0; useUIStore.setState({ activeView: 'chat', momentsSettingsRequested: mode === 'moments' }); root.render(<SettingsFixture key={crypto.randomUUID()} mode={mode} />); },
};
document.documentElement.dataset.settingsReady = 'true';
