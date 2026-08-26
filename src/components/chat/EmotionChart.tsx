import { useId, useState } from 'react';
import { useThemeStore } from '../../store/theme-store';
import type { EmotionDimensions } from '../../db/index';

interface Props {
  dimensions: EmotionDimensions;
  previousDimensions?: EmotionDimensions;
  size?: number;
}

const LABELS = ['愉悦度', '唤醒度', '亲密度', '投入度', '外显度', '稳定度'];
const KEYS: (keyof EmotionDimensions)[] = ['valence', 'arousal', 'intimacy', 'engagement', 'expressiveness', 'stability'];

interface HoverInfo {
  index: number;
  isPrevious: boolean;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildPolygonPoints(dims: EmotionDimensions, cx: number, cy: number, maxR: number) {
  return KEYS.map((key, i) => {
    const angle = (360 / KEYS.length) * i;
    const val = dims[key] / 10;
    const { x, y } = polarToCartesian(cx, cy, maxR * val, angle);
    return `${x},${y}`;
  }).join(' ');
}

export function EmotionChart({ dimensions, previousDimensions, size = 220 }: Props) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const uid = useId();
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.38;
  const levels = [0.2, 0.4, 0.6, 0.8, 1.0];
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const gridStroke = isDark ? 'rgba(139,124,247,0.13)' : 'rgba(108,92,231,0.14)';
  const labelFill = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(26,26,46,0.55)';
  const scaleFill = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(26,26,46,0.25)';
  const pointStroke = isDark ? '#0F0F1A' : '#FFFFFF';
  const tooltipBg = isDark ? 'rgba(15,15,26,0.96)' : 'rgba(255,255,255,0.96)';
  const tooltipText = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(26,26,46,0.7)';

  const fillId = `radar-fill-${uid}`;
  const strokeId = `radar-stroke-${uid}`;
  const glowId = `radar-glow-${uid}`;

  const hoverValue = hover
    ? (hover.isPrevious ? previousDimensions?.[KEYS[hover.index]] : dimensions[KEYS[hover.index]])
    : undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto"
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6C5CE7" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#00CEC9" stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6C5CE7" />
          <stop offset="100%" stopColor="#00CEC9" />
        </linearGradient>
        <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      {/* Grid: concentric hexagons */}
      {levels.map((level) => {
        const points = KEYS.map((_, i) => {
          const angle = (360 / KEYS.length) * i;
          const { x, y } = polarToCartesian(cx, cy, maxR * level, angle);
          return `${x},${y}`;
        }).join(' ');
        return (
          <polygon
            key={level}
            points={points}
            fill="none"
            stroke={gridStroke}
            strokeWidth="1"
          />
        );
      })}

      {/* Axis lines */}
      {KEYS.map((_, i) => {
        const angle = (360 / KEYS.length) * i;
        const end = polarToCartesian(cx, cy, maxR, angle);
        return (
          <line
            key={`axis-${i}`}
            x1={cx}
            y1={cy}
            x2={end.x}
            y2={end.y}
            stroke={gridStroke}
            strokeWidth="1"
          />
        );
      })}

      {/* Previous data polygon (dashed) */}
      {previousDimensions && (
        <polygon
          points={buildPolygonPoints(previousDimensions, cx, cy, maxR)}
          fill="rgba(108,92,231,0.05)"
          stroke="rgba(108,92,231,0.35)"
          strokeWidth="1.5"
          strokeDasharray="3,3"
        />
      )}

      {/* Current data polygon — 描边辉光（底层模糊光晕） */}
      <polygon
        points={buildPolygonPoints(dimensions, cx, cy, maxR)}
        fill="none"
        stroke="#6C5CE7"
        strokeWidth="5"
        strokeLinejoin="round"
        filter={`url(#${glowId})`}
        opacity="0.5"
        style={{ animation: 'chartAppear 0.6s ease-out' }}
      />
      {/* Current data polygon — 渐变填充 + 渐变描边 */}
      <polygon
        points={buildPolygonPoints(dimensions, cx, cy, maxR)}
        fill={`url(#${fillId})`}
        stroke={`url(#${strokeId})`}
        strokeWidth="2"
        strokeLinejoin="round"
        style={{ animation: 'chartAppear 0.6s ease-out' }}
      />

