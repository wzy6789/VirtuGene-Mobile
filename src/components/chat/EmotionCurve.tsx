import { useId, useState } from 'react';
import { useThemeStore } from '../../store/theme-store';
import type { EmotionSnapshot } from '../../db/index';

interface Props {
  snapshots: EmotionSnapshot[];
}

const W = 240;
const H = 96;
const PAD_X = 8;
const PAD_Y = 16;

function formatShort(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${mm}`;
}

/** 将折线点转成平滑贝塞尔曲线路径（Catmull-Rom → cubic bezier） */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function EmotionCurve({ snapshots }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  const isDark = useThemeStore((s) => s.theme) === 'dark';

  // 旧 → 新（emotion-repo 返回的是新 → 旧）
  const data = [...snapshots].reverse();
  if (data.length < 2) return null;

  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(26,26,46,0.08)';
  const pointStroke = isDark ? '#0F0F1A' : '#FFFFFF';
  const tooltipBg = isDark ? 'rgba(15,15,26,0.96)' : 'rgba(255,255,255,0.96)';
  const tooltipText = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(26,26,46,0.7)';
  const areaId = `curve-area-${uid}`;

  const x = (i: number) => PAD_X + (i / (data.length - 1)) * (W - PAD_X * 2);
  const y = (v: number) => PAD_Y + (1 - v / 100) * (H - PAD_Y * 2);

  const mood = (s: EmotionSnapshot) => Math.round(s.dimensions.valence * 10);
  const pts = data.map((s, i) => ({ x: x(i), y: y(mood(s)) }));
  const linePath = smoothPath(pts);
  const areaPath = pts.length > 1
    ? `${linePath} L ${pts[pts.length - 1].x} ${H - PAD_Y} L ${pts[0].x} ${H - PAD_Y} Z`
    : '';

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      className="mx-auto"
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00CEC9" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#6C5CE7" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* 网格线（0 / 50 / 100） */}
      {[0, 50, 100].map((v) => (
        <line key={v} x1={PAD_X} y1={y(v)} x2={W - PAD_X} y2={y(v)} stroke={gridColor} strokeWidth="1" />
      ))}

      {/* 渐变面积填充 */}
      <path d={areaPath} fill={`url(#${areaId})`} />

      {/* 平滑曲线（辉光底层 + 实线） */}
      <path d={linePath} fill="none" stroke="#00CEC9" strokeWidth="4" strokeLinecap="round" opacity="0.25" style={{ filter: 'blur(3px)' }} />
      <path d={linePath} fill="none" stroke="#00CEC9" strokeWidth="2" strokeLinecap="round" />

      {/* 数据点（带光晕） */}
      {data.map((s, i) => (
        <g key={s.id}>
          <circle
            cx={x(i)}
            cy={y(mood(s))}
            r={hover === i ? 9 : 6}
            fill="rgba(0,206,201,0.25)"
            pointerEvents="none"
            style={{ transition: 'r 0.15s ease-out' }}
          />
          <circle
            cx={x(i)}
            cy={y(mood(s))}
            r={hover === i ? 4 : 2.5}
            fill="#6C5CE7"
            stroke={pointStroke}
            strokeWidth="1"
            onMouseEnter={() => setHover(i)}
            style={{ transition: 'r 0.15s ease-out', cursor: 'pointer' }}
          />
        </g>
      ))}

      {/* 最新一点脉冲呼吸 */}
      {pts.length > 1 && (
        <circle
          cx={pts[pts.length - 1].x}
          cy={pts[pts.length - 1].y}
          r={4}
          fill="none"
          stroke="#00CEC9"
          strokeWidth="1.5"
          className="animate-point-pulse"
          pointerEvents="none"
        />
      )}

      {/* Tooltip */}
      {hover != null &&
        (() => {
          const s = data[hover];
          const tw = 92;
          const th = 40;
          const tx = Math.max(PAD_X, Math.min(W - PAD_X - tw, x(hover) - tw / 2));
          const ty = y(mood(s)) > H / 2 ? 2 : H - th - 2;
          return (
            <g style={{ animation: 'tooltipIn 0.18s ease-out' }} pointerEvents="none">
              <rect x={tx} y={ty} width={tw} height={th} rx={8} fill={tooltipBg} stroke="rgba(0,206,201,0.5)" />
              <text x={tx + tw / 2} y={ty + 15} textAnchor="middle" fill={tooltipText} fontSize="8">
                {formatShort(s.createdAt)} · {s.dominantEmotion}
              </text>
              <text x={tx + tw / 2} y={ty + 31} textAnchor="middle" fill="#00CEC9" fontSize="12" fontWeight="700">
                心情 {mood(s)}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}
