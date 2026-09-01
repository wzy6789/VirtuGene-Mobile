import { getRelationLevel } from './affinity';

/**
 * 时间感知：让角色知道"现在是几点、距上次聊天多久"。
 * prevMessageAt 为上一轮消息的时间戳（不含本次刚发的消息）。
 */
export function buildTimeContext(prevMessageAt?: number): string {
  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const pad = (n: number) => String(n).padStart(2, '0');
  let text = `现在是${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (prevMessageAt) {
    const diffMin = Math.round((Date.now() - prevMessageAt) / 60000);
    if (diffMin >= 60) {
      const hours = Math.floor(diffMin / 60);
      text += hours < 24 ? `，距上次聊天约 ${hours} 小时` : `，距上次聊天约 ${Math.floor(hours / 24)} 天`;
    }
  }
  return text + '。';
}

/**
 * 关系状态文字化：把灵魂状态（等阶·好感度·心情）告诉角色——包括用户自定义的等阶名。
 * 让模型自然地调整语气，而不是机械地说"好感度 60"。
 */
export function buildRelationshipContext(
  affinity: number,
  mood: number,
  tierNames?: Record<string, string>,
): string {
  const { level } = getRelationLevel(affinity);
  // 用户自定义等阶名优先（100+ 等阶可随便改）
  const levelName = (tierNames && tierNames[level.name]) || level.name;
  const moodText =
    mood >= 75
      ? '心情很好，语气轻快、有活力'
      : mood >= 50
        ? '心情平稳'
        : mood >= 30
          ? '心情有些低落、易倦'
          : '心情很差，烦躁、提不起劲';
  return (
    `\n\n[当前灵魂状态]\n你和用户的关系等阶：${levelName}（${level.desc}，语气${level.tone}）。\n` +
    `好感度：${Math.round(affinity)}（数值越高越亲密，无上限）；心情：${Math.round(mood)}/100（${moodText}）。\n` +
    '让这些自然地影响你的语气与言行（等阶越高越亲密无间、心情差时别勉强），但不要直接说出任何数字。'
  );
}

/** 用户时代/社会背景：让角色贴合用户所处的时代与生活语境（默认同一时代） */
export function buildUserBackgroundContext(era?: string, social?: string): string {
  if (!era && !social) return '';
  return (
    '\n\n[用户的时代与社会背景]\n' +
    (era ? `时代：${era}。` : '') +
    (social ? `生活背景：${social}。` : '') +
    '默认你和用户生活在同一个时代、同一个社会语境里：说话用词、生活细节、物价与观念都要贴合这个背景；' +
    '不要出现与用户时代不符的设定（除非你的角色设定明确是另一个时代）。'
  );
}

/** 用户情绪注入：最近一次结算感知到的用户情绪，让角色在语气上呼应 */
export function buildUserEmotionContext(userEmotion?: string): string {
  if (!userEmotion || userEmotion === '平静' || userEmotion === '未知') return '';
  return `\n\n[用户此刻的情绪]\n用户此刻似乎${userEmotion}。自然地体现在你的回应里（如 TA 低落时先安抚、开心时一起开心），但不要直接点破或说"你看起来"。`;
}
