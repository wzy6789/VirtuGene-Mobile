/**
 * Living World 验收公共装置（5.0.0）
 *
 * 抽出来的目的是让 5 套验收**互相对齐**：同样的注入方式、同样的"不该联网"断言、
 * 同样的挂载/卸载与结果上报方式。任何一套自己另写一份，都迟早会漂移。
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import { characterRepo } from '../../src/db/character-repo';
import { worldRepo } from '../../src/db/world-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useUIStore } from '../../src/store/ui-store';
import { DEFAULT_VOICE } from '../../src/lib/voice-map';
import type { Character } from '../../src/db/index';

export interface Reporter {
  lines: string[];
  failures: number;
  check: (name: string, ok: boolean, detail?: unknown) => void;
  section: (title: string) => void;
  /** 无条件写一行（用于记录实测数字：无论通过与否都要出现在结果里） */
  note: (text: string) => void;
  finish: (realFetch: typeof fetch) => void;
}

export function createReporter(): Reporter {
  const lines: string[] = [];
  const state = { failures: 0 };
  return {
    lines,
    get failures() { return state.failures; },
    check(name: string, ok: boolean, detail?: unknown) {
      if (!ok) state.failures += 1;
      lines.push(`${ok ? 'ok   ' : 'FAIL '} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
    },
    section(title: string) {
      lines.push(`\n--- ${title} ---`);
    },
    note(text: string) {
      lines.push(`note ${text}`);
    },
    finish(realFetch: typeof fetch) {
      const text = `${lines.join('\n')}\n\n${state.failures === 0 ? 'ALL PASS' : `${state.failures} FAILED`}`;
      const out = document.createElement('pre');
      out.id = 'result';
      out.textContent = text;
      document.body.appendChild(out);
      document.title = state.failures === 0 ? 'VERIFY-OK' : 'VERIFY-FAIL';
      void realFetch('/result', { method: 'POST', body: text }).catch(() => undefined);
    },
  } as Reporter & { failures: number };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * 假 LLM：既支持"注入 caller"（单元级），也支持"假 HTTP 端点"（真实 UI 路径）
 * ------------------------------------------------------------------ */

export type LlmResult = {
  content: string;
  truncated?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  modelId?: string;
};

export interface FakeLlm {
  /** 注入式 caller（保持调用顺序，用于断言 prompt 内容与调用次数） */
  stub: (params: { messages: unknown[] }) => Promise<LlmResult>;
  /** 每一次注入调用的 messages（顺序） */
  seen: unknown[][];
  /** 注入式调用次数 */
  calls: () => number;
  /** 真实 fetch 路径（假端点）的调用次数 */
  httpCalls: () => number;
  /** "不该联网"的请求数（必须为 0） */
  netCalls: () => number;
  /** 注入式队列：push 一次响应 = 一次调用 */
  queue: string[];
  /** HTTP 队列 */
  httpQueue: string[];
  push: (...responses: string[]) => void;
  /** 还没被消费的脚本数（>0 说明这一轮花的调用比脚本少 ⇒ 测试脚本自己写错了） */
  pending: () => number;
  httpPending: () => number;
  /**
   * 给每次调用加一个人为延迟（毫秒）。
   * 用来复现"用户正在向上翻阅时，新内容才姗姗来迟"这一真实时序（§70），
   * 否则假 LLM 会瞬间返回，滚动测试根本没有机会发生。
   */
  setDelay: (ms: number) => void;
  reset: () => void;
  restore: () => void;
  /** **打点前**的真实 fetch（上报结果必须用它，否则会被自己的打点拦掉） */
  realFetch: typeof fetch;
}

export function installFakeLlm(): FakeLlm {
  const realFetch = window.fetch.bind(window);
  const queue: string[] = [];
  const httpQueue: string[] = [];
  const seen: unknown[][] = [];
  let stubCalls = 0;
  let httpCalls = 0;
  let netCalls = 0;
  let delayMs = 0;
  const wait = () => (delayMs > 0 ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('chat/completions')) {
      httpCalls += 1;
      const next = httpQueue.shift() ?? '';
      // 真实星域 UI 现在请求 SSE。验收端点必须按请求的传输形态返回，
      // 否则把整段 JSON 当作 SSE 会触发无意义的重试并打乱后续响应队列。
      let stream = false;
      try { stream = JSON.parse(String(init?.body ?? '{}')).stream === true; } catch { /* 非 JSON 请求由整段分支处理 */ }
      if (stream) {
        const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: next }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
        return wait().then(() => new Response(frame, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return wait().then(() => new Response(JSON.stringify({
        choices: [{ message: { content: next }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    netCalls += 1;
    return Promise.reject(new Error(`harness: 不该联网 -> ${url}`));
  }) as typeof fetch;

  const stub = (async (params: { messages: unknown[] }) => {
    stubCalls += 1;
    seen.push(params.messages);
    await wait();
    const next = queue.shift() ?? '';
    return { content: next, truncated: false, usage: { inputTokens: 50, outputTokens: 20 }, modelId: 'stub' } as LlmResult;
  }) as never;

  return {
    stub,
    seen,
    calls: () => stubCalls,
    httpCalls: () => httpCalls,
    netCalls: () => netCalls,
    queue,
    httpQueue,
    push: (...responses: string[]) => { queue.push(...responses); },
    pending: () => queue.length,
    httpPending: () => httpQueue.length,
    setDelay: (ms: number) => { delayMs = Math.max(0, ms); },
    reset: () => { stubCalls = 0; httpCalls = 0; netCalls = 0; delayMs = 0; queue.length = 0; httpQueue.length = 0; seen.length = 0; },
    restore: () => { window.fetch = realFetch; },
    realFetch,
  };
}

/** 一个"能力齐全"的假 caller：把队列里的 JSON 依次返回 */
export function makeStub(params: { messages: unknown[] }, queue: string[]) {
  void params;
  return { content: queue.shift() ?? '' };
}

/* ------------------------------------------------------------------ *
 * React 挂载
 * ------------------------------------------------------------------ */
let activeRoot: Root | null = null;
let activeHost: HTMLDivElement | null = null;

export function mount(el: ReactElement, height = 900): HTMLDivElement {
  unmount();
  const host = document.createElement('div');
  host.style.height = `${height}px`;
  document.body.appendChild(host);
  activeHost = host;
  activeRoot = createRoot(host);
  activeRoot.render(el);
  return host;
}

export function unmount(): void {
  if (activeRoot) { activeRoot.unmount(); activeRoot = null; }
  if (activeHost) { activeHost.remove(); activeHost = null; }
}

/* ------------------------------------------------------------------ *
 * 角色与世界种子
 * ------------------------------------------------------------------ */

export function fakeCharacter(id: string, name: string, userId: string, extra: Partial<Character> = {}): Character {
  return {
    id,
    name,
    avatar: '🌙',
    systemPrompt: `${name}：说话克制，有自己的想法。`,
    tags: [],
    isPreset: false,
    isCustom: true,
    published: false,
    createdBy: userId,
    createdAt: Date.now(),
    proactivity: 0.5,
    signature: '',
    greeting: '',
    voice: { ...DEFAULT_VOICE },
    ...extra,
  };
}

export async function seedWorld(params: {
  userId: string;
  characters: { id: string; name: string }[];
  username?: string;
}): Promise<{ worldId: string; sceneId: string }> {
  useAuthStore.getState().login(params.userId, params.username ?? 'tester', 'sk-fake', '');
  for (const c of params.characters) {
    await characterRepo.create(fakeCharacter(c.id, c.name, params.userId));
  }
  useChatStore.setState({ characters: params.characters.map((c) => fakeCharacter(c.id, c.name, params.userId)) });
  useUIStore.setState({ activeView: 'chat', mobileTab: 'world', canvasSceneId: null });
  const world = await worldRepo.ensureDefaultWorld(params.userId);
  return { worldId: world.id, sceneId: '' };
}

export async function cleanupWorld(userId: string): Promise<void> {
  await worldRepo.clearForUser(userId);
}

/** 输入到 React 受控 textarea/input（绕过 React 的 value setter 缓存） */
export function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function pressEnter(el: HTMLElement, shift = false): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: shift, bubbles: true, cancelable: true }));
}

export function clickByText(root: HTMLElement, text: string): HTMLElement | undefined {
  const btn = Array.from(root.querySelectorAll('button, a')).find((b) => (b.textContent ?? '').includes(text));
  (btn as HTMLElement | undefined)?.click();
  return btn as HTMLElement | undefined;
}
