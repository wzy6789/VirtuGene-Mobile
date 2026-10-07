import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IS_MOBILE } from '../../lib/platform';
import { useModalMotion } from './useModalMotion';

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
  /** An optional action area outside the scrolling form. */
  footer?: React.ReactNode;
  panelClassName?: string;
  /** Mobile forms and detail views are pages; brief confirmations stay centered. */
  presentation?: 'page' | 'dialog';
  onBack?: () => void;
  /** Recheck access at unmount before retaining any visual copy for the exit animation. */
  canSnapshotOnExit?: () => boolean;
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg', closeOnBackdrop = true, mobileFullHeight = false, footer, canSnapshotOnExit, panelClassName = '', onBack, presentation = 'page' }: ModalProps) {
  const mobilePage = IS_MOBILE && presentation === 'page';
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const motionRef = useModalMotion(canSnapshotOnExit);
  const overlayMotionRef = useCallback((node: HTMLDivElement | null) => { overlayRef.current = node; motionRef(node); }, [motionRef]);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const backRef = useRef(onBack);
  backRef.current = onBack;

  useEffect(() => {
    if (!open) return;
    const token = Symbol('modal');
    const previousFocus = document.activeElement as HTMLElement | null;
    if (modalStack.length === 0) previousOverflow = document.body.style.overflow;
    modalStack.push(token);
    const panel = panelRef.current;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])]
      .filter(el => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
    const handleKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') { e.preventDefault(); (backRef.current ?? closeRef.current)(); }
      if (e.key === 'Tab' && panel) {
        const targets = focusable();
        const first = targets[0], last = targets[targets.length - 1];
        if (!first) { e.preventDefault(); panel.focus({ preventScroll: true }); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          e.preventDefault(); last.focus({ preventScroll: true });
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus({ preventScroll: true });
        }
      }
    };
    const retainFocus = (event: FocusEvent) => {
      if (modalStack[modalStack.length - 1] === token && panel && !panel.contains(event.target as Node)) panel.focus({ preventScroll: true });
    };
    // Focus the panel rather than a form field so opening a sheet does not summon the keyboard.
    const focusFrame = requestAnimationFrame(() => {
      if (modalStack[modalStack.length - 1] === token) panel?.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', handleKey);
    document.addEventListener('focusin', retainFocus);
    const handleBack = (event: Event) => {
      if (modalStack[modalStack.length - 1] !== token || event.defaultPrevented) return;
      event.preventDefault(); (backRef.current ?? closeRef.current)();
    };
    window.addEventListener('vg:back-request', handleBack);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('focusin', retainFocus);
      cancelAnimationFrame(focusFrame);
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
      ref={overlayMotionRef}
      data-no-page-swipe
      style={{ overscrollBehavior: 'none' }}
      className={`vg-modal-overlay fixed inset-0 flex justify-center items-center ${mobilePage ? 'vg-page-overlay' : ''}`}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : '弹窗'}
        aria-labelledby={title ? titleId : undefined}
        className={`vg-modal-panel ${panelClassName} relative z-10 rounded-2xl w-[calc(100%-2rem)] ${width} p-0 overflow-hidden ${footer ? 'vg-modal-with-footer' : ''} ${mobilePage ? 'vg-mobile-page' : IS_MOBILE ? 'vg-mobile-dialog' : 'animate-fade-in'} ${mobileFullHeight ? 'vg-modal-long-form' : ''}`}
      >
        {(title || mobilePage) && (
          <div className={`vg-modal-header shrink-0 flex items-center justify-between px-6 py-4 border-b border-line ${mobilePage ? 'vg-page-header' : ''}`}>
            {(onBack || mobilePage) && <button type="button" aria-label={onBack ? '返回设置' : '返回'} onClick={onBack ?? onClose} className="vg-settings-back vg-page-back"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 5-7 7 7 7" /></svg></button>}
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            {!mobilePage && <button
              onClick={onClose}
              aria-label="关闭"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-ink hover:bg-surface transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>}
          </div>
        )}
        <div data-modal-scroll className={`overflow-y-auto ${IS_MOBILE && mobileFullHeight ? 'vg-modal-form-scroll' : 'max-h-[70vh]'}`}>{children}</div>
        {footer && <div className="vg-modal-footer shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
