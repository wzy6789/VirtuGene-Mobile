import type { Character } from '../db';
import { characterRepo } from '../db/character-repo';
import { useAuthStore } from '../store/auth-store';
import { useChatStore } from '../store/chat-store';

/** Starting a library conversation adopts an owned copy, then opens that copy. */
interface AccountOperation {
  current: () => boolean;
  check: () => void;
  dispose: () => void;
}
/** A return to the same user ID does not revive an operation from an earlier login. */
function accountOperation(owner: string): AccountOperation {
  if (!owner || useAuthStore.getState().userId !== owner) throw Error('请先登录当前账号。');
  let valid = true;
  const unsubscribe = useAuthStore.subscribe(state => { if (state.userId !== owner) valid = false; });
  const current = () => valid && useAuthStore.getState().userId === owner;
  return {
    current,
    check: () => { if (!current()) throw Error('账号已切换，请重新打开角色。'); },
    dispose: () => { valid = false; unsubscribe(); },
  };
}
const adopting = new Map<string, { operation: AccountOperation; work: Promise<Character>; creating: boolean }>();
export function ensureOwnedChatCharacter(character: Character, owner: string): Promise<Character> {
  if (!owner || useAuthStore.getState().userId !== owner) return Promise.reject(Error('请先登录当前账号。'));
  const key = `${owner}:${character.id}`;
  const existing = adopting.get(key);
  if (existing?.operation.current()) return existing.work;
  const operation = accountOperation(owner);
  const work = (async () => {
    // An already-started write cannot be cancelled through createCharacter.
    // Wait for it, then authorize its persisted row afresh instead of creating
    // a second copy or accepting the invalidated operation's return value.
    if (existing?.creating) { await existing.work.catch(() => undefined); operation.check(); }
    return adopt(character, owner, operation, () => { entry.creating = true; });
  })().finally(() => {
    operation.dispose();
    // An invalidated A request may finish after a fresh A request has started.
    if (adopting.get(key) === entry) adopting.delete(key);
  });
  const entry = { operation, work, creating: false };
  adopting.set(key, entry);
  return work;
}
async function adopt(character: Character, owner: string, operation: AccountOperation, onCreate: () => void): Promise<Character> {
  operation.check();
  const {current,owned}=await readCharacterChatEntry(character,owner,operation);
  operation.check();
  // A withdrawn public resource cannot revoke an already adopted private copy.
  if(owned)return owned;
  if (!current || (!current.isPreset && current.createdBy !== owner && !current.published)) throw Error('这个角色已不可用。');
  onCreate();
  const created = await useChatStore.getState().createCharacter({
    name: current.name, avatar: current.avatar, systemPrompt: current.systemPrompt,
    tags: current.tags, signature: current.signature, greeting: current.greeting,
    catchphrase: current.catchphrase, boundaries: current.boundaries,
    voice: current.voice, learnedSpeechStyle: current.learnedSpeechStyle,
    model: current.model, proactivity: current.proactivity,
    sourcePresetId: current.id, isPreset: false, isCustom: false,
    published: false, createdBy: owner,
  }, { deferActivation: true });
  // The caller opens a successfully resolved identity. A late write must not
  // select a character or start voice assignment in a different account lifetime.
  operation.check();
  if (created.createdBy !== owner || created.isPreset) throw Error('账号已切换，请重新打开角色。');
  return created;
}
/** Resolve an owned identity without creating a character or exposing private data. */
export async function resolveOwnedChatCharacter(character:Character,owner:string):Promise<Character|undefined>{
  const operation = accountOperation(owner);
  try {
    const result = await readCharacterChatEntry(character,owner,operation);
    operation.check();
    return result.owned;
  } finally { operation.dispose(); }
}
async function readCharacterChatEntry(character:Character,owner:string,operation:AccountOperation){
  operation.check();
  const current=await characterRepo.getById(character.id);
  operation.check();
  if(current&&!current.isPreset&&current.createdBy===owner)return {current,owned:current};
  // A missing/deleted owned row is not replaced by a same-name public resource.
  if(!current&&!character.isPreset&&character.createdBy===owner)return {current,owned:undefined};
  const mine = await characterRepo.getByCreator(owner);
  operation.check();
  const owned=mine.find(c=>!c.isPreset&&c.createdBy===owner&&c.sourcePresetId===character.id)
    ??(current&&!current.isPreset&&current.published?mine.find(c=>!c.isPreset&&c.createdBy===owner&&!c.sourcePresetId&&c.name===current.name&&c.systemPrompt===current.systemPrompt):undefined);
  return {current,owned};
}
