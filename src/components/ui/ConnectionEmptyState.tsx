import type { ReactNode } from 'react';

/** A quiet brand illustration with a clear next action, for empty and filtered lists. */
export function ConnectionEmptyState({ title, detail, searching = false, action }: {
  title: string; detail: string; searching?: boolean; action?: ReactNode;
}) {
  return <div className="vg-connection-empty">
    <div className="vg-empty-art" aria-hidden="true">
      <svg viewBox="0 0 128 108" fill="none" focusable="false">
        <ellipse className="vg-empty-orbit" cx="64" cy="54" rx="57" ry="26" transform="rotate(-24 64 54)" />
        <ellipse className="vg-empty-orbit" cx="64" cy="54" rx="46" ry="40" transform="rotate(24 64 54)" />
        <rect className="vg-empty-core" x="37" y="27" width="54" height="54" rx="18" />
        <g className="vg-empty-symbol" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {searching ? <><circle cx="61" cy="51" r="10" /><path d="m69 59 9 9" /></> : <><path d="M50 42h28v19H61l-8 7v-7h-3V42Z" /><path d="M56 49h16M56 54h10" /></>}
        </g>
        <circle className="vg-empty-node" cx="110" cy="31" r="3" />
        <circle className="vg-empty-node" cx="19" cy="76" r="2" />
      </svg>
    </div>
    <h2>{title}</h2>
    <p>{detail}</p>
    {action && <div className="vg-empty-action">{action}</div>}
  </div>;
}
