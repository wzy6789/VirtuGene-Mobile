import { useEffect, useId, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type Character, type EmotionDimensions, type EmotionSnapshot, type Session } from '../../db';
import { emotionRepo } from '../../db/emotion-repo';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useEmotionStore } from '../../store/emotion-store';
import { Icon } from '../ui/Icon';
import '../../styles/character-detail.css';

const DIMENSIONS: { key: keyof EmotionDimensions; label: string }[] = [
  { key: 'valence', label: '愉悦度' }, { key: 'arousal', label: '唤醒度' },
  { key: 'intimacy', label: '亲密度' }, { key: 'engagement', label: '投入度' },
  { key: 'expressiveness', label: '外显度' }, { key: 'stability', label: '稳定度' },
];

/** Snapshots have no owner field; their private session and role establish scope. */
export function isEmotionSessionScope(character: Character | undefined, session: Session | undefined, owner: string, characterId: string): boolean {
  return !!owner && !!character && character.id === characterId && !character.isPreset && character.createdBy === owner
    && !!session && session.userId === owner && session.characterId === characterId && session.type !== 'group';
}
export function scopeEmotionSnapshots(rows: EmotionSnapshot[], characterId: string, sessionId: string): EmotionSnapshot[] {
  return rows.filter(row => row.characterId === characterId && row.sessionId === sessionId && Number.isFinite(new Date(row.createdAt).getTime()))
    .sort((a, b) => b.createdAt - a.createdAt);
}
function recordedValue(snapshot: EmotionSnapshot, key: keyof EmotionDimensions): number | undefined {
  const value = snapshot.dimensions?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 10 ? value : undefined;
}
function recordTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
interface EmotionPanelProps {
  embedded?: boolean; section?: 'emotion' | 'relation'; character?: Character; userId?: string; sessionId?: string | null;
}

/** Opening this reader never initiates analysis, diary reads or memory extraction. */
export function EmotionPanel({ embedded = false, character: suppliedCharacter, userId: suppliedOwner, sessionId }: EmotionPanelProps = {}) {
  const owner = useAuthStore(state => state.userId);
  const panelOpen = useEmotionStore(state => state.isPanelOpen);
  const characterId = useChatStore(state => state.selectedCharacterId);
  const currentSessionId = useChatStore(state => state.currentSessionId);
  const characters = useChatStore(state => state.characters);
  const character = suppliedCharacter ?? characters.find(row => row.id === characterId);
  const userId = suppliedOwner ?? owner;
  const explicitScope = suppliedCharacter !== undefined || suppliedOwner !== undefined;
  const requestedSession = explicitScope ? sessionId ?? null : currentSessionId;
  if ((!embedded && !panelOpen) || !character || !userId || owner !== userId) return null;
  if (character.isPreset || character.createdBy !== userId) return <p className="vg-detail-empty">私人情绪记录仅在你自己的角色详情中显示。</p>;
  return <ScopedEmotionPanel key={`${userId}:${character.id}:${requestedSession ?? 'choose'}`} character={character} userId={userId} requestedSession={requestedSession} embedded={embedded}/>;
}

