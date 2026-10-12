import { db } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { extractMemories } from '../ai/memory-consolidator';
import { processMemoryJobs } from '../memory-jobs';
import { MimoCallClient } from './mimo';
import type { VoiceCallRecord } from './record';

/** One scoped batch per action; original extraction, evidence and job commit rules are unchanged. */
export async function extractVoiceCallMemory(id: string, userId: string, signal: AbortSignal,
  api: Pick<MimoCallClient, 'dialogue'> = new MimoCallClient()): Promise<number> {
  if (signal.aborted || useAuthStore.getState().userId !== userId) return 0;
  const record = await db.voiceCalls.get(id);
  if (!record || record.userId !== userId || record.status === 'active') return 0;
  const session = await db.sessions.get(record.sessionId);
  if (session?.userId !== userId || session.characterId !== record.characterId || session.type === 'group') return 0;
  const attempts: NonNullable<VoiceCallRecord['usage']> = [];
  try {
    // Original message jobs carry at most 6,000 characters each. Four leave
    // room for evidence IDs and the extraction prompt within the 40k envelope.
    return await processMemoryJobs(userId, null, 1, { signal, maxJobs: 4, scope: { sessionId: record.sessionId, sourcePrefix: `voice:${id}:`, characterId: record.characterId },
      extract: params => extractMemories({ ...params, transport: async messages => {
        if (signal.aborted || useAuthStore.getState().userId !== userId) throw new DOMException('Aborted', 'AbortError');
        let text = '', attempt: NonNullable<VoiceCallRecord['usage']>[number] | undefined;
        await api.dialogue(messages, { signal, maxTokens: 1000,
          onRequest: () => { attempt = { stage: 'memory', requestedAt: Date.now() }; attempts.push(attempt); },
          onUsage: usage => { if (attempt) Object.assign(attempt, usage); },
          onText: delta => { text += delta; if (text.length > 8000) throw new Error('voice:memory_limit'); },
        });
        const current = await db.voiceCalls.get(id), liveSession = await db.sessions.get(record.sessionId);
        if (!current || current.userId !== userId || liveSession?.userId !== userId || liveSession.characterId !== record.characterId || useAuthStore.getState().userId !== userId || signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return text;
      } }),
    });
  } finally {
    if (useAuthStore.getState().userId === userId) {
      const jobs = (await db.memoryJobs.where('userId').equals(userId).toArray()).filter(job => job.sessionId === record.sessionId && job.sourceIds.length > 0 && job.sourceIds.every(source => source.startsWith(`voice:${id}:`)));
      const memoryProgress = { completed: jobs.filter(job => job.status === 'done').length, failed: jobs.filter(job => job.status === 'failed').length,
        pending: jobs.filter(job => !['done', 'cancelled', 'failed'].includes(job.status)).length };
      await db.transaction('rw', db.voiceCalls, async () => {
        const current = await db.voiceCalls.get(id);
        if (current?.userId === userId && useAuthStore.getState().userId === userId) await db.voiceCalls.update(id, { usage: [...(current.usage ?? []), ...attempts], memoryProgress });
      });
    }
  }
}
