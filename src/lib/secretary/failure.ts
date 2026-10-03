const reasons: Record<string, string> = {
    'auth:invalid_key': '模型密钥未配置或已失效，请检查当前模型的连接设置。',
    'billing:insufficient': '模型服务余额不足，请充值或更换可用模型。',
    'rate:limited': '模型服务请求过于频繁，请稍后重试。',
    'timeout': '模型理解请求超时，请稍后重试。',
    'server:error': '模型服务连接失败，请检查连接设置后重试。',
    'provider:disabled': '当前模型服务已关闭，请开启或选择可用模型。',
    'planning:interrupted': '请求处理被中断，尚未生成办理结果，请重试原请求。',
    'planning:source_changed': '原消息已修改，本次办理已停止。请把修改后的安排作为新消息发送。',
};
const validationReasons: [RegExp, string][] = [
    [/^日期不正确|^时间不正确/, '日期或时间没能识别，请补充具体日期和时间。'],
    [/^没能理解这次安排|^这次安排没有解析完整|^安排较多|^操作内容|^指令依据|^这项安排缺少原话/, '模型没有完整理解这次安排，可以重试原请求。'],
    [/^账号已切换|^助理工作区已变化|^请在你自己的助理/, '当前账号或助理工作区已变化，请重新打开助理聊天。'],
    [/^助理已离职|^助理已经更换|^助理已更换/, '助理任期已变化，请在当前助理聊天重新发送请求。'],
    [/^原请求|^请求已修改|^原事项的来源|^待处理事项/, '原请求或当前事项已变化，请查看最新记录再继续。'],
];
const fallback = '这次没能处理请求，原请求已保留。请检查模型连接，或点消息旁的感叹号重试。';
const safeReasons = new Set([fallback, ...Object.values(reasons).map(reason => `${reason}原请求已保留，未新增待办。`), ...validationReasons.map(([, reason]) => `${reason}原请求已保留。`)]);

/** User-facing reasons only: never display provider response bodies or credentials. */
export function secretaryFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (reasons[message]) return `${reasons[message]}原请求已保留，未新增待办。`;
  for (const [pattern, reason] of validationReasons) if (pattern.test(message)) return `${reason}原请求已保留。`;
  return fallback;
}

/** Backups and sync are untrusted; only local fixed failure wording is displayed. */
export function readSecretaryFailureReason(reason: unknown): string {
  return typeof reason === 'string' && safeReasons.has(reason) ? reason : fallback;
}
