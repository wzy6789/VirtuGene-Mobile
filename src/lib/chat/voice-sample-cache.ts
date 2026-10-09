import { db, type Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { generateVoiceSamples } from '../ai/character-voice-generator';
import { hasVoiceExamples, validVoiceSamples, voiceSource } from '../character-voice';
import { reviewedVoiceLines, type ReviewedVoiceCharacter } from './reviewed-speech';

const running = new Map<string, Promise<void>>();
const failures = new Map<string, {source:string;attempts:number;retryAt:number}>();

/** One background attempt per owner/character; edits and account switches revoke it. */
export function refreshVoiceSamples(userId: string, characterId: string, apiKey: string, options:{manual?:boolean}={}): Promise<void> {
  const key = `${userId}:${characterId}`;
  if (running.has(key)) return running.get(key)!;
  let attemptedSource:string|undefined;
  const work = (async () => {
    if (useAuthStore.getState().userId !== userId) return;
    const character = await db.characters.get(characterId);
    if (!character || character.createdBy !== userId || character.isPreset || character.agentProfile === 'secretary' || hasVoiceExamples(character.systemPrompt) || validVoiceSamples(character)) return;
    const source = voiceSource(character);
    const failure=failures.get(key);
    if(!options.manual&&failure?.source===source&&Date.now()<failure.retryAt)return;
    attemptedSource=source;
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
      failures.delete(key);
    } finally { unsubscribe(); }
  })().catch(() => {
    if(!attemptedSource)return;
    const previous=failures.get(key);
    const attempts=previous?.source===attemptedSource?Math.min(8,previous.attempts+1):1;
    if (failures.size >= 100&&!failures.has(key)) failures.delete(failures.keys().next().value!);
    // Background failures should not spend another model call every chat turn.
    // An explicit retry or changed persona can still recover immediately.
    failures.set(key,{source:attemptedSource,attempts,retryAt:Date.now()+Math.min(6*60*60*1000,5*60*1000*2**(attempts-1))});
  }).finally(() => { running.delete(key); });
  running.set(key, work);
  return work;
}

export async function readVoiceSampleCharacter(character: Character, userId: string): Promise<ReviewedVoiceCharacter> {
  if (useAuthStore.getState().userId !== userId) return { ...character, voiceSamples: undefined, reviewedVoiceLines: undefined };
  const current = await db.characters.get(character.id);
  return current?.createdBy === userId && voiceSource(current) === voiceSource(character)
    ? { ...character, voiceSamples: validVoiceSamples(current), reviewedVoiceLines: await reviewedVoiceLines(userId, character.id) } : { ...character, voiceSamples: undefined, reviewedVoiceLines: undefined };
}

export function voiceCacheStatus(character:Character): 'authored' | 'cached' | 'pending' | 'failed' | 'missing' {
  if(hasVoiceExamples(character.systemPrompt)) return 'authored';
  if(validVoiceSamples(character)) return 'cached';
  const key=`${character.createdBy}:${character.id}`;
  if(running.has(key)) return 'pending';
  if(failures.get(key)?.source===voiceSource(character)) return 'failed';
  return 'missing';
}
