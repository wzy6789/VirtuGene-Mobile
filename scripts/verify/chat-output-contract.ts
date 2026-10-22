import {inspectDialogueSegment,firstDialogueBoundary,resolveOutputContract} from '../../src/lib/chat/output-contract';
import {inspectChatOutput} from '../../src/lib/chat-output-quality';
const checks:Array<{name:string;ok:boolean;actual?:unknown}>=[];
const check=(name:string,ok:unknown,actual?:unknown)=>checks.push({name,ok:!!ok,...(actual===undefined?{}:{actual})});
declare const CONTRACT_BEFORE:boolean;
export function run(){
  const forbidden=[
    '（笑）好。','（无奈地笑了笑，把手机放下）随你。','（声音低了下来，沉默了一会儿才开口）我在。','（微笑，望向窗外）',
    '（翻了个白眼）随你。','（打了个哈欠）还没睡。','（挠了挠头）再想想。','（拍桌）不行。',
    '（冷笑一声）说吧。','（眼眶红了）我知道。','（握紧拳头）好。','（撇撇嘴）哼。','（松了口气）还好。',
    '她轻轻抬起头，声音低了下来。','古月娜笑了笑：“我在。”','古月娜：“我在。”',
    '旁白：夜色慢慢笼罩下来。','*轻轻点头*好。',
  ];
  for(const text of forbidden){
    const inspected=inspectChatOutput(text,{mode:'private',userMessage:'继续扮演古月娜，聊聊今天的事。'});
    check('private roleplay rejects raw direction: '+text,!inspected.check.ok&&inspected.check.issue==='uninvited-staging',inspected.check);
    if(!CONTRACT_BEFORE){
      for(const mode of ['private','group','proactive','voice'] as const)check(mode+' raw format rejects: '+text,inspectDialogueSegment(text,mode,true).status==='reject');
      check('world retains original narration: '+text,inspectDialogueSegment(text,'world',true).status==='ready');
    }
  }
  const preserved=[
    '嗯。','啊？？','哈哈哈！','我已经很累了，先歇一会儿。','你平时声音放得轻。','这首歌声音里有一点笑意。',
    '这是新版（2024年修订版）。','用这个公式（x + 1 = 2）算一下。','原文是“（笑了笑）你好”。','术语（望向窗外的定义）可以再说清楚。',
    '你说的“她轻轻抬头，笑了笑”，是小说原句吗？','他刚才说“随便你”，你听着不舒服吧？',
    '代码是 `if (ready) { smile(); }`。','名字叫“算了”。','结果是（1，2，3）。',
    'I don\'t think so.','That\'s Alice\'s book.','半径是 r，面积 πr²。','关于预算的问题（包括上月预算），我想再核对。',
  ];
  if(!CONTRACT_BEFORE){
    for(const text of preserved){const out=inspectDialogueSegment(text,'private',true);check('preserves factual/quoted/technical content: '+text,out.status==='ready'&&out.text===text,out);}
    for(const text of ['我想说“今天','要用这个（公式','代码是 `x +','我想说「你好'])check('unfinished structure holds: '+text,inspectDialogueSegment(text,'private',false).status==='pending');
    check('no timer/partial word boundary',firstDialogueBoundary('我想告诉你')===undefined);
    check('first independent sentence boundary',firstDialogueBoundary('我在。还想听你说。')===3);
    check('quote inner punctuation is not outer permission',firstDialogueBoundary('你说“好。”然后')===undefined);
    check('explicit separator is a boundary',firstDialogueBoundary('嗯---再说说。')===1);
    check('world output remains narrative mode',resolveOutputContract('world')==='world-narrative');
    for(const mode of ['private','group','voice','proactive'] as const)check(mode+' remains dialogue mode',resolveOutputContract(mode)==='dialogue-only');
    check('JSON transport cannot conceal raw stage direction',!inspectChatOutput(JSON.stringify({messages:['（拍桌）不行。']}),{mode:'private',userMessage:'扮演聊天。'}).check.ok);
    check('pure quoted speech punctuation survives',inspectDialogueSegment('“我在。”','private',false).status==='ready');
  }
  return {complete:checks.every(c=>c.ok),checks,failures:checks.filter(c=>!c.ok),before:CONTRACT_BEFORE,modelApiCalls:0};
}
