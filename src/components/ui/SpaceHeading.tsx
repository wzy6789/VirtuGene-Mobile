import type { ReactNode } from 'react';

export function SpaceHeading({ eyebrow, title, detail, action }: {
  eyebrow: string; title: string; detail: string; action?: ReactNode;
}) {
  return <header className="vg-space-heading">
    <div className="min-w-0">
      <p className="vg-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="vg-heading-detail">{detail}</p>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </header>;
}
