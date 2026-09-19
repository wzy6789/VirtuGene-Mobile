/**
 * WorldAIClient —— 世界层**唯一**的 AI 出口（5.0.0 Living World §54 / §55 / §56）
 *
 * 为什么必须收敛成一个出口：
 * - 世界一轮内部会有 Interpreter / Director / Actor / Narrator / Guard / Settlement
 *   多个阶段，如果每个模块各自 fetch，就再也无法回答"这一轮到底花了几次调用"，
 *   也无法统一处理 401 / 429 / 超时（§104 的错误注入验收就无从谈起）。
 * - 用户拥有自己的 Key 时走 BYOK；网关可用时走网关；两者都没有时必须**明确**
 *   告诉用户"当前没有可用 AI 服务"，而不是让按钮一直转圈（§55）。
 *
 * 三种状态（§55）：
 * - `AVAILABLE`         有 Key（BYOK）或网关已配置 ⇒ 可以发起调用
 * - `TEMPORARY_ERROR`   上一次调用因超时/限流/服务端错误失败 ⇒ 可以重试
 * - `UNAVAILABLE`       没有任何可用的 AI 服务，或凭据明确无效 ⇒ 不该重试
 */
import { llmChat, resolveModel, getProviderKey, type LLMChatParams, type LLMChatResult, type ProviderId } from '../ai/llm';
import { gatewayChat, hasAiGatewayAccess } from '../ai/gateway';

/** 可注入的 LLM 边界（验收用；生产走 llmChat / gatewayChat） */
export type WorldLlmCaller = typeof llmChat;

export type WorldAiStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'TEMPORARY_ERROR';

export interface WorldAiAvailability {
  status: WorldAiStatus;
  /** 实际会使用的 provider / model（诊断与报告用） */
  provider: string;
  modelId: string;
  /** 走的是谁：'byok' | 'gateway' | 'none' */
  route: 'byok' | 'gateway' | 'none';
  /** 给用户看的一句话（中文；UNAVAILABLE 时才是错误提示） */
  detail: string;
}

/** 一次世界轮次内的调用计数（成本可核对，验收直接断言） */
let callCount = 0;
export function worldAiCallCount(): number {
  return callCount;
}
export function resetWorldAiCallCount(): void {
  callCount = 0;
}

/** 把底层错误码翻译成三态（§55） */
export function classifyWorldAiError(err: unknown): { status: WorldAiStatus; message: string } {
  const message = (err as Error)?.message ?? 'server:error';
  switch (message) {
    case 'timeout':
      return { status: 'TEMPORARY_ERROR', message: '世界连接超时了，可以重试。' };
    case 'rate:limited':
      return { status: 'TEMPORARY_ERROR', message: '这一会儿请求太多了，稍后再试。' };
    case 'server:error':
      return { status: 'TEMPORARY_ERROR', message: '世界暂时没有回应，可以重试。' };
    case 'auth:invalid_key':
      return { status: 'UNAVAILABLE', message: '当前没有可用 AI 服务（凭据无效）。' };
    case 'billing:insufficient':
      return { status: 'UNAVAILABLE', message: '当前没有可用 AI 服务（额度不足）。' };
    default:
      return { status: 'TEMPORARY_ERROR', message: '世界暂时没有回应，可以重试。' };
  }
}

/** 统一可用性判断（UI 在"进入世界"之前就应该问它一次） */
export async function worldAiAvailability(): Promise<WorldAiAvailability> {
  const model = resolveModel();
  const key = await getProviderKey(model.provider);
  if (key) {
    return { status: 'AVAILABLE', provider: model.provider, modelId: model.id, route: 'byok', detail: '' };
  }
  // 当前自建网关只代理 DeepSeek；其他提供商必须由设备上的对应 Key 直连。
  // 否则把 qwen/mimo 的模型名发给 DeepSeek 端点，只会得到无意义的 4xx。
  if (hasAiGatewayAccess() && model.provider === 'deepseek') {
    return { status: 'AVAILABLE', provider: model.provider, modelId: model.id, route: 'gateway', detail: '' };
  }
  return {
    status: 'UNAVAILABLE',
    provider: model.provider,
    modelId: model.id,
    route: 'none',
    detail: '当前没有可用 AI 服务，请先在「我的 → 设置」里配置模型 Key。',
  };
}

export interface WorldChatParams {
  /** OpenAI 形态的消息列表（system 可以有多条，Adapter 会自行合并） */
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
  /** 结构化输出阶段置 true（Interpreter / Director / Settlement） */
  jsonMode?: boolean;
  /** 表演阶段建议关闭思考：保证 JSON 不被思维链截断，并显著降低首字延迟 */
  disableThinking?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  /** 可选的模型覆盖，用于场景在主模型无输出时切换到兜底模型。 */
  model?: { provider: ProviderId; id: string };
}

export interface WorldChatResult extends LLMChatResult {
  route: 'byok' | 'gateway';
}

/**
 * 统一世界 AI 调用。
 *
 * 注意它**不做业务解析**：返回值原样交给调用方走 `safeParseAIResponse`。
 * 调用方可以注入 `call` 用于验收（生产不传）。
 */
export async function worldChat(params: WorldChatParams, call?: WorldLlmCaller): Promise<WorldChatResult> {
  const model = params.model ?? resolveModel();
  callCount += 1;

  if (call) {
    const res = await call({
      provider: model.provider,
      model: model.id,
      apiKey: 'injected',
      messages: params.messages,
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.jsonMode ? { jsonMode: true } : {}),
      ...(params.disableThinking ? { disableThinking: true } : {}),
      maxTokens: params.maxTokens ?? 1200,
      timeoutMs: params.timeoutMs ?? 90_000,
    });
    return { ...res, route: 'byok' };
  }

  const key = await getProviderKey(model.provider);
  if (key) {
    const llmParams: LLMChatParams = {
      provider: model.provider,
      model: model.id,
      apiKey: key,
      messages: params.messages,
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.jsonMode ? { jsonMode: true } : {}),
      ...(params.disableThinking ? { disableThinking: true } : {}),
      maxTokens: params.maxTokens ?? 1200,
      timeoutMs: params.timeoutMs ?? 90_000,
    };
    const res = await llmChat(llmParams);
    return { ...res, route: 'byok' };
  }

  if (hasAiGatewayAccess() && model.provider === 'deepseek') {
    // 网关是 4.x 就有的单一聊天入口（server/ 不可改动）：把消息列表折回它的入参形态。
    const systems = params.messages.filter((m) => m.role === 'system').map((m) => String(m.content ?? ''));
    const rest = params.messages.filter((m) => m.role !== 'system');
    const last = rest[rest.length - 1];
    const history = rest.slice(0, -1).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: String(m.content ?? ''),
    }));
    const res = await gatewayChat({
      // 网关按登录态令牌鉴权，不使用 apiKey（BYOK 分支在上面已经返回）
      apiKey: '',
      systemPrompt: systems.join('\n\n'),
      message: String(last?.content ?? ''),
      history,
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.timeoutMs != null ? { timeoutMs: params.timeoutMs } : {}),
      sessionModel: { provider: model.provider, model: model.id },
    });
    return { content: res.content ?? '', route: 'gateway' };
  }

  throw new Error('auth:invalid_key');
}
