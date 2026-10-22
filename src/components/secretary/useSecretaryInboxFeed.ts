import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuthStore } from '../../store/auth-store';
import { readSecretaryInbox } from '../../lib/secretary/inbox';
import type { SecretaryTask } from '../../lib/secretary/types';

export interface SecretaryInboxFeed {
  tasks: SecretaryTask[];
  loading: boolean;
  error: string;
  retry: () => void;
}

/** One owner-scoped read can serve both workspace counts and the embedded inbox. */
export function useSecretaryInboxFeed(userId: string | null, characterId: string | undefined, enabled: boolean): SecretaryInboxFeed {
  const [revision, setRevision] = useState(0);
  // A reopen/retry must not reuse a prior authorized result before its effect runs.
  const readKey = useMemo(() => ({}), [enabled, userId, characterId, revision]);
  const [state, setState] = useState<{ key: object; userId: string; characterId: string; tasks: SecretaryTask[]; error: string; loading: boolean }>();
  useEffect(() => {
    if (!enabled || !userId || !characterId) { setState(undefined); return; }
    let alive = true;
    setState({ key: readKey, userId, characterId, tasks: [], error: '', loading: true });
    const subscription = liveQuery(() => readSecretaryInbox(userId, characterId)).subscribe({
      next: tasks => { if (alive && useAuthStore.getState().userId === userId) setState({ key: readKey, userId, characterId, tasks, error: '', loading: false }); },
      error: () => { if (alive && useAuthStore.getState().userId === userId) setState({ key: readKey, userId, characterId, tasks: [], error: '办事记录读取失败，请重试。', loading: false }); },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [enabled, userId, characterId, readKey]);
  const current = enabled && state?.key === readKey && state.userId === userId && state.characterId === characterId ? state : undefined;
  return { tasks: current?.tasks ?? [], loading: enabled && (!current || current.loading), error: current?.error ?? '', retry: () => setRevision(value => value + 1) };
}