type SnapshotRead = { sessionId: string | null; status: 'loading' | 'ready' | 'unavailable' | 'error'; session?: Session; snapshots: EmotionSnapshot[] };
function ScopedEmotionPanel({ character, userId, requestedSession, embedded }: { character: Character; userId: string; requestedSession: string | null; embedded: boolean }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [selectedSession, setSelectedSession] = useState<string | null>(requestedSession);
  const [read, setRead] = useState<SnapshotRead>({ sessionId: requestedSession, status: 'loading', snapshots: [] });
  const [retry, setRetry] = useState(0);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [dimension, setDimension] = useState<keyof EmotionDimensions>('valence');
  const selectorId = useId();

  useEffect(() => {
    let active = true;
    setSessionsStatus('loading'); setSessions([]);
    const subscription = liveQuery(() => db.transaction('r', db.characters, db.sessions, async () => {
      if (useAuthStore.getState().userId !== userId) return undefined;
      const role = await db.characters.get(character.id);
      if (!role || role.isPreset || role.createdBy !== userId) return undefined;
      return (await db.sessions.where('[characterId+userId]').equals([character.id, userId]).toArray())
        .filter(row => row.userId === userId && row.characterId === character.id && row.type !== 'group').sort((a, b) => b.updatedAt - a.updatedAt);
    })).subscribe({ next: rows => {
      if (!active || useAuthStore.getState().userId !== userId) return;
      setSessions(rows ?? []); setSessionsStatus(rows ? 'ready' : 'unavailable');
    }, error: () => { if (active && useAuthStore.getState().userId === userId) { setSessions([]); setSessionsStatus('error'); } } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [character.id, userId, retry]);

  useEffect(() => {
    let active = true;
    setSelectedSnapshot(null);
    setRead({ sessionId: selectedSession, status: 'loading', snapshots: [] });
    if (!selectedSession) return;
    const subscription = liveQuery(() => db.transaction('r', db.characters, db.sessions, db.emotionSnapshots, async (): Promise<SnapshotRead> => {
      const unavailable: SnapshotRead = { sessionId: selectedSession, status: 'unavailable', snapshots: [] };
      if (useAuthStore.getState().userId !== userId) return unavailable;
      const [role, session] = await Promise.all([db.characters.get(character.id), db.sessions.get(selectedSession)]);
      if (!isEmotionSessionScope(role, session, userId, character.id)) return unavailable;
      const rows = await emotionRepo.getBySession(selectedSession);
      if (useAuthStore.getState().userId !== userId) return unavailable;
      return { sessionId: selectedSession, status: 'ready', session, snapshots: scopeEmotionSnapshots(rows, character.id, selectedSession) };
    })).subscribe({ next: value => { if (active && useAuthStore.getState().userId === userId) setRead(value); }, error: () => {
      if (active && useAuthStore.getState().userId === userId) setRead({ sessionId: selectedSession, status: 'error', snapshots: [] });
    } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [character.id, userId, selectedSession, retry]);

  const validRead = read.sessionId === selectedSession && sessionsStatus === 'ready' && sessions.some(session => session.id === selectedSession);
  const snapshots = validRead && read.status === 'ready' ? read.snapshots : [];
  const snapshot = snapshots.find(row => row.id === selectedSnapshot) ?? snapshots[0];
  const chronological = [...snapshots].reverse();
  const first = chronological[0], latest = snapshots[0];
  const trendLabel = DIMENSIONS.find(row => row.key === dimension)!.label;
  const range = first && latest ? `${recordTime(first.createdAt)} — ${recordTime(latest.createdAt)}` : '';
  const domain = latest && first ? Math.max(1, latest.createdAt - first.createdAt) : 1;
  return <section className={`vg-emotion-panel vg-detail-emotion${embedded ? ' is-embedded' : ''}`} data-vg-surface-mode="long-form" aria-label={`${character.name}的情绪详情`}>
    {!embedded && <header className="vg-detail-emotion-heading"><h3>这段对话的表达</h3><button type="button" aria-label="关闭情绪详情" onClick={() => useEmotionStore.getState().closePanel()}><Icon name="close" size={18}/></button></header>}
    {!requestedSession && <div className="vg-detail-session"><label htmlFor={selectorId}>选择分析范围</label><select id={selectorId} value={selectedSession ?? ''} disabled={sessionsStatus !== 'ready'} onChange={event => setSelectedSession(event.target.value || null)}><option value="">选择一段已有会话</option>{sessions.map(session => <option value={session.id} key={session.id}>{session.title || '未命名会话'}</option>)}</select></div>}
    {sessionsStatus === 'loading' ? <p role="status" className="vg-detail-empty">正在读取可访问会话…</p>
      : sessionsStatus === 'error' ? <div className="vg-detail-empty"><p role="alert">会话目录暂未读到。</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></div>
      : sessionsStatus === 'unavailable' ? <p className="vg-detail-empty">角色资料已不可用，私人记录已收起。</p>
      : !selectedSession ? <p className="vg-detail-empty">{sessions.length ? '选择一段会话后，查看其中留存的情绪记录。不同会话分别展示。' : '还没有可查看的私聊会话。'}</p>
      : read.sessionId !== selectedSession || read.status === 'loading' ? <p role="status" className="vg-detail-empty">正在读取这段会话的记录…</p>
      : read.status === 'error' ? <div className="vg-detail-empty"><p role="alert">情绪记录暂未读到，已有记录没有改动。</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></div>
      : !validRead || read.status === 'unavailable' ? <p className="vg-detail-empty">这段会话已不可用，或不属于当前角色。</p>
      : <>
        <p className="vg-detail-scope">分析范围：{read.session?.title || '未命名会话'} · {snapshots.length} 条留存记录</p>
        {!snapshot ? <p className="vg-detail-empty">还没有足够记录。</p> : <>
          <article className="vg-detail-emotion-summary"><div className="vg-detail-record-heading"><h4>{snapshot.id === latest?.id ? '这段对话的表达' : '当时的对话表达'}</h4><time dateTime={new Date(snapshot.createdAt).toISOString()}>{recordTime(snapshot.createdAt)}</time></div>
            <strong>{snapshot.dominantEmotion?.trim() || '未记录情绪短语'}</strong><p>{snapshot.summary?.trim() || '这条记录没有摘要。'}</p>
            <small>分析对象：{character.name} · {Number.isFinite(snapshot.messageCount) ? `当时 ${snapshot.messageCount} 条消息` : '当时消息数量未记录'} · 由对话推测，并非心理诊断</small>
            {snapshot.messageCount < 4 && <p className="vg-detail-scope">当时的对话较少，这条理解可能不够准确。</p>}
            {snapshot.userEmotion?.trim() && <details className="vg-detail-disclosure"><summary>对你情绪的理解 · 推测</summary><p>{snapshot.userEmotion}</p><small>与角色表达及日记自评分别记录。</small></details>}
            {snapshot.id !== latest?.id && <button type="button" className="vg-detail-text-action" onClick={() => setSelectedSnapshot(null)}>返回最近记录</button>}
          </article>
          <details className="vg-detail-disclosure vg-detail-trend"><summary>查看会话趋势<span>{snapshots.length} 个实际样本</span></summary>
            <p className="vg-detail-scope">留存范围：{range}。仅展示现有快照；稀疏处留空，不代表完整对话历史。</p>
            <label className="vg-detail-dimension-select">显示维度<select value={dimension} onChange={event => setDimension(event.target.value as keyof EmotionDimensions)}>{DIMENSIONS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
            <svg className="vg-detail-trend-chart" viewBox="0 0 320 156" role="group" aria-label={`${trendLabel}，一到十分的实际离散记录`}>
              <path d="M28 18V132H304" fill="none" stroke="var(--border-strong,var(--border))"/><text x="4" y="26">10</text><text x="12" y="134">1</text>
              {chronological.map(row => { const value = recordedValue(row, dimension); if (value === undefined) return null; const x = chronological.length === 1 ? 166 : 40 + ((row.createdAt - first.createdAt) / domain) * 252; const y = 132 - ((value - 1) / 9) * 108; return <g key={row.id} role="button" tabIndex={0} aria-label={`${recordTime(row.createdAt)}，${trendLabel} ${value} 分，查看摘要`} aria-pressed={row.id === snapshot.id} onClick={() => setSelectedSnapshot(row.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedSnapshot(row.id); } }}><circle cx={x} cy={y} r="16" fill="transparent"/><circle cx={x} cy={y} r={row.id === snapshot.id ? 6 : 4} fill={row.id === snapshot.id ? 'var(--vg-accent)' : 'var(--text-secondary)'}/></g>; })}
            </svg>
            <div className="vg-detail-snapshot-list" aria-label="会话样本列表">{chronological.map(row => <button key={row.id} type="button" aria-pressed={row.id === snapshot.id} onClick={() => setSelectedSnapshot(row.id)}><time>{recordTime(row.createdAt)}</time><span>{row.dominantEmotion?.trim() || '未记录情绪短语'}</span></button>)}</div>
          </details>
          <details className="vg-detail-disclosure"><summary>查看六维分析<span>1—10 分</span></summary><div className="vg-detail-dimensions">{DIMENSIONS.map(item => { const value = recordedValue(snapshot, item.key); return <div key={item.key}><span>{item.label}</span>{value === undefined ? <small>未记录</small> : <><meter min={1} max={10} value={value} aria-label={`${item.label} ${value} 分`}/><output>{value.toFixed(1)}</output></>}</div>; })}</div></details>
        </>}
      </>}
  </section>;
}
