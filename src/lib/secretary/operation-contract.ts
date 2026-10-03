import type { SecretaryAction, SecretaryTask } from './types';

export interface InstructionSpan { start: number; end: number }
export interface OperationContract {
  evidence?: InstructionSpan;
  fieldSources?: Partial<Record<keyof SecretaryAction, InstructionSpan>>;
  /** Zero-based indices of earlier operations; never an instruction to run them again. */
  dependsOn?: number[];
}

function withinQuote(text: string, position: number): boolean {
  const closes: Record<string, string> = { '“': '”', '「': '」', '『': '』', '"': '"', "'": "'" };
  let closing: string | undefined;
  for (let i = 0; i < position; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (closing) { if (text[i] === closing) closing = undefined; }
    else closing = closes[text[i]];
  }
  return !!closing;
}

export function parseOperationContracts(actions: unknown[], indexOffset = 0, requireEvidence = false): OperationContract[] {
  const span = (raw: unknown): InstructionSpan => {
    const value = raw as InstructionSpan;
    if (!value || !Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.end <= value.start) throw new Error('指令依据不完整，请重新安排。');
    return { start: value.start, end: value.end };
  };
  return actions.map((raw, index) => {
    const action = raw as Record<string, unknown>;
    const result: OperationContract = {};
    if (requireEvidence && action?.evidence == null) throw new Error('这项安排缺少原话依据，请重新明确这项请求。');
    if (action.evidence != null) result.evidence = span(action.evidence);
    if (action.fieldSources != null) {
      if (typeof action.fieldSources !== 'object' || Array.isArray(action.fieldSources)) throw new Error('字段来源不正确。');
      result.fieldSources = Object.fromEntries(Object.entries(action.fieldSources).map(([key, value]) => {
        if (!(key in action) || ['kind', 'evidence', 'fieldSources', 'dependsOn'].includes(key)) throw new Error('字段来源与操作不一致。');
        return [key, span(value)];
      }));
    }
    if (action.dependsOn != null) {
      if (!Array.isArray(action.dependsOn) || action.dependsOn.some(i => !Number.isInteger(i) || i < 0 || i >= index + indexOffset)) throw new Error('操作依赖顺序不正确，请拆开安排。');
      result.dependsOn = [...new Set(action.dependsOn as number[])];
    }
    return result;
  });
}

/** Spans are checked against the actual user source, never the model's recalled prose. */
export function instructionText(task: SecretaryTask, contract?: OperationContract): string {
  if (!contract) return task.request;
  for (const span of [contract.evidence, ...Object.values(contract.fieldSources ?? {})]) {
    if (!span || span.end > task.request.length || !task.request.slice(span.start, span.end).trim()
      || /[\uDC00-\uDFFF]/u.test(task.request[span.start] ?? '') || /[\uD800-\uDBFF]/u.test(task.request[span.end - 1] ?? '')) throw new Error('指令来源已变化，请重新安排。');
  }
  if (!contract.evidence) return task.request;
  const { start, end } = contract.evidence;
  // Negation and quoted commands must remain in scope. A clipped inner quote is unsafe.
  const before = task.request.slice(0, start);
  if (withinQuote(task.request, start)) throw new Error('引用的内容不能作为执行指令。');
  const clauseStart = Math.max(before.lastIndexOf('，'), before.lastIndexOf(','), before.lastIndexOf('。'), before.lastIndexOf('；'), before.lastIndexOf(';'), before.lastIndexOf('\n')) + 1;
  const rest = task.request.slice(end);
  const clauseEnd = rest.search(/[，,。；;\n]/u);
  return task.request.slice(clauseStart, clauseEnd < 0 ? task.request.length : end + clauseEnd);
}
