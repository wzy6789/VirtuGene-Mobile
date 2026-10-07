import type { SoulRole } from '../../lib/soul-handoff';
import type { SoulOrbEmotion } from './SoulOrb';
import { SoulOrb } from './SoulOrb';
export function OrbEmptyState({ title, detail, action, onAction, emotion='idle', soulKey, soulRole }: { title: string; detail: string; action: string; onAction: () => void; emotion?: SoulOrbEmotion; soulKey?: string; soulRole?: SoulRole }) {
  return <div className="vg-orb-empty-state"><SoulOrb size={88} emotion={emotion} soulKey={soulKey} soulRole={soulRole}/><strong>{title}</strong><p>{detail}</p><button type="button" className="vg-button vg-button-secondary" onClick={onAction}>{action}</button></div>;
}
