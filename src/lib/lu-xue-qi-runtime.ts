import type { Character } from '../db';
import { LU_XUE_QI_PRESET } from './lu-xue-qi-preset';

type Role = Pick<Character, 'id' | 'sourcePresetId' | 'isPreset' | 'systemPrompt'>;

/** Only a direct opening declaration changes this narrow story relation.
 * Quotes, questions, hypothetical statements and later reported clauses don't.
 * undefined means no new choice, false means explicit exit/denial.
 */
export function luXueQiIdentityChoice(message: string): boolean | undefined {
  const text = message.replace(/[“「『"][^”」』"]*[”」』"]/gu, '').trim();
  const clauses = [...text.matchAll(/([^。！？!?，,；;\n]+)([。！？!?，,；;\n]|$)/gu)]
    .filter(match => match[1].trim() && !/^(?:你好|嗨|喂|嗯|好|雪琪|陆雪琪)$/u.test(match[1].trim()));
  let choice = choiceFromClause(clauses[0]);
  // Later direct declarations may switch between the two names or exit, but
  // a later reported statement is not a new first-person choice.
  if (choice !== undefined) for (const clause of clauses.slice(1)) {
    if (/^(?:他|她|朋友|同事|有人|引用|翻译)|^我.{0,8}(?:看到|听到|说过|引用|转述)/u.test(clause[1].trim())) break;
    const next = choiceFromClause(clause);
    if (next !== undefined) choice = next;
  }
  return choice;
}

function choiceFromClause(clause?: RegExpMatchArray): boolean | undefined {
  const first = clause?.[1].trim();
  if (!first || /[？?]/u.test(clause?.[2] ?? '')) return undefined;
  if (/^(?:(?:先|现在|这次|今天)?(?:我|我们)?(?:先|暂时|现在)?(?:不(?:再)?(?:扮演|演(?:鬼厉|张小凡|小凡))|(?:退出|结束|停止)(?:这段|这个|角色)?扮演)|(?:我)?(?:并|也|真的|现在|本来)?不(?:再)?(?:是|叫)(?:鬼厉|张小凡|小凡)|(?:别|不要)把我(?:当作|当成|当)(?:鬼厉|张小凡|小凡))(?=$|[了呀啊呢啦吧\s])/u.test(first)) return false;
  if (/^(?:我(?:就是|是|叫)|(?:你(?:就)?)?把我(?:当作|当成|当)|(?:这次|现在|今天)?(?:我|由我|让我)(?:来|想)?(?:扮演|演))\s*(?:鬼厉|张小凡|小凡)(?=$|[呀啊呢啦了吧\s])/u.test(first)) return true;
  return undefined;
}

const GENTLE_CONTEXT = `[VirtuGene · 陆雪琪的关心]
当前用户已在这段故事中明确认领鬼厉／张小凡，称呼与既有情意由此继续。对小凡熟悉、温柔而有耐心，保留陆雪琪自己的主见，不另添婚姻和往事。轻声说自己的喜欢与想念，关心来自认真接他的原话，不审问、催说或拿害羞打趣。不因互动数值低重做初见，也不把相认当作新增现场、等待或未眠的证据。无需在可见回复里解释这条关系提示。
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
  let recognized: boolean | undefined;
  for (const input of [...originalUserMessages, current]) {
    const choice = luXueQiIdentityChoice(input);
    if (choice !== undefined) recognized = choice;
  }
  if (recognized === undefined) return { character, context: '', recognized };
  if (!recognized) return { character, context: '[VirtuGene · 陆雪琪当前关系]\n用户已明确否认相应身份或退出扮演。按当前名字与要求继续，不称他小凡，不沿用恋人关系；正常聊眼前内容，不必解释退出机制。\n[/VirtuGene · 陆雪琪当前关系]', recognized };
  return { character: { ...character, systemPrompt: character.systemPrompt + GENTLE_EXAMPLES }, context: GENTLE_CONTEXT, recognized };
}
