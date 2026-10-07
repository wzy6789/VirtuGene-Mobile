import { createRoot } from 'react-dom/client';
import { CharacterAddModal } from '../../src/components/character/CharacterAddModal';
import { db } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
import { fakeCharacter } from './world-harness';
import { ensureOwnedChatCharacter } from '../../src/lib/character-chat';
import { ImmersiveSceneCard } from '../../src/components/chat/ImmersiveSceneCard';

const owner = 'profile-preview-owner';
let root: ReturnType<typeof createRoot> | undefined, selected = 0, network = 0;
window.fetch = (() => { network++; throw Error('No paid calls allowed in profile test'); }) as typeof fetch;
async function setup(existing = false, shared = false) {
  root?.unmount(); root = undefined;
  await db.delete(); await db.open();
  selected = 0; network = 0;
  useAuthStore.getState().login(owner, '测试', null, '');
  useSettingsStore.setState({ aiVoiceMode: false });
  const source = fakeCharacter('source-profile', '艾莉', shared ? 'other-owner' : 'preset', {
    isPreset: !shared, published: shared, avatar: '🌌', tags: ['开朗', '好奇', '浪漫'],
    signature: '基因告诉我，我们注定相遇', greeting: '你好呀！基因告诉我，今天会遇见一个有趣的人——果然没错。',
    catchphrase: '果然没错', boundaries: '尊重彼此的生活', model: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  });
  await db.characters.add(source);
  if (existing) {
    await db.characters.add({ ...source, id: 'existing-copy', createdBy: owner, isPreset: false, published: false, sourcePresetId: source.id, signature: '用户改过的签名' });
    await db.sessions.add({ id: 'existing-session', characterId: 'existing-copy', userId: owner, title: '原来的聊天', createdAt: 1, updatedAt: 1, modelAsked: true });
    await db.messages.add({ id: 'old-message', sessionId: 'existing-session', role: 'user', content: '我们之前聊过的话', createdAt: 2, isProactive: false });
  }
  useChatStore.setState({ characters: [], messages: [], currentSessionId: null, selectedCharacterId: null });
  root = createRoot(document.getElementById('app')!);
  root.render(<CharacterAddModal open onClose={() => undefined} onSelected={() => { selected++; root?.render(<div>已进入聊天</div>); }} />);
}
(window as any).characterProfile = { setup,
  scene: async () => {
    const character = (await db.characters.get('source-profile'))!;
    await db.sessions.put({ id:'scene-session',characterId:character.id,userId:owner,title:'场景测试',createdAt:1,updatedAt:1 });
    root?.render(<ImmersiveSceneCard character={character} userId={owner} sessionId="scene-session" affinity={0} mood={50} onPrompt={() => undefined} />);
  },
  records: async () => ({ characters: await db.characters.toArray(), sessions: await db.sessions.toArray(), messages: await db.messages.toArray(), selected, network, selectedId: useChatStore.getState().selectedCharacterId, sessionId: useChatStore.getState().currentSessionId }),
  concurrent: async () => { const source = (await db.characters.get('source-profile'))!; const result = await Promise.all([ensureOwnedChatCharacter(source, owner), ensureOwnedChatCharacter(source, owner)]); return result.map(c => c.id); },
};
