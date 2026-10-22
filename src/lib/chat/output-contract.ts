import { isRoleplayAction } from '../ai/text';

/** Product surfaces, never a field that model output may choose. Fictional
 * facts do not change the ordinary messenger's dialogue-only presentation. */
export type ChatSurface = 'private' | 'group' | 'proactive' | 'voice' | 'world';
export type OutputContract = 'dialogue-only' | 'world-narrative';
export type DialogueReview =
  | { status: 'ready'; text: string }
  | { status: 'pending'; reason: 'incomplete' | 'ambiguous-structure' }
  | { status: 'reject'; reason: 'narration' | 'stage-direction' | 'speaker-label' };

export function resolveOutputContract(surface: ChatSurface): OutputContract {
  return surface === 'world' ? 'world-narrative' : 'dialogue-only';
}

interface Structure {
  prose: string;
  pending: boolean;
  malformed: boolean;
  stageDirection: boolean;
  boundaries: number[];
}
const pairs: Record<string, string> = { '“':'”', '「':'」', '『':'』', '‘':'’', '"':'"', "'":"'", '（':'）', '(' : ')', '[':']', '【':'】', '{':'}' };
const quoted = new Set(['“', '「', '『', '‘', '"', "'"]);
const closeOnly = new Set(['”', '」', '』', '’', '）', ')', ']', '】', '}']);
const directionLead = /^(?:动作|神态|表情|心理|内心|旁白|画外音|舞台提示)[：:]/u;

/** Check whole action asides. Keep factual, technical and quoted parentheses;
 * do not infer that every parenthesis containing a verb is a direction. */
