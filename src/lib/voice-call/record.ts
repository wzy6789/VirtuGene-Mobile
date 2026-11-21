import type { CallExchange } from './controller';
import type { CallVoice } from './mimo';
import type { Message } from '../../db';
import { inspectDialogueSegment } from '../chat/output-contract';
import { SpokenSentenceBuffer } from './utterance';
import { isIncompleteAssistantReply,INCOMPLETE_REPLY_MARKER } from '../chat/reply-delivery';

export interface VoiceCallRecord {
  memoryProgress?: { pending: number; completed: number; failed: number };
  usage?: { stage: 'asr' | 'dialogue' | 'tts' | 'summary' | 'memory'; requestedAt: number; requestId?: string; audioSeconds?: number; inputTokens?: number; outputTokens?: number }[];
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
function fullyPlayedSegment(segment:CallExchange['segments'][number]):boolean{
  if(segment.interrupted||segment.playedAt===undefined||!Number.isFinite(segment.playedAt)
    ||!Number.isSafeInteger(segment.playedFrames)||segment.playedFrames<=0)return false;
  const start=segment.playbackStartFrame,end=segment.playbackEndFrame;
  return start===undefined&&end===undefined||Number.isSafeInteger(start)&&start!>=0
    &&Number.isSafeInteger(end)&&end!>start!&&segment.playedFrames>=end!-start!;
}
export function confirmedCallSpeech(exchange: CallExchange): string {
  const ids = new Set<string>();
  return exchange.segments.filter(segment => {
    if (segment.turnId !== exchange.turnId || ids.has(segment.id)) return false;
    ids.add(segment.id);
    return fullyPlayedSegment(segment);
  }).map(segment => segment.text).join('');
}

/** A final transport flag alone cannot prove the generated suffix played.
 * Compare the existing speech projection with all full segment receipts. */
export function isCompleteCallExchange(exchange:CallExchange):boolean {
  if(exchange.interrupted||!exchange.generatedText.trim()||!exchange.segments.length
    ||inspectDialogueSegment(exchange.generatedText,'voice',true).status!=='ready')return false;
  const heard=confirmedCallSpeech(exchange);
  if(!heard||new Set(exchange.segments.map(segment=>segment.id)).size!==exchange.segments.length
    ||exchange.segments.some(segment=>segment.turnId!==exchange.turnId||!fullyPlayedSegment(segment)))return false;
  try {
    const projected=new SpokenSentenceBuffer().push(exchange.generatedText,true).join('');
    return projected.replace(/\s+/gu,'')===heard.replace(/\s+/gu,'');
  }catch{return false;}
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
    if (!userText && exchange.origin !== 'presence-check') return;
    if (userText.length > 4096) throw new Error('voice:record');
    // Capture order is deterministic. No false reconstruction of acoustic wall-clock time.
    const createdAt = exchange.recordedAt ?? record.endedAt + index * 2;
    if (userText) messages.push({ id: userId, sessionId: record.sessionId, role: 'user', content: userText, createdAt, isProactive: false });
    const heard = confirmedCallSpeech(exchange);
    const complete=!!heard&&isCompleteCallExchange(exchange);
    if (heard) messages.push({ id: `voice:${record.id}:${exchange.turnId}:assistant`, sessionId: record.sessionId,
      role: 'assistant', content: heard, createdAt: createdAt + 1, ...(userText ? { replyToUserMessageId: userId } : {}), isProactive: exchange.origin === 'presence-check',
      replyDelivery:'settled',replyCompletion:complete?'complete':'interrupted',
      ...(!complete?{interrupted:true}:{}) });
  });
  return messages;
}

/** Summary input uses the same fact projection; generated-only text cannot become memory evidence. */
export function callSummarySource(record: VoiceCallRecord): string {
  return projectCallMessages(record).map(row => `${row.role === 'user' ? '用户' : '角色'}：${isIncompleteAssistantReply(row)?INCOMPLETE_REPLY_MARKER:''}${row.content}`).join('\n');
}
