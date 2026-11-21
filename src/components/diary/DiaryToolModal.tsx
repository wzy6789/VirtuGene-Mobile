import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { useAiAvailability } from '../settings/useAiAvailability';

const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const ToolNavigation = createContext({ openConnection: () => {}, close: () => {} });

/** Keep the tool's owner mounted while the existing settings stack handles connection and back. */
export function DiaryToolModal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  const [connectionOpen, setConnectionOpen] = useState(false);
  useEffect(() => { if (!open) setConnectionOpen(false); }, [open]);
  return <ToolNavigation.Provider value={{ openConnection: () => setConnectionOpen(true), close: onClose }}>
    <Modal open={open && !connectionOpen} onClose={onClose} title={title} width="max-w-xl" closeOnBackdrop={false}
      panelClassName="vg-diary vg-diary-tool" canSnapshotOnExit={() => false}>
      {children}
    </Modal>
    {open && connectionOpen && <Suspense fallback={<Modal open title="AI 连接" onClose={() => setConnectionOpen(false)}><p className="p-5 text-sm text-sub">正在打开…</p></Modal>}>
      <SettingsPanel open initialPage="connection" onClose={() => setConnectionOpen(false)} />
    </Suspense>}
  </ToolNavigation.Provider>;
}

/** Use known error codes without exposing provider responses, endpoints or credentials. */
export function diaryFailure(error: string | null, hasAccess: boolean) {
  if (!hasAccess) return { message: '先配置当前模型的 AI 连接。', action: 'connection' } as const;
  if (error?.startsWith('请先在设置')) return { message: '配置已更新，可以继续生成。', action: 'continue' } as const;
  if (error === 'billing:insufficient') return { message: '当前额度不足，可在 AI 连接中更换服务商。', action: 'connection' } as const;
  if (error === 'rate:limited') return { message: '请求较频繁，请稍后重试。', action: 'retry' } as const;
  if (/^(auth:|model:unavailable|provider:|key:)/.test(error ?? '')) return { message: '当前模型连接不可用，请检查配置。', action: 'connection' } as const;
  if (/^(timeout|network|Failed to fetch|NetworkError|Load failed)/i.test(error ?? '')) return { message: '连接中断，请检查网络后重试。', action: 'retry' } as const;
  if (/^(还没有写过|这周还没有|\d{4} 年还没有|至少写|这一天没有|请先选择|先在日记里)/.test(error ?? '')) return { message: error!, action: 'back' } as const;
  return { message: '生成未完成，请稍后重试。', action: 'retry' } as const;
}

export function DiaryAiFeedback({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const hasAccess = useAiAvailability();
  const navigation = useContext(ToolNavigation);
  const failure = diaryFailure(error, hasAccess);
  return <div className="vg-diary-tool-feedback">
    <FeedbackNotice tone={failure.action === 'continue' ? 'info' : 'error'} message={failure.message} />
    <div className="vg-diary-tool-actions">
      {failure.action === 'connection' && <button type="button" className="vg-button vg-button-primary" onClick={navigation.openConnection}>AI 连接</button>}
      {failure.action === 'connection' && hasAccess && <button type="button" className="vg-button vg-button-secondary" onClick={onRetry}>重新生成</button>}
      {(failure.action === 'retry' || failure.action === 'continue') && <button type="button" className="vg-button vg-button-primary" onClick={onRetry}>{failure.action === 'continue' ? '继续生成' : '重试'}</button>}
      <button type="button" className="vg-button vg-button-ghost" onClick={navigation.close}>返回日记</button>
    </div>
  </div>;
}
