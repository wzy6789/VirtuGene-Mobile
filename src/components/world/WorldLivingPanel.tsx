import { memo, useMemo, useState } from 'react';
import type { Character, WorldEvent, WorldPulse, WorldScene } from '../../db/index';
import type { WorldKernelSnapshot } from '../../lib/world/world-kernel';
import { eventLabel } from '../../lib/world/world-timeline';

function pulseLabel(pulse: WorldPulse | null, busy: boolean): string {
  if (busy) return '世界正在向前行走';
  if (!pulse) return '还没有离开期间的记录';
  if (pulse.status === 'failed') return '这一段时间没有被编造成事件';
  if (pulse.status === 'pending') return '正在整理刚才错过的时间';
  return pulse.eventIds.length > 0 ? '离开期间留下了新的回声' : '这段时间很安静';
}

function durationLabel(pulse: WorldPulse | null): string {
  if (!pulse) return '';
  const minutes = Math.max(1, Math.round((pulse.toWorldTime - pulse.fromWorldTime) / 60_000));
  if (minutes < 60) return `${minutes} 分钟前进`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} 小时前进` : `${Math.round(hours / 24)} 天前进`;
}

export const WorldLivingPanel = memo(function WorldLivingPanel({
  kernel,
  characters,
  scenes,
  events,
  pulse,
  pulseBusy,
  onPulse,
}: {
  kernel: WorldKernelSnapshot;
  characters: Character[];
  scenes: WorldScene[];
  events: WorldEvent[];
  pulse: WorldPulse | null;
  pulseBusy: boolean;
  onPulse: () => void;
}) {
  const [locationId, setLocationId] = useState<string | null>(null);
  const selectedLocation = kernel.locations.find((location) => location.id === locationId) ?? null;
  const characterById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);
  const locations = kernel.locations.slice(0, 8);
  const selectedPeople = selectedLocation
    ? kernel.presences
      .filter((presence) => presence.locationId === selectedLocation.id && presence.status === 'present')
      .map((presence) => ({
        character: characterById.get(presence.characterId),
        agent: kernel.agents.find((row) => row.characterId === presence.characterId),
      }))
      .filter((row): row is { character: Character; agent: typeof kernel.agents[number] | undefined } => Boolean(row.character))
    : [];
  const selectedScenes = selectedLocation ? scenes.filter((scene) => scene.locationId === selectedLocation.id || scene.place === selectedLocation.name) : [];
  const selectedEvents = selectedLocation ? events.filter((event) => event.locationId === selectedLocation.id).slice(0, 3) : [];

  return (
    <section className="vg-living-panel" aria-label="世界脉搏">
      <header className="vg-living-panel-head">
        <div>
          <p className="vg-living-panel-code">WORLD PULSE</p>
          <h2>他们的生活还在继续</h2>
          <p>{pulseLabel(pulse, pulseBusy)}{durationLabel(pulse) ? ` · ${durationLabel(pulse)}` : ''}</p>
        </div>
        <button type="button" className="vg-living-pulse-button" onClick={onPulse} disabled={pulseBusy || characters.length === 0}>
          <span aria-hidden="true">{pulseBusy ? '◌' : '↗'}</span>
          {pulseBusy ? '行走中' : '走一步'}
        </button>
      </header>

      <div className="vg-living-people" aria-label="角色此刻的状态">
        {characters.length === 0 ? (
          <p className="vg-living-empty">等一位角色进入这个世界。</p>
        ) : characters.slice(0, 8).map((character) => {
          const presence = kernel.presences.find((row) => row.characterId === character.id);
          const agent = kernel.agents.find((row) => row.characterId === character.id);
          const place = kernel.locations.find((location) => location.id === presence?.locationId);
          return (
            <article key={character.id} className="vg-living-person">
              <span className="vg-living-person-mark" aria-hidden="true">{presence?.status === 'present' ? '·' : '—'}</span>
              <div>
                <strong>{character.name}</strong>
                <span>{place?.name ?? '还没有固定地点'}</span>
                {agent?.currentGoal && <em>{agent.currentGoal}</em>}
              </div>
            </article>
          );
        })}
      </div>

      <div className="vg-living-locations-head">
        <span>地点正在发生什么</span>
        <small>点开一个地点</small>
      </div>
      <div data-no-page-swipe="true" className="vg-living-locations" role="list">
        {locations.map((location) => {
          const people = kernel.presences.filter((presence) => presence.locationId === location.id && presence.status === 'present');
          const activeSceneCount = scenes.filter((scene) => scene.locationId === location.id || scene.place === location.name).filter((scene) => scene.status === 'active').length;
          const active = people.length > 0 || activeSceneCount > 0;
          return (
            <button
              type="button"
              role="listitem"
              key={location.id}
              className={`vg-living-location ${location.id === locationId ? 'is-selected' : ''} ${active ? 'is-active' : ''}`}
              onClick={() => setLocationId((current) => current === location.id ? null : location.id)}
            >
              <span className="vg-living-location-signal" aria-hidden="true" />
              <strong>{location.name}</strong>
              <span>{people.length ? `${people.length} 人在场` : activeSceneCount ? '世界正在发生' : '暂时安静'}</span>
            </button>
          );
        })}
      </div>

      {selectedLocation && (
        <div className="vg-living-location-detail">
          <div className="vg-living-location-detail-head">
            <div><span>LOCATION LENS</span><strong>{selectedLocation.name}</strong></div>
            <button type="button" onClick={() => setLocationId(null)} aria-label="关闭地点视角">收起</button>
          </div>
          <p className="vg-living-location-description">{selectedLocation.description ?? '这里还没有被写下固定的样子，下一次发生会留下第一笔记忆。'}</p>
          {selectedPeople.length > 0 && (
            <div className="vg-living-location-people">
              {selectedPeople.map(({ character, agent }) => (
                <div key={character.id}><b>{character.name}</b><span>{agent?.nextIntent ?? '正在这里停留'}</span></div>
              ))}
            </div>
          )}
          {selectedScenes.length > 0 && <p className="vg-living-location-scenes">这里有 {selectedScenes.length} 个相关世界{selectedScenes.some((scene) => scene.status === 'active') ? '，其中一个正在发生' : ''}。</p>}
          {selectedEvents.length > 0 && (
            <div className="vg-living-location-events">
              {selectedEvents.map((event) => <p key={event.id}><small>{eventLabel(event)}</small><span>{event.title}</span></p>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
});
