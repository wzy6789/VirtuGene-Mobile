import { liveQuery } from 'dexie';
import type { ReactNode } from 'react';
import { useFeedback } from '../../lib/feedback';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Character, MemoryClaim, MemoryEvidence, MemoryItem } from '../../db/index';
import { db } from '../../db/index';
import { memoryRepo } from '../../db/memory-repo';
import { memoryLedgerRepo } from '../../db/memory-ledger-repo';
import { useAuthStore } from '../../store/auth-store';
import { Modal } from '../ui/Modal';
import { memoryKindLabel } from '../../lib/memory-engine';
import { Icon } from '../ui/Icon';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { MemoryOriginals } from './MemoryOriginals';
import '../../styles/memory-archive.css';

type MemoryFilter = 'all' | 'fact' | 'preference' | 'episode' | 'promise' | 'character-life';

/**
 * 记忆档案：角色记得的每一件事，以及它从哪来。
 * 用户可以看见来源、点开原话、并直接删掉不想被记住的内容。
 */
export function MemoryArchiveModal({
  open,
  onClose,
  character,
  userId,
  focusMemoryId,
  embedded = false,
  onManage,
}: {
  open: boolean;
  onClose: () => void;
  character: Character;
  userId: string;
  focusMemoryId?: string;
  embedded?: boolean;
  onManage?: (memoryId?: string) => void;
}) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const feedback = useFeedback();
  const [crossClaims, setCrossClaims] = useState<{ claim: MemoryClaim; sources: MemoryEvidence[] }[]>([]);
  const [jobStatus, setJobStatus] = useState({ pending: 0, failed: 0 });
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const [sessionTypes, setSessionTypes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const owner = useAuthStore(s => s.userId);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const readEpoch = useRef(0);
  const actionLock = useRef(false);
  const activeView = useRef(false);
  const context = useRef({ open, userId, characterId: character.id });
  context.current = { open, userId, characterId: character.id };
  const ownsView = useCallback(() => activeView.current && context.current.open && context.current.userId === userId && context.current.characterId === character.id && useAuthStore.getState().userId === userId, [character.id, userId]);

  const reload = useCallback(async () => {
    const epoch = ++readEpoch.current;
    const current = () => ownsView() && epoch === readEpoch.current;
    setLoading(true);
    setLoadError(false);
    try {
      const role = await db.characters.get(character.id);
      if (!current()) return;
      if (!role || role.isPreset || role.createdBy !== userId) throw new Error('memory:character-unavailable');
      // The inline view is a bounded local preview, not a partial full archive.
      // No claim, processing-job, evidence, session or original-message reads here.
      if (embedded) {
        const recent = await memoryRepo.getArchivePreviewByCharacter(character.id, userId);
        if (current()) {
          setMemories(recent.filter(memory => memory.userId === userId && memory.characterId === character.id));
          setCrossClaims([]); setJobStatus({ pending: 0, failed: 0 }); setSessionTitles({}); setSessionTypes({});
        }
        return;
      }
      const list = focusMemoryId
        ? (await memoryRepo.getByIds([focusMemoryId])).filter(memory => memory.userId === userId && memory.characterId === character.id)
        : await memoryRepo.getRecentByCharacter(character.id, userId, 60);
      const [claims, processing] = await Promise.all([
        focusMemoryId ? Promise.resolve([] as MemoryClaim[]) : memoryLedgerRepo.claimsKnownBy(userId, character.id),
        focusMemoryId ? Promise.resolve({ pending: 0, failed: 0 }) : memoryLedgerRepo.jobStatusForCharacter(userId, character.id),
      ]);
      const existingContent = new Set(list.filter((memory) => (memory.status ?? 'active') === 'active').map((memory) => memory.content.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()));
      const cross = (await Promise.all(claims.map(async claim => {
        const key = claim.value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
        if (existingContent.has(key)) return undefined;
        const sources = await db.memoryEvidence.where('[userId+claimId]').equals([userId, claim.id]).toArray();
        const crossSources = sources.filter((source) => !source.withdrawnAt && source.sourceType !== 'chat' && source.sourceType !== 'group' && source.sourceType !== 'legacy');
        return crossSources.length ? { claim, sources: crossSources } : undefined;
      }))).filter((row): row is { claim: MemoryClaim; sources: MemoryEvidence[] } => !!row);
      const sessionIds = Array.from(new Set(list.map((m) => m.sourceSessionId).filter((id): id is string => !!id)));
      const titles: Record<string, string> = {};
      const types: Record<string, string> = {};
      for (const session of await db.sessions.bulkGet(sessionIds)) {
        if (session?.userId === userId) {
          titles[session.id] = session.title || '一段对话';
          types[session.id] = session.type ?? 'single';
        }
      }
      if (current()) {
        setMemories(list); setCrossClaims(cross.slice(0, 30)); setJobStatus(processing);
        setSessionTitles(titles); setSessionTypes(types);
      }
    } catch {
      if (current()) { setMemories([]); setCrossClaims([]); setLoadError(true); }
    } finally {
      if (current()) setLoading(false);
    }
  }, [character.id, userId, ownsView, focusMemoryId, embedded]);

  useEffect(() => {
    activeView.current = open;
    if (!open) return;
    setExpanded(null);
    setConfirmId(null);
    setFilter('all');
    setEditingId(null); setDraft(''); setMemories([]); setCrossClaims([]);
    setBusy(actionLock.current);
    const subscription = liveQuery(() => reload()).subscribe({ error: () => { if (ownsView()) setLoadError(true); } });
    return () => { activeView.current = false; readEpoch.current++; subscription.unsubscribe(); };
  }, [open, reload, ownsView]);

  const runAction = async (action: () => Promise<unknown>, success?: string) => {
    if (actionLock.current || !ownsView()) return;
    actionLock.current = true; setBusy(true);
    try {
      await action();
      if (!ownsView()) return;
      setEditingId(null); setDraft(''); setConfirmId(null);
      if (success) feedback(success, { tone: 'success' });
      await reload();
    } catch {
      if (ownsView()) feedback('记忆操作未完成，请重试', { tone: 'error' });
    } finally {
      actionLock.current = false;
      if (ownsView()) setBusy(false);
    }
  };

  if (owner !== userId) return null;
  return (
    <MemoryArchiveSurface embedded={embedded} open={open} onClose={onClose} title={`${character.name} 的记忆档案`}>
      <div className={`vg-memory-archive ${embedded ? 'vg-memory-embedded' : 'p-4'}`}>
        <p className="text-xs leading-6 text-sub">
          {embedded ? '最近保存的记忆档案，不代表当前有效知情。跨场景内容与来源状态请在管理中核对。' : '查看来源与原话，也可以更正、撤回重点或删除记忆。'}
        </p>

        {loading && <LoadingSkeleton label="正在读取记忆" rows={3} />}
        {!loading && loadError && <div className="vg-record-card mt-4" role="alert"><p className="text-sm text-ink">记忆暂时没有读取到</p><p className="mt-1 text-xs text-sub">记录仍保存在本机，可以再试一次。</p><button type="button" className="vg-button vg-button-secondary mt-3" onClick={() => void reload()}><Icon name="refresh" />重新读取</button></div>}

        {!loading && !loadError && memories.length === 0 && crossClaims.length === 0 && (
          <div className="vg-record-card mt-4 py-8 text-center">
            <Icon name="diary" size={28} className="mx-auto mb-3 text-sub" /><strong className="text-base text-ink">{embedded ? '暂未保存对话记忆' : '还没有留下记忆'}</strong><p className="mt-2 text-sm leading-6 text-sub">{embedded ? '跨场景知情与完整记录可在管理中查看。' : <>聊到你的偏好、经历或计划时，<br />它们会慢慢留在这里。</>}</p>
          </div>
        )}

        {!embedded && !loading && memories.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="记忆分类" data-no-page-swipe>
            {([
              ['all', '全部'],
              ['fact', '关于你'],
              ['preference', '偏好'],
              ['episode', '共同经历'],
              ['promise', '约定'],
              ['character-life', '角色生活'],
            ] as [MemoryFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`vg-button shrink-0 ${filter === value ? 'vg-button-secondary' : 'vg-button-ghost'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {!loading && !loadError && <ul className="mt-3 space-y-3">
          {memories.filter((memory) => filter === 'all' || memory.memoryKind === filter).slice(0, embedded ? 6 : undefined).map((memory) => {
            const hasOrigin = (memory.sourceMessageIds?.length ?? 0) > 0;
            const sessionTitle = memory.sourceSessionId ? sessionTitles[memory.sourceSessionId] : undefined;
            return (
              <li key={memory.id} className="vg-record-card">
                <p className="text-sm leading-7 text-ink">{memory.content}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-sub">
                  <span className="rounded-full bg-surface px-2 py-1 text-[color:var(--vg-cyan)]">{memoryKindLabel(memory.memoryKind)}</span>
                  {!embedded && <span className="rounded-full bg-black/5 px-1.5 py-0.5">{memoryOrigin(memory, sessionTypes)}</span>}
                  {memory.pinned && (memory.status ?? 'active') === 'active' && <span className="rounded-full bg-gene-purple/15 px-1.5 py-0.5 text-gene-purple">必须记住</span>}
                  {memory.status === 'superseded' && <span className="rounded-full bg-gray-500/15 px-1.5 py-0.5 text-gray-500">已被新信息替代</span>}
                  {memory.status === 'withdrawn' && <span className="rounded-full bg-gray-500/15 px-1.5 py-0.5 text-gray-500">已撤回，不再召回</span>}
                  <span>{new Date(memory.createdAt).toLocaleDateString('zh-CN')}</span>
                  {sessionTitle && <span>· 来自「{sessionTitle}」</span>}
                  {!embedded && <span>· {hasOrigin ? '有原话依据' : '由对话总结'}</span>}
                  {typeof memory.confidence === 'number' && memory.confidence < 0.8 && <span>· 把握不大</span>}
                </div>
                {!embedded && editingId === memory.id ? (
                  <div className="mt-2">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={3}
                      aria-label="更正记忆内容"
                      disabled={busy}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-3 text-base leading-7 text-ink"
                      placeholder="改写成你希望他记住的说法"
                    />
                    <div className="mt-1.5 flex items-center justify-end gap-2">
                      <button disabled={busy} onClick={() => { setEditingId(null); setDraft(''); }} className="vg-button vg-button-ghost">取消</button>
                      <button
                        onClick={() => void runAction(() => memoryRepo.correctContent(memory.id, draft, userId), '记忆已更正')}
                        disabled={busy || !draft.trim() || draft.trim() === memory.content}
                        className="vg-button vg-button-secondary"
                      >
                        保存更正
                      </button>
                    </div>
                  </div>
                ) : null}
                {!embedded && hasOrigin && (
                  <button
                    onClick={() => setExpanded(current => current === memory.id ? null : memory.id)}
                    aria-expanded={expanded === memory.id}
                    className="vg-button vg-button-ghost mt-2"
                  >
                    <Icon name="eye" size={16} />
                    {expanded === memory.id ? '收起原话' : '看当时说的话'}
                  </button>
                )}
                {expanded === memory.id && (
                  <MemoryOriginals key={memory.id} userId={userId} characterId={character.id} memoryId={memory.id} />
                )}
                {embedded ? <button type="button" className="vg-detail-text-action" onClick={() => onManage?.(memory.id)}>来源与管理</button> : <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <button
                    onClick={() => { setEditingId(memory.id); setDraft(memory.content); setConfirmId(null); }}
                    disabled={busy || (memory.status ?? 'active') !== 'active'}
                    className="vg-button vg-button-ghost"
                  >
                    <Icon name="edit" size={16} />
                    纠正这条
                  </button>
                  {!(memory.type === 'summary' && memory.sourceSessionId) && (
                    <button
                      onClick={() => void runAction(() => memoryRepo.setPinned(memory.id, !memory.pinned))}
                      disabled={busy || ((memory.status ?? 'active') !== 'active' && !memory.pinned)}
                      title={(memory.status ?? 'active') !== 'active' ? '已停用的旧记忆不能重新置顶；需要时请在聊天中重新告诉角色' : undefined}
                      className="vg-button vg-button-ghost"
                    >
                      <Icon name="flag" size={16} />
                      {(memory.status ?? 'active') !== 'active' ? (memory.pinned ? '清除重点' : '已停用') : memory.pinned ? '取消重点' : '设为必须记住'}
                    </button>
                  )}
                  {confirmId === memory.id ? (
                    <div className="vg-delete-confirmation vg-delete-inline w-full">
                      <span>这条记忆删除后无法恢复</span>
                      <button disabled={busy} onClick={() => setConfirmId(null)} className="vg-button vg-button-secondary">取消</button>
                      <button
                        onClick={() => void runAction(() => memoryRepo.deleteById(memory.id), '这条记忆已删除')}
                        disabled={busy}
                        className="vg-button vg-button-danger"
                      >
                        删除
                      </button>
                    </div>
                  ) : (
                    <button disabled={busy} onClick={() => setConfirmId(memory.id)} className="vg-button vg-button-ghost"><Icon name="trash" size={16} />删除这条记忆</button>
                  )}
                </div>}
              </li>
            );
          })}
        </ul>}
        {!loading && !loadError && memories.length > 0 && !memories.some(memory => filter === 'all' || memory.memoryKind === filter) && <p className="mt-4 text-sm leading-7 text-sub">还没有这一类记忆，可以查看其他分类。</p>}

        {!loading && (jobStatus.pending > 0 || jobStatus.failed > 0) && (
          <div className="mt-4 rounded-xl border border-life-cyan/15 bg-life-cyan/[0.04] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                {jobStatus.pending > 0 ? `还有 ${jobStatus.pending} 条对话记忆正在整理` : '对话记忆整理已完成'}
                {jobStatus.failed > 0 ? `，${jobStatus.failed} 条需要重试` : ''}
              </p>
              {!embedded && jobStatus.failed > 0 && (
                <button disabled={busy} onClick={() => void runAction(() => memoryLedgerRepo.retryFailedJobs(userId, character.id))} className="vg-button vg-button-ghost shrink-0">
                  重新处理
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && crossClaims.length > 0 && (
          <section className="mt-5 border-t border-line/70 pt-4">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-ink">跨场景知情</h3>
                <p className="mt-1 text-xs leading-6 text-sub">仅列出这位角色曾被允许看到并实际召回过的内容</p>
              </div>
              <span className="text-xs text-sub">{crossClaims.length} 条</span>
            </div>
            <ul className="space-y-2">
              {crossClaims.slice(0, embedded ? 3 : undefined).map(({ claim, sources }) => (
                <li key={claim.id} className="vg-record-card">
                  <p className="text-sm leading-7 text-ink">{claim.value}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-sub">
                    {[...new Set(sources.map((source) => source.sourceType))].map((source) => (
                      <span key={source} className="rounded-full bg-surface px-2 py-1 text-[color:var(--vg-cyan)]">{sourceLabel(source)}</span>
                    ))}
                    <span>{sources.length} 个来源</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {embedded && !loading && !loadError && <button type="button" className="vg-detail-archive-button" onClick={() => onManage?.()}>全部记忆与管理</button>}
      </div>
    </MemoryArchiveSurface>
  );
}

/**
 * "他怎么知道的"：这条记忆是用户在哪告诉他的，还是他自己经历/总结出来的。
 * 只回答来源，不展示内部评分或证据表。
 */
function memoryOrigin(memory: MemoryItem, sessionTypes: Record<string, string>): string {
  if (memory.importedFromMemoryId) return '你创建他时分享的背景';
  const type = memory.sourceSessionId ? sessionTypes[memory.sourceSessionId] : undefined;
  if (type === 'group') return '群聊里听到的';
  if (memory.memoryKind === 'character-life') return '他自己的近况';
  if (memory.memoryKind === 'episode') return '你们一起经历过的';
  if (memory.memoryKind === 'summary') return '由对话总结';
  if (type === 'single' || memory.sourceMessageIds?.length) return '你在私聊里告诉他的';
  if (memory.sourceSessionId) return '来自一段对话';
  return '他记得的事';
}

function sourceLabel(source: MemoryEvidence['sourceType']): string {  const labels: Record<MemoryEvidence['sourceType'], string> = {
    chat: '私聊', group: '群聊', moment: '朋友圈', momentReaction: '评论互动', diary: '日记', todo: '待办',
    todoOccurrence: '待办记录', worldEvent: '世界事件', sharedMemory: '共同经历', worldScene: '星域', worldSceneEntry: '星域片段',
    continuityThread: '约定', relationshipEvent: '关系变化', legacy: '旧记忆',
  };
  return labels[source];
}

function MemoryArchiveSurface({ embedded, open, onClose, title, children }: { embedded: boolean; open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (embedded) return open ? <section aria-label={title}>{children}</section> : null;
  return <Modal open={open} onClose={onClose} title={title} width="max-w-md" surfaceMode="long-form" canSnapshotOnExit={() => false}>{children}</Modal>;
}
