import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { GenePoolTab } from './GenePoolTab';
import { CreateGeneTab } from './CreateGeneTab';
import type { Character } from '../../db/index';

interface CharacterAddModalProps {
  open: boolean;
  onClose: () => void;
  editCharacter?: Character | null;
  /** 选中角色并关闭后回调（手机端切回聊天页用） */
  onSelected?: () => void;
}

type Tab = 'pool' | 'create';

export function CharacterAddModal({ open, onClose, editCharacter, onSelected }: CharacterAddModalProps) {
  const [tab, setTab] = useState<Tab>(editCharacter ? 'create' : 'pool');

  const handleClose = () => {
    setTab('pool');
    onClose();
    onSelected?.();
  };

  return (
    <Modal open={open} onClose={handleClose} title="基因实验室" width="max-w-2xl" closeOnBackdrop={false}>
      <div className="flex border-b border-line">
        <button
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            tab === 'pool'
              ? 'text-ink border-b-2 border-gene-purple bg-gene-purple/5'
              : 'text-gray-500 hover:text-sub'
          }`}
          onClick={() => setTab('pool')}
        >
          🧬 基因库
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            tab === 'create'
              ? 'text-ink border-b-2 border-gene-purple bg-gene-purple/5'
              : 'text-gray-500 hover:text-sub'
          }`}
          onClick={() => setTab('create')}
        >
          ✨ 创造基因
        </button>
      </div>

      <div className="p-6">
        {tab === 'pool' ? (
          <GenePoolTab onSelect={handleClose} />
        ) : (
          <CreateGeneTab
            editCharacter={editCharacter ?? undefined}
            onClose={handleClose}
          />
        )}
      </div>
    </Modal>
  );
}
