import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Avatar } from '../ui/Avatar';
import { categorizeTag, CATEGORY_LABELS, CATEGORY_ORDER, type TagCategory } from '../../lib/tag-categories';
import type { Character } from '../../db/index';

interface CharacterProfileModalProps {
  character: Character;
  userId: string;
  onClose: () => void;
  onAdd: (clone: Character) => void;
  onChat: (c: Character) => void;
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
export function CharacterProfileModal({ character, userId, onClose, onAdd, onChat }: CharacterProfileModalProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const isOwn = !character.isPreset && character.createdBy === userId;
  const groups = groupTags(character.tags);

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

        {/* 开场白 */}
        {character.greeting && (
          <div className="mt-4 rounded-xl border-l-2 border-life-cyan bg-life-cyan/5 px-3 py-2.5">
            <p className="text-sm text-sub italic">“{character.greeting}”</p>
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
    </Modal>
  );
}
