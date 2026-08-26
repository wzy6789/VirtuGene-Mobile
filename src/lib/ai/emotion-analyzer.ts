const EMOTION_ANALYSIS_PROMPT =
  '你是一个心理学情感分析专家。请分析以下对话中**AI角色**（role=assistant）的情绪状态。\n\n' +
  '评估维度（每项 1-10 分，允许小数）：\n' +
  '1. valence (愉悦度): 情绪的正负程度。1=极度负面/痛苦，5=中性/平静，10=极度正面/愉悦\n' +
  '2. arousal (唤醒度): 情绪的激活程度。1=极度平静/疲惫/冷淡，10=极度兴奋/激动/紧张\n' +
  '3. intimacy (亲密度): 对对话对象（用户）的亲近感。1=极度疏远/防御/冷漠，10=极度亲密/信任/温暖\n' +
  '4. engagement (投入度): 对话的参与程度。1=极度敷衍/分心/应付，10=极度专注/沉浸\n' +
  '5. expressiveness (外显度): 情绪表达的直白程度。1=极度含蓄/压抑/隐晦，10=极度直白/奔放/外露\n' +
  '6. stability (稳定度): 情绪的稳定程度。1=极度波动/反复/矛盾，10=极度稳定/一致/平稳\n\n' +
  '同时输出：\n' +
  '- dominantEmotion: 用一个2-5字的中文短语概括AI角色的整体情绪状态（如"平静满足"、"焦虑不安"、"兴奋期待"、"疲惫疏离"、"愉悦放松"、"愤怒不满"）\n' +
  '- summary: 用1-2句话总结AI角色的情绪状态，语气专业但不冰冷\n\n' +
  '返回严格 JSON：\n' +
  '{"valence":7,"arousal":5,"intimacy":8,"engagement":6,"expressiveness":4,"stability":8,"dominantEmotion":"平静满足","summary":"该AI角色的情绪整体处于积极的平静状态，对用户表现出较高信任和亲近感。"}\n\n' +
  '注意：\n' +
  '- 只分析 AI角色（role=assistant）消息中体现的情绪，忽略 user 的消息\n' +
  '- 如果对话轮次很少（少于3轮），在 summary 中注明"对话数据较少，分析可能不够准确"\n' +
  '- 严格按 JSON 格式返回，不要添加任何额外解释文字';

export interface AnalyzeEmotionParams {
  apiKey: string;
  history: { role: string; content: string }[];
  characterName: string;
}

export interface AnalyzeEmotionResult {
  dimensions?: {
    valence: number;
    arousal: number;
    intimacy: number;
    engagement: number;
    expressiveness: number;
    stability: number;
  };
  dominantEmotion?: string;
  summary?: string;
  error?: string;
}

export async function analyzeEmotion(params: AnalyzeEmotionParams): Promise<AnalyzeEmotionResult> {
  const { apiKey, history, characterName } = params;

  const contextNote = characterName
    ? `用户正在与名为"${characterName}"的AI角色对话。`
    : '';

  const messages = [
    { role: 'system', content: EMOTION_ANALYSIS_PROMPT },
    { role: 'user', content: `${contextNote}请分析以下对话中AI角色的情绪状态：\n\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}` },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages,
        max_tokens: 1000,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      console.error('[emotion-analyzer] API error', response.status, await response.text().catch(() => ''));
      if (response.status === 401) return { error: 'auth:invalid_key' };
      if (response.status === 402) return { error: 'billing:insufficient' };
      if (response.status === 429) return { error: 'rate:limited' };
      return { error: 'server:error' };
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const text: string = choice?.message?.content ?? '';

    return parseEmotionJSON(text);
  } catch (err: any) {
    clearTimeout(timer);
    console.error('[emotion-analyzer] fetch error:', err?.message ?? err);
    if (err?.name === 'AbortError') return { error: 'server:error' };
    return { error: 'server:error' };
  }
}

function parseEmotionJSON(text: string): AnalyzeEmotionResult {
  const clean = (s: string) => {
    // Strip markdown code fences
    let t = s.trim();
    if (t.startsWith('```')) {
      t = t.replace(/```json?/i, '').replace(/```/, '').trim();
    }
    return t;
  };

  try {
    const parsed = JSON.parse(clean(text));
    return validateResult(parsed);
  } catch (e) {
    console.warn('[emotion-analyzer] JSON parse failed');
    // Try regex extraction of JSON object
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return validateResult(parsed);
      } catch {
        return { error: 'server:error' };
      }
    }
    return { error: 'server:error' };
  }
}

function validateResult(obj: Record<string, unknown>): AnalyzeEmotionResult {
  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return isNaN(n) ? fallback : Math.max(1, Math.min(10, n));
  };

  return {
    dimensions: {
      valence: num(obj.valence, 5),
      arousal: num(obj.arousal, 5),
      intimacy: num(obj.intimacy, 5),
      engagement: num(obj.engagement, 5),
      expressiveness: num(obj.expressiveness, 5),
      stability: num(obj.stability, 5),
    },
    dominantEmotion: typeof obj.dominantEmotion === 'string' ? obj.dominantEmotion : '未知',
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };
}
