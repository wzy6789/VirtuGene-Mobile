import { lazy, Suspense, useCallback, useRef, useState, type CSSProperties } from 'react';
import { Modal } from '../ui/Modal';
import { GenePoolTab } from './GenePoolTab';
import { CreateGeneTab } from './CreateGeneTab';
import type { Character } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { Icon } from '../ui/Icon';
import geneBackdrop from '../../assets/primary-scenes/mountain-lake.webp';
import '../../styles/gene-workspace.css';
const SecretaryManagementModal = lazy(() => import('../secretary/SecretaryManagementModal').then(m => ({ default: m.SecretaryManagementModal })));

interface CharacterAddModalProps {
  open: boolean;
  onClose: () => void;
  editCharacter?: Character | null;
  initialTab?: 'pool' | 'create';
  /** 成功选中/创建角色并关闭后回调（手机端切回聊天页用）。
   *  注意：仅「成功操作」触发；纯关闭（× / 遮罩）不会触发，避免误跳转 */
  onSelected?: () => void;
}

type Tab = 'pool' | 'create';

export function CharacterAddModal({ open, onClose, editCharacter, initialTab = 'pool', onSelected }: CharacterAddModalProps) {
  const owner = useAuthStore(s => s.userId);
  if (editCharacter && (editCharacter.createdBy !== owner || editCharacter.isPreset)) return <Modal open={open} presentation="dialog" title="角色设置" onClose={onClose} canSnapshotOnExit={()=>false}><div className="p-4 text-sm text-sub">这个角色无法在当前账号编辑，请关闭后重新选择。</div></Modal>;
  return <CharacterAddContent key={`${owner ?? ''}:${editCharacter?.id ?? `new-${initialTab}`}`} open={open} onClose={onClose} editCharacter={editCharacter} initialTab={initialTab} onSelected={onSelected} />;
}

