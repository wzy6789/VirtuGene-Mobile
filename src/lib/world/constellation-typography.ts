/**
 * 星图文字契约（移动端）：节点可以缩放，文字不能缩成蚂蚁。
 *
 * 这些值集中在这里，避免某个星图组件悄悄恢复 8px/9px 的设计稿字号。
 */
export const CONSTELLATION_TYPE = {
  world: 24,
  sector: 16,
  character: 14,
  status: 12,
  body: 12,
} as const;

/** 缩放星图时保持标签可读；节点可远离，标签有明确的视觉上下限。 */
export function constellationLabelScale(zoom: number): number {
  return Math.min(1.15, Math.max(0.85, 1 / Math.max(0.01, zoom)));
}

/**
 * SVG 没有可靠的 max-width/ellipsis，先按中文视觉宽度裁切，完整名称仍由 title/aria-label 保留。
 * 返回值（包含省略号）最多 maxChars 个字，五个汉字在 14～16px 下约等于 70～80px，
 * 落在 88px 标签安全宽度内。
 */
export function fitConstellationName(value: string, maxChars = 5): string {
  const text = value.trim();
  const limit = Math.max(2, maxChars);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** 主页星图的剧情主题名：数据层已经限制为五字，这里兼容旧数据且不追加省略号。 */
export function plainConstellationTitle(value: string, maxChars = 5): string {
  return value.trim().slice(0, maxChars);
}

/** 清理旧版本自动生成的“地点的那场戏”，避免它继续出现在星图标题里。 */
export function cleanConstellationTitle(value: string, maxChars = 5): string {
  const clean = value.trim().replace(/\u7684\u90a3\u573a\u620f$/u, '');
  return plainConstellationTitle(clean || '此刻', maxChars);
}
