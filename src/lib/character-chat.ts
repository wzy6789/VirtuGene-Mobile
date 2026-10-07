import type { Character } from '../db';
import { characterRepo } from '../db/character-repo';
import { useAuthStore } from '../store/auth-store';
import { useChatStore } from '../store/chat-store';

/** Starting a library conversation adopts an owned copy, then opens that copy. */
const adopting = new Map<string, Promise<Character>>();
export function ensureOwnedChatCharacter(character: Character, owner: string): Promise<Character> {
  if (!owner || useAuthStore.getState().userId !== owner) return Promise.reject(Error('请先登录当前账号。'));
  const key = `${owner}:${character.id}`;
  const existing = adopting.get(key);
  if (existing) return existing;
  const work = adopt(character, owner).finally(() => { adopting.delete(key); });
  adopting.set(key, work);
  return work;
}
async function adopt(character: Character, owner: string): Promise<Character> {
  if (!owner || useAuthStore.getState().userId !== owner) throw Error('请先登录当前账号。');
  const current = await characterRepo.getById(character.id);
  if (!current || (!current.isPreset && current.createdBy !== owner && !current.published)) throw Error('这个角色已不可用。');
  if (!current.isPreset && current.createdBy === owner) return current;
  const mine = await characterRepo.getByCreator(owner);
  if (useAuthStore.getState().userId !== owner) throw Error('账号已切换，请重新打开角色。');
  const existing = mine.find(c => !c.isPreset && c.sourcePresetId === current.id)
    ?? (!current.isPreset ? mine.find(c => !c.isPreset && !c.sourcePresetId && c.name === current.name && c.systemPrompt === current.systemPrompt) : undefined);
  if (existing) return existing;
  return useChatStore.getState().createCharacter({
    name: current.name, avatar: current.avatar, systemPrompt: current.systemPrompt,
    tags: current.tags, signature: current.signature, greeting: current.greeting,
    catchphrase: current.catchphrase, boundaries: current.boundaries,
    voice: current.voice, learnedSpeechStyle: current.learnedSpeechStyle,
    model: current.model, proactivity: current.proactivity,
    sourcePresetId: current.id, isPreset: false, isCustom: false,
    published: false, createdBy: owner,
  });
}
