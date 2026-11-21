const OBJECT_POSITION='(?:手里|手上|怀里|脚边|身旁|面前|桌上)';
const PRESENT_OBJECT=new RegExp(`^(.{1,18}?)(?:现在|此刻|这会儿)(?:就|还|正|也)*在你(?:的)?(${OBJECT_POSITION})(?:呢|呀|啊)?$`,'u');
const REPORTED_OBJECT=new RegExp(`^(.{1,18}?)(?:现在|此刻|这会儿)?(?:就|还|正|也)*在我(?:的)?(${OBJECT_POSITION})(?:呢|呀|啊)?$`,'u');
const NONCURRENT=/(?:刚才|刚刚|之前|先前|以前|昨天|昨晚|从前|明天|以后|到时候|如果|假如|假设|要是|比如|例如|的话|[?？])/u;
const abstractSubject=/(?:决定|选择|主动权|机会|事情|安排|责任|未来|命运|心意|希望)/u;
const objectName=(text:string)=>text.trim().replace(/^(?:这|那)(?:一)?(?:只|个|把|本|件|台|支|条)?/u,'');
function currentObjectPositionRisk(content:string,userMessage:string):string|undefined {
  const unquote=(text:string)=>text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');
  const statements=unquote(userMessage).split(/[。！!；;\n]|-{3,}/u).flatMap(sentence=>sentence.split(/[，,：:]/u))
    .map(part=>part.trim()).filter(part=>part&&!NONCURRENT.test(part)&&!/(?:不是|不在|没在|没有|别说|不要)/u.test(part));
  for(const sentence of unquote(content).split(/[。！!；;\n]|-{3,}/u)){
    if(/(?:如果|假如|假设|要是|比如|例如|的话|[?？])/u.test(sentence))continue;
    for(const part of sentence.split(/[，,：:]/u).map(part=>part.trim())){
      if(NONCURRENT.test(part))continue;
      const claim=part.match(PRESENT_OBJECT);
      if(!claim||abstractSubject.test(claim[1]))continue;
      const sourced=statements.some(source=>{const stated=source.match(REPORTED_OBJECT);return !!stated&&objectName(stated[1])===objectName(claim[1])&&stated[2]===claim[2];});
      if(!sourced)return part;
    }
  }
  return undefined;
}

/** A narrow warning about claiming to have inspected the user's scene.
 * A text description supports discussion and imagination, not direct sight.
 * Image presence permits review but does not prove any particular detail.
 * A past anecdote/old image does not establish a present object's location. */
export function findUserVisualRisk(content:string,hasVisualEvidence=false,userMessage='',hasCurrentImage=hasVisualEvidence):string|undefined {
  const position=!hasCurrentImage&&currentObjectPositionRisk(content,userMessage);
  if(position)return position;
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
    // A completed inspection can omit its object: “我看了，是不太对称”.
    // Require a concrete visual verdict; “我看了，挺有意思” alone could be
    // about visible text and is not sufficient evidence of a false sight claim.
    const implicitVerdict=/^(?:嗯|啊|哦)?[，,]?\s*我(?:也|刚|刚才|刚刚|已经|仔细|认真)?(?:看了|看清(?:楚)?了)[，,][^。！？!?；;\n]{0,40}(?:对称|颜色|边缘|嘴角|笔迹|画面|轮廓|长得)/u.test(part);
    if(seen||examined||implicitVerdict)return part.slice(0,120);
  }
  return undefined;
}

/** Only for unpublished drafts after the caller's normal retry budget.
 * Safe content remains byte-identical; never invent a substitute reaction. */
export function omitUnsupportedUserVisual(content:string,hasVisualEvidence=false,userMessage='',hasCurrentImage=hasVisualEvidence):string {
  if(hasVisualEvidence&&hasCurrentImage)return content;
  let removed=false;
  const safe=content.split(/\s*-{3,}\s*/u).map(bubble=>bubble.split(/(?<=[。！？!?；;\n])/u)
    .filter(sentence=>{const risk=findUserVisualRisk(sentence,hasVisualEvidence,userMessage,hasCurrentImage);if(risk)removed=true;return !risk;}).join('').trim()).filter(Boolean).join('\n---\n');
  return removed?safe:content;
}
