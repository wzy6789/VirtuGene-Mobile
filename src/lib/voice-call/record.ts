import type { CallExchange } from './controller';
import type { CallVoice } from './mimo';
import type { Message } from '../../db';

export interface VoiceCallRecord {
  memoryProgress?: { pending: number; completed: number; failed: number };
  usage?: { stage: 'asr' | 'dialogue' | 'tts' | 'summary' | 'memory'; requestedAt: number; audioSeconds?: number; inputTokens?: number; outputTokens?: number }[];
  id: string; userId: string; characterId: string; sessionId: string;
  startedAt: number; endedAt: number; voice: CallVoice;
  exchanges: CallExchange[];
  summary?: string;
  summaryState: 'pending' | 'ready' | 'partial' | 'failed';
  summaryParts?: { index: number; sourceMessageIds: string[]; text: string }[];
  summaryTotalParts?: number;
  status?: 'active' | 'ended';
  /** IDs of projected raw speech, not generated or partially played sentences. */
  messageIds: string[];
}

/** Recompute from actual segment acknowledgements, never trust the UI's heardText. */
export function confirmedCallSpeech(exchange: CallExchange): string {
  const ids = new Set<string>();
  return exchange.segments.filter(segment => {
    if (segment.turnId !== exchange.turnId || ids.has(segment.id)) return false;
    ids.add(segment.id);
    return segment.playedAt !== undefined && Number.isFinite(segment.playedAt)
      && Number.isSafeInteger(segment.playedFrames) && segment.playedFrames > 0;
  }).map(segment => segment.text).join('');
}

/** Deterministic IDs make retries idempotent. The host commits these with the original message repository. */
export function projectCallMessages(record: VoiceCallRecord): Message[] {
  const messages: Message[] = [];
  if (!record.id || !record.sessionId || record.exchanges.length > 200) throw new Error('voice:record');
  const turns = new Set<string>();
  record.exchanges.forEach((exchange, index) => {
    if (!exchange.turnId || turns.has(exchange.turnId)) throw new Error('voice:duplicate_turn');
    turns.add(exchange.turnId);
    const userId = `voice:${record.id}:${exchange.turnId}:user`;
    const userText = exchange.userText.trim();
    if (!userText) return;
    if (userText.length > 4096) throw new Error('voice:record');
    // Capture order is deterministic. No false reconstruction of acoustic wall-clock time.
    const createdAt = exchange.recordedAt ?? record.endedAt + index * 2;
    messages.push({ id: userId, sessionId: record.sessionId, role: 'user', content: userText, createdAt, isProactive: false });
    const heard = confirmedCallSpeech(exchange);
    if (heard) messages.push({ id: `voice:${record.id}:${exchange.turnId}:assistant`, sessionId: record.sessionId,
      role: 'assistant', content: heard, createdAt: createdAt + 1, replyToUserMessageId: userId, isProactive: false });
  });
  return messages;
}

/** Summary input uses the same fact projection; generated-only text cannot become memory evidence. */
export function callSummarySource(record: VoiceCallRecord): string {
  return projectCallMessages(record).map(row => `${row.role === 'user' ? '用户' : '角色'}：${row.content}`).join('\n');
}
