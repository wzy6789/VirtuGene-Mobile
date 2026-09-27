import type { Character, WorldScene, WorldSceneEntry } from '../../db/index';
import { cleanConstellationTitle } from '../../lib/world/constellation-typography';

function statusLabel(status: WorldScene['status']): string {
  return status === 'active' ? '进行中' : status === 'paused' ? '已暂停' : status === 'finished' ? '已保存' : '未开始';
}
function entryLabel(entry: WorldSceneEntry, characters: Character[]): string {
  if (entry.kind === 'user_input') return '你';
  if (entry.kind === 'narration') return '旁白';
  if (entry.kind === 'choice') return '选择';
  return characters.find(c => c.id === entry.speakerId)?.name ?? '记录';
}
export function WorldSceneConstellation({ scene, entries, characters, entriesLoading, onBack, onContinue }: {
  scene: WorldScene; entries: WorldSceneEntry[]; characters: Character[]; entriesLoading: boolean;
  onBack: () => void; onContinue: () => void;
}) {
  const cast = scene.characterIds.map(id => characters.find(c => c.id === id)).filter((c): c is Character => !!c);
  const recent = entries.filter(e => e.kind !== 'system').slice(-3);
  const facts = [
    { label: '地点', value: scene.place || '未设定地点', tone: 'mint' },
    { label: '时间', value: scene.timeLabel || '此刻', tone: 'violet' },
    { label: '角色', value: cast.map(c => c.name).join(' · ') || '只有你', tone: 'warm' },
    { label: '片段', value: `${entries.length} 条记录`, detail: scene.mood, tone: 'blue' },
  ];
  return <section className="vg-scene-constellation vg-sector-detail" aria-label={`世界星域：${scene.title}`}>
    <header className="vg-scene-constellation-header">
      <button type="button" onClick={onBack} className="vg-scene-back">‹ 世界星域</button>
      <span className={`vg-world-scene-status is-${scene.status}`}>{statusLabel(scene.status)}</span>
    </header>
    <div className="vg-sector-identity">
      <svg viewBox="0 0 360 140" fill="none" aria-hidden="true" focusable="false">
        <path d="M15 106C85 33 242 130 346 27M17 31C100 98 252 13 340 102" stroke="currentColor" strokeOpacity=".12" />
        <path d="M35 118C113 89 259 114 324 41" stroke="currentColor" strokeOpacity=".16" strokeDasharray="2 7" />
        <circle cx="62" cy="42" r="1.5" fill="currentColor" opacity=".6" /><circle cx="296" cy="83" r="1.5" fill="currentColor" opacity=".6" />
      </svg>
      <span className="vg-sector-identity-star" aria-hidden="true">✦</span>
      <h2>{cleanConstellationTitle(scene.title)}</h2>
      <p>这个世界</p>
    </div>
    <dl className="vg-sector-facts">
      {facts.map(f => <div key={f.label} className={`vg-sector-fact is-${f.tone}`}>
        <dt><i aria-hidden="true" />{f.label}</dt>
        <dd>{f.value}</dd>
        {f.detail && <span>{f.detail}</span>}
      </div>)}
    </dl>
    <div className="vg-sector-enter">
      <button type="button" className="vg-scene-constellation-continue" onClick={onContinue}>
        <span className="vg-scene-constellation-continue-label">{scene.status === 'finished' ? '回看世界' : '继续生活'}</span>
        <span className="vg-scene-continue-arrow" aria-hidden="true">↗</span>
      </button>
    </div>
    <section className="vg-sector-recent" aria-label="最近发生">
      <h3>最近发生</h3>
      {entriesLoading ? <p className="vg-sector-empty">正在读取这段经历…</p> : recent.length ?
        <div className="vg-sector-recent-list">{recent.map(e => <p key={e.id}><b>{entryLabel(e, characters)}</b><span>{e.content}</span></p>)}</div>
        : <p className="vg-sector-empty">这里还没有经历，下一句话会决定它的方向。</p>}
    </section>
  </section>;
}
