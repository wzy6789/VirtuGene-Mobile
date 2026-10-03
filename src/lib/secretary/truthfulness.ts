/** Quotes are preserved only when they actually occur in the user's current request. */
export function hasUnverifiedExecutionClaim(reply: string, request: string): boolean {
  const prose = reply.replace(/“[^”]*”|「[^」]*」|"[^"\n]*"/gu, quote => request.includes(quote) ? '' : quote);
  const compact = prose.replace(/[\s，,。！？!?；;：:✓\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');
  return /(?:已|已经|我帮你|帮你|替你).*(?:保存|发布|创建|添加|划掉|勾掉|设置|安排|提醒|通知|完成|修改|取消|恢复|设好|设妥|记好|发好|搞妥|弄好|存好|记住|忘记|删除.*记忆)/u.test(compact)
    || /(?:保存|发布|创建|添加|划掉|勾掉|设置|安排|提醒|通知|记录|完成|修改|改期|取消|恢复|记|发|弄|办|搞|做好|存)(?:好|完|妥)?(?:了|啦|成功|完毕)/u.test(compact)
    || /(?:闹钟|提醒|通知).*(?:设好|设妥|排好|安排好|搞定|就绪)|(?:设好|设妥|排好|安排好|搞定).*(?:闹钟|提醒|通知)/u.test(compact)
    || /(?:到点|到时|到时候|届时).*(?:叫你|叫您|喊你|通知你|提醒你)|(?:我会|保证|一定|放心).*(?:提醒|通知|叫你|喊你)/u.test(compact);
}
