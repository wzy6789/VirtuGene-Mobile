import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from './auth-store';
import { useChatStore } from './chat-store';
import { loadSecret } from '../lib/api-key-storage';
import { VoiceCallController, type CallView, type CallAudioPort } from '../lib/voice-call/controller';
import type { MimoCallClient } from '../lib/voice-call/mimo';
import { assertCallContextOwner, prepareCallContext, type CallContextOwner } from '../lib/voice-call/context';
import { voiceProfileRepo } from '../db/voice-profile-repo';
import { callDeliveryStyle } from '../lib/voice-call/profile';
import { voiceCallRepo } from '../db/voice-call-repo';
import { summarizeVoiceCall } from '../lib/voice-call/summary';
import { extractVoiceCallMemory } from '../lib/voice-call/memory';
import { withChatSessionLock } from '../lib/chat/request-coordinator';
import type { VoiceCallRecord } from '../lib/voice-call/record';

type Adapters = { audio: CallAudioPort; api: Pick<MimoCallClient, 'recognize' | 'dialogue' | 'synthesize'> };
interface State {
  owner?: CallContextOwner; view?: CallView; busy: boolean; saving: boolean; finishing?: 'saving' | 'summary' | 'memory'; error?: string; record?: VoiceCallRecord;
  start(owner: CallContextOwner, adapters?: Adapters): Promise<void>;
  end(): Promise<void>;
  mute(): Promise<void>; interrupt(): Promise<void>; resume(): Promise<void>;
  routes(bluetooth?: boolean): Promise<void>; route(id: number): Promise<void>;
  summarize(): Promise<void>;
}
let controller: VoiceCallController | undefined;
let releaseSession: (() => void) | undefined;
let stopping: Promise<void> | undefined;
let generation = 0;
let startedAt = 0;
let usage: NonNullable<VoiceCallRecord['usage']> = [];
let summaryApi: Pick<MimoCallClient, 'dialogue'> | undefined;
let checkpoint: Promise<unknown> = Promise.resolve();
const initial: CallView = { phase: 'initializing', userText: '', generatedText: '', heardText: '', level: 0, muted: false };

