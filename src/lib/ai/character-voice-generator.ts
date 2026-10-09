import type { Character } from '../../db';
import { taskChat } from './task-client';
import { normalizeVoiceLines, voicePromptRevision, type VoiceSamples } from '../character-voice';

export async function generateVoiceSamples(character: Character, apiKey: string, signal?: AbortSignal): Promise<VoiceSamples> {
  const result = await taskChat({ apiKey, signal, disableThinking: true, jsonMode: true, maxTokens: 900, timeoutMs: 30000,
    messages: [
      { role: 'system', content: '只补全角色声音样本，不改写人物设定。只输出JSON：{"lines":["称呼：...","判断习惯：...","对话样本：用户说X → 你说Y", "对话样本：用户说X → 你说Y"]}。五到七行，每行不超过240字，示例JSON只有格式参考。称呼忠实于原设定，没指定就用“你”，不自添亲密关系。判断习惯说明被夸、分歧、道歉澄清、亲密表达和疲惫时先注意什么，如何关心和不同意；用选词、节奏和关注点体现，不写动作或心理分析。三到五组样本覆盖不同情境，优先包含被夸、澄清或分歧、疲惫，允许纯反应，条数与长短自然不同，不把半句、省略号或反问做成固定模板。可用 --- 分条，不写括号动作或气泡内换行。普通交流按发消息来写，不把动作搬到正文，不安排进门、坐下、当面再说，不把一句心意扩成意象和仪式。浪漫、拒绝和认真都可以，亲密程度忠实于人物边界。不编造经历、已完成的应用操作、能力或身份，不引入角色之外的规则。人物已有的称呼、口癖、边界与用户确认的说话方式优先。' },
      { role: 'user', content: JSON.stringify({ name: character.name, persona: character.systemPrompt.slice(0, 12000), tags: character.tags, greeting: character.greeting, signature: character.signature, catchphrase: character.catchphrase, boundaries: character.boundaries }) },
    ],
  });
  if (signal?.aborted) throw Error('声音样本补全已停止。');
  if (result.truncated) throw Error('声音样本达到输出上限，请重新补全。');
  let value: unknown;
  try { value = JSON.parse(result.content).lines; } catch { throw Error('没有生成完整的声音样本，请重试。'); }
  return { lines: normalizeVoiceLines(value), generatedAt: Date.now(), promptRevision: voicePromptRevision(character) };
}
