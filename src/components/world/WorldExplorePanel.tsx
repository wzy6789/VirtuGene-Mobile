import type { Character, WorldAgentState, WorldLocation, WorldPresence, WorldScene } from '../../db/index';
import { Icon } from '../ui/Icon';

export function WorldExplorePanel({
  scene,
  locations,
  presence,
  agents,
  characters,
  onClose,
  onMove,
}: {
  scene: WorldScene;
  locations: WorldLocation[];
  presence: WorldPresence[];
  agents: WorldAgentState[];
  characters: Character[];
  onClose: () => void;
  onMove: (location: WorldLocation) => void;
}) {
  const nameOf = (id: string) => characters.find((character) => character.id === id)?.name ?? '某人';
  const agentFor = (id: string) => agents.find((agent) => agent.characterId === id);
  const otherLocations = locations.filter((location) => location.id !== scene.locationId && location.type !== 'reality');

  return (
    <aside className="vg-world-explore" aria-label="探索现场">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-wider text-[color:var(--vg-cyan)]">现场探索</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">{scene.place}</h2>
          <p className="mt-2 text-sm leading-6 text-sub">看看谁在这里，也可以选择接下来去哪里。</p>
        </div>
        <button type="button" onClick={onClose} aria-label="收起探索现场" className="vg-button vg-button-secondary shrink-0"><Icon name="close" size={18} /></button>
      </div>

      <section className="mt-4 border-t border-line pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">此刻在场</h3>
          <span className="text-[12px] text-sub">{presence.length} 人</span>
        </div>
        {presence.length ? (
          <div className="grid gap-2">
            {presence.map((item) => {
              const agent = agentFor(item.characterId);
              return <div key={item.id} className="vg-world-explore-person"><strong>{nameOf(item.characterId)}</strong><span>{agent?.currentGoal || agent?.nextIntent || item.note || '在这里停留'}</span></div>;
            })}
          </div>
        ) : <p className="text-sm leading-6 text-sub">暂时只有你在这里。</p>}
      </section>

      {otherLocations.length > 0 && (
        <section className="mt-4 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink">世界里的其他地点</h3>
          <span className="text-[12px] text-sub">前往会写进世界</span>
          </div>
          <div data-no-page-swipe="true" className="flex gap-2 overflow-x-auto pb-1">
            {otherLocations.slice(0, 6).map((location) => (
              <button key={location.id} type="button" onClick={() => onMove(location)} className="vg-button vg-button-secondary shrink-0">{location.name}</button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
