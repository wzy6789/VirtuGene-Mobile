/** A bounded source view for explicit questions about what the current user
 * said. No inferred attributes, extracted memories or generated reply facts. */
export function buildRecentFactRecallContext(message:string,history:Array<{role:string;content:string;userAuthored?:boolean}>):string {
  const unquote=(text:string)=>text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'').trim();
  const current=unquote(message);
  if(/^(?:朋友|同事|他|她|有人|如果|假如|假设|比如|例如|帮我写|翻译|解释)/u.test(current)
    ||/(?:不是(?:要|想)?问|不用回忆|别查|别记)/u.test(current))return '';
  const asksOriginal=/^(?:(?:我|我们|咱们)(?:刚才|刚刚|之前|前面|一开始|最开始|开头)|(?:刚才|刚刚|之前|前面)(?:我|我们|咱们))[^。！？!?\n]{0,20}(?:说|提|聊|更正|改口)[^。！？!?\n]{0,36}(?:什么|哪|几|多少|还是)/u.test(current);
  if(!asksOriginal)return '';
  const originals=history.filter(turn=>turn.role==='user'&&turn.userAuthored!==false).slice(-6).flatMap((turn,index)=>{
    const raw=turn.content.trim();
    // Keep complete originals. A cut-off correction or condition can reverse
    // its scope; large messages remain in normal history instead of this view.
    if(!raw||raw.length>240)return [];
    const plain=unquote(raw);
    const signals:string[]=[];
    if(/^(?:朋友|同事|他|她|有人).{0,12}(?:说|问|提)|^(?:帮我写|翻译|解释|写一段)|^[“「『"]/u.test(raw))signals.push('转述、引语或创作请求');
    else {
      if(/(?:我(?:刚才|刚刚)?说错了|更正一下|其实是|不是.{1,30}[，,]是)/u.test(plain))signals.push('更正线索');
      if(/(?:假如|假设|如果|不是说真发生|只是(?:在)?想象)/u.test(plain))signals.push('假设线索');
      if(/我(?:会|想|更想|愿意)(?:选|买|放|去|做)|我(?:更|比较)?喜欢/u.test(plain))signals.push('偏好或意愿线索');
      if(/[?？]/u.test(raw))signals.push('提问线索');
    }
    return [{顺序:index+1,原话:raw,...(signals.length?{表达线索:signals}:{})}];
  });
  if(!originals.length)return '';
  return '[近期事实原话]\n'+JSON.stringify(originals)+'\n这是最近六条用户原话的读取视图，线索不替代原句的具体范围。明确更正沿本人更新后的字段；讨论偏好、意愿、提问和假设不等于描述某个物件已经是什么样。只回答问到且原话明确的事实，不从人物回复补事实，也不把其他未说明属性一起补齐。未知就简短说还没说清，不用追加另一项安排或解释检查过程。\n[/近期事实原话]';
}
