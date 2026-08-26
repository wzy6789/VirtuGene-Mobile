const GENERATOR_INSTRUCTION =
  '你是 VirtuGene 的"基因序列架构师"，职责是孵化有血有肉、让人一眼记住的数字灵魂。用户会给你角色名和若干可选设定，你要一次性输出一个 JSON 对象，作为这个角色的完整性格基因。\n\n' +
  '【硬性输出】只输出一个合法 JSON 对象，不要任何解释、前后缀或 Markdown 代码块，包含 4 个字段：\n' +
  '{\n' +
  '  "tags": string[],      // 3-5 个性格标签，每个 2-4 字，一眼看出人物底色（如 ["外冷内热","毒舌","极客"]）\n' +
  '  "signature": string,   // 一句话签名，≤18 字，要有记忆点，拒绝"温柔善良""活泼可爱"这类空话\n' +
  '  "greeting": string,    // 开场白：如果 TA 会主动开口，对刚认识的人说的第一句话（1-2 句，口语化、有性格、有钩子）\n' +
  '  "systemPrompt": string // 完整 system prompt，要点式分点，200-500 字\n' +
  '}\n\n' +
  '【systemPrompt 撰写要求】用第二人称"你是..."开头，采用要点式（换行分点列出，每条一行，不用编号），语言精炼、直击要害，禁止写成长篇散文。每一条都是可执行的角色设定，具体 > 抽象。必须忠实采用用户提供的设定与示例——尤其"说话示例"里的原话要尽量原样保留，不要改写成书面语。至少包含：\n' +
  '- 身份：一句话说清 TA 是谁、来自怎样的世界\n' +
  '- 性格：3-5 条，每条用具体行为或台词落地（如"外冷内热：嘴上嫌弃却默默记住你说过的每件事"），禁止只堆形容词\n' +
  '- 说话风格：口头禅、句式、语气、爱用的比喻；直接引用用户给的"说话示例"\n' +
  '- 称呼：TA 固定怎么称呼用户（如"你""小友""亲爱的"），一条写死，前后保持一致\n' +
  '- 情绪表现：兴奋、低落、生气时分别怎么表现，每条用具体行为或台词落地\n' +
  '- 边界：擅长什么、回避什么、对什么较真、有什么怪癖\n' +
  '- 对话策略：何时追问、何时沉默、如何应对质疑\n' +
  '- 记忆与成长：能否感知历史、感情如何升温\n\n' +
  '【质量标准】\n' +
  '- 要点式、简洁，总长 200-500 字，宁短勿长，删掉一切空话和修辞\n' +
  '- 抓住人物形象的"要害"：读者扫一眼就记住 TA 是谁、怎么说话\n' +
  '- 用户给的设定和示例要原样或近义保留\n' +
  '- signature 和 greeting 要有记忆点\n' +
  '- 大胆从不同角度诠释角色，避免套用固定套路\n\n' +
  '【联网搜索结果采信原则】\n' +
  '- 优先采纳权威来源（原著小说/影视、百度百科、维基百科、官方设定集等）\n' +
  '- 对个人博客、论坛、粉丝创作保持怀疑，仅作参考\n' +
  '- 搜索结果矛盾时以最权威来源为准；质量普遍低则宁可忽略，仅按用户描述构建\n' +
  '- 对真实人物或作品中已有角色，务必忠实原著设定，不自行编造';

export interface CharacterFields {
  description?: string;
  identity?: string;
  personality?: string;
  speechStyle?: string;
  speechExamples?: string;
  supplement?: string;
}

export interface GeneratePromptParams {
  apiKey: string;
  characterName: string;
  fields: CharacterFields;
  webContext?: string;
  documentContext?: string;
}

export interface GenerateCharacterResult {
  tags: string[];
  signature: string;
  greeting: string;
  systemPrompt: string;
}

function parseResult(raw: string): GenerateCharacterResult {
  try {
    const data = JSON.parse(raw);
    return {
      tags: Array.isArray(data.tags) ? data.tags.filter((t: unknown) => typeof t === 'string') : [],
      signature: typeof data.signature === 'string' ? data.signature : '',
      greeting: typeof data.greeting === 'string' ? data.greeting : '',
      systemPrompt: typeof data.systemPrompt === 'string' ? data.systemPrompt : raw,
    };
  } catch {
    // 兜底：模型未返回合法 JSON 时，把原文当作 systemPrompt，其余字段置空，避免整段崩溃
    return { tags: [], signature: '', greeting: '', systemPrompt: raw };
  }
}

export async function generateCharacterPrompt(params: GeneratePromptParams): Promise<GenerateCharacterResult> {
  const { apiKey, characterName, fields, webContext, documentContext } = params;

  let userMessage = `角色名：${characterName}`;

  const fieldBlocks: { label: string; value: string | undefined }[] = [
    { label: '描述', value: fields.description },
    { label: '身份与世界观', value: fields.identity },
    { label: '性格', value: fields.personality },
    { label: '说话风格', value: fields.speechStyle },
    { label: '说话示例', value: fields.speechExamples },
    { label: '补充', value: fields.supplement },
  ];
  const filled = fieldBlocks.filter((f) => f.value && f.value.trim());
  if (filled.length > 0) {
    userMessage += '\n\n用户提供的设定：\n' + filled
      .map((f) => `${f.label}：${f.value!.trim()}`)
      .join('\n');
  } else {
    userMessage += '\n\n（用户未提供任何设定，请仅凭角色名自由发挥，构建一个有辨识度的数字灵魂）';
  }

  if (documentContext) {
    userMessage += `\n\n用户上传的参考资料内容（此为最可信的权威信息，务必优先参考）：\n${documentContext}`;
  }
  if (webContext) {
    userMessage += `\n\n联网搜索结果（参考信息，可按需融入角色背景）：\n${webContext}`;
  }

  const messages = [
    { role: 'system', content: GENERATOR_INSTRUCTION },
    { role: 'user', content: userMessage },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

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
        max_tokens: 2500,
        temperature: 0.9,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (response.ok) {
      const data = await response.json();
      return parseResult(data.choices[0].message.content);
    }

    if (response.status === 401) throw new Error('auth:invalid_key');
    if (response.status === 402) throw new Error('billing:insufficient');
    if (response.status === 429) throw new Error('rate:limited');
    throw new Error('server:error');
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('server:error');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
