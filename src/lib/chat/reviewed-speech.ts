import { db, type Character, type Message } from '../../db';
import { messageRepo } from '../../db/message-repo';
import { memorySourceTombstoneRepo, memorySourceTombstoneId } from '../../db/memory-source-tombstone-repo';
import { useAuthStore } from '../../store/auth-store';
import { voicePromptRevision } from '../character-voice';
import { normalizeBubbleText } from '../chat-pacing';
import { inspectChatOutput } from '../chat-output-quality';

type Source = { id: string; revision: number; content: string };
type SourceReference = { id: string; revision: number; contentHash: string };
export interface ReviewedSpeechSample {
  id: string; ownerId: string; characterId: string; sessionId: string;
  promptRevision: number; createdAt: number; input: string; reply: string; sources: SourceReference[];
}
export type ReviewedVoiceCharacter = Character & { reviewedVoiceLines?: string[] };
export interface SpeechPreview { character: Character; input: string; reply: string; sessionId: string; sources: Source[] }
function assertOwner(owner: string) { if (!owner || useAuthStore.getState().userId !== owner) throw Error('账号已变化，请重新打开。'); }
function editable(character: Character | undefined, owner: string): character is Character {
  return !!character && character.createdBy === owner && !character.isPreset && !character.published && character.agentProfile !== 'secretary';
}
function sourceOf(message: Message): Source { return { id: message.id, revision: message.revision ?? 1, content: message.content }; }
async function hasBlockedSources(owner: string, sources: Array<{ id: string; revision: number }>): Promise<boolean> {
  const rows = await db.memorySourceTombstones.bulkGet(sources.map(source => memorySourceTombstoneId(owner, 'message', source.id)));
  return rows.some((row, index) => row && (row.status === 'deleted' || sources[index].revision <= row.sourceRevision));
}
function reviewText(value: string, limit: number): string {
  const text = normalizeBubbleText(value).trim();
  if (!text || text.length > limit || /[\[【](?:系统|开发者|指令)|忽略.{0,8}(?:规则|指令)|\[\/?角色声音样本\]|```/u.test(text)) throw Error(`请使用不超过${limit}字的普通对话示例。`);
  return text;
}

/** A bounded source-backed pair, including all bubbles from this reply. */
export async function previewSpeech(owner: string, characterId: string, messageId: string): Promise<SpeechPreview> {
  assertOwner(owner);
  const character = await db.characters.get(characterId), message = await db.messages.get(messageId);
  if (!editable(character, owner) || !message || message.role !== 'assistant' || message.failed || message.interrupted || message.isProactive) throw Error('这条回复不能作为对话样本。');
  const session = await db.sessions.get(message.sessionId);
  if (!session || session.userId !== owner || session.characterId !== characterId || session.type === 'group') throw Error('请选择这个角色的私聊回复。');
  const rows = await messageRepo.getPage(session.id, { before: message.createdAt + 1, limit: 40 });
  const first = message.replyBatchId
    ? rows.find(row => row.replyBatchId === message.replyBatchId && row.role === 'assistant') ?? message : message;
  const input = first.replyToUserMessageId ? await db.messages.get(first.replyToUserMessageId) : [...rows].reverse().find(row => row.role === 'user' && row.createdAt <= first.createdAt && !row.failed);
  const replies = message.replyBatchId
    ? await db.messages.where('[sessionId+createdAt]').between([session.id, first.createdAt], [session.id, first.createdAt + 60000], true, true).limit(20).filter(row => row.replyBatchId === message.replyBatchId).toArray() : [message];
  if (!input || input.role !== 'user' || input.sessionId !== session.id || input.failed || input.secretaryDispatch || replies.length > 4 || replies.some(row => row.role !== 'assistant' || row.failed || row.interrupted || row.image || row.audio) || input.image || input.audio) throw Error('请选完整的文字问答；主动消息和代发内容不参与学习。');
  const suppressed = await memorySourceTombstoneRepo.suppressedMessages(owner, characterId);
  if ([input, ...replies].some(row => suppressed.has(row.id))) throw Error('来源已撤回，不能采用。');
  if (await hasBlockedSources(owner, [input, ...replies].map(sourceOf))) throw Error('来源已撤回，不能采用。');
  assertOwner(owner);
  // Source text is retained only in the preview for equality checks. Persist a digest instead.
  return { character, sessionId: session.id, input: normalizeBubbleText(input.content).slice(0, 160), reply: replies.map(row => normalizeBubbleText(row.content)).join(' --- ').slice(0, 320), sources: [input, ...replies].map(sourceOf) };
}
async function hash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function validSources(owner: string, character: Character, sample: ReviewedSpeechSample, suppressed: Set<string>): Promise<boolean> {
  if (sample.ownerId !== owner || sample.characterId !== character.id || sample.promptRevision !== voicePromptRevision(character) || !Array.isArray(sample.sources) || sample.sources.length < 2 || sample.sources.length > 5) return false;
  try { reviewText(sample.input, 160); reviewText(sample.reply, 320); } catch { return false; }
  if (await hasBlockedSources(owner, sample.sources)) return false;
  const session = await db.sessions.get(sample.sessionId);
  if (!session || session.userId !== owner || session.characterId !== character.id || session.type === 'group') return false;
  const messages = await db.messages.bulkGet(sample.sources.map(source => source.id));
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i], source = sample.sources[i];
    if (!message || message.role !== (i === 0 ? 'user' : 'assistant') || message.sessionId !== session.id || message.failed || message.interrupted || suppressed.has(message.id) || (message.revision ?? 1) !== source.revision || await hash(message.content) !== source.contentHash) return false;
  }
  return true;
}
export async function saveSpeech(owner: string, preview: SpeechPreview, input: string, reply: string): Promise<void> {
  assertOwner(owner);
  const normalizedInput = reviewText(input, 160), normalizedReply = reviewText(reply, 320);
  if (!inspectChatOutput(normalizedReply, { mode: 'private', userMessage: normalizedInput, persona: preview.character.systemPrompt, catchphrase: preview.character.catchphrase }).check.ok) throw Error('样本仍包含不适合该角色的表达，请修改后采用。');
  const sources = await Promise.all(preview.sources.map(async source => ({ id: source.id, revision: source.revision, contentHash: await hash(source.content) })));
  const sample: ReviewedSpeechSample = { id: crypto.randomUUID(), ownerId: owner, characterId: preview.character.id, sessionId: preview.sessionId, promptRevision: voicePromptRevision(preview.character), createdAt: Date.now(), input: normalizedInput, reply: normalizedReply, sources };
  // Crypto completes before the IndexedDB transaction; keep its write check atomic.
  await db.transaction('rw', db.characters, db.sessions, db.messages, db.memorySourceTombstones, async () => {
    assertOwner(owner);
    const current = await db.characters.get(preview.character.id);
    if (!editable(current, owner) || voicePromptRevision(current) !== sample.promptRevision) throw Error('人物设定已变化，请重新预览。');
    const session = await db.sessions.get(preview.sessionId), rows = await db.messages.bulkGet(preview.sources.map(source => source.id));
    const suppressed = await memorySourceTombstoneRepo.suppressedMessages(owner, current.id);
    if (!session || session.userId !== owner || session.characterId !== current.id || session.type === 'group' || rows.some((row, i) => !row || row.sessionId !== preview.sessionId || row.failed || row.interrupted || row.content !== preview.sources[i].content || (row.revision ?? 1) !== preview.sources[i].revision || suppressed.has(row.id))) throw Error('原消息已修改或删除，请重新预览。');
    if (await hasBlockedSources(owner, preview.sources)) throw Error('来源已撤回，不能采用。');
    const previous = (current.reviewedSpeechSamples ?? []).filter(row => row.sources?.[0]?.id !== sources[0].id);
    if (previous.length >= 8) throw Error('最多保留8组，请先移除不需要的样本。');
    assertOwner(owner);
    await db.characters.update(current.id, { reviewedSpeechSamples: [...previous, sample] });
  });
}
export async function listSpeech(owner: string, characterId: string): Promise<Array<{ sample: ReviewedSpeechSample; active: boolean }>> {
  assertOwner(owner);
  const character = await db.characters.get(characterId);
  if (!editable(character, owner)) return [];
  const suppressed = await memorySourceTombstoneRepo.suppressedMessages(owner, characterId);
  const result = await Promise.all((character.reviewedSpeechSamples ?? []).slice(-8).map(async sample => ({ sample, active: await validSources(owner, character, sample, suppressed).catch(() => false) })));
  assertOwner(owner); return result;
}
export async function removeSpeech(owner: string, characterId: string, id: string): Promise<void> {
  await db.transaction('rw', db.characters, async () => {
    assertOwner(owner);
    const character = await db.characters.get(characterId);
    if (!editable(character, owner)) throw Error('角色已变化。');
    await db.characters.update(characterId, { reviewedSpeechSamples: (character.reviewedSpeechSamples ?? []).filter(row => row.id !== id) });
  });
}
export async function reviewedVoiceLines(owner: string, characterId: string): Promise<string[]> {
  const rows = await listSpeech(owner, characterId);
  return rows.filter(row => row.active).map(({ sample }) => `对话样本：用户说${sample.input} → 你说${sample.reply}`);
}
