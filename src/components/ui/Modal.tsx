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
  /** Long mobile forms use one stable scroll surface. */
  mobileFullHeight?: boolean;
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg', closeOnBackdrop = true, mobileFullHeight = false }: ModalProps) {
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
    const handleBack = (event: Event) => {
      if (modalStack[modalStack.length - 1] !== token || event.defaultPrevented) return;
      event.preventDefault(); closeRef.current();
    };
    window.addEventListener('vg:back-request', handleBack);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('vg:back-request', handleBack);
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
      data-no-page-swipe
      style={{ overscrollBehavior: 'none' }}
      className={`vg-modal-overlay fixed inset-0 z-50 flex justify-center bg-black/60 ${IS_MOBILE ? 'items-end' : 'items-center'}`}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === overlayRef.current) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`vg-modal-panel relative z-10 rounded-2xl w-[calc(100%-2rem)] ${width} p-0 overflow-hidden ${IS_MOBILE && mobileFullHeight ? 'vg-mobile-sheet vg-mobile-sheet-full' : `animate-fade-in ${IS_MOBILE ? 'vg-mobile-sheet' : ''}`}`}
      >
        {title && (
          <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-line">
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
        <div data-modal-scroll className={`overflow-y-auto ${IS_MOBILE && mobileFullHeight ? 'vg-modal-form-scroll' : 'max-h-[70vh]'}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
