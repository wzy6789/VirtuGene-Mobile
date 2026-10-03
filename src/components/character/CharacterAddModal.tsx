import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { GenePoolTab } from './GenePoolTab';
import { CreateGeneTab } from './CreateGeneTab';
import type { Character } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
const SecretaryManagementModal = lazy(() => import('../secretary/SecretaryManagementModal').then(m => ({ default: m.SecretaryManagementModal })));

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
  const userId = useAuthStore(s => s.userId);
  const assistant = useChatStore(s => s.characters.find(c => c.agentProfile === 'secretary' && c.createdBy === userId));
  const contentRef = useRef<HTMLDivElement>(null);
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

  if (editCharacter?.agentProfile === 'secretary') return <Suspense fallback={<div role="status">正在打开助理管理…</div>}><SecretaryManagementModal key={editCharacter.id} character={editCharacter} open={open} onClose={onClose} /></Suspense>;

  return (
    <Modal open={open} onClose={handleDismiss} title={editCharacter ? '角色设置' : '基因实验室'} panelClassName={editCharacter ? 'vg-settings-panel' : undefined} width="max-w-2xl" closeOnBackdrop={false} mobileFullHeight>
      {!editCharacter && <div className="vg-character-editor-tabs flex border-b border-line">
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
      </div>}

      <div ref={contentRef} className={editCharacter ? 'vg-settings-design' : 'p-4 sm:p-6'}>
        {!editCharacter && <button type="button" onClick={() => { handleDismiss(); window.dispatchEvent(new Event('virtugene:open-secretary')); }} className="mb-4 w-full min-h-12 rounded-xl border border-gene-purple/25 bg-gene-purple/5 px-4 text-left text-sm text-ink">{assistant && assistant.secretaryStatus !== 'dismissed' ? `🗂️ 管理生活助理 · ${assistant.name}` : '🗂️ 聘用生活助理 · 你来取名'}</button>}
        {!editCharacter && tab === 'pool' ? (
          <GenePoolTab onSelect={handleSuccess} singleScroll />
        ) : (
          <CreateGeneTab
            key={editCharacter?.id ?? 'new'}
            editCharacter={editCharacter ?? undefined}
            onClose={handleSuccess}
          />
        )}
      </div>
    </Modal>
  );
}