export const useVoiceCallStore = create<State>((set, get) => ({
  busy: false, saving: false,
  async start(owner, adapters) {
    if (get().busy || get().saving) throw new Error('voice:busy');
    if (!adapters && (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('VoiceCallAudio'))) throw new Error('voice:android_required');
    if (useAuthStore.getState().userId !== owner.userId) throw new Error('voice:account_changed');
    const token = ++generation;
    set({ owner, view: { ...initial }, busy: true, saving: false, finishing: undefined, record: undefined, error: undefined });
    const live = () => token === generation && get().busy && useAuthStore.getState().userId === owner.userId;
    try {
      if (!await loadSecret('mimo-key')) throw new Error('voice:key');
      await assertCallContextOwner(owner);
      if (!live()) return;
      const profile = await voiceProfileRepo.getOrCreate(owner.characterId, owner.userId);
      if (!live()) return;
      // Hold the existing session queue throughout the call. Text sends cannot interleave unseen turns.
      let ready!: () => void;
      const acquired = new Promise<void>(resolve => { ready = resolve; });
      const hold = withChatSessionLock(owner.sessionId, async () => {
        if (!live()) { ready(); return; }
        await new Promise<void>(resolve => { releaseSession = resolve; ready(); });
      });
      void hold.catch(() => {});
      await acquired;
      if (!live()) { releaseSession?.(); releaseSession = undefined; return; }
      await assertCallContextOwner(owner);
      if (!live()) { releaseSession?.(); releaseSession = undefined; return; }
      startedAt = Date.now();
      usage = [];
      const callUsage = usage;
      summaryApi = adapters?.api;
      const callId = crypto.randomUUID();
      const base: VoiceCallRecord = { id: callId, ...owner, startedAt, endedAt: startedAt, voice: profile.voice, exchanges: [], messageIds: [], summaryState: 'pending', status: 'active' };
      const completed: VoiceCallRecord['exchanges'] = [];
      checkpoint = Promise.resolve();
      controller = new VoiceCallController(callId, {
        audio: adapters?.audio, api: adapters?.api,
        voice: profile.voice, style: callDeliveryStyle(profile), context: (text, exchanges, signal) => prepareCallContext({ ...owner, callId }, text, exchanges, signal),
        onExchange: exchange => {
          completed.push(exchange);
          const snapshot = { ...base, endedAt: Date.now(), exchanges: [...completed], usage: callUsage.map(row => ({ ...row })) };
          checkpoint = checkpoint.catch(() => undefined).then(async () => {
            if (useAuthStore.getState().userId !== owner.userId) return;
            try {
              const saved = await voiceCallRepo.save(snapshot);
              if (token === generation) set({ record: saved });
            } catch { if (token === generation) set({ error: 'voice:checkpoint_failed' }); }
          });
        },
        onRequest: (stage, audioSeconds) => { callUsage.push({ stage, requestedAt: Date.now(), ...(audioSeconds !== undefined ? { audioSeconds } : {}) }); },
        onUsage: (stage, receipt) => {
          const attempt = [...callUsage].reverse().find(row => row.stage === stage);
          if (attempt) Object.assign(attempt, receipt);
        },
        onView: view => {
          if (token !== generation) return;
          set({ view });
          if (view.phase === 'ended' && !stopping) queueMicrotask(() => { void get().end(); });
        },
      });
      // The chosen sound is fixed for this call; future edits apply to the next call.
      set({ record: base });
      await controller.start();
    } catch (error) {
      if (token === generation) {
        releaseSession?.(); releaseSession = undefined;
        set({ busy: false, error: error instanceof Error ? error.message : 'voice:unknown', view: undefined });
      }
    }
  },
  end() {
    if (stopping) return stopping;
    const active = controller, owner = get().owner, record = get().record;
    const endedAt = Date.now();
    ++generation; controller = undefined;
    set({ busy: false, saving: !!active, finishing: active ? 'saving' : undefined,
      // Capture the user's hang-up time even if durable saving later fails.
      // Retain active status until persistence confirms an ended record.
      record: record ? { ...record, endedAt } : undefined,
      view: get().view ? { ...get().view!, phase: 'ended', level: 0 } : undefined });
    stopping = Promise.resolve().then(async () => {
      try {
        let exchanges;
        try { exchanges = await active?.end(); }
        catch { exchanges = active?.getRecords(); set({ error: 'voice:audio_release_failed' }); }
        await checkpoint;
        if (record && exchanges && owner && useAuthStore.getState().userId === owner.userId) {
          const saved = await voiceCallRepo.save({ ...record, status: 'ended', endedAt, exchanges, usage: usage.map(row => ({ ...row })) });
          set({ record: saved });
          // Release before summary/network work so ordinary chatting is immediately available.
          releaseSession?.(); releaseSession = undefined;
          if (useChatStore.getState().currentSessionId === owner.sessionId) {
            const messages = await import('../db/message-repo').then(m => m.messageRepo.getPage(owner.sessionId));
            if (useAuthStore.getState().userId === owner.userId && useChatStore.getState().currentSessionId === owner.sessionId) useChatStore.setState({ messages });
          }
          if (exchanges.some(exchange => exchange.userText)) {
            const signal = new AbortController();
            const unsubscribe = useAuthStore.subscribe(state => { if (state.userId !== owner.userId) signal.abort(); });
            try {
              set({ finishing: 'summary' });
              await summarizeVoiceCall(saved.id, owner.userId, signal.signal, { api: summaryApi });
              const complete = await voiceCallRepo.get(saved.id, owner.userId);
              if (complete && !signal.signal.aborted) set({ record: complete });
            }
            catch { if (!signal.signal.aborted) set({ error: 'voice:summary_failed' }); }
            finally {
              try {
                if (!signal.signal.aborted) { set({ finishing: 'memory' }); await extractVoiceCallMemory(saved.id, owner.userId, signal.signal, summaryApi); }
                const complete = await voiceCallRepo.get(saved.id, owner.userId);
                if (complete && !signal.signal.aborted) set({ record: complete });
              } finally { unsubscribe(); }
            }
          }
        }
      } catch { set({ error: get().finishing === 'memory' ? 'voice:memory_failed' : get().record?.status === 'ended' ? 'voice:postprocess_failed' : 'voice:save_failed' }); }
      finally { releaseSession?.(); releaseSession = undefined; set({ saving: false, finishing: undefined }); }
    }).finally(() => { stopping = undefined; });
    return stopping;
  },
  async mute() { await controller?.mute(!get().view?.muted); },
  async interrupt() { await controller?.interrupt(); },
  async resume() { await controller?.resume(); },
  async routes(bluetooth) { await controller?.refreshRoutes(bluetooth); },
  async route(id) { await controller?.selectRoute(id); },
  async summarize() {
    const { record, owner, busy, saving } = get();
    if (!record || !owner || busy || saving || useAuthStore.getState().userId !== owner.userId) return;
    set({ saving: true, finishing: 'summary', error: undefined });
    const signal = new AbortController();
    const unsubscribe = useAuthStore.subscribe(state => { if (state.userId !== owner.userId) signal.abort(); });
    try {
      await summarizeVoiceCall(record.id, owner.userId, signal.signal, { api: summaryApi });
      const updated = await voiceCallRepo.get(record.id, owner.userId);
      if (updated && !signal.signal.aborted) set({ record: updated });
    } catch { if (!signal.signal.aborted) set({ error: 'voice:summary_failed' }); }
    finally {
      try {
        const updated = await voiceCallRepo.get(record.id, owner.userId);
        if (updated && !signal.signal.aborted) set({ record: updated });
      } finally { unsubscribe(); set({ saving: false, finishing: undefined }); }
    }
  },
}));

useAuthStore.subscribe(state => {
  const call = useVoiceCallStore.getState();
  if (call.busy && state.userId !== call.owner?.userId) void call.end();
});
