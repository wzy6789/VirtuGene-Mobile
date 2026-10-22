import { useCallback, useEffect, useRef, useState } from 'react';
import { momentsRepo, type MomentWithMedia } from '../../db/moments-repo';
import type { Character, MomentNotification, MomentReaction } from '../../db';
import { useAuthStore } from '../../store/auth-store';

/** Read current records as one UI update; never reuse another owner's result. */
export function useMomentsFeed(userId: string) {
  const [rows, setRows] = useState<MomentWithMedia[]>([]);
  const [contacts, setContacts] = useState<Character[]>([]);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [mutedIds, setMutedIds] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<MomentNotification[]>([]);
  const [unreadInteractions, setUnreadInteractions] = useState(0);
  const [reactionMap, setReactionMap] = useState<Record<string, MomentReaction[]>>({});
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const alive = useRef(false), epoch = useRef(0), hasLoaded = useRef(false), processing = useRef(false);
  const read = useCallback(async (showSpinner: boolean) => {
    if (!alive.current || useAuthStore.getState().userId !== userId) return false;
    const request = ++epoch.current;
    const current = () => alive.current && epoch.current === request && useAuthStore.getState().userId === userId;
    if (showSpinner || !hasLoaded.current) setLoading(true);
    setLoadError('');
    try {
      const [nextRows, nextContacts, settings, nextNotifications, unread] = await Promise.all([
        momentsRepo.list(userId), momentsRepo.contacts(userId), momentsRepo.contactSettings(userId),
        momentsRepo.notifications(userId), momentsRepo.unreadNotifications(userId),
      ]);
      if (!current()) return false;
      const reactions = await Promise.all(nextRows.map(async ({ moment }) => [moment.id, await momentsRepo.reactions(moment.id, userId)] as const));
      if (!current()) return false;
      setRows(nextRows); setContacts(nextContacts.filter(c => c.agentProfile !== 'secretary'));
      setBlockedIds(settings.filter(item => item.blocked).map(item => item.characterId));
      setMutedIds(settings.filter(item => item.muted).map(item => item.characterId));
      setNotifications(nextNotifications); setUnreadInteractions(unread.length); setReactionMap(Object.fromEntries(reactions));
      hasLoaded.current = true; setLoaded(true);
      return true;
    } catch {
      if (current()) setLoadError('动态读取失败，请重试。');
      return false;
    } finally {
      if (current()) setLoading(false);
    }
  }, [userId]);
  const processInteractions = useCallback(async () => {
    if (!alive.current || processing.current || useAuthStore.getState().userId !== userId) return;
    processing.current = true;
    try {
      // Existing job leases, visibility revisions and model decisions stay in the repository.
      await momentsRepo.processJobs(userId);
      if (alive.current && useAuthStore.getState().userId === userId) await read(false);
    } catch {
      // A job failure does not erase an already-readable feed. A later pass can retry it.
    } finally { processing.current = false; }
  }, [userId, read]);
  const load = useCallback(async (showSpinner = true) => {
    if (await read(showSpinner)) void processInteractions();
  }, [read, processInteractions]);
  useEffect(() => {
    alive.current = true;
    void load();
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ userId?: string }>).detail?.userId === userId) void load(false);
    };
    window.addEventListener('virtugene:moments-updated', refresh);
    const timer = window.setInterval(() => { void processInteractions(); }, 30_000);
    return () => {
      alive.current = false; epoch.current++;
      window.clearInterval(timer); window.removeEventListener('virtugene:moments-updated', refresh);
    };
  }, [userId, load, processInteractions]);
  return { rows, setRows, contacts, blockedIds, setBlockedIds, mutedIds, setMutedIds, notifications, setNotifications,
    unreadInteractions, setUnreadInteractions, reactionMap, setReactionMap, loading, loaded, loadError, load, processInteractions };
}
