import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { MobileChatListPage } from '../../src/components/chat/MobileChatListPage';
import { MobileCharacterPage } from '../../src/components/character/MobileCharacterPage';
import { ChangePasswordSection } from '../../src/components/settings/ChangePasswordSection';
import { BackupSection } from '../../src/components/settings/BackupSection';
import { PinSettingsModal } from '../../src/components/diary/DiaryLock';
import { MomentsPage } from '../../src/components/moments/MomentsPage';
import { ChatInput } from '../../src/components/chat/ChatInput';
import { db } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useGroupStore } from '../../src/store/group-store';
import { loadMomentsPreferences } from '../../src/lib/moments/preferences';
import { fakeCharacter } from './world-harness';

let root: Root | undefined, selected = 0, network = 0;
const sent: string[] = [];
let setGenerating: (value: boolean) => void = () => undefined;
function ComposerFixture() {
  const [generating, updateGenerating] = useState(false); setGenerating = updateGenerating;
  return <div className="flex h-full flex-col justify-end"><ChatInput onSend={text => sent.push(text)} onSendImage={() => undefined} onSendVoice={() => undefined} disabled={generating} onStop={generating ? () => updateGenerating(false) : undefined} /></div>;
}
window.fetch = (() => { network++; throw Error('No external requests in compact dialog verification'); }) as typeof fetch;
function PinFixture() {
  const [open, setOpen] = useState(true);
  return <PinSettingsModal open={open} currentPin={null} onClose={() => setOpen(false)} onSave={() => setOpen(false)} />;
}
async function setup(view: string) {
  root?.unmount(); root = undefined;
  await db.delete(); await db.open(); selected = 0; sent.length = 0;
  useAuthStore.setState({ userId: 'dialog-user', username: 'dialog-user', apiKey: null });
  const character = fakeCharacter('dialog-role', '待整理的对话', 'dialog-user');
  await db.characters.add(character);
  await db.sessions.add({ id: 'dialog-session', characterId: character.id, userId: 'dialog-user', title: character.name, createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 3 });
  await db.messages.add({ id: 'dialog-message', sessionId: 'dialog-session', role: 'assistant', content: '这段聊天记录需要保留。', createdAt: Date.now(), isProactive: false });
  useChatStore.setState({ characters: [character], charPreviews: {}, unreadByCharacter: {}, selectedCharacterId: null, currentSessionId: null });
  useGroupStore.setState({ groups: [], groupPreviews: {} });
  root = createRoot(document.getElementById('app')!);
  root.render(view === 'chats' ? <MobileChatListPage onSelect={() => { selected++; }} />
    : view === 'roles' ? <MobileCharacterPage onSelect={() => undefined} />
    : view === 'password' ? <ChangePasswordSection />
    : view === 'backup' ? <BackupSection />
    : view === 'pin' ? <PinFixture /> : view === 'composer' ? <ComposerFixture /> : <MomentsPage />);
}
(window as any).compactDialogs = { setup, selected: () => selected, network: () => network,
  record: () => db.characters.get('dialog-role'), messages: () => db.messages.count(),
  unread: async () => (await db.sessions.get('dialog-session'))?.unreadCount,
  history: () => loadMomentsPreferences('dialog-user').historyWindow,
  sent: () => sent, generating: (value: boolean) => setGenerating(value),
  switchAccount: () => useAuthStore.setState({ userId: 'different-user' }) };
