import { resonate } from '../../lib/haptics';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCharacterStateStore } from '../../store/character-state-store';
import { animateVisual } from '../../lib/ui-visual-motion';
import { SoulOrb } from '../ui/SoulOrb';
import { Icon } from '../ui/Icon';

const celebrated = new WeakSet<object>();

export function RelationMilestoneToast() {
  const milestone = useCharacterStateStore((s) => s.milestone);
  const clearMilestone = useCharacterStateStore((s) => s.clearMilestone);
  const card = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!milestone) return;
    return animateVisual(card.current, [{opacity:0,transform:'translateY(-8px) scale(.98)'},{opacity:1,transform:'none'}], 320);
  }, [milestone]);

  useEffect(() => {
    if (!milestone) return;
    if (!celebrated.has(milestone)) { celebrated.add(milestone); resonate('success'); }
    const timer = setTimeout(() => {
      if (useCharacterStateStore.getState().milestone === milestone) clearMilestone();
    }, 2800);
    return () => clearTimeout(timer);
  }, [milestone, clearMilestone]);

  if (!milestone) return null;

  return createPortal(
    <div className="vg-relation-receipt" aria-live="polite" aria-atomic="true">
      <div ref={card} className="vg-relation-receipt-card">
        <span className="vg-relation-receipt-face" aria-hidden="true"><SoulOrb size={48} emotion="happy" animated={false} fallbackLabel={false} /></span>
        <div className="vg-relation-receipt-copy">
          <span>关系进阶</span>
          <strong>{milestone.level}</strong>
          <p>从「{milestone.prevLevel}」走到了这里</p>
        </div>
        <Icon name="spark" size={20} className="vg-relation-receipt-spark" />
      </div>
    </div>, document.body
  );
}
