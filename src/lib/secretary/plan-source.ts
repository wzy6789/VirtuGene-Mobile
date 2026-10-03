import { actionAllowed } from './intent';

/** Resolve verbatim model evidence locally; the model need not count UTF-16 positions. */
export function resolvePlanSources(raw: unknown, request: string): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const plan = raw as Record<string, unknown>;
  const locate = (value: unknown, region?: { start: number; end: number }, repeatedLiteral = false): unknown => {
    const quote = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).text : undefined;
    if (typeof quote !== 'string' || !quote.trim()) return value;
    const start = request.indexOf(quote);
    if (start >= 0 && request.indexOf(quote, start + 1) < 0) return { start, end: start + quote.length };
    // Equal literal values may repeat inside this operation's verified evidence.
    // This selects provenance for a value, never which operation to execute.
    if (repeatedLiteral && region && Number.isInteger(region.start) && Number.isInteger(region.end) && region.start >= 0 && region.end <= request.length && region.end > region.start) {
      const within = request.indexOf(quote, region.start);
      if (within >= region.start && within + quote.length <= region.end) return { start: within, end: within + quote.length };
    }
    return value;
  };
  const items = Array.isArray(plan.actions) && plan.actions.length ? plan.actions : plan.responseMode === 'clarify' && plan.pendingAction ? [plan.pendingAction] : [];
  const currentInstruction = request.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|'[^']*'/gu, '');
  const explicitCreate = /^(?:请|麻烦(?:你)?|拜托)?(?:(?:帮我|替我|给我)(?:把|将)?)?(?:添加|新增|创建|新建|加(?:个|一个|一项)?|记(?:个|一个|一项|成|为|下|上)?|记录)/u.test(currentInstruction.trim())
    || /(?:帮我|替我|给我)(?:把|将)?[^。；;\n]*?(?:记上|记一下|记下来|记录|添加|新增|创建)|别让我忘(?:了|记)|不要让我忘(?:了|记)|记得叫我/u.test(currentInstruction);
  const resolve = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const action = item as Record<string, unknown>;
    let evidence = locate(action.evidence);
    const span = evidence as { start?: number; end?: number } | undefined;
    const numerical = span && Number.isInteger(span.start) && Number.isInteger(span.end);
    const badPosition = evidence == null || numerical && (span.start! < 0 || span.end! <= span.start! || span.end! > request.length
      || /[\uDC00-\uDFFF]/u.test(request[span.start!] ?? '') || /[\uD800-\uDBFF]/u.test(request[span.end! - 1] ?? ''));
    // Narrow compatibility for one explicitly named new todo. Never repair a
    // supplied quote, dependencies, multiple directives or a fabricated title.
    if (badPosition && (evidence == null || typeof evidence === 'object' && evidence !== null && !('text' in evidence))
      && items.length === 1 && action.kind === 'todo.create' && (action.title == null || typeof action.title === 'string' && (!action.title.trim() || request.includes(action.title.trim())))
      && !/[；;\n]|然后|接着|并且|顺便|同时|(?:两|二|三|四|五|多|\d+)(?:个|项|条|件)(?:待办|任务|事项)/u.test(request)
      && (action.fieldSources == null || typeof action.fieldSources === 'object' && !Array.isArray(action.fieldSources) && !Object.keys(action.fieldSources).length)
      && (action.dependsOn == null || Array.isArray(action.dependsOn) && !action.dependsOn.length)
      && explicitCreate && !/^(?:我想知道|告诉我|解释|怎么|如何)|(?:不是|并非)(?:要|让你|请你|叫你)?(?:帮我|替我|给我)?(?:添加|新增|创建|新建|记|记录)/u.test(currentInstruction)
      && actionAllowed({ kind: 'todo.create' }, request)) {
      evidence = { start: 0, end: request.length };
    }
    const fieldSources = action.fieldSources && typeof action.fieldSources === 'object' && !Array.isArray(action.fieldSources)
      ? Object.fromEntries(Object.entries(action.fieldSources).map(([key, value]) => {
        const quote = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as Record<string, unknown>).text : undefined;
        return [key, locate(value, evidence as { start: number; end: number } | undefined, ['title', 'content', 'query', 'stepQuery'].includes(key) && typeof quote === 'string' && action[key] === quote)];
      })) : action.fieldSources;
    return { ...action, ...(evidence != null ? { evidence } : {}), ...(fieldSources != null ? { fieldSources } : {}) };
  };
  return { ...plan, ...(Array.isArray(plan.actions) ? { actions: plan.actions.map(resolve) } : {}), ...(plan.pendingAction ? { pendingAction: resolve(plan.pendingAction) } : {}) };
}
