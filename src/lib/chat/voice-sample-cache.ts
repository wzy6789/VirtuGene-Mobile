import { db, type Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { generateVoiceSamples } from '../ai/character-voice-generator';
import { hasVoiceExamples, validVoiceSamples, voiceSource } from '../character-voice';

const running = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();

/** One background attempt per owner/character; edits and account switches revoke it. */
export function refreshVoiceSamples(userId: string, characterId: string, apiKey: string): Promise<void> {
  const key = `${userId}:${characterId}`;
  if (running.has(key)) return running.get(key)!;
  if (Date.now() - (failedAt.get(key) ?? 0) < 30000) return Promise.resolve();
  const work = (async () => {
    if (useAuthStore.getState().userId !== userId) return;
    const character = await db.characters.get(characterId);
    if (!character || character.createdBy !== userId || character.isPreset || character.agentProfile === 'secretary' || hasVoiceExamples(character.systemPrompt) || validVoiceSamples(character)) return;
    const source = voiceSource(character);
    const controller = new AbortController();
    const unsubscribe = useAuthStore.subscribe(state => { if (state.userId !== userId) controller.abort(); });
    try {
      if (useAuthStore.getState().userId !== userId) return;
      const sample = await generateVoiceSamples(character, apiKey, controller.signal);
      await db.transaction('rw', db.characters, async () => {
        const current = await db.characters.get(characterId);
        if (controller.signal.aborted || useAuthStore.getState().userId !== userId || !current || current.createdBy !== userId || current.isPreset || current.agentProfile === 'secretary' || voiceSource(current) !== source || validVoiceSamples(current)) return;
        await db.characters.update(characterId, { voiceSamples: sample });
      });
      failedAt.delete(key);
    } finally { unsubscribe(); }
  })().catch(() => {
    if (failedAt.size >= 100) failedAt.delete(failedAt.keys().next().value!);
    failedAt.set(key, Date.now());
  }).finally(() => { running.delete(key); });
  running.set(key, work);
  return work;
}

export async function readVoiceSampleCharacter(character: Character, userId: string): Promise<Character> {
  if (useAuthStore.getState().userId !== userId) return { ...character, voiceSamples: undefined };
  const current = await db.characters.get(character.id);
  return current?.createdBy === userId && voiceSource(current) === voiceSource(character)
    ? { ...character, voiceSamples: validVoiceSamples(current) } : { ...character, voiceSamples: undefined };
}

export function voiceCacheStatus(character:Character): 'authored' | 'cached' | 'pending' | 'failed' | 'missing' {
  if(hasVoiceExamples(character.systemPrompt)) return 'authored';
  if(validVoiceSamples(character)) return 'cached';
  const key=`${character.createdBy}:${character.id}`;
  if(running.has(key)) return 'pending';
  if(failedAt.has(key)) return 'failed';
  return 'missing';
}
