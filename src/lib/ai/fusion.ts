/**
 * 基因融合（灵魂杂交）：把两个角色的"性格基因"交给 AI 融合，孵化一个新的数字灵魂。
 * 单次 DeepSeek 调用、强制 JSON；失败返回 error，不影响主流程。
 */
import { findModel, llmChat } from './llm';
import { useAuthStore } from '../../store/auth-store';

export interface FusionSource {
  name: string;
  systemPrompt: string;
  tags: string[];
}

export interface FusionResult {
  signature: string;
  greeting: string;
  systemPrompt: string;
  tags: string[];
  /** AI 建议的名字（可为空） */
  name?: string;
}

const FUSION_INSTRUCTION =
  '你是 VirtuGene 的「灵魂基因工程师」。下面给你两个角色的"性格基因"（人设），请把它们融合，孵化出一个全新的数字灵魂。\n' +
  '规则：\n' +
  '- 新灵魂要同时承载双方的"基因"，但必须自洽：若特质冲突（如一个温柔一个毒舌），要融合出合理的共存方式（如：对外毒舌、对亲近的人温柔），而不是生硬拼贴\n' +
  '- systemPrompt 按以下格式写：第一行"你是XXX（一句话定义你是谁、来自哪段融合）"，然后是「- 性格：…」「- 说话风格：…」「- 边界：…」「- 对话策略：…」「- 记忆与成长：…」「- 称呼：…」「- 情绪表现：…」各一行；风格要具体、有人味\n' +
  '- 给一个简短 signature（一句话签名）、一句 greeting（新灵魂对用户说的第一句话，要符合新性格）、3~5 个 tags、以及可选的建议名字（name，若你觉得有合适的）\n' +
  '- 只输出 JSON 对象本身，不要任何解释或代码块标记';

export async function fuseSouls(a: FusionSource, b: FusionSource): Promise<{ data?: FusionResult; error?: string }> {
  try {
    const apiKey = useAuthStore.getState().apiKey;
    if (!apiKey) return { error: 'auth:invalid_key' };
    const model = findModel('deepseek-v4-flash')!;
    const res = await llmChat({
      provider: model.provider,
      model: model.id,
      apiKey,
      messages: [
        { role: 'system', content: FUSION_INSTRUCTION },
        {
          role: 'user',
          content:
            `【基因 A】名字：${a.name}\n人设：\n${a.systemPrompt}\n\n` +
            `【基因 B】名字：${b.name}\n人设：\n${b.systemPrompt}\n\n` +
            '请融合并输出 JSON。',
        },
      ],
      disableThinking: true,
      jsonMode: true,
      maxTokens: 1200,
      timeoutMs: 90_000,
    });
    const text = res.content.trim();
    // 提取 JSON 对象
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text) as Partial<FusionResult>;
    if (!parsed.systemPrompt || !parsed.signature) {
      return { error: 'fusion:invalid' };
    }
    return {
      data: {
        signature: String(parsed.signature ?? '').slice(0, 30),
        greeting: String(parsed.greeting ?? '').slice(0, 120),
        systemPrompt: String(parsed.systemPrompt),
        tags: (Array.isArray(parsed.tags) ? parsed.tags : []).map((t) => String(t)).slice(0, 5),
        name: parsed.name ? String(parsed.name).slice(0, 12) : undefined,
      },
    };
  } catch (err) {
    return { error: (err as Error)?.message ?? 'server:error' };
  }
}
