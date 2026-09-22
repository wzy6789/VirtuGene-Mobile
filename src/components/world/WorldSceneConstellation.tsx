import type { Character, WorldScene, WorldSceneEntry } from '../../db/index';
import { CONSTELLATION_TYPE, cleanConstellationTitle, constellationLabelScale, fitConstellationName } from '../../lib/world/constellation-typography';

const WIDTH = 360;
const HEIGHT = 620;
const CENTER = { x: 180, y: 207 };

function statusLabel(status: WorldScene['status']): string {
  if (status === 'active') return '进行中';
  if (status === 'paused') return '已暂停';
  if (status === 'finished') return '已保存';
  return '未开始';
}

function entryLabel(entry: WorldSceneEntry, characters: Character[]): string {
  if (entry.kind === 'narration') return '旁白';
  if (entry.kind === 'action') return characters.find((character) => character.id === entry.speakerId)?.name ?? '动作';
  if (entry.kind === 'dialogue') return characters.find((character) => character.id === entry.speakerId)?.name ?? '对白';
  if (entry.kind === 'user_input') return '你';
  if (entry.kind === 'choice') return '选择';
  return '记录';
}

function onActivate(event: React.KeyboardEvent<HTMLElement>, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

export function WorldSceneConstellation({
  scene,
  entries,
  characters,
  entriesLoading,
  onBack,
  onContinue,
}: {
  scene: WorldScene;
  entries: WorldSceneEntry[];
  characters: Character[];
  entriesLoading: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const cast = scene.characterIds
    .map((id) => characters.find((character) => character.id === id))
    .filter((character): character is Character => Boolean(character));
  const recentEntries = entries.slice(-3);
  const tone = scene.status === 'active' ? '#82e8e3' : scene.status === 'paused' ? '#f0b568' : '#9b8bed';
  const labelScale = constellationLabelScale(1);

  return (
    <section className="vg-scene-constellation" aria-label={`世界星域：${scene.title}`}>
      <header className="vg-scene-constellation-header">
        <button type="button" onClick={onBack} className="vg-scene-back">‹ 世界星域</button>
        <span className={`vg-world-scene-status is-${scene.status}`}>{statusLabel(scene.status)}</span>
      </header>

      <div className="vg-scene-constellation-map">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`世界 ${scene.title} 的详情星域`}>
          <defs>
            <radialGradient id="vg-scene-core" cx="50%" cy="42%" r="68%">
              <stop offset="0%" stopColor={tone} stopOpacity=".42" />
              <stop offset="70%" stopColor={tone} stopOpacity=".08" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </radialGradient>
            <filter id="vg-scene-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path d="M25 101 C74 33 128 42 180 58 S293 46 338 113" fill="none" stroke="rgba(130,232,227,.10)" strokeDasharray="2 10" />
          <path d="M22 351 C78 303 122 333 180 356 S282 334 339 369" fill="none" stroke="rgba(155,139,237,.10)" strokeDasharray="1 9" />
          {[{ x: 32, y: 50, r: 1.2 }, { x: 328, y: 55, r: .9 }, { x: 20, y: 420, r: .8 }, { x: 338, y: 446, r: 1.1 }, { x: 93, y: 488, r: .7 }, { x: 277, y: 513, r: .8 }, { x: 344, y: 238, r: .7 }].map((star) => (
            <circle key={`${star.x}-${star.y}`} cx={star.x} cy={star.y} r={star.r} fill="#b6adff" opacity=".62" />
          ))}

          <path d="M180 160 C126 126 86 129 60 104" fill="none" stroke={tone} strokeOpacity=".35" strokeDasharray="2 5" />
          <path d="M180 160 C236 125 275 129 302 104" fill="none" stroke={tone} strokeOpacity=".35" strokeDasharray="2 5" />
          <path d="M180 255 C130 282 99 317 83 357" fill="none" stroke={tone} strokeOpacity=".25" strokeDasharray="2 5" />
          <path d="M180 255 C230 283 264 314 279 357" fill="none" stroke={tone} strokeOpacity=".25" strokeDasharray="2 5" />

          <g className="vg-scene-star-core" filter="url(#vg-scene-glow)">
            <text className="vg-scene-title" x={CENTER.x} y={CENTER.y - 5} textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.sector * labelScale} fontWeight="600">{cleanConstellationTitle(scene.title)}</text>
            <text x={CENTER.x} y={CENTER.y + 15} textAnchor="middle" fill="#a9a3c8" fontSize={CONSTELLATION_TYPE.body * labelScale}>这个世界</text>
          </g>

          <g className="vg-scene-satellite">
            <text x="60" y="111" textAnchor="middle" fill="#82e8e3" fontSize="28">✦</text>
            <text x="60" y="135" textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.character * labelScale}>地点</text>
            <text x="60" y="153" textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.body * labelScale}>{fitConstellationName(scene.place || '未设定地点')}</text>
          </g>

          <g className="vg-scene-satellite">
            <text x="300" y="111" textAnchor="middle" fill="#c5bdfd" fontSize="28">✦</text>
            <text x="300" y="135" textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.character * labelScale}>时间</text>
            <text x="300" y="153" textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.body * labelScale}>{fitConstellationName(scene.timeLabel || '此刻')}</text>
          </g>

          <g className="vg-scene-satellite">
            <text x="83" y="364" textAnchor="middle" fill="#f0b568" fontSize="28">✦</text>
            <text x="83" y="388" textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.character * labelScale}>角色</text>
            <text x="83" y="406" textAnchor="middle" fill="#a9a3c8" fontSize={CONSTELLATION_TYPE.body * labelScale}>{cast.length ? `${cast.length} 位角色` : '只有你'}</text>
            <text x="83" y="424" textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.body * labelScale}>{fitConstellationName(cast.slice(0, 2).map((character) => character.name).join(' · ') || '你与世界')}</text>
          </g>

          <g className="vg-scene-satellite">
            <text x="279" y="364" textAnchor="middle" fill="#82e8e3" fontSize="28">✦</text>
            <text x="279" y="388" textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.character * labelScale}>片段</text>
            <text x="279" y="406" textAnchor="middle" fill="#a9a3c8" fontSize={CONSTELLATION_TYPE.body * labelScale}>{entries.length ? `${entries.length} 条记录` : '尚无记录'}</text>
            <text x="279" y="424" textAnchor="middle" fill="#f0edff" fontSize={CONSTELLATION_TYPE.body * labelScale}>{fitConstellationName(scene.mood || '等待发生')}</text>
          </g>
        </svg>

        <div className="vg-scene-constellation-note">
          <p>最近发生</p>
          {entriesLoading ? (
            <span>正在读取这段经历…</span>
          ) : recentEntries.length ? (
            <div>
              {recentEntries.map((entry) => <span key={entry.id}><b>{entryLabel(entry, characters)}</b>{entry.content}</span>)}
            </div>
          ) : (
            <span>这里还没有经历，下一句话会决定它的方向。</span>
          )}
        </div>

        <button type="button" className="vg-scene-constellation-continue" onClick={onContinue}>
          <span className="vg-scene-constellation-continue-label">{scene.status === 'finished' ? '回看世界' : '继续生活'}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
