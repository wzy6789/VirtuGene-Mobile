/**
 * AI 结构化输出兼容层（5.0.0 Living World §63 / §64）
 *
 * 真实的模型不会永远输出干净 JSON。实测会遇到的形态至少有：
 * 1. 标准 JSON
 * 2. ```json 代码块（有时前后还有解释文字）
 * 3. JSON 前面一句"好的，这是结果："、后面一句"希望有帮助"
 * 4. 用单引号当键或值的引号
 * 5. 尾随逗号
 * 6. 该给的字段没给（缺非必要字段）
 * 7. content 本身是一段合法的自然语言，结构完全失败
 *
 * 本模块是**唯一**的结构化解析入口：所有 World AI 阶段（Interpreter / Director /
 * Actor / Settlement / Guard）都必须走它，禁止各自 `JSON.parse`。
 * 它只做"能不能读出来"的判断，不做业务校验——业务校验在各自模块里。
 *
 * 重要取舍：这里**不会**凭空补字段。读不出来就是读不出来，由调用方决定
 * 降级（例如 Actor 的结构失败但正文可用 ⇒ 保留正文，§64）。
 */

export type SafeJsonVia = 'json' | 'fenced' | 'sliced' | 'repaired' | 'none';

export interface SafeJsonResult<T = unknown> {
  value?: T;
  via: SafeJsonVia;
  error?: string;
  /** 原始返回（诊断用；不进 Prompt） */
  raw: string;
}

/** 从文本里剥掉 ```json ... ``` 围栏（有围栏时返回围栏内容，没有则返回原文） */
function unfence(text: string): { body: string; fenced: boolean } {
  const m = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (m && m[1].trim()) return { body: m[1].trim(), fenced: true };
  return { body: text, fenced: false };
}

/** 截取第一个 `{` 到最后一个 `}`（或 `[`…`]`）之间的内容 */
function sliceStructure(text: string): string | null {
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) return text.slice(objStart, objEnd + 1);
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) return text.slice(arrStart, arrEnd + 1);
  return null;
}

/**
 * 轻度修复：只做**不会改变语义**的修补。
 * - 去掉尾随逗号（`,}` / `,]`）
 * - 单引号字符串 → 双引号（仅当其中没有双引号时；有双引号说明模型是混用，不敢动）
 */
function repair(text: string): string {
  let out = text.replace(/,\s*([}\]])/g, '$1');
  if (!out.includes('"') && out.includes("'")) {
    out = out.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) => `"${inner}"`);
  }
  return out;
}

function attempt(text: string): unknown {
  return JSON.parse(text);
}

/**
 * 宽容解析 AI 返回。
 * `via` 让调用方/验收可以断言"到底是走哪条路读出来的"，避免"看起来成功了"。
 */
export function safeParseAIResponse<T = unknown>(raw: string | null | undefined): SafeJsonResult<T> {
  const text = (raw ?? '').trim();
  if (!text) return { via: 'none', error: 'empty', raw: '' };

  // 1) 原生
  try {
    return { value: attempt(text) as T, via: 'json', raw: text };
  } catch { /* 继续降级 */ }

  const { body, fenced } = unfence(text);
  if (fenced) {
    try {
      return { value: attempt(body) as T, via: 'fenced', raw: text };
    } catch { /* 继续降级 */ }
  }

  const sliced = sliceStructure(body);
  if (sliced) {
    try {
      return { value: attempt(sliced) as T, via: 'sliced', raw: text };
    } catch { /* 继续降级 */ }
    try {
      return { value: attempt(repair(sliced)) as T, via: 'repaired', raw: text };
    } catch { /* 继续降级 */ }
  }

  return { via: 'none', error: 'unparsable', raw: text };
}

/** 只接受对象形态（数组/标量一律当作解析失败——结构化协议都是对象） */
export function safeParseObject<T = Record<string, unknown>>(raw: string | null | undefined): SafeJsonResult<T> {
  const result = safeParseAIResponse<T>(raw);
  if (result.via === 'none') return result;
  const v = result.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { via: 'none', error: 'not_object', raw: result.raw };
  }
  return result;
}

/**
 * 结构失败但正文可用时的降级（§64）。
 *
 * 场景：Actor 被要求输出 `{"dialogue":"...","action":"..."}`，
 * 模型却直接写了一段台词。这时**保留正文**远好于让整轮失败：
 * 用户看到的是角色在说话，而不是"这一轮世界没有继续回应"。
 *
 * 判定很保守：只有"整段看起来就是自然语言"（不含结构标记）才返回正文，
 * 否则返回 undefined，让调用方走真正的失败路径。
 */
export function salvagePlainText(raw: string | null | undefined, max = 1200): string | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  if (text.startsWith('{') || text.startsWith('[')) return undefined;
  if (text.includes('"}') || text.includes('":"')) return undefined;
  // 去掉可能残留的引号包裹
  const cleaned = text.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}
