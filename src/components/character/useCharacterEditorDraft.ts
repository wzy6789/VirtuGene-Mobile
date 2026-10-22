import { useCallback, useEffect, useRef, useState } from 'react';
import { characterEditorDraft, type CharacterEditorDraftRow } from '../../db/character-editor-draft';
import { useAuthStore } from '../../store/auth-store';

/** Draft contents never enter localStorage, logs, model requests or a backup
 * implicitly. The main DB lets a successful role save clear them atomically. */
export function useCharacterEditorDraft(options: {
  userId: string; characterId?: string; enabled: boolean; dirty: boolean;
  payload: string; saving: boolean; apply: (payload: string) => void;
}) {
  const { userId, characterId } = options;
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<CharacterEditorDraftRow | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const latest = useRef(options); latest.current = options;
  const alive = useRef(true);
  const paused = useRef(false);
  const ended = useRef(false);
  const blocked = useRef(true);
  const revision = useRef<number | null>(null);
  const lastPayload = useRef<string | null>(null);
  const epoch = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const current = useCallback(() => !!userId && useAuthStore.getState().userId === userId, [userId]);
  const failed = useCallback((cause: unknown) => {
    if (!alive.current) return;
    setError(cause instanceof Error && cause.message === 'draft:conflict'
      ? '本机草稿已在另一个窗口更新，尚未覆盖。请重新读取后选择保留哪一版。'
      : '草稿暂未保存到本机，当前填写仍在。请重试，或先完成角色保存。');
    setStatus('idle');
  }, []);
  const reload = useCallback(async () => {
    blocked.current = true;
    clearTimeout(timer.current); const generation = ++epoch.current;
    try {
      await queue.current.catch(() => {});
      const row = await characterEditorDraft.read(userId, characterId);
      if (!alive.current || !current() || generation !== epoch.current) return;
      revision.current = row?.revision ?? null;
      lastPayload.current = row?.payload ?? null;
      setPending(row?.payload ? row : null);
      blocked.current = !!row?.payload;
      setReady(true); setError('');
    } catch (cause) {
      if (alive.current) { setReady(true); failed(cause); }
    }
  }, [userId, characterId, current, failed]);
  const persist = useCallback(() => {
    const generation = epoch.current;
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (ended.current || paused.current || blocked.current || !current() || generation !== epoch.current || !latest.current.enabled) return;
      const payload = latest.current.dirty ? latest.current.payload : null;
      if (payload === lastPayload.current) return;
      if (alive.current) setStatus('saving');
      const row = await characterEditorDraft.write(userId, characterId, payload, revision.current,
        () => current() && !ended.current && generation === epoch.current);
      revision.current = row.revision; lastPayload.current = payload;
      if (alive.current) { setStatus(payload ? 'saved' : 'idle'); setError(''); }
    }).catch(cause => { if (generation === epoch.current) failed(cause); });
    return queue.current;
  }, [current, userId, characterId, failed]);
  const pause = useCallback(async () => {
    paused.current = true; epoch.current++; clearTimeout(timer.current);
    await queue.current.catch(() => {});
  }, []);
  const discard = useCallback(async () => {
    await pause();
    try {
      const row = await characterEditorDraft.write(userId, characterId, null, revision.current, current);
      revision.current = row.revision; lastPayload.current = null; ended.current = true;
    } catch (cause) { paused.current = false; failed(cause); throw cause; }
  }, [pause, userId, characterId, current, failed]);
  // Caller joins this write to the role transaction. Do not advance the local
  // revision until that outer transaction has actually committed.
  const clearForCommit = useCallback(async () => {
    try { return await characterEditorDraft.write(userId, characterId, null, revision.current, current); }
    catch (cause) { failed(cause); throw cause; }
  }, [userId, characterId, current, failed]);
  const committed = useCallback((row: CharacterEditorDraftRow) => {
    revision.current = row.revision; lastPayload.current = null;
    ended.current = true; paused.current = true;
    if (alive.current) { setStatus('idle'); setError(''); }
  }, []);
  useEffect(() => {
    alive.current = true;
    void reload();
    const flush = () => { clearTimeout(timer.current); void persist(); };
    window.addEventListener('pagehide', flush);
    const hide = () => { if (document.hidden) flush(); };
    document.addEventListener('visibilitychange', hide);
    return () => {
      alive.current = false; clearTimeout(timer.current);
      window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hide);
      // Ordinary host unmount preserves the last edit; explicit discard/save
      // sets ended first, so this cannot recreate cleared content.
      void persist();
    };
  }, [reload, persist]);
  useEffect(() => {
    if (!options.saving && !ended.current) paused.current = false;
    clearTimeout(timer.current);
    if (!ready || pending || options.saving || !options.enabled) return;
    timer.current = setTimeout(() => { void persist(); }, 300);
    return () => clearTimeout(timer.current);
  }, [ready, pending, options.payload, options.dirty, options.enabled, options.saving, persist]);
  const restore = () => {
    if (!pending?.payload || !options.enabled) return;
    try {
      options.apply(pending.payload);
      blocked.current = false; setPending(null); setError(''); setStatus('saved');
    } catch { setError('这份草稿暂时无法恢复。当前填写未变，你可以保留当前内容并清除旧草稿。'); }
  };
  const keepCurrent = async () => {
    try {
      const row = await characterEditorDraft.write(userId, characterId, null, revision.current, current);
      if (!alive.current || !current()) return;
      revision.current = row.revision; lastPayload.current = null;
      blocked.current = false; setPending(null); setError('');
    } catch (cause) { failed(cause); }
  };
  return { ready, pending, status, error, reload, restore, keepCurrent, pause, discard, clearForCommit, committed };
}
