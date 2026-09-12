import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IS_MOBILE } from '../../lib/platform';

const modalStack: symbol[] = [];
let previousOverflow = '';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
  closeOnBackdrop?: boolean;
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg', closeOnBackdrop = true }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = Symbol('modal');
    const previousFocus = document.activeElement as HTMLElement | null;
    if (modalStack.length === 0) previousOverflow = document.body.style.overflow;
    modalStack.push(token);
    const handleKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      const index = modalStack.indexOf(token);
      if (index !== -1) modalStack.splice(index, 1);
      if (modalStack.length === 0) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={`vg-modal-overlay fixed inset-0 z-50 flex justify-center bg-black/60 ${IS_MOBILE ? 'items-end' : 'items-center'}`}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === overlayRef.current) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`vg-modal-panel relative z-10 rounded-2xl w-[calc(100%-2rem)] ${width} p-0 overflow-hidden animate-fade-in ${IS_MOBILE ? 'vg-mobile-sheet' : ''}`}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-line">
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-ink hover:bg-surface transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        <div className="overflow-y-auto max-h-[70vh]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
