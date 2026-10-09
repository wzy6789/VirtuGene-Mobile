import {SAMPLE_LINE,stripVoiceSampleBlock} from './character-voice';
/** A bounded source-risk check for explicit ongoing character activities.
 * It does not judge emotions, preferences, future choices or all factual prose.
 * Old assistant replies and un-timed life records are not current-state proof.
 */
const PAST=/(?:昨天|昨晚|前天|以前|从前|小时候|曾经|去年|上周|那天)/u;
const CONDITIONAL=/(?:如果|假如|假设|要是|比如|例如|的话)/u;
// Concrete objects keep eating jealousy, reading a message and waiting for a
// reply outside this physical-scene check. Unrecognized actions remain open.
const ONGOING=/^我(?:自己|也|这边|这里)?(?:现在|这会儿|此刻|正(?:在)?|还在)\s*(?:吃(?:饭|面(?:条)?|早餐|午饭|晚饭|水果|苹果|饺子|火锅)|喝(?:水|茶|咖啡|酒)|(?:读|看)(?:书|小说|电影|电视)|洗(?:碗|衣服|澡)|写(?:报告|作业|代码|论文)|玩(?:游戏|手游)|散步|跑步|整理(?:房间|书架)|做(?:饭|菜))[^。！？!?，,；;\n]{0,60}$/u;
const UNFINISHED=/^我(?:这边|这里|自己|也)?(?:的)?(?:这碗|这杯|这本|这份|这局)?(?:面(?:条)?|饭|早餐|午饭|晚饭|咖啡|茶|水|书|小说|电影|电视|碗|衣服|报告|作业|论文|代码|游戏)(?:还没|还未)(?:吃完|喝完|读完|看完|洗完|写完|做完|弄完|结束)[^。！？!?，,；;\n]{0,30}$/u;
const AGENDA=/^我(?:这边|这里|也|自己)?(?:也)?(?:现在|这会儿|正好|刚好)(?:也)?(?:有点|有些|有)(?:事|事情|工作|活)(?:情)?(?:要|得)(?:弄|做|处理|忙)[^。！？!?，,；;\n]{0,20}$/u;
function unquote(text:string):string{return text.replace(/[“「『"][^”」』"]*[”」』"]/gu,'');}

export function findCurrentActivityRisk(content:string,userMessage='',persona=''):string|undefined {
  const parts=unquote(content).split(/([。！？!?，,；;\n]|-{3,})/u);
  // Only explicitly authored current scenes are eligible. A biography, taste,
  // example, yesterday's event or an imperative cannot establish this scene.
  const scenes=stripVoiceSampleBlock(persona).split(/\r?\n/u).filter(line=>!SAMPLE_LINE.test(line)&&/^\s*(?:当前场景|此刻场景)[：:]/u.test(line));
  let prefix='';
  for(let i=0;i<parts.length;i+=2){
    const clause=parts[i].trim(),delimiter=parts[i+1]??'';
    const preceding=prefix;prefix=/[。！？!?\n]|-{3,}/u.test(delimiter)?'':prefix+parts[i]+delimiter;
    if(/[?？]/u.test(delimiter)||PAST.test(clause)||PAST.test(preceding)||CONDITIONAL.test(clause)||CONDITIONAL.test(preceding))continue;
    if(/^我(?:想|希望|喜欢|不想|不喜欢|打算|决定|准备|会|没|没有)/u.test(clause))continue;
    if(!ONGOING.test(clause)&&!UNFINISHED.test(clause)&&!AGENDA.test(clause))continue;
    const addressed=clause.replace(/^我(?:自己|也)?/u,'你');
    const message=unquote(userMessage).trim();
    const direct=!/^(?:他|她|朋友|同事|如果|假如|假设|比如|例如|翻译|解释|复述|改写|帮我写|替我写)/u.test(message)&&!PAST.test(message)&&!CONDITIONAL.test(message)&&message.split(/[。！？!?，,；;\n]/u).map(p=>p.trim())
      .some(p=>p===addressed&&!/[?？]/u.test(userMessage));
    const authored=scenes.some(line=>!PAST.test(line)&&!CONDITIONAL.test(line)&&unquote(line).slice(line.search(/[：:]/u)+1).trim()===clause);
    if(!direct&&!authored)return clause;
  }
  return undefined;
}

/** After the existing retry, before publication, drop the entire sentence
 * with its dependent clauses. Never invent replacement facts. */
export function omitUnsupportedCurrentActivities(content:string,userMessage='',persona=''):string {
  return content.split(/\n?-{3,}\n?/u).map(bubble=>bubble.split(/(?<=[。！？!?])/u)
    .filter(sentence=>!findCurrentActivityRisk(sentence,userMessage,persona)).join('').trim())
    .filter(Boolean).join('\n---\n');
}
