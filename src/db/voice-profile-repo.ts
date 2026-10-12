import { db, type CharacterState } from './index';
import { defaultVoiceProfile, normalizeVoiceProfile, type VoiceProfile } from '../lib/voice-call/profile';

function identity(characterId: string, userId: string) {
  if (!characterId.trim() || !userId.trim()) throw new Error('voice:identity');
}

function base(characterId: string, userId: string): CharacterState {
  return { characterId, userId, affinity: 0, mood: 70, milestones: [], updatedAt: Date.now() };
}

/** Uses the existing account/character state; never writes to a shared preset. */
export const voiceProfileRepo = {
  async getOrCreate(characterId: string, userId: string): Promise<VoiceProfile> {
    identity(characterId, userId);
    return db.transaction('rw', db.characterStates, async () => {
      const state = await db.characterStates.get([characterId, userId]) ?? base(characterId, userId);
      const existing = normalizeVoiceProfile(state.voiceProfile);
      if (existing) return existing;
      const profile = defaultVoiceProfile();
      await db.characterStates.put({ ...state, voiceProfile: profile, updatedAt: Date.now() });
      return profile;
    });
  },
  async set(characterId: string, userId: string, value: VoiceProfile): Promise<VoiceProfile> {
    identity(characterId, userId);
    const profile = normalizeVoiceProfile(value);
    if (!profile) throw new Error('voice:profile');
    return db.transaction('rw', db.characterStates, async () => {
      const state = await db.characterStates.get([characterId, userId]) ?? base(characterId, userId);
      const saved = { ...profile, updatedAt: Date.now() };
      await db.characterStates.put({ ...state, voiceProfile: saved, updatedAt: Date.now() });
      return saved;
    });
  },
};
