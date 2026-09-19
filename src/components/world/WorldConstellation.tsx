import type { WorldScene } from '../../db/index';
import { CONSTELLATION_TYPE, cleanConstellationTitle, constellationLabelScale } from '../../lib/world/constellation-typography';

const WIDTH = 360;
const HEIGHT = 390;
const CENTER = { x: 180, y: 190 };

type ScenePoint = {
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  labelW: number;
};

/**
 * 非对称的深空坐标。剧情星点与文字各占独立区域，
 * 中文标题即使达到五个字也不会压住节点或其他文字。
 */
const SCENE_POINTS: ScenePoint[] = [
  { x: 63, y: 78, labelX: 10, labelY: 12, labelW: 108 },
  { x: 293, y: 82, labelX: 235, labelY: 14, labelW: 112 },
  { x: 321, y: 190, labelX: 244, labelY: 214, labelW: 106 },
  { x: 276, y: 309, labelX: 229, labelY: 329, labelW: 116 },
  { x: 89, y: 318, labelX: 15, labelY: 329, labelW: 116 },
  { x: 37, y: 196, labelX: 10, labelY: 220, labelW: 108 },
];

const BACKGROUND_STARS = [
  [20, 42, 1.1], [143, 24, .7], [218, 43, .8], [342, 51, 1], [18, 137, .7],
  [112, 121, .6], [335, 137, .6], [24, 283, .9], [151, 353, .7], [346, 286, 1],
] as const;

function sceneTone(scene: WorldScene, selected: boolean): string {
  if (selected || scene.status === 'active') return '#73f6ec';
  if (scene.status === 'finished') return '#a99bff';
  if (scene.status === 'paused') return '#ffbd73';
  return '#78809f';
}

function sceneStatus(scene: WorldScene): string {
  if (scene.status === 'active') return '信号活跃';
  if (scene.status === 'paused') return '轨道暂停';
  if (scene.status === 'finished') return '已写入世界';
  return '等待唤醒';
}

function linkPath(point: ScenePoint, index: number): string {
  const bendX = (CENTER.x + point.x) / 2 + (index % 2 === 0 ? -11 : 13);
  const bendY = (CENTER.y + point.y) / 2 + (index % 3 === 0 ? -14 : 11);
  return `M ${CENTER.x} ${CENTER.y} Q ${bendX} ${bendY} ${point.x} ${point.y}`;
}

function labelConnector(point: ScenePoint): { x: number; y: number } {
  return {
    x: Math.min(Math.max(point.x, point.labelX + 12), point.labelX + point.labelW - 12),
    y: point.labelY < point.y ? point.labelY + 54 : point.labelY,
  };
}

