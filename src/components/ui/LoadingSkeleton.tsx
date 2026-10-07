export function LoadingSkeleton({ label, rows=3, stats=false }: { label: string; rows?: number; stats?: boolean }) {
  return <div className="vg-loading-skeleton" role="status" aria-label={label}><span className="sr-only">{label}</span><div aria-hidden="true">
    {stats && <div className="vg-skeleton-stat-grid">{[0,1,2,3].map(i => <div key={i}><i /><i /></div>)}</div>}
    {Array.from({ length: rows }, (_, i) => <div className="vg-skeleton-card" key={i}><i /><span><i /><i /><i /></span></div>)}
  </div></div>;
}
