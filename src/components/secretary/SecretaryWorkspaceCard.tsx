import { useEffect, useId, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuthStore } from '../../store/auth-store';
import { readSecretaryWorkspace } from '../../lib/secretary/workspace';
import { openSecretary } from '../../lib/secretary/character';
import { Avatar } from '../ui/Avatar';
import { SecretaryIcon } from './SecretaryIcon';
import { useSecretaryDisclosureMotion } from './useSecretaryDisclosureMotion';
import { AnimatedValue } from '../ui/AnimatedValue';
import type { Character } from '../../db';
import { SecretarySuggestionCard } from './SecretarySuggestionCard';
import { openAssistantWorkspace } from '../../lib/secretary/navigation';
import { SoulOrb } from '../ui/SoulOrb';

export function SecretaryWorkspaceCard({ onOpen, compact = false }: { onOpen?: (character: Character) => void; compact?: boolean }) {
  const userId = useAuthStore(s => s.userId);
  const [storedSnapshot, setSnapshot] = useState<Awaited<ReturnType<typeof readSecretaryWorkspace>>>();
  const [loadedUserId, setLoadedUserId] = useState<string>();
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const detailsContentRef = useRef<HTMLDivElement>(null);
  useSecretaryDisclosureMotion(expanded, userId, detailsRef, detailsContentRef);
  useEffect(() => {
    setExpanded(false);
  }, [userId]);
  useEffect(() => {
    setSnapshot(undefined); setLoadedUserId(undefined); setError(false);
    if (!userId) return;
    const subscription = liveQuery(() => readSecretaryWorkspace(userId)).subscribe({
      next: value => { if (useAuthStore.getState().userId === userId) { setSnapshot(value); setLoadedUserId(userId); setError(false); } },
      error: () => { if (useAuthStore.getState().userId === userId) { setError(true); setLoadedUserId(userId); } },
    });
    const refresh = () => setRevision(value => value + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', onVisible);
    // A dashboard left open across midnight must update today's count as well.
    const now = new Date(); const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = window.setTimeout(refresh, tomorrow.getTime() - now.getTime() + 100);
    return () => { subscription.unsubscribe(); window.clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVisible); };
  }, [userId, revision]);
  if (!userId) return null;
  const ready = loadedUserId === userId;
  const snapshot = storedSnapshot?.character.createdBy === userId ? storedSnapshot : undefined;
  const character = snapshot?.character;
  const active = character && character.secretaryStatus !== 'dismissed';
  const manage = () => window.dispatchEvent(new Event('virtugene:open-secretary'));
  const enter = () => { if (character) { if (onOpen) onOpen(character); else void openSecretary(character).catch(() => setError(true)); } else if (ready && !error) manage(); };
  const toggle = () => {
    if (expanded && detailsRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
    setExpanded(value => !value);
  };
  return <section aria-label="生活助理工作台" className={`vg-secretary-workspace rounded-2xl border border-line bg-panel ${expanded ? 'is-expanded' : ''} ${compact ? 'mx-2 my-2' : ''}`}>
    <button ref={toggleRef} type="button" aria-label={expanded ? '收起生活助理工作台' : '展开生活助理工作台'} aria-expanded={expanded} aria-controls={detailsId} onClick={toggle} className="vg-secretary-toggle flex w-full min-w-0 items-center gap-3 text-left">
      {character ? <Avatar avatar={character.avatar} size="lg" className="!h-12 !w-12 shrink-0" /> : <span className="vg-secretary-empty-avatar shrink-0"><SecretaryIcon name="profile" size={24} /></span>}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2"><span className="truncate text-base font-medium text-ink">{character?.name ?? '聘用助理'}</span>{character && <span className="vg-secretary-badge shrink-0">助理</span>}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-sub"><span className="vg-secretary-presence truncate" data-active={ready && !error && active ? 'true' : 'false'}>{!ready ? '读取中…' : error ? '读取失败 · 展开重试' : active ? '在职 · 为你办事' : character ? '助理空缺 · 记录保留' : '等待你的聘用'}</span>{snapshot && snapshot.attention > 0 && <span className="vg-secretary-attention shrink-0"><AnimatedValue value={snapshot.attention} /> 待处理</span>}</span>
      </span>
      <svg aria-hidden="true" className="vg-secretary-chevron shrink-0 text-sub" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m8 10 4 4 4-4" /></svg>
    </button>
    <div className="vg-assistant-home-actions">
      <button type="button" onClick={() => openAssistantWorkspace('today')} className="vg-assistant-home-today"><SoulOrb size={36} emotion="idle" soulKey={`action-cabin:${userId}`} soulRole="list" /><span>查看今日</span></button>
      <button type="button" disabled={!ready || error} onClick={enter}>{character ? '继续对话' : '开始聘用'}</button>
    </div>
    {active && <SecretarySuggestionCard userId={userId} onContinue={enter} />}
    <div ref={detailsRef} id={detailsId} className="vg-secretary-details" aria-hidden={!expanded} inert={!expanded}>
      <div ref={detailsContentRef} className="vg-secretary-details-clip">
        <div className="vg-secretary-details-content">
          <p className="text-xs leading-relaxed text-sub">{active ? '记日记、写朋友圈、安排待办。' : character ? '查看保留记录，或聘用新的助理。' : '名字、性格和形象，由你决定。'}</p>
          {snapshot && <div aria-label="助理办事概览" className="vg-secretary-counts mt-3 grid grid-cols-3 gap-1 rounded-xl py-3 text-center text-xs text-sub">
            {[[snapshot.todayCount, '今日及逾期待办'], [snapshot.attention, '待处理请求'], [snapshot.drafts, '待发布草稿']].map(([count, label]) => <p key={label}><span className="mb-1 block text-base font-semibold text-ink"><AnimatedValue value={count} /></span>{label}</p>)}
          </div>}
          <div className="mt-3 flex gap-2">
            <button type="button" aria-label={character ? `与助理${character.name}对话` : '聘用生活助理'} disabled={!ready || error} onClick={enter} className="vg-secretary-chat flex-1 min-h-12 rounded-xl px-3 text-sm font-medium disabled:opacity-50">{character ? '进入对话' : '开始聘用'}</button>
            {character && <button type="button" onClick={manage} className="vg-secretary-manage min-h-12 rounded-xl px-4 text-sm text-ink">助理管理</button>}
          </div>
          <p className="vg-secretary-retained mt-3 text-xs leading-relaxed text-sub"><SecretaryIcon name={snapshot?.failed ? 'inbox' : 'shield'} size={14} />{snapshot?.failed ? `${snapshot.failed} 个请求未办成，进入收件箱处理` : '你的记录归你，换助理也保留。'}</p>
          {error && <button type="button" onClick={() => setRevision(value => value + 1)} className="min-h-12 w-full text-sm text-gene-purple">重新读取助理工作台</button>}
        </div>
      </div>
    </div>
  </section>;
}
