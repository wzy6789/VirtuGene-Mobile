import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Character, type WorldScene, type WorldLocation } from '../../src/db';
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
import { TodoPage } from '../../src/components/todo/TodoPage';
import { LivingWorldHero } from '../../src/components/character/LivingWorldHero';
import { installThemePreferences } from '../../src/lib/theme';
import { installUiFont } from '../../src/lib/ui-font';
import { GroupChatPage } from '../../src/components/chat/GroupChatPage';
import { useGroupStore } from '../../src/store/group-store';
import { MobileMePage } from '../../src/components/layout/MobileMePage';
import { WeeklyLifeReviewModal } from '../../src/components/insights/WeeklyLifeReviewModal';
import { WorldExplorePanel } from '../../src/components/world/WorldExplorePanel';
import { AuthPage } from '../../src/pages/AuthPage';

const root = createRoot(document.getElementById('root')!);
const owner = 'settings-ui-owner';
const character = { id: 'settings-ui-character', name: '知微', avatar: '🌌', createdBy: owner, voice: DEFAULT_VOICE, systemPrompt: '', tags: [], greeting: '', isPreset: false, isCustom: true, published: false, proactivity: 0, signature: '', createdAt: 1 } as Character;
const actions: WorldControlAction[] = [];
const scene: WorldScene = { id:'audit-scene',userId:owner,worldId:'audit-world',title:'秋日相聚',place:'星光庭院',timeLabel:'傍晚',mood:'平静',characterIds:[],status:'active',state:{currentAct:1,currentTension:0,activeSecrets:[],activeConflicts:[],pendingConsequences:[],resolvedEventIds:[],newEventIds:[],participants:[]},startedAt:1,createdAt:1,updatedAt:1 };
const location: WorldLocation = {id:'audit-location',userId:owner,worldId:scene.worldId,name:'湖畔书屋',type:'place',active:true,sourceType:'user',createdAt:1,updatedAt:1};
function SettingsFixture({ mode }: { mode: string }) {
  useSlideOutCancel();
  const [open, setOpen] = useState(true);
  const [memory, setMemory] = useState<'memory' | 'present' | 'amnesiac'>('memory');
  const activeView = useUIStore(s => s.activeView);
  return <div className="mobile-layout" style={{ height: '100dvh' }}>
    {mode === 'me' && <MobileMePage />}
    {mode === 'weekly' && <WeeklyLifeReviewModal open={open} onClose={() => setOpen(false)} />}
    {mode === 'explore' && open && <WorldExplorePanel scene={scene} locations={[location]} presence={[]} agents={[]} characters={[character]} onClose={() => setOpen(false)} onMove={() => {}} />}
    {mode === 'auth' && <AuthPage />}
    {mode === 'todo' && <TodoPage />}
    {mode === 'hero' && <LivingWorldHero characters={[character]} states={{}} onCreate={() => {}} onOpenNetwork={() => {}} />}
    {mode === 'group' && open && <GroupChatPage onClose={() => setOpen(false)} />}
    {['todo','hero','group','me','weekly','explore','auth'].includes(mode) ? null : activeView === 'moments' || mode === 'moments' ? <MomentsPage /> : mode === 'settings' ? <SettingsPanel open={open} onClose={() => setOpen(false)} /> : mode === 'chat' ? <ChatHeaderMoreMenu character={character} modelLabel="已选会话模型" cost={{ calls: 4, inputTokens: 1200, outputTokens: 450, cost: .005 }} /> : mode === 'world' ? <WorldControlSheet open={open} scene={null} onClose={() => setOpen(false)} busy={false} entryMemoryMode={memory} onAction={action => { actions.push(action); if (action.kind === 'entry_mode') setMemory(action.mode); }} /> : mode === 'facts' ? <WorldSettingsPage /> : <ModelPickModal onClose={() => setOpen(false)} onPick={() => setOpen(false)} />}
  </div>;
}
installThemePreferences();
installUiFont();
async function setup() {
  useAuthStore.setState({ userId: owner, username: '小林', apiKey: '' });
  useSettingsStore.setState({ chatFontSize: 14, ttsEnabled: true, aiVoiceMode: false, ttsSpeed: 1, ttsEngine: 'edge', diaryPin: null, diaryReminderEnabled: false, diaryReminderTime: '21:00', diaryAiEnabled: true, defaultModel: null });
  useThemeStore.getState().setTheme('dark');
  useChatStore.setState({ characters: [character] });
  await db.characters.put(character);
  const world = await worldRepo.ensureDefaultWorld(owner);
  await upsertWorldFactWithReconcile({ userId: owner, worldId: world.id, category: 'rule', content: '这里一直是秋天。', visibility: 'world', sourceType: 'user', sourceId: 'settings-demo-rule' });
}
(window as any).settingsUITest = {
  db, useSettingsStore, useThemeStore, useUIStore, useGroupStore, actions,
  mount: async (mode: string) => {
    await setup();
    if(mode==='group') {
      const second={...character,id:'settings-second-character',name:'清和'};
      await db.characters.put(second); useChatStore.setState({characters:[character,second]});
      await useGroupStore.getState().createGroup('界面验收群',[character.id,second.id]);
    }
    actions.length=0; useUIStore.setState({activeView:'chat',momentsSettingsRequested:mode==='moments'});
    root.render(<SettingsFixture key={crypto.randomUUID()} mode={mode} />);
  },
};
document.documentElement.dataset.settingsReady = 'true';
