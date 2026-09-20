import type { Character, WorldAgentState, WorldLocation, WorldObject, WorldPresence, WorldScene } from '../../db/index';

export function WorldExplorePanel({
  scene,
  locations,
  objects,
  presence,
  agents,
  characters,
  onClose,
  onInspect,
  onAct,
  onMove,
}: {
  scene: WorldScene;
  locations: WorldLocation[];
  objects: WorldObject[];
  presence: WorldPresence[];
  agents: WorldAgentState[];
  characters: Character[];
  onClose: () => void;
  onInspect: (object: WorldObject) => void;
  onAct: (object: WorldObject, action: 'take' | 'leave' | 'open') => void;
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
          <p className="mt-1 text-xs leading-5 text-white/55">先看看这里留下了什么，再决定让世界往哪里走。</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65 active:scale-95">收起</button>
      </div>

      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/85">这里有</h3>
          <span className="text-[11px] text-white/40">{objects.length} 个细节</span>
        </div>
        {objects.length ? (
          <div className="grid gap-2">
            {objects.map((object) => (
              <div key={object.id} className="rounded-2xl border border-white/8 bg-white/[.045] px-3 py-3 transition">
                <button type="button" onClick={() => onInspect(object)} className="flex w-full items-start gap-3 text-left active:opacity-80">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-cyan-300/10 text-sm text-cyan-100">{object.kind === 'note' ? '⌁' : object.kind === 'door' ? '◫' : object.kind === 'device' ? '⌘' : '✦'}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-white/90">{object.name}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-white/50">{object.lastAction ? `上次：${object.lastAction}` : object.description}</span>
                  </span>
                </button>
                <div className="mt-2 flex gap-2 pl-10">
                  {object.state !== 'held' && <button type="button" onClick={() => onAct(object, 'take')} className="rounded-full border border-cyan-100/10 px-2.5 py-1 text-[11px] text-cyan-100/70 active:scale-95">带走</button>}
                  {object.state === 'held' && <button type="button" onClick={() => onAct(object, 'leave')} className="rounded-full border border-cyan-100/10 px-2.5 py-1 text-[11px] text-cyan-100/70 active:scale-95">放下</button>}
                  {(object.kind === 'door' || object.kind === 'device') && object.state !== 'moved' && <button type="button" onClick={() => onAct(object, 'open')} className="rounded-full border border-violet-100/10 px-2.5 py-1 text-[11px] text-violet-100/70 active:scale-95">打开</button>}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-xs text-white/45">这里暂时没有留下可辨认的细节。</p>}
      </section>

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
            <span className="text-[11px] text-white/40">前往会写进剧情</span>
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
