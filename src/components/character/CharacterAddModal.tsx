import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { GenePoolTab } from './GenePoolTab';
import { CreateGeneTab } from './CreateGeneTab';
import type { Character } from '../../db/index';

interface CharacterAddModalProps {
  open: boolean;
  onClose: () => void;
  editCharacter?: Character | null;
  /** 成功选中/创建角色并关闭后回调（手机端切回聊天页用）。
   *  注意：仅「成功操作」触发；纯关闭（× / 遮罩）不会触发，避免误跳转 */
  onSelected?: () => void;
}

type Tab = 'pool' | 'create';

export function CharacterAddModal({ open, onClose, editCharacter, onSelected }: CharacterAddModalProps) {
  const [tab, setTab] = useState<Tab>(editCharacter ? 'create' : 'pool');

  /** 纯关闭（× / 遮罩）：只关弹窗，不触发 onSelected */
  const handleDismiss = () => {
    setTab('pool');
    onClose();
  };

  /** 成功操作（选中基因 / 创建/编辑保存）：关闭 + 触发 onSelected */
  const handleSuccess = () => {
    setTab('pool');
    onClose();
    onSelected?.();
  };

  return (
    <Modal open={open} onClose={handleDismiss} title="基因实验室" width="max-w-2xl" closeOnBackdrop={false}>
      <div className="flex border-b border-line">
        <button
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            tab === 'pool'
              ? 'text-ink border-b-2 border-gene-purple bg-gene-purple/5'
              : 'text-gray-500 hover:text-sub'
          }`}
          onClick={() => setTab('pool')}
        >
          基因库
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            tab === 'create'
              ? 'text-ink border-b-2 border-gene-purple bg-gene-purple/5'
              : 'text-gray-500 hover:text-sub'
          }`}
          onClick={() => setTab('create')}
        >
          创造基因
        </button>
      </div>

      <div className="p-6">
        {tab === 'pool' ? (
          <GenePoolTab onSelect={handleSuccess} />
        ) : (
          <CreateGeneTab
            editCharacter={editCharacter ?? undefined}
            onClose={handleSuccess}
          />
        )}
      </div>
    </Modal>
  );
}