function actionAside(text: string): boolean {
  const body = text.trim();
  if (directionLead.test(body)) return true;
  if (isRoleplayAction(body)) return true;
  if (/[“”「」『』"'`]|(?:原文|备注|定义|术语|意思|例如|假设|如果|公式|函数|版本|变量|预算)/u.test(body)) return false;
  // Repeated durations and mixed-script action tags were previously missed by
  // the short-aside remover. Only unambiguous staging syntax opts in here.
  return /^(?:(?:我|她|他)\s*)?(?:轻轻|缓缓|微微|默默|无奈地|温柔地|笑着|低声|轻声|冷冷地)?(?:点(?:了点)?头|摇(?:了摇)?头|笑(?:了笑|起来)?|叹(?:了)?(?:口|一口)?气|沉默|停顿)(?:了|着|地)?(?:\s*\d+\s*(?:秒|下|次))?(?:[，,；;].*)?$/u.test(body)
    || /^(?:smiles?|sighs?|nods?|shrugs?|whispers?|laughs?)(?:\s+(?:softly|quietly|gently))?[.!]?$/iu.test(body);
}

/** One structural pass. Quoted source text/code are shielded from narration
 * matching, but remain byte-for-byte in the returned text. Closing a quote is
 * not itself permission to publish an unfinished outer sentence. */
function structure(raw: string): Structure {
  const stack: Array<{ open:string; close:string; start:number }> = [];
  const visible = raw.split('');
  const boundaries: number[] = [];
  let code = '', codeStart = 0, malformed = false, stageDirection = false;
  const mask = (start:number,end:number) => { for(let i=start;i<=end;i++) visible[i]=' '; };
  for(let i=0;i<raw.length;i++) {
    const char=raw[i];
    if(char==='\\') { i++; continue; }
    if(code) {
      if(raw.startsWith(code,i)) { mask(codeStart,i+code.length-1); i+=code.length-1; code=''; }
      continue;
    }
    const top=stack[stack.length-1];
    if(top&&quoted.has(top.open)) {
      if(char===top.close) {
        stack.pop();mask(top.start,i);
        // An entire quoted utterance can stand alone; a quotation inside an
        // unfinished reporting sentence cannot authorize its outer prefix.
        if(!stack.length&&!raw.slice(0,top.start).trim()&&/[。！？!?…]\s*$/u.test(raw.slice(top.start+1,i)))boundaries.push(i+1);
      }
      continue;
    }
    if(char==='`') {code=raw.startsWith('```',i)?'```':'`';codeStart=i;i+=code.length-1;continue;}
    if(top&&char===top.close) {
      stack.pop();
      if(actionAside(raw.slice(top.start+1,i))) stageDirection=true;
      mask(top.start,i);
      continue;
    }
    // Apostrophes inside natural English (don't, Alice's) are not quotation.
    if((char==="'"||char==='’')&&/[\p{L}\p{N}]/u.test(raw[i-1]??'')
      &&(/[\p{L}\p{N}]/u.test(raw[i+1]??'')||/[sS]/u.test(raw[i-1]??'')&&!/[\p{L}\p{N}]/u.test(raw[i+1]??'')))continue;
    if(pairs[char]) {stack.push({open:char,close:pairs[char],start:i});continue;}
    if(closeOnly.has(char)) {malformed=true;continue;}
    if(!stack.length) {
      if(/[。！？!?]/u.test(char)||char==='.'&&!/[\p{L}\p{N}]/u.test(raw[i+1]??'')) boundaries.push(i+1);
      if(raw.startsWith('---',i)) {boundaries.push(i);i+=2;}
      // The established paragraph fallback is also a message boundary. A
      // reaction needs no invented punctuation, but an unfinished raw token
      // still cannot publish before the following separator arrives.
      if(char==='\n'&&/^\n[ \t]*\n/u.test(raw.slice(i)))boundaries.push(i);
    }
  }
  return {prose:visible.join(''),pending:stack.length>0||!!code,malformed,stageDirection,boundaries};
}

function narration(prose:string): DialogueReview | undefined {
  if(/(?:^|\n|---)\s*(?:(?:assistant|角色|旁白|画外音|心理活动|内心独白|我|她|他)\s*[：:]|[\p{Script=Han}]{1,12}\s*[：:]\s*[“「『"])/imu.test(prose))
    return {status:'reject',reason:'speaker-label'};
  // Stars as stage delimiters; multiplication and ordinary emphasis are kept.
  if([...prose.matchAll(/\*([^*\n]{1,240})\*/gu)].some(match=>actionAside(match[1])))
    return {status:'reject',reason:'stage-direction'};
  const clauses=prose.split(/[。！？!?\n]|---/u).map(s=>s.trim()).filter(Boolean);
  for(const clause of clauses) {
    if(/^(?:你刚才说|原文|原句|引用|台词|这句话|文中|书中|小说里|故事里|例如|比如|假如|如果|想象|假设|翻译|代码|公式|函数|变量|所谓|(?:他|她)说的)/u.test(clause)) continue;
    if(directionLead.test(clause)) return {status:'reject',reason:'narration'};
    // Narrated body placement is still narration when the user roleplays.
    // Match the object/action relation, not every 把/将, body noun or verb.
    if(/^(?:她|他|少女|少年|女子|男子|[\p{Script=Han}]{2,5})(?:轻轻|缓缓|慢慢|默默)?(?:把|将)(?:自己(?:的)?|她的|他的)?(?:额头|脑袋|头|脸|身子|身体|双手|手掌|手)(?:轻轻|缓缓|慢慢)?(?:贴|靠|埋|搭|放|伸|交叠|环)(?:上|在|向|到|进|出|着|住|了|过)[^。！？!?]*$/u.test(clause))
      return {status:'reject',reason:'narration'};
    // The generic-name fallback must not interpret “刚才说从早” as a
    // five-character person's name before “走到”. This is a reference to an
    // utterance, not a blanket exemption for narration elsewhere in the reply.
    const earlierSpeech=/^(?:刚才|刚刚|之前|前面|先前)(?:说|讲|提到|提过)(?!完|罢)/u.test(clause);
    if(!earlierSpeech&&!/^(?:我|你|我们|你们|咱们)/u.test(clause)&&/^(?:(?:她|他|少女|少年|女子|男子)|[\p{Script=Han}]{2,5})(?:缓缓|轻轻|微微|默默|慢慢|忽然|突然)?(?:抬(?:起|了)|低(?:下|了)|转(?:过|身)|走(?:到|近)|靠(?:近|过来)|伸(?:出|手)|点了点头|摇了摇头|笑了笑|轻声(?:说|道)|低声(?:说|道))[^。！？!?]*(?:[，,：:]|$)/u.test(clause))
      return {status:'reject',reason:'narration'};
    if(/^(?:我)?(?:缓缓|轻轻|微微|默默|慢慢|无奈地|温柔地)(?:一笑|点头|点了点头|摇头|抬头|低头|伸手|叹气|叹了口气)(?:[，,：:]|$)/u.test(clause))
      return {status:'reject',reason:'narration'};
    if(/^(?:说完|话音落下|话音刚落|话音未落|眼底|眸中|唇角|嘴角|银发|发丝)(?:[，,]|.{0,36}(?:闪过|浮现|扬起|勾起|弯起|垂落|拂过))/u.test(clause))
      return {status:'reject',reason:'narration'};
  }
  return undefined;
}

/** Structural/format check only. A ready segment still needs persona, facts,
 * source permissions and delivery checks before it may become visible. */
export function inspectDialogueSegment(raw:string,surface:ChatSurface,final:boolean):DialogueReview {
  if(resolveOutputContract(surface)==='world-narrative')return {status:'ready',text:raw};
  // Review decoded transport messages before any display cleanup. Ordinary
  // JSON examples without this exact envelope retain their technical meaning.
  if(/^\s*\{\s*"messages"\s*:/u.test(raw)) {
    try {
      const envelope:unknown=JSON.parse(raw);
      const messages=(envelope as {messages?:unknown}).messages;
      if(Array.isArray(messages)&&messages.some(part=>typeof part==='string'&&part.trim())) {
        for(const part of messages)if(typeof part==='string'&&part.trim()) {
          const reviewed=inspectDialogueSegment(part,surface,final);
          if(reviewed.status!=='ready')return reviewed;
        }
        return {status:'ready',text:raw};
      }
    } catch {return {status:'pending',reason:'ambiguous-structure'};}
  }
  const label=raw.match(/(?:^|\n|---)\s*([\p{Script=Han}]{1,12})\s*[：:]\s*[“「『"]/u)?.[1];
  if(label&&!/^(?:原文|原句|引用|台词|这句话|例子|代码|公式|结果|备注)$|(?:说|写|是)$/u.test(label))return {status:'reject',reason:'speaker-label'};
  const parsed=structure(raw);
  if(parsed.stageDirection)return {status:'reject',reason:'stage-direction'};
  const rejected=narration(parsed.prose);
  if(rejected)return rejected;
  if(parsed.pending||parsed.malformed)return {status:'pending',reason:'ambiguous-structure'};
  if(!raw.trim())return {status:'pending',reason:'incomplete'};
  if(!final&&!/[。！？!?…](?:\s|---)*$|\.(?:\s|---)*$|---\s*$/u.test(raw)
    &&!parsed.boundaries.some(end=>!raw.slice(end).trim()))return {status:'pending',reason:'incomplete'};
  return {status:'ready',text:raw};
}

/** Locate the first independent structural boundary in accumulated raw text.
 * The caller keeps the original prefix immutable and reviews it with current
 * sources. This helper neither publishes text nor trusts elapsed time. */
export function firstDialogueBoundary(raw:string):number|undefined {
  const parsed=structure(raw);
  for(const end of parsed.boundaries) {
    if(end>0&&inspectDialogueSegment(raw.slice(0,end),'private',true).status==='ready')return end;
  }
  return undefined;
}
