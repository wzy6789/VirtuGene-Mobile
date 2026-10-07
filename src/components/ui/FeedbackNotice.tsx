import type { ReactNode } from 'react';
import type { FeedbackTone } from '../../lib/feedback';
import { Icon } from './Icon';

export function FeedbackNotice({ message, tone = 'info', children, className = '' }: {
  message: string; tone?: FeedbackTone; children?: ReactNode; className?: string;
}) {
  return <div className={`vg-feedback-card ${className}`} data-tone={tone}>
    <span className="vg-feedback-symbol" aria-hidden="true"><Icon name={tone === 'success' ? 'check' : tone === 'error' ? 'warning' : 'info'} /></span>
    <span className="vg-feedback-copy" role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true">{message}</span>
    {children && <div className="vg-feedback-actions">{children}</div>}
  </div>;
}
