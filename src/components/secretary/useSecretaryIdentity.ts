import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';

/** Identity is readable without loading the planner or creating a chat session. */
export function useSecretaryIdentity(userId: string | null) {
  const [state, setState] = useState<{ owner: string; character?: Character; error?: string }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setState(undefined);
    if (!userId) return;
    const subscription = liveQuery(async () => {
      const binding = await db.secretaryBindings.get(userId);
      const rows = await db.characters.where('createdBy').equals(userId).filter(c => c.agentProfile === 'secretary' && !c.isPreset).toArray();
      return rows.find(c => c.id === binding?.characterId) ?? rows.find(c => c.secretaryStatus !== 'dismissed') ?? rows[0];
    }).subscribe({
      next: character => { if (useAuthStore.getState().userId === userId) setState({ owner: userId, character }); },
      error: () => { if (useAuthStore.getState().userId === userId) setState({ owner: userId, error: '助理资料读取失败，请重试。' }); },
    });
    return () => subscription.unsubscribe();
  }, [userId, revision]);
  return { character: state?.owner === userId ? state.character : undefined, loading: state?.owner !== userId, error: state?.owner === userId ? state.error : undefined, retry: () => setRevision(n => n + 1) };
}