function onActivate(event: React.KeyboardEvent<SVGGElement>, action: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

export function WorldConstellation({
  scenes,
  currentSceneId,
  onOpenScene,
  onOpenStage,
  onOpenDiary,
}: {
  scenes: WorldScene[];
  currentSceneId?: string | null;
  onOpenScene: (sceneId: string) => void;
  onOpenStage: () => void;
  onOpenDiary: () => void;
}) {
  const visibleScenes = scenes.slice(0, SCENE_POINTS.length);
  const extraScenes = Math.max(0, scenes.length - visibleScenes.length);
  // 当前星图没有缩放手势；保留统一的计算入口，后续加入缩放时标签仍遵守 0.85～1.15 的视觉上下限。
  const labelScale = constellationLabelScale(1);

  return (
    <section className="vg-world-constellation" aria-label="世界星图">
      <div className="vg-world-constellation-head">
        <div>
          <p className="vg-world-constellation-kicker">STORY ORBITS</p>
          <h2>剧情星域</h2>
          <p>{scenes.length > 0 ? `${scenes.length} 段生活仍在留下回声` : '第一段故事，正等你点亮。'}</p>
        </div>
        <button type="button" onClick={onOpenStage}><i />新建剧情</button>
      </div>

      <div className="vg-world-constellation-map">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="由生活核心与多段剧情信标组成的世界星图">
          <defs>
            <linearGradient id="vg-world-core-surface" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#21265a" stopOpacity=".98" />
              <stop offset="48%" stopColor="#151633" stopOpacity=".98" />
              <stop offset="100%" stopColor="#082c36" stopOpacity=".98" />
            </linearGradient>
            <linearGradient id="vg-world-core-edge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#b1a4ff" />
              <stop offset="52%" stopColor="#73f6ec" />
              <stop offset="100%" stopColor="#5d70ff" />
            </linearGradient>
            <linearGradient id="vg-world-link" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#73f6ec" stopOpacity=".72" />
              <stop offset="100%" stopColor="#9585ff" stopOpacity=".28" />
            </linearGradient>
            <radialGradient id="vg-world-halo">
              <stop offset="0%" stopColor="#7767f5" stopOpacity=".2" />
              <stop offset="65%" stopColor="#36d9d0" stopOpacity=".05" />
              <stop offset="100%" stopColor="#101025" stopOpacity="0" />
            </radialGradient>
            <pattern id="vg-world-grid" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#9b91dc" strokeOpacity=".055" strokeWidth=".6" />
            </pattern>
          </defs>

          <rect width={WIDTH} height={HEIGHT} fill="url(#vg-world-grid)" />
          <ellipse cx="180" cy="192" rx="117" ry="137" fill="url(#vg-world-halo)" />
          <path className="vg-world-sector-line" d="M16 112 L108 36 L252 30 L344 121 L326 286 L223 374 L77 361 L18 271 Z" />
          <path className="vg-world-sector-line is-secondary" d="M75 53 L180 16 L318 72 L351 214 L274 354 L110 373 L17 250 L33 137 Z" />
          {BACKGROUND_STARS.map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#c4bcff" opacity=".58" />)}

          {visibleScenes.map((scene, index) => {
            const point = SCENE_POINTS[index];
            const selected = scene.id === currentSceneId;
            const path = linkPath(point, index);
            return (
              <g key={`world-scene-link-${scene.id}`} className={selected || scene.status === 'active' ? 'vg-world-link is-live' : 'vg-world-link'}>
                <path d={path} className="vg-world-link-base" />
                {(selected || scene.status === 'active') && <path d={path} className="vg-world-link-signal" />}
              </g>
            );
          })}

          <g
            role="button"
            tabIndex={0}
            aria-label="打开我的生活日记"
            className="vg-world-constellation-core"
            onClick={onOpenDiary}
            onKeyDown={(event) => onActivate(event, onOpenDiary)}
          >
            <circle cx={CENTER.x} cy={CENTER.y} r="76" fill="url(#vg-world-halo)" />
            <ellipse className="vg-world-core-aura" cx={CENTER.x} cy={CENTER.y} rx="86" ry="58" />
            <path className="vg-world-core-rays" d="M 108 190 H 136 M 224 190 H 252 M 180 118 V 145 M 180 235 V 262 M 124 134 L 143 153 M 217 227 L 236 246 M 236 134 L 217 153 M 143 227 L 124 246" />
            <path className="vg-world-core-scan" d="M 122 176 H 238" />
            <text x={CENTER.x} y={CENTER.y - 31} textAnchor="middle" className="vg-world-core-code" style={{ fontSize: `${CONSTELLATION_TYPE.body * labelScale}px` }}>REALITY CORE</text>
            <text x={CENTER.x} y={CENTER.y + 7} textAnchor="middle" className="vg-world-core-title" style={{ fontSize: `${CONSTELLATION_TYPE.world * labelScale}px` }}>我的生活</text>
            <text x={CENTER.x} y={CENTER.y + 35} textAnchor="middle" className="vg-world-core-subtitle" style={{ fontSize: `${CONSTELLATION_TYPE.body * labelScale}px` }}>记忆持续写入</text>
          </g>

          {visibleScenes.map((scene, index) => {
            const point = SCENE_POINTS[index];
            const selected = scene.id === currentSceneId;
            const tone = sceneTone(scene, selected);
            const connector = labelConnector(point);
            const labelCenter = point.labelX + point.labelW / 2;
            return (
              <g
                key={scene.id}
                role="button"
                tabIndex={0}
                aria-label={`查看剧情：${scene.title}`}
                onClick={() => onOpenScene(scene.id)}
                onKeyDown={(event) => onActivate(event, () => onOpenScene(scene.id))}
                className={`vg-world-constellation-node is-${scene.status}${selected ? ' is-selected' : ''}`}
              >
                <line x1={point.x} y1={point.y} x2={connector.x} y2={connector.y} stroke={tone} strokeOpacity=".38" strokeDasharray="2 4" />
                <text className="vg-world-scene-star" x={point.x} y={point.y + 7} textAnchor="middle" fill={tone} fontSize={selected ? 24 : 20}>✦</text>
                <path d={`M ${point.x - 14} ${point.y} H ${point.x + 14} M ${point.x} ${point.y - 14} V ${point.y + 14}`} stroke={tone} strokeOpacity=".34" strokeDasharray="2 3" />
                <title>{scene.title}</title>
                <text x={labelCenter} y={point.labelY + 20} textAnchor="middle" className="vg-world-node-title" style={{ fontSize: `${CONSTELLATION_TYPE.sector * labelScale}px` }}>{cleanConstellationTitle(scene.title)}</text>
                <text x={labelCenter} y={point.labelY + 40} textAnchor="middle" fill={tone} className="vg-world-node-status" style={{ fontSize: `${Math.max(11, CONSTELLATION_TYPE.status * labelScale * 0.9)}px` }}>{sceneStatus(scene)}</text>
                <text x={point.labelX + point.labelW} y={point.labelY + 40} textAnchor="end" className="vg-world-node-index" style={{ fontSize: `${CONSTELLATION_TYPE.status * labelScale}px` }}>{String(index + 1).padStart(2, '0')}</text>
              </g>
            );
          })}

          {extraScenes > 0 && (
            <g className="vg-world-constellation-overflow" role="button" tabIndex={0} aria-label={`查看其余 ${extraScenes} 段剧情`} onClick={onOpenStage} onKeyDown={(event) => onActivate(event, onOpenStage)}>
              <text x="183" y="67" textAnchor="middle" fill="#d0c9ff" fontSize="22">✦</text>
              <text x="183" y="85" textAnchor="middle" fill="#d0c9ff" fontSize={CONSTELLATION_TYPE.status}>＋{extraScenes}</text>
            </g>
          )}
        </svg>
      </div>

      {visibleScenes.length === 0 && (
        <button type="button" className="vg-world-constellation-empty" onClick={onOpenStage}>
          <span>NO STORY SIGNAL</span>
          <b>这里还没有剧情</b>
          <i>建立第一段世界切片 →</i>
        </button>
      )}
    </section>
  );
}
