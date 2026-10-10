import { hasExplicitTopicShift, setsAsideNamedTopic } from './chat-turn-cues';

/** Small paraphrases, not copied chapters. The publisher's indexed chapter
 * excerpt verifies the unnamed blue book; the fan title verifies a nickname,
 * not a novel volume or an event witnessed by Lu Xueqi. */
export const LU_XUE_QI_BOOK_SOURCES = [
  { kind: 'novel', title: '萧鼎《诛仙》第二十三章·神剑', url: 'https://www.hongxiu.com/chapter/22108833000562102/94956723278380969', evidence: 'Publisher-indexed excerpt: Zeng Shushu offers an unnamed blue-covered erotic picture book to trade for Xiaohui. Full page access was unavailable during review.' },
  { kind: 'fan-nickname', title: '读者视频标题：诛仙第六卷天书', url: 'https://www.bilibili.com/video/BV1Pr421E7rs/', evidence: 'Indexed fan video title and related titles use sixth-volume and Tianxianglu; this does not authenticate Tianxianglu as the novel book title.' },
  { kind: 'game', title: '完美世界：天书之谜《诛仙2》古卷的前世今生', url: 'https://zhuxian.wanmei.com/news/gamenews/20120502/65182.shtml', evidence: 'Official 2012 game announcement gives a different sixth-book time-travel story. Game lore is separate from the novel.' },
] as const;

const TOPIC = /第(?:六|6)(?:本|卷|册)?天书|天书第(?:六|6)(?:本|卷|册)?|天香录|蓝皮(?:书|册)|蓝色封(?:面|皮)(?:的)?书/u;
const FOLLOWUP = /^(?:那|这)(?:本|个|卷)?(?:书|图册|天书|名字|称呼|说法)|^它|^(?:所以)?(?:真|到底|算|是|不是).{0,8}(?:功法|天书|原著|游戏|玩笑)|^曾书书/u;
const CONTEXT = `[作品资料 · 第六本天书]
小说第二十三章“神剑”中，曾书书拿一本无名的蓝封面风月图册，想与张小凡交换小灰；这不是修炼功法，也没有核实的正式书名。
读者及动画相关二创常把这类图册戏称为“第六卷天书”，并提到《天香录》；这些称呼不作为小说正式卷名或书名。《诛仙2》网游官方另有穿越焚香谷寻第六本天书的剧情，属于游戏设定，不移入小说婚后背景。
可以顺着眼前的玩笑含蓄接话，是否亲近仍依据当前身份；聊原著或游戏时说明相应来源。知道这个典故不等于你曾亲眼看见、如今持有这本书，或和对方一起读过；趣味可以来自你此刻的看法。
[/作品资料 · 第六本天书]`;

/** Follow only recent user-authored mentions, never assistant inventions.
 * An explicit new topic or dismissal ends the supplemental book material. */
export function luXueQiBookContext(current: string, recentUsers: string[] = []): string {
  let mentionsBook = false;
  let wantsBook = false;
  for (const clause of current.split(/[。！？!?，,；;\n]/u)) {
    const part = clause.trim().replace(/^(?:不过|但|那么)[\s，,]*/u, '');
    if (TOPIC.test(part)) {
      mentionsBook = true;
      wantsBook = !/(?:先不|不再|别|不要|不用).{0,6}(?:聊|说|讲|提)/u.test(part);
    } else if (hasExplicitTopicShift(part) || setsAsideNamedTopic(part)) wantsBook = false;
  }
  if (mentionsBook) return wantsBook ? CONTEXT : '';
  if (setsAsideNamedTopic(current)) return '';
  if (hasExplicitTopicShift(current) || !FOLLOWUP.test(current.trim())) return '';
  const recent = recentUsers.slice(-2);
  for (let index = recent.length - 1; index >= 0; index--) {
    if (setsAsideNamedTopic(recent[index]) || hasExplicitTopicShift(recent[index]) && !TOPIC.test(recent[index])) return '';
    if (TOPIC.test(recent[index])) return CONTEXT;
  }
  return '';
}
