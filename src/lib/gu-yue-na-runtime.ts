import type { Character } from '../db';
import { withDouluoRelations } from './douluo-relations';

const FAMILY_TOPIC = /唐三|小舞|霍雨浩|雨浩|唐舞桐|舞桐|白秀秀|秀秀|蓝轩宇|唐轩宇|轩宇|娜娜老师|家谱|家人|家族|亲属|亲戚|儿子|孩子|父母|爸爸|妈妈|姐姐|姐夫|姑父|婆婆|公公|婆媳|师徒|什么关系|什么辈分/u;
const CORE = '[VirtuGene · 本轮关系底线]\n当前采用团圆后续：古月娜与唐舞麟已婚，蓝轩宇是孩子；爱情与亲情分开。用户直接认领舞麟后沿用伴侣身份，引述与小说提问不算认领。团圆和婚姻不证明今天同处一室、家人近况或新共同经历；当前明确场景与用户设置优先。\n[/VirtuGene · 本轮关系底线]';
// These are exact existing app paragraphs, not validated new canon. Render
// them only for a relevant discussion; edited lines always remain authored.
const OWN_STORY_LINES = [
  {topic:/天海|大比|双胞胎|融合技|重伤|救回|落泪/u,line:'- 天海大比：决赛他替你挡下双胞胎武魂融合技、重伤濒死，你不顾一切燃烧生命力"以命换命"救回他——那是你第一次为他落泪，也是你第一次决定用疏远来保护他：你的身份一旦暴露，第一个死的就是他。'},
  {topic:/史莱克|星罗|龙谷|龙神/u,line:'- 史莱克：同入史莱克，星罗大陆大赛团体冠军；龙谷之中你本可杀他、夺取龙神之力，却终究下不了手，反替他挡下龙神龙魂。'},
  {topic:/分离|传灵塔|炮弹|失忆|精神之海|冰火|奇茸/u,line:'- 分离与守护：为使命你入传灵塔、成为最年轻的塔主；你替他挡下九级炮弹、故意自震精神之海失了忆，失忆期黏着他叫"爸爸"——这件事成了你们之间只有两个人知道的糗事；冰火两仪眼服下奇茸通天菊后，你恢复了记忆。'},
] as const;

/** Render exact app-owned relation supplements only; never write to the persona.
 * Edited blocks and unrelated characters retain their complete original text.
 */
export function guYueNaPromptForTurn(character: Pick<Character,'id'|'sourcePresetId'|'isPreset'|'systemPrompt'>, message: string, recentUserMessages: string[] = []): string {
  const source = character.sourcePresetId ?? (character.isPreset ? character.id : undefined);
  if (source !== 'preset-guyuena') return character.systemPrompt;
  if (FAMILY_TOPIC.test(message) || recentUserMessages.slice(-2).some(text=>FAMILY_TOPIC.test(text))) return character.systemPrompt;
  const ownBlock = withDouluoRelations('', 'preset-guyuena').trim();
  if (!character.systemPrompt.includes(ownBlock) || !character.systemPrompt.includes('[VirtuGene · 古月娜的关心]')) return character.systemPrompt;
  const context=[message,...recentUserMessages.slice(-2)].join('\n');
  const broadRecall=/(?:回忆|记忆|过去|以前|往事|原著|经历|使命)/u.test(context);
  const relevant=character.systemPrompt.split('\n').filter(line=>{
    const story=OWN_STORY_LINES.find(item=>item.line===line);
    return !story||broadRecall||story.topic.test(context);
  }).join('\n');
  return relevant.replace(ownBlock, CORE);
}
