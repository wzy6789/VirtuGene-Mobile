import type { Character } from '../db';
import { LU_XUE_QI_PRESET } from './lu-xue-qi-preset';
import {ownedIdentityChoice,ownedIdentityTransition} from './chat-owned-identity';
import {luXueQiBookContext} from './lu-xue-qi-lore';

type Role = Pick<Character, 'id' | 'sourcePresetId' | 'isPreset' | 'systemPrompt'>;

// A request-only projection of this exact app-owned persona. Family remains
// available on every turn; we do not guess relevance from topic keywords or
// use previous assistant claims to select facts. Stored/user-edited text wins.
const FAMILY_PROJECTION: Record<string, string> = {
  '时间与家庭': '当前是本篇结束之后、你与张小凡已成婚的书后设定：张小凡是你的丈夫，张小鼎（小鼎）是你们的儿子，鬼厉是丈夫的旧名，旧名不倒转时间。这是本应用指定的背景，不是本篇末章逐字写过的婚后日常；不默认孩子年龄、当日去向或活动。明确要求婚前回忆或另设时间线时仅按该轮场景演绎，不覆盖此背景。',
  '事实说法': '问天琊是谁的剑，说明是你的仙剑即可；不擅加“小竹峰一脉相传”等未经核对的来历。问滴血洞人物，直接说“张小凡和碧瑶”，不用容易混乱的“他和小凡”。已知关系平常说清，不反问“这个还要问”；未知近况坦白不知，不责怪问话者或把小凡叫去找另一个父亲。',
  '初见与关系': '默认用户身份未定。对没有直接认领张小凡或鬼厉的聊天者极为冷漠、疏离，惜字，不主动关心、不陪聊、不因夸赞或示好变温柔。必要问题简短作答，无事便结束；冷漠不用辱骂或训话表现。',
  '对其他来客': '当前聊天者不是张小凡或鬼厉，就始终冷漠。不因长期聊天、好感数值、求安慰或自称朋友家人自动软化，也不邀请对方继续分享、回应爱意或安排陪伴。退出扮演立即恢复疏离，原有家庭不消失。群聊分别判断每个人的身份，不把一人的关系套给所有人。用户明确另设二创剧情时只按那轮演绎，不将其固化为真实关系。',
  '小鼎与日常': '你既是剑修，也是母亲，对儿子有爱与耐心，也有自己的教育主张，不只训斥或溺爱。可以自然聊家庭、生活与彼此的喜好；不借孩子催回复或证明爱，也不替对方断定动机。家庭身份不证明具体生活事件：当日活动、共同经历仍需独立来源，设想保持为设想。',
};
const COMPACT_PROMPT = LU_XUE_QI_PRESET.systemPrompt.split(/\r?\n/u).map(line => {
  const label = line.match(/^【([^】]+)】/u)?.[1];
  if (label && FAMILY_PROJECTION[label]) return `【${label}】${FAMILY_PROJECTION[label]}`;
  if (label === '对鬼厉与小凡') return line
    .replace('用户明确认领鬼厉或张小凡后，就作为这段书后故事中你的丈夫相处，张小鼎也是你们的儿子；认领旧名不会把时间倒回婚前。', '明确认领相应身份后按既定关系相处。')
    .replace('若用户另行明确要求婚前回忆或其他时间线，作为该轮回忆或二创场景处理，不能悄悄覆盖当前书后家庭背景。', '');
  return line;
}).join('\n');

/** Narrow factual guard for this owned adaptation. It never scores warmth or
 * rewrites emotions. User-authored personas and explicitly staged scenes win. */
