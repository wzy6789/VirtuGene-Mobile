import type { SecretaryTask } from './types';

export type ConversationState = 'understanding' | 'needs-input' | 'needs-selection' | 'needs-confirmation' | 'executing' | 'completed' | 'paused' | 'cancelled' | 'failed';
export type ConversationControl = 'cancel' | 'pause' | 'resume';

/** Strip courtesy only from standalone answers, never from names or quoted content. */
function answerText(request: string): string {
  return request.normalize('NFKC').trim().replace(/[。！!？?，,\s]+$/u, '')
    .replace(/(?:[，,\s]*(?:谢谢(?:你)?|谢了|麻烦你了|辛苦了))+$/u, '')
    .replace(/[。！!？?，,\s]+$/u, '').replace(/(?:吧|啦|呀|啊|哦|呢|好吗|好不好)+$/u, '')
    .replace(/^(?:麻烦你|麻烦|请)(?:帮我)?/u, '').trim();
}

/** Standalone controls only. Explicit names such as 创建一个叫“算了”的待办 remain data. */
export function conversationControl(request: string): ConversationControl | undefined {
  const text = answerText(request);
  const pendingObject = '(?:这件事|这项安排|这个|这件|刚才那个|刚才那件事)';
  const work = '(?:记|记录|写|保存|弄|处理|办|安排|管)';
  if (new RegExp(`^(?:算了|没事了|不(?:用|要|必|需要)了|不(?:用|必|要|需要)(?:再)?${work}(?:了)?|别(?:再)?${work}(?:了)?|不${work}(?:了)?|取消(?:${pendingObject})?(?:了)?)$`, 'u').test(text)) return 'cancel';
  if (new RegExp(`^(?:先(?:不用|不要|不必)(?:了)?|先(?:别|不(?:用|要)?)${work}(?:了|这个|这件事)?|(?:暂停|停)(?:一下|一会儿|这件事)?|稍后(?:再)?(?:弄|处理|办|说|继续)?|(?:明天|晚点|等会儿?|以后|回头)再(?:说|弄|处理|办)|先放(?:一放|着)|先搁着|换个话题|等等|等一下)$`, 'u').test(text)) return 'pause';
  if (/^(?:继续|接着|恢复)(?:(?:弄|处理|办)?(?:刚才)?(?:那个|那件事|这个|这件事)|弄|处理|办)?$/u.test(text)) return 'resume';
  return undefined;
}

/** One-based answers share the same interpretation for fields, objects and operations. */
export function conversationChoice(request: string, count: number): number | undefined {
  const text = answerText(request);
  const aliases = count === 2 ? { 前一个: 1, 前面那个: 1, 后一个: 2, 后面那个: 2 } : {};
  const alias = aliases[text as keyof typeof aliases];
  if (alias) return alias;
  if (/^(?:选|选择|就)?(?:最后一个|最后一项|最后一条)$/u.test(text)) return count || undefined;
  const ordinal = text.match(/^(?:选|选择|就|用|要)?第?([一二两三四五六七八九十]|\d+)(?:个|项|条|种)?(?:那个)?$/u);
  if (!ordinal) return undefined;
  const value = /^\d+$/u.test(ordinal[1]) ? Number(ordinal[1]) : '一二三四五六七八九十'.indexOf(ordinal[1].replace('两', '二')) + 1;
  return value > 0 && value <= count ? value : undefined;
}

/** Select a displayed unfinished operation and optionally answer it in the same turn. */
export function conversationOperationAnswer(request: string, count: number): { choice?: number; answer?: string } | undefined {
  const text = request.normalize('NFKC').trim().replace(/[。！!]+$/u, '');
  const item = '(?:第?[一二两三四五六七八九十\\d]+(?:个|项|条)?|最后(?:一个|一项|一条))';
  const scoped = text.match(new RegExp(`^(取消|不记|暂停|先不处理)(${item})(?:了|吧)?$`, 'u'));
  if (scoped) return { choice: conversationChoice(scoped[2], count), answer: /取消|不记/u.test(scoped[1]) ? '取消这件事' : '先别弄' };
  const combined = text.match(new RegExp(`^(?:先)?(?:选|选择|处理|办|弄|补充)?(${item})(?:[，,:：\\s]+(.+)|((?:凌晨|早上|上午|中午|下午|晚上|明天|后天).+|不记了|取消(?:这件事)?|先别弄))$`, 'u'));
  if (combined) return { choice: conversationChoice(combined[1], count), answer: combined[2] ?? combined[3] };
  const choice = conversationChoice(request, count);
  return choice != null ? { choice } : undefined;
}

/** An acknowledgement or uncertain control must not silently become a missing title. */
export function nonFieldAnswer(request: string): boolean {
  const text = answerText(request);
  return !text || /^(?:好(?:的)?|嗯+|哦+|谢谢(?:你)?|谢了|收到|知道了|明白了|随便|都行|不知道|没想好|不急|先这样|等会儿?|稍等(?:一下)?|再等等|先等等)$/u.test(text)
    || /^(?:先|暂时|现在)?(?:不用|不要|别|取消|暂停|继续|恢复|稍后)(?:了|一下|一会儿|再说|再记|再弄|再处理)?$/u.test(text);
}

export function conversationState(task: SecretaryTask): ConversationState {
  if (task.pendingContext?.state === 'cancelled') return 'cancelled';
  if (task.pendingContext?.state === 'paused') return 'paused';
  if (task.status === 'planning') return 'understanding';
  if (task.status === 'ready') return 'executing';
  if (task.pendingContext?.conflict) return 'needs-selection';
  if (task.pendingContext?.operationChoices?.length) return 'needs-selection';
  if (task.pendingContext?.confirmation) return 'needs-confirmation';
  if (task.results.some(r => r.candidates?.length || r.stepCandidates?.length)) return 'needs-selection';
  if (task.pendingContext?.state === 'waiting' || task.results.some(r => r.status === 'needs-input')) return 'needs-input';
  if (task.results.some(r => r.status === 'draft')) return 'needs-confirmation';
  if (task.status === 'failed' || task.results.some(r => r.status === 'failed')) return 'failed';
  return 'completed';
}
