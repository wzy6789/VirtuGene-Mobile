/** Local recall hints only. Categories never assert a fact or authorise an action. */
const GENERIC = new Set(['我想', '我们', '你们', '现在', '今天', '这个', '那个', '什么', '怎么', '一下', '可以', '然后', '因为', '所以', '就是', '知道', '说过', '事情', '问题', '喜欢', '偏好', '习惯', '记住', '记忆', '助理', '用户', '关于', '告诉', '长期', '还记', '信息', '内容', '之前', '以前', '记得', '帮我', '请你', '有没有']);
const COMMON_CHARS = new Set(Array.from('我你他她它们的了是这那着就也都把让在有不吗呢吧啊呀和与又很今天现在以前喜欢偏好习惯知道记住什么怎么一下长期告诉助理用户帮请想要能会可对还再事些个种说回'));
const CONCEPTS = [
  { key: 'work', source: /工作|上班|办公|职业|任职|公司/u, query: /工作|上班|办公|职业|任职|公司/u },
  { key: 'home', source: /居住|住在|住址|家在|搬到|搬家/u, query: /(?:我|我的).*(?:住哪|住在|住所|住址|居住|家在哪)|搬家|搬到/u },
  { key: 'name', source: /称呼|叫我|我的名字|我叫/u, query: /称呼|叫我|我的名字|我叫什么|怎么叫我/u },
  { key: 'style', source: /回复|回应|表情|文风|语气|说话|简短|少问|不要催/u, query: /回复|回应|文风|语气|说话|表达方式/u },
  { key: 'drink', source: /茶|咖啡|饮料|饮品|喝|汽水|果汁/u, query: /(?:我|平时|之前).*(?:喝什么|爱喝|喜欢喝)|饮品|饮料偏好|喝茶|喝咖啡/u },
  { key: 'food', source: /吃|食物|口味|饮食|忌口|过敏/u, query: /(?:我|平时|之前).*(?:吃什么|爱吃|喜欢吃)|饮食|忌口|过敏/u },
  { key: 'preference', source: /喜欢|偏好|习惯|忌口|过敏|叫我|不要催/u, query: /(?:我|我的|关于我).*(?:偏好|习惯|喜欢什么)|我的喜好/u },
] as const;

const clean = (text: string) => text.normalize('NFKC').toLowerCase();
function lexical(text: string, index: boolean): Set<string> {
  const result = new Set<string>();
  for (const chunk of clean(text).match(/[\u4e00-\u9fff]+|[a-z0-9][a-z0-9_-]*/gu) ?? []) {
    if (/^[a-z0-9]/u.test(chunk)) {
      if (chunk.length > 1) result.add(chunk);
      for (const part of chunk.split(/[_-]/u)) if (part.length > 1) result.add(part);
      continue;
    }
    for (let i = 0; i < chunk.length - 1; i++) {
      const gram = chunk.slice(i, i + 2);
      if (!GENERIC.has(gram)) result.add(gram);
    }
    // Index characters, but query them only for a short, explicit single-noun turn.
    if (index || text.trim().length <= 4) {
      for (const char of chunk) if (!COMMON_CHARS.has(char)) result.add(`char:${char}`);
    }
  }
  return result;
}

export function secretaryIndexTerms(text: string): string[] {
  const result = lexical(text, true);
  for (const concept of CONCEPTS) if (concept.source.test(text)) result.add(`concept:${concept.key}`);
  return [...result];
}

export function secretaryQueryTerms(text: string): string[] {
  const result = lexical(text, false);
  for (const concept of CONCEPTS) if (concept.query.test(text)) result.add(`concept:${concept.key}`);
  const terms = [...result];
  if (terms.length <= 32) return terms;
  // Spread a bounded query over the entire request, keeping names and category hints.
  const selected = new Set(terms.filter(t => t.startsWith('concept:') || /^[a-z0-9]/u.test(t) && !t.startsWith('char:')).slice(0, 12));
  const remaining = terms.filter(t => !selected.has(t));
  const slots = 32 - selected.size;
  for (let i = 0; i < slots; i++) selected.add(remaining[Math.round(i * (remaining.length - 1) / (slots - 1))]);
  return [...selected];
}

export function secretaryRecallScore(source: string, query: string): number {
  const known = new Set(secretaryIndexTerms(source));
  return secretaryQueryTerms(query).reduce((score, term) => score + (known.has(term) ? term.startsWith('concept:') ? 2 : term.startsWith('char:') ? 0.5 : 1 : 0), 0);
}

/** A short referential turn may use one preceding user topic, within this chat only. */
export function secretaryRecallQuery(request: string, previousUserText?: string): string {
  if (!previousUserText || request.length > 60 || /换个|换一|别的|不聊|先不说|另外|对了|算了/u.test(request)) return request;
  if (/^(?:那(?:么)?[，,\s]*(?:你|我|怎么|应该|建议)|这个|那个|这件事|那件事|按(?:我)?之前|照(?:我)?之前)/u.test(request)) {
    const subjects = previousUserText.split(/[。！？；;\n]/u).map(s => s.trim()).filter(s => s && !/^(?:谢谢|谢谢你|好了|就这样|麻烦你了)$/u.test(s));
    const subject = subjects[subjects.length - 1];
    return subject ? `${request}\n${subject.slice(-500)}` : request;
  }
  return request;
}

export function secretaryWorkOverview(request: string): boolean {
  return /(?:之前|上次|最近|以前).*(?:让你|交代|拜托|托你|帮我).*(?:什么|哪些|进展|进度|结果|怎么样|怎样)|(?:你|助理).*(?:办过|做过).*(?:什么|哪些)|(?:之前|上次|最近).*(?:办的事|办过的事).*(?:进展|进度|结果|怎么样|怎样)/u.test(request);
}
