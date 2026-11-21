import type { Character } from '../db';
import { sessionRepo } from '../db/session-repo';
import { useAuthStore } from '../store/auth-store';
import { useChatStore } from '../store/chat-store';
import { useVoiceCallUIStore } from '../store/voice-call-ui-store';
import { ensureOwnedChatCharacter } from './character-chat';

/** Open the real preparation UI; adopting a public role uses the existing chat
 * contract. This never starts capture or claims that a call has connected. */
export async function openCharacterVoiceCall(character: Character, userId: string, isCurrent: () => boolean = () => true): Promise<boolean> {
  const valid = () => !!userId && useAuthStore.getState().userId === userId && isCurrent();
  if (!valid()) return false;
  const ongoing = useVoiceCallUIStore.getState();
  if (ongoing.target?.userId === userId) { ongoing.restore(); return true; }
  const target = await ensureOwnedChatCharacter(character, userId);
  if (!valid()) return false;
  await useChatStore.getState().selectCharacter(target.id);
  if (!valid()) return false;
  const chat = useChatStore.getState();
  if (chat.selectedCharacterId !== target.id || !chat.currentSessionId) return false;
  const session = await sessionRepo.getById(chat.currentSessionId);
  if (!valid() || !session || session.userId !== userId || session.characterId !== target.id
    || useChatStore.getState().currentSessionId !== session.id || useChatStore.getState().selectedCharacterId !== target.id) return false;
  useVoiceCallUIStore.getState().open({character:target,userId,sessionId:session.id});
  return true;
}
