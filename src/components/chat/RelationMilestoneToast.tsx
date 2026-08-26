import { useEffect } from 'react';
import { useCharacterStateStore } from '../../store/character-state-store';

export function RelationMilestoneToast() {
  const milestone = useCharacterStateStore((s) => s.milestone);
  const clearMilestone = useCharacterStateStore((s) => s.clearMilestone);

  useEffect(() => {
    if (!milestone) return;
    const timer = setTimeout(() => clearMilestone(), 2800);
    return () => clearTimeout(timer);
  }, [milestone, clearMilestone]);

  if (!milestone) return null;

  return (
    <div className="pointer-events-none fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
      <div className="relative flex items-center gap-4 px-7 py-5 rounded-3xl border border-gene-purple/30 bg-panel/95 backdrop-blur-xl milestone-toast overflow-hidden">
        <span className="milestone-particle" style={{ left: '12%' }} />
        <span className="milestone-particle" style={{ left: '55%', animationDelay: '0.2s' }} />
        <span className="milestone-particle" style={{ left: '88%', animationDelay: '0.4s' }} />

        <span className="text-3xl shrink-0">🧬</span>
        <div className="flex flex-col leading-tight">
          <span className="text-xs uppercase tracking-[0.2em] text-gray-500">关系进阶</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-lg text-gray-400">{milestone.prevLevel}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00CEC9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <span className="text-2xl font-bold milestone-level">{milestone.level}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
