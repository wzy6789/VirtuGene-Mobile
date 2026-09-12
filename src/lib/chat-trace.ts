/**
 * 上下文溯源（Phase 2b-3 抽取：逻辑与 4.x 完全一致 + 新增共同记忆）
 *
 * 规则：只记录这一轮**真的完整注入**的本地数据 id。
 * 上下文编译器的预算不足时会截断区块（`compiled.partial`），
 * 被截断的区块无法确认究竟哪几条真正进了 prompt，因此**一律不记录**——
 * 宁可少报，也不谎报"已参考"。
 *
 * 抽成纯函数的原因：这条"不谎报"的契约必须能被验收直接覆盖
 * （尤其是"预算不足 ⇒ 不记录"这条平时很难在真实聊天里触发的分支）。
 */
import type { Message } from '../db/index';
import type { CompiledChatContext } from './chat-context-compiler';

/** 只依赖 id（验收可以传最小对象） */
export interface TraceMember {
  id: string;
}

export interface ContextTraceSources {
  compiled: CompiledChatContext;
  /** 4.x 长期记忆（关于用户的事实） */
  memories?: TraceMember[];
  /** 4.x 主动回忆：随机翻出的那一条 */
  recalledMemoryId?: string;
  /** 4.x 未完成事件 */
  continuityThreads?: TraceMember[];
  /** 4.x 人物之间的故事 */
  sharedEvents?: TraceMember[];
  /** 5.0 共同记忆（用户与这个角色一起经历过、且角色确实知道的事） */
  sharedMemories?: TraceMember[];
  /** 5.0 日记（用户显式允许这个角色知道的那几页） */
  diaries?: TraceMember[];
  /** 5.0 世界舞台：这个角色亲身参与过、且这一轮真的注入了的那几场戏 */
  scenes?: TraceMember[];
  now?: number;
}

/** 与 `Message['contextTrace']` 同构 */
export type BuiltContextTrace = NonNullable<Message['contextTrace']>;

export function buildContextTrace(sources: ContextTraceSources): BuiltContextTrace {
  const included = new Set(sources.compiled.included);
  const memoryIds = new Set<string>();
  if (included.has('memory')) for (const m of sources.memories ?? []) memoryIds.add(m.id);
  if (included.has('recall') && sources.recalledMemoryId) memoryIds.add(sources.recalledMemoryId);

  const continuityThreadIds = included.has('continuity')
    ? (sources.continuityThreads ?? []).map((t) => t.id)
    : [];
  const sharedEventIds = included.has('shared-events')
    ? (sources.sharedEvents ?? []).map((e) => e.id)
    : [];
  const sharedMemoryIds = included.has('shared-memory')
    ? (sources.sharedMemories ?? []).map((m) => m.id)
    : [];
  const diaryIds = included.has('diary') ? (sources.diaries ?? []).map((d) => d.id) : [];
  const sceneIds = included.has('scene') ? (sources.scenes ?? []).map((s) => s.id) : [];

  return {
    ...(memoryIds.size > 0 ? { memoryIds: [...memoryIds] } : {}),
    ...(continuityThreadIds.length > 0 ? { continuityThreadIds } : {}),
    ...(sharedEventIds.length > 0 ? { sharedEventIds } : {}),
    ...(sharedMemoryIds.length > 0 ? { sharedMemoryIds } : {}),
    ...(diaryIds.length > 0 ? { diaryIds } : {}),
    ...(sceneIds.length > 0 ? { sceneIds } : {}),
    at: sources.now ?? Date.now(),
  };
}

/** 这条溯源信息是否值得存到消息上（全空则不存，避免每条消息挂一个空对象） */
export function hasTraceContent(trace: BuiltContextTrace): boolean {
  return (
    (trace.memoryIds?.length ?? 0) > 0 ||
    (trace.continuityThreadIds?.length ?? 0) > 0 ||
    (trace.sharedEventIds?.length ?? 0) > 0 ||
    (trace.sharedMemoryIds?.length ?? 0) > 0 ||
    (trace.diaryIds?.length ?? 0) > 0 ||
    (trace.sceneIds?.length ?? 0) > 0
  );
}
