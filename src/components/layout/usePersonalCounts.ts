import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';

export function usePersonalCounts() {
  const owner = useAuthStore(s => s.userId);
  const characters = useChatStore(s => s.characters);
  const ids = useMemo(() => characters.filter(c => c.createdBy === owner).map(c => c.id).sort(), [characters, owner]);
  const identity = JSON.stringify([owner, ids]);
  const [result, setResult] = useState<{ identity: string; count?: number; error?: boolean }>();
  useEffect(() => {
    let alive = true;
    const subscription = liveQuery(async () => {
      if (!owner || !ids.length) return 0;
      // Count exact owned compound keys. Relationship histories stay unread.
      return (await db.characterStates.where(':id').anyOf(ids.map(id => [id, owner])).primaryKeys()).length;
    }).subscribe({
      next: count => { if (alive && useAuthStore.getState().userId === owner) setResult({ identity, count }); },
      error: () => { if (alive && useAuthStore.getState().userId === owner) setResult({ identity, error: true }); },
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [owner, identity, ids]);
  return { characters: ids.length, relations: result?.identity === identity ? result.count : undefined,
    error: result?.identity === identity && result.error };
}
