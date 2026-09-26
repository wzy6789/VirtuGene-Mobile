import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { categorizeTag, CATEGORY_LABELS, CATEGORY_ORDER, type TagCategory } from '../../lib/tag-categories';
import type { Character, CharacterState } from '../../db/index';
import { stateRepo } from '../../db/state-repo';
import { getRelationLevel, levelProgress } from '../../lib/affinity';
import { continuityRepo } from '../../db/continuity-repo';
import type { ContinuityThread } from '../../db/index';
import { LifeTimelineModal } from './LifeTimelineModal';
import { MemoryArchiveModal } from './MemoryArchiveModal';

interface CharacterProfileModalProps {
  character: Character;
  userId: string;
  onClose: () => void | Promise<void>;
  onAdd: (clone: Character) => void | Promise<void>;
  onChat: (c: Character) => void | Promise<void>;
  worldCharacters?: Character[];
}

function groupTags(tags: string[]): Partial<Record<TagCategory, string[]>> {
  const groups: Partial<Record<TagCategory, string[]>> = {};
  for (const tag of tags) {
    const cat = categorizeTag(tag);
    (groups[cat] ??= []).push(tag);
  }
  return groups;
}

/**
 * 角色资料卡（手机端美化版）：
 * 品牌渐变头部 + 圆形大头像 + 签名 + 分类标签 + 开场白 + 基因序列。
 * 点「开始聊天」进入对话；自定义角色显示「编辑」。
 */
