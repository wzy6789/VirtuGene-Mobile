import type { EmotionDimensions } from '../../db/index';

/** 六维情绪键与中文标签（与 EmotionPanel 一致） */
const DIM_LABELS: { key: keyof EmotionDimensions; label: string }[] = [
  { key: 'valence', label: '愉悦度' },
  { key: 'arousal', label: '唤醒度' },
  { key: 'intimacy', label: '亲密度' },
  { key: 'engagement', label: '投入度' },
  { key: 'expressiveness', label: '外显度' },
  { key: 'stability', label: '稳定度' },
];

/** 生成一条正弦链路径（多边形近似，round join 视觉平滑） */
function sinePath(xBase: number, y0: number, height: number, amp: number, phase: boolean): string {
  const steps = 28;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = y0 + (height / steps) * i;
    const x = xBase + Math.sin((i / steps) * Math.PI * 2 + (phase ? Math.PI : 0)) * amp;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

/**
 * 灵魂图谱：把 6 维情绪（1~9）渲染成基因双螺旋。
 * 两条链 = 基因紫 / 生命青（品牌主辅色）；每条横档的粗细/发光强度 = 该维度数值，
 * 值越大横档越长、节点越亮——角色的"情绪基因"一眼可见。
 */
export function SoulHelix({ dimensions, size = 240 }: { dimensions: EmotionDimensions; size?: number }) {
  const W = 262;
  const H = 272;
  const amp = 9;
  const xL = 46;
  const xR = 218;
  const y0 = 14;

  const strandY = (i: number) => y0 + ((H - 20) / 24) * i;

  const rungs = DIM_LABELS.map((d, idx) => {
    const y = 18 + idx * 39;
    // 该高度上两条链的 x（同相位，横档水平连接）
    const t = (y - y0) / (H - 20);
    const swing = Math.sin(t * Math.PI * 2) * amp;
    const lx = xL + swing;
    const rx = xR - swing;
    const v = Math.max(1, Math.min(9, dimensions?.[d.key] ?? 5));
    const len = 26 + (v / 9) * (rx - lx - 26);
    const opacity = 0.35 + (v / 9) * 0.55;
    return { ...d, y, x1: lx, x2: lx + len, v, opacity };
  });

  return (
    <div className="flex justify-center py-1">
      <svg width={size} height={Math.round((size * H) / W)} viewBox={`0 0 ${W} ${H}`} fill="none">
        <defs>
          <linearGradient id="soul-strand-l" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6C5CE7" />
            <stop offset="100%" stopColor="#8B7CF7" />
          </linearGradient>
          <linearGradient id="soul-strand-r" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00CEC9" />
            <stop offset="100%" stopColor="#4DE8E4" />
          </linearGradient>
          <linearGradient id="soul-rung" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6C5CE7" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#00CEC9" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* 两条链（正弦，相位相反 → 缠绕感） */}
        <path d={sinePath(xL, y0, H - 20, amp, false)} stroke="url(#soul-strand-l)" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
        <path d={sinePath(xR, y0, H - 20, amp, true)} stroke="url(#soul-strand-r)" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />

        {/* 横档 + 值节点 + 标签 */}
        {rungs.map((r) => (
          <g key={r.key}>
            <line
              x1={r.x1}
              y1={r.y}
              x2={r.x2}
              y2={r.y}
              stroke="url(#soul-rung)"
              strokeWidth={1.2 + r.v * 0.5}
              strokeLinecap="round"
              opacity={r.opacity}
            />
            <circle cx={r.x2} cy={r.y} r={2.5 + r.v * 0.35} fill="#00CEC9" opacity={0.5 + r.v / 18} />
            <text x={r.x2 + 10} y={r.y + 3.5} fontSize="9.5" fill="#9CA3AF">
              {r.label}
            </text>
            <text x={W - 8} y={r.y + 3.5} fontSize="9.5" fill="#F0EDFF" textAnchor="end" fontWeight="600" className="tabular-nums">
              {r.v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* 底部图例 */}
        <text x={W / 2} y={H - 4} fontSize="8.5" fill="#6B7280" textAnchor="middle" letterSpacing="2">
          情绪基因序列
        </text>
      </svg>
    </div>
  );
}