      {/* Current data points — 光晕顶点 */}
      {KEYS.map((key, i) => {
        const angle = (360 / KEYS.length) * i;
        const val = dimensions[key] / 10;
        const { x, y } = polarToCartesian(cx, cy, maxR * val, angle);
        const active = hover?.index === i && !hover.isPrevious;
        return (
          <g key={`dot-${i}`}>
            <circle
              cx={x}
              cy={y}
              r={11}
              fill="transparent"
              onMouseEnter={() => setHover({ index: i, isPrevious: false })}
            />
            <circle
              cx={x}
              cy={y}
              r={8}
              fill="rgba(108,92,231,0.35)"
              filter={`url(#${glowId})`}
              pointerEvents="none"
              style={{ transition: 'opacity 0.15s ease-out', opacity: active ? 0.6 : 0.35 }}
            />
            <circle
              cx={x}
              cy={y}
              r={active ? 5 : 3.2}
              fill={`url(#${strokeId})`}
              stroke={pointStroke}
              strokeWidth="1.5"
              pointerEvents="none"
              style={{ transition: 'r 0.15s ease-out' }}
            />
          </g>
        );
      })}

      {/* Previous data points */}
      {previousDimensions && KEYS.map((key, i) => {
        const angle = (360 / KEYS.length) * i;
        const val = previousDimensions[key] / 10;
        const { x, y } = polarToCartesian(cx, cy, maxR * val, angle);
        const active = hover?.index === i && hover.isPrevious;
        return (
          <g key={`prev-dot-${i}`}>
            <circle
              cx={x}
              cy={y}
              r={10}
              fill="transparent"
              onMouseEnter={() => setHover({ index: i, isPrevious: true })}
            />
            <circle
              cx={x}
              cy={y}
              r={active ? 3 : 2}
              fill="rgba(108,92,231,0.4)"
              stroke={pointStroke}
              strokeWidth="1"
              pointerEvents="none"
              style={{ transition: 'r 0.15s ease-out' }}
            />
          </g>
        );
      })}

      {/* Axis labels */}
      {KEYS.map((_, i) => {
        const angle = (360 / KEYS.length) * i;
        const { x, y } = polarToCartesian(cx, cy, maxR + 16, angle);
        return (
          <text
            key={`label-${i}`}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fill={labelFill}
            fontSize="11"
            fontFamily="'Noto Sans SC', sans-serif"
            pointerEvents="none"
          >
            {LABELS[i]}
          </text>
        );
      })}

      {/* Scale labels on top axis */}
      {[2, 4, 6, 8, 10].map((val) => {
        const { x, y } = polarToCartesian(cx, cy, maxR * (val / 10), 0);
        return (
          <text
            key={`scale-${val}`}
            x={x}
            y={y - 8}
            textAnchor="middle"
            dominantBaseline="central"
            fill={scaleFill}
            fontSize="8"
            pointerEvents="none"
          >
            {val}
          </text>
        );
      })}

      {/* Hover tooltip */}
      {hover && hoverValue != null && (() => {
        const angle = (360 / KEYS.length) * hover.index;
        const { x, y } = polarToCartesian(cx, cy, maxR * (hoverValue / 10), angle);
        const w = 86;
        const h = 34;
        let tx = x - w / 2;
        let ty = y - h - 14;
        tx = Math.max(4, Math.min(size - w - 4, tx));
        if (ty < 4) ty = y + 14;
        const label = hover.isPrevious ? `上次 ${LABELS[hover.index]}` : LABELS[hover.index];
        return (
          <g pointerEvents="none" style={{ animation: 'tooltipIn 0.18s ease-out' }}>
            <rect
              x={tx}
              y={ty}
              width={w}
              height={h}
              rx={8}
              fill={tooltipBg}
              stroke={hover.isPrevious ? 'rgba(108,92,231,0.4)' : 'rgba(108,92,231,0.7)'}
            />
            <text
              x={tx + w / 2}
              y={ty + 13}
              textAnchor="middle"
              fill={tooltipText}
              fontSize="9"
              fontFamily="'Noto Sans SC', sans-serif"
            >
              {label}
            </text>
            <text
              x={tx + w / 2}
              y={ty + 27}
              textAnchor="middle"
              fill="#00CEC9"
              fontSize="12"
              fontWeight="700"
              fontFamily="'Noto Sans SC', sans-serif"
            >
              {hoverValue.toFixed(1)}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}
