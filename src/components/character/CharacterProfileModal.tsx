import { useEffect, useState } from 'react';
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
  onClose: () => void;
  onAdd: (clone: Character) => void;
  onChat: (c: Character) => void;
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
  const [showPrompt, setShowPrompt] = useState(false);
  const [lifeState, setLifeState] = useState<CharacterState | null>(null);
  const [showLifeTimeline, setShowLifeTimeline] = useState(false);
  const [showMemoryArchive, setShowMemoryArchive] = useState(false);
  /** 还没做完的事（未完成事件）——资料卡上让用户知道"你们还有事没做完" */
  const [openThreads, setOpenThreads] = useState<ContinuityThread[]>([]);
  const isOwn = !character.isPreset && character.createdBy === userId;
  const groups = groupTags(character.tags);

  useEffect(() => {
    let active = true;
    void stateRepo.getOrCreate(character.id, userId).then((state) => {
      if (active) setLifeState(state);
    });
    void continuityRepo.getOpenByCharacter(character.id, userId)
      .then((threads) => { if (active) setOpenThreads(threads); })
      .catch(() => { /* 未完成事件读不到不影响资料卡 */ });
    return () => { active = false; };
  }, [character.id, userId]);

  return (
    <Modal open onClose={onClose} width="max-w-md">
      {/* 品牌渐变头部 */}
      <div className="relative overflow-hidden bg-gradient-to-br from-gene-purple via-[#5B4BD4] to-[#00B8B3] px-6 pt-8 pb-6">
        {/* 光斑装饰 */}
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-8 w-36 h-36 rounded-full bg-life-cyan/15 blur-3xl pointer-events-none" />
        {/* 头像光环 */}
        <div className="relative flex flex-col items-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-white/20 blur-md" />
            <Avatar avatar={character.avatar} size="lg" className="relative ring-4 ring-white/25" />
          </div>
          <h3 className="relative mt-3 text-lg font-semibold text-white">{character.name}</h3>
          {character.signature && (
            <p className="relative text-xs text-white/80 mt-0.5 text-center px-4">{character.signature}</p>
          )}
        </div>
      </div>

      <div className="p-5">
        {/* 分类标签 */}
        <div className="space-y-2.5">
          {CATEGORY_ORDER.map((cat) => {
            const tags = groups[cat];
            if (!tags || tags.length === 0) return null;
            return (
              <div key={cat} className="flex items-start gap-3">
                <span className="text-[11px] text-gray-500 mt-1 shrink-0 w-8">{CATEGORY_LABELS[cat]}</span>
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
                <div><p className="text-xs font-semibold text-ink">生命状态</p><p className="mt-0.5 text-[11px] text-gray-500">{lifeState.lifeFocus || '你们的故事正从这里开始。'}</p></div>
                <span className="text-[10px] rounded-full bg-life-cyan/15 px-2 py-1 text-life-cyan">{relation.level.name}</span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-black/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-gene-purple to-life-cyan" style={{ width: `${levelProgress(lifeState.affinity, relation.level, relation.next)}%` }} /></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]"><div className="rounded-xl bg-white/[0.04] px-2.5 py-2 text-gray-500">关系温度 <span className="ml-1 text-life-cyan">{Math.round(lifeState.affinity)}</span></div><div className="rounded-xl bg-white/[0.04] px-2.5 py-2 text-gray-500">情绪 <span className="ml-1 text-gene-purple">{lifeState.mood >= 70 ? '明亮' : lifeState.mood >= 45 ? '平稳' : '低落'}</span></div></div>
              {storyLinks.length > 0 && <div className="mt-3 border-t border-white/10 pt-2.5"><p className="text-[10px] tracking-[0.16em] text-gray-500">STORY CONNECTIONS</p><div className="mt-2 flex flex-wrap gap-1.5">{storyLinks.map((link) => <span key={link.targetCharacterId} className="inline-flex items-center gap-1 rounded-full border border-gene-purple/20 bg-gene-purple/8 px-2 py-1 text-[10px] text-gene-purple"><span>{link.character!.avatar}</span>{link.character!.name} · {link.label}</span>)}</div></div>}
              {recentEvents.length > 0 && <div className="mt-3 border-t border-white/10 pt-2.5 space-y-1.5">{recentEvents.map((event) => <p key={event.id} className="text-[11px] leading-relaxed text-gray-500"><span className="text-gene-purple">共同事件</span> · {event.title}</p>)}</div>}
              {openThreads.length > 0 && (
                <div className="mt-3 border-t border-white/10 pt-2.5 space-y-1.5">
                  <p className="text-[10px] tracking-[0.16em] text-gray-500">还没做完的事</p>
                  {openThreads.slice(0, 2).map((thread) => (
                    <p key={thread.id} className="text-[11px] leading-relaxed text-gray-500">
                      <span className="text-life-cyan">未完成</span> · {thread.title}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <button onClick={() => setShowLifeTimeline(true)} className="text-[11px] text-life-cyan hover:underline">查看完整成长轨迹</button>
                <button onClick={() => setShowMemoryArchive(true)} className="text-[11px] text-gene-purple hover:underline">记忆档案</button>
              </div>
            </section>
          );
        })()}

        {/* 开场白 */}
        {character.greeting && (
          <div className="mt-4 rounded-xl border-l-2 border-life-cyan bg-life-cyan/5 px-3 py-2.5">
            <p className="text-sm text-sub italic">“{character.greeting}”</p>
          </div>
        )}

        {character.boundaries && (
          <div className="mt-4 rounded-xl border border-gene-purple/15 bg-gene-purple/[0.05] px-3 py-2.5">
            <p className="text-[10px] font-medium tracking-wide text-gene-purple">互动边界</p>
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
            <span className="text-[10px]">{showPrompt ? '▲' : '▼'}</span>
          </button>
          {showPrompt && (
            <div className="mt-2 max-h-48 overflow-y-auto bg-surface rounded-xl p-3 text-xs text-sub leading-relaxed whitespace-pre-wrap">
              {character.systemPrompt}
            </div>
          )}
        </div>

        {/* 操作 */}
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => onChat(character)}
            className="flex-1 py-3 rounded-xl bg-gene-purple text-white text-sm font-medium hover:bg-[#5B4BD4] shadow-[0_2px_12px_rgba(108,92,231,0.30)] transition-all active:scale-[0.98]"
          >
            开始聊天
          </button>
          {isOwn ? (
            <button
              onClick={onClose}
              className="px-4 py-3 rounded-xl border border-line text-sm text-gray-500 hover:text-sub hover:bg-surface transition-colors"
            >
              关闭
            </button>
          ) : (
            <button
              onClick={() => onAdd(character)}
              className="flex-1 py-3 rounded-xl border border-gene-purple/40 text-gene-purple text-sm font-medium hover:bg-gene-purple/10 transition-colors"
            >
              添加
            </button>
          )}
        </div>
      </div>
      <LifeTimelineModal open={showLifeTimeline} onClose={() => setShowLifeTimeline(false)} character={character} userId={userId} characters={worldCharacters} />
      <MemoryArchiveModal open={showMemoryArchive} onClose={() => setShowMemoryArchive(false)} character={character} userId={userId} />
    </Modal>
  );
}
