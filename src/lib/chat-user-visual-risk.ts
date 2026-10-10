/** A narrow warning about claiming to have inspected the user's scene.
 * A text description supports discussion and imagination, not direct sight.
 * Image presence permits review but does not prove any particular detail. */
export function findUserVisualRisk(content:string,hasVisualEvidence=false):string|undefined {
  if(hasVisualEvidence)return undefined;
  const text=content.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  const clauses=text.split(/[。！!；;\n]|-{3,}/u);
  for(const clause of clauses) {
    const part=clause.trim();
    if(!part||/[?？]|^(?:他|她|朋友|同事|如果|假如|假设|要是|比如|例如)|(?:的话|等你|发来后|收到后|如果|假如|要是)|(?:上次|昨天|以前|过去|曾经|从前)|(?:没|没有|并未|不是|并非|不曾).{0,10}(?:看|图片|照片)/u.test(part))continue;
    // Reading visible text and conventional “我看…” opinions remain allowed.
    if(/(?:消息|文字|原话|你说|你写|描述|说法|句子|代码|意思)/u.test(part))continue;
    const seen=/^(?:嗯|啊|哦)?[，,]?\s*我(?:也|刚|刚才|刚刚|已经|仔细|认真)?(?:看(?:见|到)(?:了)?|看了|看清(?:楚)?了?)[^。！？!?，,；;\n]{0,10}(?:你|这张|那张|这幅|那幅|这朵|那朵|照片|图片|画面)/u.test(part);
    // “我看看” alone may request a photo. A same-sentence verdict pretends
    // that the comparison has already been possible, as in the observed draft.
    const examined=/我(?:先|来|仔细)?看看像不像[^。！？!?；;\n]{0,60}(?:行吧|确实|的确|果然|算你|挺像|还真像)/u.test(part);
    if(seen||examined)return part.slice(0,120);
  }
  return undefined;
}

/** Only for unpublished drafts after the caller's normal retry budget.
 * Safe content remains byte-identical; never invent a substitute reaction. */
export function omitUnsupportedUserVisual(content:string,hasVisualEvidence=false):string {
  if(hasVisualEvidence)return content;
  let removed=false;
  const safe=content.split(/\s*-{3,}\s*/u).map(bubble=>bubble.split(/(?<=[。！？!?；;\n])/u)
    .filter(sentence=>{const risk=findUserVisualRisk(sentence);if(risk)removed=true;return !risk;}).join('').trim()).filter(Boolean).join('\n---\n');
  return removed?safe:content;
}
