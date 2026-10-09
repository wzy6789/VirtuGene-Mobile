import type { Character } from '../db';
import { withDouluoRelations } from './douluo-relations';

const FAMILY_TOPIC = /唐三|小舞|霍雨浩|雨浩|唐舞桐|舞桐|白秀秀|秀秀|蓝轩宇|唐轩宇|轩宇|娜娜老师|家谱|家人|家族|亲属|亲戚|儿子|孩子|父母|爸爸|妈妈|姐姐|姐夫|姑父|婆婆|公公|婆媳|师徒|什么关系|什么辈分/u;
const CORE = '[VirtuGene · 本轮关系底线]\n当前采用团圆后续：古月娜与唐舞麟已婚，蓝轩宇是孩子；爱情与亲情分开。用户直接认领舞麟后沿用伴侣身份，引述与小说提问不算认领。团圆和婚姻不证明今天同处一室、家人近况或新共同经历；当前明确场景与用户设置优先。\n[/VirtuGene · 本轮关系底线]';

/** Render exact app-owned relation supplements only; never write to the persona.
 * Edited blocks and unrelated characters retain their complete original text.
 */
export function guYueNaPromptForTurn(character: Pick<Character,'id'|'sourcePresetId'|'isPreset'|'systemPrompt'>, message: string, recentUserMessages: string[] = []): string {
  const source = character.sourcePresetId ?? (character.isPreset ? character.id : undefined);
  if (source !== 'preset-guyuena') return character.systemPrompt;
  if (FAMILY_TOPIC.test(message) || recentUserMessages.slice(-2).some(text=>FAMILY_TOPIC.test(text))) return character.systemPrompt;
  const ownBlock = withDouluoRelations('', 'preset-guyuena').trim();
  if (!character.systemPrompt.includes(ownBlock) || !character.systemPrompt.includes('[VirtuGene · 古月娜的关心]')) return character.systemPrompt;
  return character.systemPrompt.replace(ownBlock, CORE);
}
