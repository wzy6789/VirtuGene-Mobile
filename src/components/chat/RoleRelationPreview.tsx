import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type Character, type CharacterState } from '../../db';
import { getRelationLevel } from '../../lib/affinity';
import { useAuthStore } from '../../store/auth-store';
import '../../styles/role-relation-preview.css';

export interface RoleRelationPreviewProps {
  character: Character;
  userId: string;
  sessionId: string | null;
}

type RelationRecord = Pick<CharacterState, 'affinity' | 'tierNames' | 'milestones'>;
type RelationRead =
  | { status: 'loading' | 'no-session' | 'unavailable' | 'error' }
  | { status: 'ready'; record: RelationRecord | null };

/** Account, role and session changes discard the previous reader and its private projection. */
export function RoleRelationPreview({ character, userId, sessionId }: RoleRelationPreviewProps) {
  const owner = useAuthStore(state => state.userId);
  if (!userId || owner !== userId) return null;
  return <ScopedRoleRelationPreview key={JSON.stringify([userId, character.id, sessionId])}
    characterId={character.id} userId={userId} sessionId={sessionId} />;
}

function ScopedRoleRelationPreview({ characterId, userId, sessionId }: {
  characterId: string; userId: string; sessionId: string | null;
}) {
  const [read, setRead] = useState<RelationRead>(() => ({ status: sessionId ? 'loading' : 'no-session' }));
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const current = () => active && useAuthStore.getState().userId === userId;
    setRead({ status: sessionId ? 'loading' : 'no-session' });
    if (!sessionId) return () => { active = false; };

    const subscription = liveQuery(() => db.transaction('r', db.characters, db.sessions, db.characterStates, async (): Promise<RelationRead> => {
      const unavailable: RelationRead = { status: 'unavailable' };
      if (!current()) return unavailable;
      // Recheck both resources by primary key on every live read, in one read-only snapshot.
      const [role, session] = await Promise.all([
        db.characters.get(characterId),
        db.sessions.get(sessionId),
      ]);
      if (!current() || !role || role.id !== characterId || role.isPreset || role.createdBy !== userId
        || !session || session.id !== sessionId || session.characterId !== characterId || session.userId !== userId
        || session.type === 'group' || !!session.groupId) return unavailable;

      // Never create a record merely by opening this preview.
      const state = await db.characterStates.get([characterId, userId]);
      if (!current() || state && (state.characterId !== characterId || state.userId !== userId)) return unavailable;
      return { status: 'ready', record: state ? {
        affinity: state.affinity,
        tierNames: state.tierNames,
        milestones: state.milestones,
      } : null };
    })).subscribe({
      next: value => { if (current()) setRead(value); },
      error: () => { if (current()) setRead({ status: 'error' }); },
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [characterId, userId, sessionId, retry]);

  return <section className="vg-role-relation-preview" aria-label="关系阶段与里程碑" aria-busy={read.status === 'loading'}>
    {read.status === 'ready' ? <RelationSummary record={read.record} />
      : read.status === 'loading' ? <p className="vg-role-relation-empty" role="status">正在读取关系记录…</p>
      : read.status === 'error' ? <div className="vg-role-relation-empty">
        <p role="alert">关系记录暂时无法读取，请重试。</p>
        <button type="button" className="vg-role-relation-retry" onClick={() => setRetry(value => value + 1)}>重新读取</button>
      </div>
      : <p className="vg-role-relation-empty" role="status">{read.status === 'no-session' ? '还没有选定可查看的私聊。' : '这段私聊或角色已不可用，关系记录已收起。'}</p>}
  </section>;
}

function stageName(value: unknown, tierNames: RelationRecord['tierNames']): string {
  if (typeof value !== 'string' || !value.trim()) return '阶段名称未记录';
  const renamed = tierNames?.[value];
  return typeof renamed === 'string' && renamed.trim() ? renamed : value;
}

function milestoneTime(value: number) {
  const date = new Date(value);
  return typeof value === 'number' && Number.isFinite(date.getTime())
    ? { iso: date.toISOString(), label: date.toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    : { iso: undefined, label: '时间未记录' };
}

function RelationSummary({ record }: { record: RelationRecord | null }) {
  if (!record) return <p className="vg-role-relation-empty">还没有留下关系阶段记录。</p>;
  const level = typeof record.affinity === 'number' && Number.isFinite(record.affinity) ? getRelationLevel(record.affinity).level : null;
  // Render only stored milestones. A stage never generates a synthetic history entry.
  const milestones = (Array.isArray(record.milestones) ? record.milestones : []).map((milestone, index) => ({ milestone, index }))
    .sort((a, b) => {
      const timeA = typeof a.milestone?.reachedAt === 'number' && Number.isFinite(new Date(a.milestone.reachedAt).getTime()) ? a.milestone.reachedAt : -Infinity;
      const timeB = typeof b.milestone?.reachedAt === 'number' && Number.isFinite(new Date(b.milestone.reachedAt).getTime()) ? b.milestone.reachedAt : -Infinity;
      return (timeA === timeB ? 0 : timeA > timeB ? -1 : 1) || a.index - b.index;
    });

  return <>
    <div className="vg-role-relation-stage">
      <h3>已记录阶段</h3>
      <strong>{level ? stageName(level.name, record.tierNames) : '阶段暂未记录'}</strong>
      {level && <p>{level.desc}</p>}
    </div>
    <section className="vg-role-relation-milestones" aria-label="已有关系里程碑">
      <h3>关系里程碑</h3>
      {milestones.length ? <ol>{milestones.map(({ milestone, index }) => {
        const stamp = milestoneTime(milestone?.reachedAt);
        return <li key={index}><strong>{stageName(milestone?.level, record.tierNames)}</strong><time dateTime={stamp.iso}>{stamp.label}</time></li>;
      })}</ol> : <p className="vg-role-relation-empty">还没有里程碑记录。</p>}
    </section>
  </>;
}
