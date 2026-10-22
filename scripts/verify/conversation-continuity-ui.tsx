import { createRoot } from 'react-dom/client';
import { db, type Character, type WorldScene, type MemoryItem, type Message, type ContinuityThread } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { useVoiceCallUIStore } from '../../src/store/voice-call-ui-store';
import { memoryRepo } from '../../src/db/memory-repo';
import { publishMemoryWrite, subscribeMemoryWrites } from '../../src/lib/memory-write-events';
import { callOrbPresence } from '../../src/lib/voice-call/orb-presence';
import { latestResumableScene, loadResumableScene } from '../../src/lib/world/resume-scene';
import { MemoryWriteReceipt } from '../../src/components/chat/MemoryWriteReceipt';
import { WorldResumeCard } from '../../src/components/world/WorldResumeCard';
import { ImmersiveSceneCard } from '../../src/components/chat/ImmersiveSceneCard';
import { VoiceCallHost } from '../../src/components/chat/VoiceCallHost';
import { CharacterSoulOrb } from '../../src/components/chat/CharacterSoulOrb';

const owner = 'continuity-owner', sessionId = 'continuity-session';
const character = { id: 'continuity-character', name: '林舟', avatar: '🌿', systemPrompt: '原创朋友', tags: [], createdBy: owner, createdAt: 1 } as Character;
const source = { id: 'continuity-source', sessionId, role: 'user', content: '周五三点在北港旧钟楼见。', createdAt: 2, revision: 1 } as Message;
const base = { id: 'continuity-memory', characterId: character.id, userId: owner, content: source.content, type: 'auto', pinned: true,
  createdAt: 3, updatedAt: 3, sourceSessionId: sessionId, sourceMessageIds: [source.id], sourceMessageRevisions: { [source.id]: 1 } } as MemoryItem;
const scene = { id: 'continuity-scene', userId: owner, worldId: 'continuity-world', title: '旧钟楼的午后', place: '北港旧钟楼', timeLabel: '午后', mood: '安静', characterIds: [character.id], status: 'paused',
  state: { currentAct: 1, currentTension: 0, activeSecrets: [], activeConflicts: [], pendingConsequences: [], resolvedEventIds: [], newEventIds: [],
    participants: [{ characterId: character.id, goals: [], knowsEventIds: [], secrets: [] }] }, createdAt: 1, updatedAt: 8, startedAt: 1 } as WorldScene;