function CharacterAddContent({ open, onClose, editCharacter, initialTab = 'pool', onSelected }: CharacterAddModalProps) {
  const userId = useAuthStore(s => s.userId);
  const [tab, setTab] = useState<Tab>(editCharacter ? 'create' : initialTab);
  const [formBusy, setFormBusy] = useState(false);
  const [createVisited, setCreateVisited] = useState(!!editCharacter || initialTab === 'create');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardError, setDiscardError] = useState('');
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const discardDraft = useRef<(() => Promise<void>) | null>(null);
  const trackDiscard = useCallback((discard: (() => Promise<void>) | null) => { discardDraft.current = discard; }, []);
  const dirtyRef = useRef(false);
  const pendingExit = useRef<(() => void) | null>(null);
  const trackDirty = useCallback((value: boolean) => { dirtyRef.current = value; }, []);
  const formBusyRef = useRef(false);
  const trackFormBusy = useCallback((value: boolean)=>{formBusyRef.current=value;setFormBusy(value);},[]);

  /** 纯关闭（× / 遮罩）：只关弹窗，不触发 onSelected */
  const handleDismiss = (afterClose?: () => void) => {
    if (formBusyRef.current || discardBusy) return;
    const exit = async () => {
      if (dirtyRef.current) {
        setDiscardBusy(true); setDiscardError('');
        try {
          if (!discardDraft.current) throw Error('draft:not-ready');
          await discardDraft.current();
        } catch {
          setDiscardError('草稿暂时没能清除，填写内容仍在。请重试或继续编辑。');
          setDiscardBusy(false);
          return;
        }
        setDiscardBusy(false);
      }
      if (useAuthStore.getState().userId !== userId) return;
      dirtyRef.current = false;
      setCreateVisited(false);
      setTab('pool');
      setDiscardOpen(false);
      onClose();
      afterClose?.();
    };
    if (dirtyRef.current) {
      pendingExit.current = exit;
      setDiscardError('');
      setDiscardOpen(true);
    } else void exit();
  };

  /** 成功操作（选中基因 / 创建/编辑保存）：关闭 + 触发 onSelected */
  const handleSuccess = () => {
    dirtyRef.current = false;
    setCreateVisited(false);
    setTab('pool');
    onClose();
    onSelected?.();
  };

  if (editCharacter?.agentProfile === 'secretary') return <Suspense fallback={<div role="status">正在打开助理管理…</div>}><SecretaryManagementModal key={editCharacter.id} character={editCharacter} open={open} onClose={onClose} /></Suspense>;

  return (
    <Modal open={open} onClose={() => handleDismiss()} title={editCharacter ? '角色设置' : tab === 'create' ? '创建基因' : '基因库'} panelClassName={editCharacter ? 'vg-settings-panel' : `vg-gene-workspace${tab === 'create' ? ' vg-create-panel' : ''}`} panelStyle={!editCharacter ? { '--vg-gene-background': `url("${geneBackdrop}")` } as CSSProperties : undefined} width="max-w-2xl" closeOnBackdrop={false} canSnapshotOnExit={()=>false} mobileFullHeight
      onBack={!editCharacter && tab === 'create' ? () => { if (!formBusyRef.current) setTab('pool'); } : undefined}
      backLabel={!editCharacter && tab === 'create' ? '返回基因库' : undefined}
      headerActions={!editCharacter && tab === 'create' ? <button type="button" disabled={formBusy} className="w-12 h-12 flex items-center justify-center text-sub" aria-label="关闭" onClick={() => handleDismiss()}><Icon name="close" size={22}/></button> : undefined}
      footer={(editCharacter || tab === 'create') ? <div ref={setFooterTarget}/> : undefined}>
      {!editCharacter && tab === 'pool' && <div className="vg-character-editor-tabs flex gap-1" role="group" aria-label="基因页面">
        <button
          className="flex-1 rounded-xl py-3 text-sm font-semibold text-ink transition-colors"
          style={{ minHeight:44 }}
          aria-pressed={tab === 'pool'}
          disabled={formBusy}
          onClick={() => setTab('pool')}
        >
          基因库
        </button>
        <button
          className="flex-1 rounded-xl py-3 text-sm font-medium transition-colors text-sub hover:text-ink"
          style={{ minHeight:44 }}
          aria-pressed={false}
          disabled={formBusy}
          onClick={() => { setCreateVisited(true); setTab('create'); }}
        >
          创建基因
        </button>
      </div>}

      <div className={editCharacter ? 'vg-settings-design' : tab === 'create' ? 'p-6' : 'p-4 sm:p-6'}>
        {!editCharacter && tab === 'pool' && (
          <GenePoolTab onSelect={handleSuccess} singleScroll />
        )}
        {(editCharacter || createVisited) && <div hidden={!editCharacter && tab !== 'create'} inert={!editCharacter && tab !== 'create'}>
          <CreateGeneTab
            key={editCharacter?.id ?? 'new'}
            editCharacter={editCharacter ?? undefined}
            onClose={handleSuccess}
            onCancel={() => handleDismiss()}
            onSavingChange={trackFormBusy}
            onDirtyChange={trackDirty}
            onDiscardReady={trackDiscard}
            footerTarget={footerTarget}
            active={!!editCharacter || tab === 'create'}
          />
        </div>}
      </div>
      <Modal open={discardOpen} presentation="dialog" title="放弃尚未保存的内容？" onClose={() => { if (!discardBusy) { pendingExit.current = null; setDiscardOpen(false); } }} closeOnBackdrop={false} canSnapshotOnExit={()=>false}>
        <div className="p-4 space-y-4">
          <p className="text-sm text-sub">关闭后，本次填写的内容不会保存。你也可以继续编辑。</p>
          {discardError && <p className="text-sm text-sub" role="status">{discardError}</p>}
          <div className="flex gap-3">
            <button type="button" disabled={discardBusy} className="vg-button vg-button-secondary flex-1" onClick={() => { pendingExit.current = null; setDiscardOpen(false); }}>继续编辑</button>
            <button type="button" disabled={discardBusy} aria-busy={discardBusy} className="vg-button vg-button-danger flex-1" onClick={() => { pendingExit.current?.(); }}>{discardBusy ? '正在清除…' : '放弃并关闭'}</button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
