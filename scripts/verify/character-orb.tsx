import React from 'react';
import { createRoot } from 'react-dom/client';
import { db, type Character } from '../../src/db';
import { CharacterSoulOrb } from '../../src/components/chat/CharacterSoulOrb';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useEmotionStore } from '../../src/store/emotion-store';
import { ChatPage } from '../../src/pages/ChatPage';
const root = createRoot(document.getElementById('root')!);
let role: Character;
async function seed() {
  await db.open(); await Promise.all(db.tables.map(t => t.clear()));
  useAuthStore.setState({ userId: 'orb-user', isLoggedIn: true });
  role = { id: 'orb-role', name: '晓来', avatar: '🌙', createdBy: 'orb-user', createdAt: Date.now(), isPreset: false, isCustom: true, published: false, tags: [], proactivity: 0, systemPrompt: '' };
  await db.characters.put(role);
  await db.sessions.put({ id: 'orb-session', characterId: role.id, userId: 'orb-user', title: role.name, type: 'single', modelAsked: true, createdAt: Date.now(), updatedAt: Date.now(), unreadCount: 0 });
  await db.memories.put({ id: 'orb-memory', characterId: role.id, userId: 'orb-user', content: '喜欢周末去公园', importance: 5, createdAt: Date.now() });
  await db.memories.bulkPut([
    {id:'orb-pin',characterId:role.id,userId:'orb-user',type:'auto',content:'重要的约定：忙的时候也记得好好休息。',memoryKind:'promise',pinned:true,createdAt:Date.now()+1},
    {id:'orb-recent',characterId:role.id,userId:'orb-user',type:'auto',content:'一起聊过傍晚的天空，想把这段安静的时间留下。',memoryKind:'episode',createdAt:Date.now()+2},
    {id:'orb-fourth',characterId:role.id,userId:'orb-user',type:'auto',content:'喜欢下雨时听窗外的声音。',memoryKind:'preference',createdAt:Date.now()+2},
    {id:'orb-hidden',characterId:role.id,userId:'orb-user',type:'auto',content:'已经撤回的记忆',status:'withdrawn',createdAt:Date.now()+3},
    {id:'orb-private',characterId:role.id,userId:'another-user',type:'auto',content:'其他账号的私人记忆',createdAt:Date.now()+4},
  ]);
  useChatStore.setState({ selectedCharacterId: role.id, currentSessionId: 'orb-session', characters: [role], messages: [] });
  mount();
}
function mount(sending = false, streaming = false, failed = false) { root.render(<CharacterSoulOrb character={role} sending={sending} streaming={streaming} failed={failed} />); }
function snapshot(valence: number, characterId = role.id, dominantEmotion = '开心', summary = '今天聊得很开心') { useEmotionStore.setState({ currentSnapshot: { id: 'orb-snap', characterId, sessionId: 'orb-session', dimensions: { valence, arousal: 5, intimacy: 5, engagement: 5, expressiveness: 5, stability: 5 }, summary, dominantEmotion, messageCount: 2, createdAt: Date.now() } }); }
(window as any).orbTest = { seed, mount, snapshot, chat: async () => { await seed(); root.render(<ChatPage />); }, switchRole: () => { role = { ...role, id: 'other-role', name: '另一个角色' }; useChatStore.setState({ selectedCharacterId: role.id, currentSessionId: 'other-session', characters: [role] }); mount(); }, switchOwner: () => useAuthStore.setState({ userId: 'another-user' }), assistant: () => { role = { ...role, agentProfile: 'secretary' }; mount(); } };
