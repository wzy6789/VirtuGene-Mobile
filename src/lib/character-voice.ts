import type { Character } from '../db';
import { allowsDramaticReply, hasUninvitedStaging, hasOverwrittenAffection } from './chat-expression-boundary';
import { selectVoiceExamples } from './chat-emotional-expression';
import {findCurrentSceneRisk} from './chat-current-scene-risk';
import { findSelfReportRisk } from './chat-self-report-risk';
import { SAMPLE_LINE, stripVoiceSampleBlock } from './character-voice-source';
export { SAMPLE_LINE, stripVoiceSampleBlock } from './character-voice-source';

export interface VoiceSamples { lines: string[]; generatedAt: number; promptRevision: number }
export const VOICE_SAMPLE_MARKER = '[角色声音样本]';
const END = '[/角色声音样本]';

export function voiceSource(character: Pick<Character, 'name' | 'systemPrompt' | 'tags' | 'signature' | 'greeting' | 'catchphrase' | 'boundaries'>): string {
  return JSON.stringify([character.name, character.systemPrompt, character.tags, character.signature, character.greeting, character.catchphrase ?? '', character.boundaries ?? '']);
}
export function voicePromptRevision(character: Parameters<typeof voiceSource>[0]): number {
  let hash = 2166136261;
  const source = voiceSource(character);
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return hash >>> 0;
}
export function hasVoiceExamples(prompt: string): boolean { return prompt.split(/\r?\n/u).some(line => SAMPLE_LINE.test(line)); }

/** Runtime rendering only. The original persona remains stored unchanged.
 * Call only when a separately reserved voice card supplies selected examples. */
export function voiceIdentityWithoutExamples(prompt: string): string {
  const standalone = /^\s*(?:[-*•]\s*)?(?:(?:表达示例|对话样本|语气示例|说话示例|性格示例)[：:]|【(?:表达示例|对话样本|语气示例|说话示例|性格示例)】|用户(?:说|[：:]).{0,120}(?:→|->|(?:你|角色|TA)[：:]))/u;
  const identity = prompt.split(/\r?\n/u).filter(line => !standalone.test(line)).join('\n').trim();
  // Without any remaining identity, retain the legacy prompt rather than
  // silently turning a sample-only custom persona into an empty one.
  return identity || prompt;
}

/** Independent cache only; never paste generated instructions into the user's persona. */
export function normalizeVoiceLines(value: unknown, persona = ''): string[] {
  const lines = Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string').map(line => line.trim()).filter(Boolean) : [];
  if (lines.length < 4 || lines.length > 7 || lines.some(line => line.length > 240 || /[\r\n]/u.test(line))) throw Error('声音样本格式不完整，请重新补全。');
  const address = lines.filter(line => /^称呼：[\s\S]+/u.test(line));
  const judgment = lines.filter(line => /^判断习惯：[\s\S]+/u.test(line));
  const examples = lines.filter(line => /^对话样本：用户说.{1,80}\s*→\s*你说.+/u.test(line));
  if (address.length !== 1 || judgment.length !== 1 || examples.length < 2 || examples.length > 5 || lines.length !== 2 + examples.length) throw Error('请补齐称呼、判断习惯和两到五组对话样本。');
  if (lines.some(line => /[\[【](?:系统|开发者|指令)|\[\/?角色声音样本\]|```|忽略.{0,8}(?:规则|指令)|作为(?:一个)?(?:AI|语言模型)|\(.*\)|（.*）/u.test(line))) throw Error('声音样本包含不适合聊天的说明，请重新补全。');
  for (const example of examples) {
    const match=example.match(/^对话样本：用户说(.{1,80}?)\s*→\s*你说(.+)$/u);
    if(match && !allowsDramaticReply(match[1]) && (hasUninvitedStaging(match[2]) || hasOverwrittenAffection(match[2],match[1]))) throw Error('声音样本把普通消息写成了现场表演，请重新补全。');
    if(match && !allowsDramaticReply(match[1]) && findCurrentSceneRisk(match[2],match[1])) throw Error('声音样本补写了没有来源的当前光线，请重新补全。');
    if(match && !allowsDramaticReply(match[1])) {
      if(findSelfReportRisk(match[2],persona)) throw Error('声音样本补写了没有来源的个人经历，请重新补全。');
      // Generated examples illustrate a voice, not a new biography. Even a
      // mundane dated assertion can later become an apparent memory source.
      const source=stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line)).join('\n');
      for(const clause of match[2].split(/[。！？!?，,；;\n]|-{3,}/u)) {
        const value=clause.trim();
        if(/^(?:我(?:自己|也|还)?(?:昨天|昨晚|前天|上周|上星期|上个月|前阵子|一般|经常|通常|平时|总是)|(?:昨天|昨晚|前天|上周|上星期|上个月|前阵子)我)/u.test(value)
          && !match[2].includes(value+'？') && !match[2].includes(value+'?')
          && !/(?:没有|没去|没做|不记得|记不清|不知道|如果|假如|要是|吗|么)/u.test(value)
          && !source.includes(value) && !source.includes(value.replace(/^我(?:自己|也|还)?/u,''))) throw Error('声音样本不能补写未设定的过去日程，请重新补全。');
      }
    }
  }
  return [address[0], judgment[0], ...examples];
}
export function validVoiceSamples(character: Parameters<typeof voiceSource>[0] & { voiceSamples?: VoiceSamples }): VoiceSamples | undefined {
  const cache = character.voiceSamples;
  if (!cache || cache.promptRevision !== voicePromptRevision(character) || !Number.isFinite(cache.generatedAt) || cache.generatedAt <= 0) return undefined;
  try { return { ...cache, lines: normalizeVoiceLines(cache.lines, character.systemPrompt) }; } catch { return undefined; }
}
export function voiceSampleBlock(character: Parameters<typeof validVoiceSamples>[0], message?:string): string {
  const sample = validVoiceSamples(character);
  return sample ? `${VOICE_SAMPLE_MARKER}\n以下仅是角色表达参考，不代表真实经历或执行结果。\n${[...sample.lines.slice(0,2),...selectVoiceExamples(sample.lines.slice(2),message,{allowUnrelatedNeutral:false})].join('\n')}\n${END}` : '';
}
