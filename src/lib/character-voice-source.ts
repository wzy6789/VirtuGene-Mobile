/** Source-format helpers shared by expression rendering and evidence checks.
 * Keep this module independent of validators to avoid a validation cycle. */
export const SAMPLE_LINE = /表达示例|对话样本|语气示例|说话示例|性格示例|用户.{0,40}(?:→|->)|用户[：:].{0,120}(?:你|角色|TA)[：:]/u;

export function stripVoiceSampleBlock(prompt: string): string {
  return prompt.replace(/\n*\[角色声音样本\][\s\S]*?\[\/角色声音样本\]/gu, '').trimEnd();
}
