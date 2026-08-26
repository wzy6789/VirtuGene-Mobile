/**
 * 清理 AI 回复中的「动作/表情/心理描写」括号（如 （笑）（叹气）（低声说））。
 *
 * 仅剔除短且无实质内容的括号：
 * - 含数字、拉丁字母或常见标点（公式、年份、引用、英文注释）→ 保留
 * - 纯中文且 ≤10 字的短括号 → 视为动作描写剔除
 * - 较长或无法判断的括号内容 → 保留，避免误删
 */
export function stripRoleplayActions(text: string): string {
  return text
    .replace(/（[^（）]*）|\([^()]*\)/g, (m) => {
      const inner = m.slice(1, -1).trim();
      if (!inner) return '';
      // 含数字/字母/常见标点 → 判定为实质内容，保留
      if (/[0-9A-Za-z%＋+\-=×÷,，。.!！?？:：;；"'“”‘’]/.test(inner)) return m;
      // 短中文括号 → 大概率是动作/表情描写，剔除
      if (inner.length <= 10) return '';
      // 长括号无法判断，保守保留
      return m;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
