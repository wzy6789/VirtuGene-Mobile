import type { Character, WorldAgentState, WorldLocation, WorldPresence, WorldScene } from '../../db/index';

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
    <aside className="absolute inset-x-3 top-[58px] z-20 max-h-[min(68vh,520px)] overflow-y-auto rounded-[24px] border border-white/10 bg-[#111225]/95 p-4 shadow-[0_18px_70px_rgba(0,0,0,.45)] backdrop-blur-xl" aria-label="探索现场">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[.24em] text-cyan-200/65">现场探索</p>
          <h2 className="mt-1 text-base font-semibold text-white">{scene.place}</h2>
          <p className="mt-1 text-xs leading-5 text-white/55">看看谁在这里，也可以选择接下来去哪里。</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65 active:scale-95">收起</button>
      </div>

      <section className="mt-4 border-t border-white/8 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/85">此刻在场</h3>
          <span className="text-[11px] text-white/40">{presence.length} 人</span>
        </div>
        {presence.length ? (
          <div className="grid gap-2">
            {presence.map((item) => {
              const agent = agentFor(item.characterId);
              return <div key={item.id} className="flex items-center justify-between gap-3 text-xs text-white/65"><span>{nameOf(item.characterId)}</span><span className="truncate text-right text-white/40">{agent?.currentGoal || agent?.nextIntent || item.note || '在这里停留'}</span></div>;
            })}
          </div>
        ) : <p className="text-xs leading-5 text-white/55">暂时只有你在这里。</p>}
      </section>

      {otherLocations.length > 0 && (
        <section className="mt-4 border-t border-white/8 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-white/85">世界里的其他地点</h3>
          <span className="text-[11px] text-white/40">前往会写进世界</span>
          </div>
          <div data-no-page-swipe="true" className="flex gap-2 overflow-x-auto pb-1">
            {otherLocations.slice(0, 6).map((location) => (
              <button key={location.id} type="button" onClick={() => onMove(location)} className="shrink-0 rounded-full border border-violet-200/15 bg-violet-200/[.06] px-3 py-2 text-xs text-violet-100/80 active:scale-95">{location.name}</button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
