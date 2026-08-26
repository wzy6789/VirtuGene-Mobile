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

export function CharacterProfileModal({ character, userId, onClose, onAdd, onChat }: CharacterProfileModalProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const isOwn = !character.isPreset && character.createdBy === userId;
  const groups = groupTags(character.tags);

  return (
    <Modal open onClose={onClose} width="max-w-md">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Avatar avatar={character.avatar} size="lg" />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink">{character.name}</h3>
            {character.signature && (
              <p className="text-sm text-gray-500 mt-0.5">{character.signature}</p>
            )}
          </div>
        </div>

        {/* Grouped tags */}
        <div className="mt-5 space-y-3">
          {CATEGORY_ORDER.map((cat) => {
            const tags = groups[cat];
            if (!tags || tags.length === 0) return null;
            return (
              <div key={cat} className="flex items-start gap-3">
                <span className="text-[11px] text-gray-500 mt-1 shrink-0 w-8">{CATEGORY_LABELS[cat]}</span>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 rounded-full bg-gene-purple/10 text-gene-purple"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Greeting */}
        {character.greeting && (
          <div className="mt-5 border-l-2 border-life-cyan pl-3">
            <p className="text-sm text-sub italic">“{character.greeting}”</p>
          </div>
        )}

        {/* System prompt */}
        <div className="mt-5">
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

        {/* Actions */}
        <div className="mt-6 flex gap-2">
          {isOwn ? (
            <button
              onClick={() => onChat(character)}
              className="flex-1 py-2.5 rounded-xl bg-gene-purple text-white text-sm font-medium hover:bg-gene-purple/90 transition-colors"
            >
              直接对话
            </button>
          ) : (
            <button
              onClick={() => onAdd(character)}
              className="flex-1 py-2.5 rounded-xl bg-gene-purple text-white text-sm font-medium hover:bg-gene-purple/90 transition-colors"
            >
              添加到我
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-line text-sm text-gray-500 hover:text-sub hover:bg-surface transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </Modal>
  );
}
