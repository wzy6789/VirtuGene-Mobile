const WARM_WORDS = [
  '开朗', '热情', '主动', '外向', '黏人', '粘人', '活泼', '浪漫', '好奇',
  '健谈', '阳光', '话痨', '温暖', '元气', '乐观', '自来熟',
  '温柔', '治愈', '热血', '暖心', '沙雕',
];

/** 主动倾向达到该阈值时，角色会在新会话里先开口发开场白 */
export const GREETING_PROACTIVITY_THRESHOLD = 0.5;

const COLD_WORDS = [
  '高冷', '冰冷', '冷淡', '冷漠', '毒舌', '理性', '慵懒', '内向', '沉默',
  '疏离', '傲娇', '神秘', '内敛', '孤僻', '冷静', '外冷', '惜字如金', '安静',
  '忧郁', '偏执', '清冷', '孤傲',
];

/**
 * 依据角色标签与 system prompt 中的性格关键词推导"主动倾向"评分（0-1）。
 * 温暖外向的词提升倾向，冰冷疏离的词降低倾向。
 */
export function deriveProactivity(tags: string[], systemPrompt: string): number {
  const text = `${tags.join(' ')} ${systemPrompt}`;
  let score = 0.5;

  for (const w of WARM_WORDS) {
    if (text.includes(w)) score += 0.12;
  }
  for (const w of COLD_WORDS) {
    if (text.includes(w)) score -= 0.15;
  }

  return Math.max(0.05, Math.min(0.95, score));
}