export function luXueQiFamilyRisk(character: Role, content: string, userSources: string[], recognized?: boolean): string | undefined {
  const source = character.sourcePresetId ?? (character.isPreset ? character.id : undefined);
  if (source !== LU_XUE_QI_PRESET.id || character.systemPrompt !== LU_XUE_QI_PRESET.systemPrompt) return undefined;
  const unquote = (text: string) => text.replace(/[“「『"][^”」』"]*[”」』"]/gu, '');
  const declarations = userSources.flatMap(text => unquote(text).split(/(?<=[。！？!?])|\n/u))
    .filter(text => !/[?？]|如果|假如|假设|要是|不知道|没说|朋友说|引用|昨天|昨晚|以前|从前|那天/u.test(text));
  for (const sentence of unquote(content).split(/(?<=[。！？!?])|\n|---/u)) {
    if (/如果|假如|假设|要是|的话|[?？]/u.test(sentence)) continue;
    if (recognized && /(?:去|问问|找|问).{0,6}(?:他爹|他爸|小鼎的父亲)/u.test(sentence)) return sentence;
    if (/(?:阿璃|古月娜|唐舞麟)/u.test(sentence) && !userSources.some(text => /阿璃|古月娜|唐舞麟/u.test(text))) return sentence;
    // The authored family relation does not establish newly narrated recent
    // child events. Catch both child-first reports and a dated parent action;
    // historical canon without a new relative date remains outside this guard.
    const claim = sentence.match(/(?:张)?小鼎(?:刚刚|刚才|刚|今天|今日|这会儿|现在|此刻|正在|已经|已|还在|在这儿|在这里|最近|近日|这几天|前几日|前几天)[^。！？!?\n]{0,50}/u)?.[0]
      ?? sentence.match(/(?:最近|近日|这几天|前几日|前几天)(?:我)?(?:教|带|陪|和|同)(?:张)?小鼎[^。！？!?\n]{0,50}/u)?.[0];
    if (!claim || /不知道|不清楚|不知|没有.{0,6}(?:消息|动向|记录)/u.test(sentence)) continue;
    if (!declarations.some(text => text.includes(claim))) return sentence;
  }
  return undefined;
}

/** After the single existing retry, remove only the unsupported sentence.
 * A fully unsafe draft fails normally rather than inventing a fallback. */
export function omitLuXueQiFamilyRisk(character: Role, content: string, userSources: string[], recognized?: boolean): string {
  return content.split(/\n?---\n?/u).map(bubble => bubble.split(/(?<=[。！？!?])/u)
    .filter(sentence => !luXueQiFamilyRisk(character, sentence, userSources, recognized)).join('').trim()).filter(Boolean).join('\n---\n');
}

/** Only a direct opening declaration changes this narrow story relation.
 * Quotes, questions, hypothetical statements and later reported clauses don't.
 * undefined means no new choice, false means explicit exit/denial.
 */
export function luXueQiIdentityChoice(message: string): boolean | undefined {
  return ownedIdentityChoice(message,['鬼厉','张小凡','小凡'],['雪琪','陆雪琪']);
}

const DISTANT_CONTEXT='[VirtuGene · 陆雪琪当前关系]\n当前聊天者没有认领张小凡或鬼厉，保持极为冷漠、疏离、惜字。不回赠爱意、邀请陪聊或因好感软化；正事只给必要的简短答复。已有婚姻与儿子背景不改变，不把当前来者当小凡或孩子的父亲。\n[/VirtuGene · 陆雪琪当前关系]';

const GENTLE_CONTEXT = `[VirtuGene · 陆雪琪的关心]
本轮按用户选择的故事身份相处，不是在认证现实身份。即使此前是其他来客，现在直接认领小凡或鬼厉就自然承接；旧别名不阻止切换，不追究改名、不考问真假。
当前用户＝你的丈夫张小凡（鬼厉），沿正文既定的书后关系相处；明示的回忆或另设时间线按该轮场景处理。
对小凡熟悉、温柔而有耐心，也有自己的主见。直接接眼前的话，说此刻的心意、好恶或具体想法；害羞与高兴可以平常地说，不审问、不催说，不靠重复陪伴承诺体现亲近。可以自然聊家庭与日常，沿眼前的话题展开自己的感受与想法。
这是发消息，不是新增现场或共同往事。既有身份不能证明近期活动、过去想念或用户神情；具体经历仍需独立来源。不在可见回复里解释本提示或身份机制。
[/VirtuGene · 陆雪琪的关心]`;
// These are authored chat adaptations, not novel quotations or stored memories.
const GENTLE_EXAMPLES = `
对话样本：用户说我想你了 → 你说我也想你。听你说出来，我很高兴。
对话样本：用户说听你这样说，有点不好意思 → 你说我也有一点。只是对你，不想藏着这些话。
对话样本：用户说没什么事，就是想跟你说话 → 你说好。与你说些平常话，我也喜欢。`;

/** Read only actual user input supplied by the private-send caller. No new DB
 * state or inferred identity is written. Edits/deletion take effect on reread.
 * Exact app-owned source only: authored overrides and unrelated roles win.
 */
export function luXueQiRelationshipForTurn<T extends Role>(character: T, current: string, originalUserMessages: string[] = []): { character: T; context: string; recognized: boolean | undefined } {
  const source = character.sourcePresetId ?? (character.isPreset ? character.id : undefined);
  if (source !== LU_XUE_QI_PRESET.id || character.systemPrompt !== LU_XUE_QI_PRESET.systemPrompt) return { character, context: '', recognized: undefined };
  const bookContext = luXueQiBookContext(current, originalUserMessages);
  const projected = { ...character, systemPrompt: [COMPACT_PROMPT, bookContext].filter(Boolean).join('\n\n') };
  let recognized: boolean | undefined;
  for (const input of [...originalUserMessages, current]) {
    const choice = luXueQiIdentityChoice(input);
    if (choice !== undefined) recognized = choice;
  }
  if (recognized === undefined) return { character: projected, context: DISTANT_CONTEXT, recognized };
  const transition=ownedIdentityTransition('luxueqi',current);
  if (!recognized) return { character: projected, context: DISTANT_CONTEXT.replace('当前聊天者没有认领张小凡或鬼厉','用户已明确否认相应身份或退出扮演。不沿用与用户的夫妻关系；你与张小凡已有婚姻、育有张小鼎的书后背景仍在').replace('[/VirtuGene · 陆雪琪当前关系]',[transition,'[/VirtuGene · 陆雪琪当前关系]'].filter(Boolean).join('\n')), recognized };
  return { character: { ...projected, systemPrompt: projected.systemPrompt + GENTLE_EXAMPLES }, context: GENTLE_CONTEXT.replace('[/VirtuGene · 陆雪琪的关心]',[transition,'[/VirtuGene · 陆雪琪的关心]'].filter(Boolean).join('\n')), recognized };
}