export function CharacterProfileModal({ character, userId, onClose, onAdd, onChat, worldCharacters = [] }: CharacterProfileModalProps) {
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const act = async (action: () => void | Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setActionError('');
    try { await action(); } catch { setActionError('操作没有完成，请重试。'); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const [showPrompt, setShowPrompt] = useState(false);
  const [lifeState, setLifeState] = useState<CharacterState | null>(null);
  const [showLifeTimeline, setShowLifeTimeline] = useState(false);
  const [showMemoryArchive, setShowMemoryArchive] = useState(false);
  /** 还没做完的事（未完成事件）——资料卡上让用户知道"你们还有事没做完" */
  const [openThreads, setOpenThreads] = useState<ContinuityThread[]>([]);
  const isOwn = !character.isPreset && character.createdBy === userId;
  const groups = groupTags(character.tags ?? []);

  useEffect(() => {
    let active = true;
    setLifeState(null); setOpenThreads([]);
    if (!userId || !isOwn) return;
    void stateRepo.get(character.id, userId).then((state) => {
      if (active) setLifeState(state ?? null);
    }).catch(() => { if (active) setActionError('角色状态暂时无法读取。'); });
    void continuityRepo.getOpenByCharacter(character.id, userId)
      .then((threads) => { if (active) setOpenThreads(threads); })
      .catch(() => { /* 未完成事件读不到不影响资料卡 */ });
    return () => { active = false; };
  }, [character.id, userId, isOwn]);

  return (
    <Modal open onClose={() => { if (!busy) void onClose(); }} title="角色" width="max-w-md">
      <div className="vg-profile-hero">
        <Avatar avatar={character.avatar} size="lg" className="vg-profile-avatar" />
        <div className="vg-profile-identity">
          <h3>{character.name}</h3>
          <p>{character.signature || character.greeting || '从这里，继续认识彼此。'}</p>
          {(character.tags ?? []).length > 0 && <div className="vg-profile-traits" aria-label="性格特点">{character.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>}
          {lifeState && <span className="vg-profile-relation">{getRelationLevel(lifeState.affinity).level.name}</span>}
        </div>
      </div>
      <div className="vg-profile-body p-5">
        {character.greeting && <p className="vg-profile-greeting">“{character.greeting}”</p>}
        {actionError && <p role="alert" className="text-sm text-red-400">{actionError}</p>}
        <div className="vg-profile-actions">
          <button disabled={busy} onClick={() => void act(() => onChat(character))} className="vg-profile-primary">{busy ? '正在进入…' : '开始聊天'}</button>
          {!isOwn && <button disabled={busy} onClick={() => void act(() => onAdd(character))} className="vg-profile-secondary">添加到我</button>}
        </div>
        <details className="vg-profile-details">
          <summary>更多关于 {character.name} <span aria-hidden="true">⌄</span></summary>
        {/* 分类标签 */}
        <div className="space-y-2.5">
          {CATEGORY_ORDER.map((cat) => {
            const tags = groups[cat];
            if (!tags || tags.length === 0) return null;
            return (
              <div key={cat} className="flex items-start gap-3">
                <span className="text-xs text-gray-500 mt-1 shrink-0 w-8">{CATEGORY_LABELS[cat]}</span>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-gene-purple/10 text-gene-purple">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {lifeState && (() => {
          const relation = getRelationLevel(lifeState.affinity);
          const recentEvents = (lifeState.lifeEvents ?? []).slice(0, 2);
          const storyLinks = (lifeState.storyRelations ?? [])
            .map((link) => ({ ...link, character: worldCharacters.find((item) => item.id === link.targetCharacterId) }))
            .filter((link) => link.character)
            .slice(0, 4);
          return (
            <section className="mt-4 rounded-2xl border border-life-cyan/20 bg-gradient-to-br from-life-cyan/[0.07] to-gene-purple/[0.07] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xs font-semibold text-ink">生命状态</p><p className="mt-0.5 text-xs text-gray-500">{lifeState.lifeFocus || '你们的故事正从这里开始。'}</p></div>
                <span className="text-xs rounded-full bg-life-cyan/15 px-2 py-1 text-life-cyan">{relation.level.name}</span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-black/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-gene-purple to-life-cyan" style={{ width: `${levelProgress(lifeState.affinity, relation.level, relation.next)}%` }} /></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-white/[0.04] px-2.5 py-2 text-gray-500">关系温度 <span className="ml-1 text-life-cyan">{Math.round(lifeState.affinity)}</span></div><div className="rounded-xl bg-white/[0.04] px-2.5 py-2 text-gray-500">情绪 <span className="ml-1 text-gene-purple">{lifeState.mood >= 70 ? '明亮' : lifeState.mood >= 45 ? '平稳' : '低落'}</span></div></div>
              {storyLinks.length > 0 && <div className="mt-3 border-t border-white/10 pt-2.5"><p className="text-xs tracking-[0.16em] text-gray-500">STORY CONNECTIONS</p><div className="mt-2 flex flex-wrap gap-1.5">{storyLinks.map((link) => <span key={link.targetCharacterId} className="inline-flex items-center gap-1 rounded-full border border-gene-purple/20 bg-gene-purple/8 px-2 py-1 text-xs text-gene-purple"><Avatar avatar={link.character!.avatar} size="sm" />{link.character!.name} · {link.label}</span>)}</div></div>}
              {recentEvents.length > 0 && <div className="mt-3 border-t border-white/10 pt-2.5 space-y-1.5">{recentEvents.map((event) => <p key={event.id} className="text-xs leading-relaxed text-gray-500"><span className="text-gene-purple">共同事件</span> · {event.title}</p>)}</div>}
              {openThreads.length > 0 && (
                <div className="mt-3 border-t border-white/10 pt-2.5 space-y-1.5">
                  <p className="text-xs tracking-[0.16em] text-gray-500">还没做完的事</p>
                  {openThreads.slice(0, 2).map((thread) => (
                    <p key={thread.id} className="text-xs leading-relaxed text-gray-500">
                      <span className="text-life-cyan">未完成</span> · {thread.title}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <button onClick={() => setShowLifeTimeline(true)} className="text-xs text-life-cyan hover:underline">查看完整成长轨迹</button>
                <button onClick={() => setShowMemoryArchive(true)} className="text-xs text-gene-purple hover:underline">记忆档案</button>
              </div>
            </section>
          );
        })()}

        {character.boundaries && (
          <div className="mt-4 rounded-xl border border-gene-purple/15 bg-gene-purple/[0.05] px-3 py-2.5">
            <p className="text-xs font-medium tracking-wide text-gene-purple">互动边界</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{character.boundaries}</p>
          </div>
        )}

        {/* 基因序列（性格 Prompt） */}
        <div className="mt-4">
          <button
            onClick={() => setShowPrompt((v) => !v)}
            className="text-xs text-gray-500 hover:text-sub transition-colors flex items-center gap-1"
          >
            <span>{showPrompt ? '收起' : '展开'}基因序列</span>
            <span className="text-xs">{showPrompt ? '▲' : '▼'}</span>
          </button>
          {showPrompt && (
            <div className="mt-2 max-h-48 overflow-y-auto bg-surface rounded-xl p-3 text-xs text-sub leading-relaxed whitespace-pre-wrap">
              {character.systemPrompt}
            </div>
          )}
        </div>

        </details>
      </div>
      <LifeTimelineModal open={showLifeTimeline} onClose={() => setShowLifeTimeline(false)} character={character} userId={userId} characters={worldCharacters} />
      <MemoryArchiveModal open={showMemoryArchive} onClose={() => setShowMemoryArchive(false)} character={character} userId={userId} />
    </Modal>
  );
}