let sequence = 0, receipt: Awaited<ReturnType<typeof memoryRepo.remember>> | undefined;
const thread = { id: 'pending', characterId: character.id, userId: owner, title: '一起看看钟楼里的旧照片', kind: 'plan', status: 'open', sourceSceneId: scene.id, createdAt: 2, updatedAt: 2 } as ContinuityThread;
const valid = () => useAuthStore.getState().userId === owner;
async function remember() {
  receipt = await memoryRepo.remember({ ...base, id: `${base.id}-${++sequence}` }, valid);
  publishMemoryWrite(receipt);
  return receipt;
}
async function seed() {
  await db.delete(); await db.open();
  await db.characters.put(character);
  await db.sessions.put({ id: sessionId, characterId: character.id, userId: owner, title: '旧钟楼约定', createdAt: 1, updatedAt: 1 });
  await db.messages.put(source);
  useAuthStore.setState({ userId: owner, username: owner, isLoggedIn: true });
  useChatStore.setState({ selectedCharacterId: character.id, currentSessionId: sessionId, characters: [character], messages: [source] });
}
function Fixture() {
  const activeOwner = useAuthStore(state => state.userId);
  return <main className="mobile-layout" style={{ maxWidth: 430, margin: '0 auto', padding: '16px 0', color: 'var(--text)', background: 'var(--bg)' }}>
    <WorldResumeCard scene={scene} characters={[character]} threads={[thread, { ...thread, id: 'foreign', userId: 'other', title: 'foreign private thread' }, { ...thread, id: 'other-scene', sourceSceneId: 'other', title: 'unrelated scene thread' }]} busy={false} onContinue={() => { (window as any).continuityUI.continues++; }} onFree={() => { (window as any).continuityUI.free++; }} />
    <ImmersiveSceneCard key={`scene:${activeOwner}`} character={character} userId={owner} sessionId={sessionId} affinity={0} mood={50} onPrompt={() => {}} />
    <button onClick={() => void remember()}>记住本轮</button>
    <CharacterSoulOrb character={character}/>
    <MemoryWriteReceipt key={`receipt:${activeOwner}`} character={character} userId={owner} sessionId={sessionId}/>
    <textarea aria-label="自由输入" placeholder="继续说你想说的话"/>
    <VoiceCallHost/>
  </main>;
}
(window as any).continuityUI = {
  ready: false,
  continues: 0, free: 0, remember,
  count: () => db.memories.where('characterId').equals(character.id).count(),
  current: () => receipt && db.memories.get(receipt.memory.id),
  republish: () => receipt && publishMemoryWrite(receipt),
  edit: () => receipt && memoryRepo.correctContent(receipt.memory.id, '约定改到周六。', owner),
  owner: (userId: string) => useAuthStore.setState({ userId }),
  async contracts() {
    const checks: string[] = [];
    const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
    check(latestResumableScene([scene, { ...scene, id: 'foreign', userId: 'other', updatedAt: 99 }, { ...scene, id: 'done', status: 'finished', updatedAt: 100 }], owner, scene.worldId)?.id === scene.id, 'resume excludes foreign and finished scenes');
    check(!latestResumableScene([scene], owner, 'another-world'), 'resume excludes another world');
    check(latestResumableScene([scene, { ...scene, id: 'recent-pulse', updatedAt: 100 }], owner, scene.worldId, scene.id)?.id === scene.id, 'last opened scene wins over a newer background update');
    check(latestResumableScene([scene, { ...scene, id: 'foreign-last', userId: 'other' }], owner, scene.worldId, 'foreign-last')?.id === scene.id, 'last opened scene never bypasses account scope');
    await db.worlds.put({ id: scene.worldId, userId: owner, name: 'fixture', createdAt: 1, updatedAt: 1 } as any);
    await db.worldScenes.bulkPut([scene, ...Array.from({ length: 400 }, (_, index) => ({ ...scene, id: `stored-${index}` }))]);
    let selectedRows = 0;
    const countRead = (row: unknown) => { if (row) selectedRows++; return row; };
    db.worldScenes.hook('reading', countRead); db.worlds.hook('reading', countRead);
    check((await loadResumableScene(scene.id, owner, scene.worldId, valid))?.id === scene.id, 'selected scene authorization uses the actual stored scene');
    db.worldScenes.hook('reading').unsubscribe(countRead); db.worlds.hook('reading').unsubscribe(countRead);
    check(selectedRows === 2, '401 stored scenes still require only two selected rows');
    check(!await loadResumableScene(scene.id, 'other', scene.worldId, () => true), 'fresh resume rejects a foreign account');
    let scopeChecks = 0;
    check(!await loadResumableScene(scene.id, owner, scene.worldId, () => ++scopeChecks < 2), 'fresh resume stops after scope loss');
    await db.worldScenes.update(scene.id, { status: 'finished' });
    check(!await loadResumableScene(scene.id, owner, scene.worldId, valid), 'fresh resume rejects a newly finished scene');
    check(callOrbPresence({ phase: 'playing' }).emotion !== 'happy', 'speaking does not invent happiness');
    check(callOrbPresence({ phase: 'listening', inputMode: 'text' }).label === '等你发送文字', 'typed mode never claims listening');
    check(!callOrbPresence({ phase: 'paused' }).animated, 'paused orb stays quiet');
    check(callOrbPresence({ phase: 'listening', muted: true }).label === '麦克风已静音', 'muted status stays truthful');
    check(callOrbPresence({ phase: 'listening', inputModePending: true }).label === '正在切换输入方式', 'input switching never claims microphone capture');
    const first = await remember();
    const duplicate = await remember();
    check(first.created && !duplicate.created && first.memory.id === duplicate.memory.id, 'duplicate remember preserves the existing row');
    check(await db.memories.count() === 1, 'duplicate remember adds no extra memory');
    check(await memoryRepo.undoRemember(first, 'other', character.id, sessionId, valid) === 'unavailable', 'foreign owner cannot undo');
    await memoryRepo.correctContent(first.memory.id, '周六再去钟楼。', owner);
    check(await memoryRepo.undoRemember(first, owner, character.id, sessionId, valid) === 'changed', 'later edit wins over old undo receipt');
    check((await db.memories.get(first.memory.id))?.content === '周六再去钟楼。', 'changed memory is retained');
    const uncommitted = { ...base, id: 'rollback-memory', content: '另一个明确事实' };
    let permissionChecks = 0;
    try { await memoryRepo.remember(uncommitted, () => ++permissionChecks < 2); } catch { /* expected rollback */ }
    check(!await db.memories.get(uncommitted.id), 'context loss rolls the transaction back');
    let automaticReceipts = 0;
    const unsubscribe = subscribeMemoryWrites(next => { if (next.memory.id.startsWith('automatic-')) automaticReceipts++; });
    const automatic = { ...base, id: 'automatic-rollback', content: '事务内的自动记忆' };
    try { await db.transaction('rw', db.tables, async () => { await memoryRepo.create(automatic); throw new Error('intentional rollback'); }); } catch { /* expected rollback */ }
    check(automaticReceipts === 0 && !await db.memories.get(automatic.id), 'rolled-back automatic memories publish no receipt');
    await db.transaction('rw', db.tables, async () => {
      await db.transaction('rw', db.tables, () => memoryRepo.create({ ...automatic, id: 'automatic-committed' }));
      check(automaticReceipts === 0, 'nested automatic write waits for outermost commit');
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    check(automaticReceipts === 1, 'committed automatic memory publishes exactly one receipt');
    unsubscribe();
    await db.messages.update(source.id, { revision: 2 });
    let rejected = false;
    try { await remember(); } catch { rejected = true; }
    check(rejected, 'edited source cannot be remembered using an old revision');
    await seed(); receipt = undefined;
    return checks;
  },
  call(phase: 'generating' | 'paused' = 'generating') {
    useVoiceCallUIStore.getState().open({ character, userId: owner, sessionId });
    useVoiceCallStore.setState({ owner: { userId: owner, characterId: character.id, sessionId }, busy: true,
      view: { phase, userText: '', generatedText: '', heardText: '', level: 0, muted: false, inputMode: 'text' } });
    useVoiceCallUIStore.getState().minimize();
  },
  callState: () => ({ busy: useVoiceCallStore.getState().busy, minimized: useVoiceCallUIStore.getState().minimized }),
  stopFixture() { useVoiceCallStore.setState({ busy: false }); useVoiceCallUIStore.getState().close(); },
};
void seed().then(() => {
  createRoot(document.getElementById('root')!).render(<Fixture/>);
  (window as any).continuityUI.ready = true;
});
