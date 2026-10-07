/**
 * 清理 AI 回复中的「动作/表情/心理描写」括号（如 （笑）（叹气）（低声说））。
 *
 * 只删除整段可识别的动作，长短和标点不是判断依据。
 * 正常说明、术语、公式、引用及无法确定的内容保留。
 */
// Match the entire new action clause: a verb mentioned in an explanatory note
// is not a stage direction. Keep additions bounded rather than matching any verb.
const COMMON_ACTION_CLAUSE = /^(?:(?:他|她|我|你|轻轻地?|慢慢地?|缓缓地?|默默地?|微微|突然|用力|忍不住|不由得)\s*)*(?:翻(?:了)?(?:个|一个)?白眼|打(?:了)?(?:个|一个)?哈欠|挠(?:了挠|挠)?(?:头|头发)|拍(?:了拍|了|拍)?(?:桌|桌子)|冷笑(?:了)?(?:一声|一下)?|眼眶(?:微微|有些|渐渐)?红(?:了)?(?:起来)?|握紧(?:了)?(?:拳头|双拳)|撇(?:了撇|撇)?嘴|松(?:了)?(?:口|一口)气|深吸(?:了)?一口气|吸(?:了)?一口气|咽(?:了)?(?:口|一口)唾沫|攥紧(?:了)?(?:拳头|双拳)|闭(?:上|了|了闭)?眼(?:睛)?|抬起(?:了)?(?:手|头)|瞥(?:了)?你一眼)$/u;

export function isRoleplayAction(inner: string): boolean {
  // Describe the whole aside, rather than deleting every short Chinese note.
  // Numbers, terminology, quoted speech and factual notes remain untouched.
  if (/[0-9A-Za-z%＋+\-=×÷“”「」"'‘’]/u.test(inner)) return false;
  if (/笑话|笑容|声音文件|声音设置|语气词|眼神交流|(?:不含|含税|截止|预算|备注|例如|也就是|意思是|原文|定义|术语)/u.test(inner)) return false;
  if (/^(?:低声说|轻声说|小声说|轻笑|深呼吸|吸了口气|沉默了一会儿才开口)$/u.test(inner.trim())) return true;
  const clauses = inner.trim().split(/[，,。；;！!]/u).map(s => s.trim()).filter(Boolean);
  const action = /^(?:(?:轻轻|慢慢|缓缓|无奈地|微微|默默|悄悄|有些|一边|忽然|突然|用力|低声|小声|轻声|深深地?|忍不住|不由得|笑着|叹着气|他|她|我|你)\s*)?(?:笑|苦笑|微笑|叹气|叹了|叹口气|点头|点了点头|摇头|摇了摇头|顿了顿|沉默|停顿|眨眼|眨了|挑眉|皱眉|抿嘴|抿了|咬唇|歪头|耸肩|扶额|捂脸|低头|抬头|转身|伸手|把(?:手机|杯子|手|头)|放下(?:手机|杯子)|拿起(?:手机|杯子)|声音(?:低|轻|放|变)|语气(?:变|放|低)|眼神|看(?:向你|着你|了你)|摸(?:摸|了)|揉(?:揉|了))/u;
  return clauses.length > 0 && clauses.every(c => COMMON_ACTION_CLAUSE.test(c) || action.test(c) || /^(?:才开口|才说话|不说话|没说话|了一会儿|了一下)$/u.test(c));
}

/** Collapse only line-break whitespace; preserve intentionally typed spaces. */
export function collapseChatNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]*\n+[ \t]*/gu, (gap, offset: number, source: string) => {
    const left = source[offset - 1] ?? '', right = source[offset + gap.length] ?? '';
    return /[A-Za-z0-9]/u.test(left) && /[A-Za-z0-9]/u.test(right) ? ' ' : '';
  });
}

export function stripRoleplayActions(text: string): string {
  return text
    .replace(/（[^（）]*）|\([^()]*\)/g, (m) => {
      const inner = m.slice(1, -1).trim();
      if (!inner) return '';
      return isRoleplayAction(inner) ? '' : m;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
