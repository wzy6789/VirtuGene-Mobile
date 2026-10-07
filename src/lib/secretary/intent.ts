import type { SecretaryAction } from './types';
import { explicitStepIndex } from './followup';

export function ambiguousRecordRequest(request: string): boolean {
  return /^(?:请|帮我|给我|替我|麻烦)?(?:给我|帮我)?记一[笔筆](?:[：:，,\s].*)?[。！!]?$/u.test(request.trim()) && !/日记|手账|待办|提醒|日程|计划/u.test(request);
}

/** An explicit recording wrapper delegates one quoted reminder, never other tools. */
export function quotedTodoPayload(request: string): { text: string; start: number; end: number } | undefined {
  const match = request.trim().match(/^(?:请|麻烦(?:你)?)?(?:(?:帮我|替我|给我))?(?:记一下|记下来|记上|记录(?:一下)?)[：:，,\s]*(["'“「『])([\s\S]+?)(["'”」』])[。！!\s]*$/u);
  if (!match) return;
  const closing: Record<string, string> = { '"': '"', "'": "'", '“': '”', '「': '」', '『': '』' };
  if (closing[match[1]] !== match[3] || /["'“”「」『』\n；;]|然后|并且|顺便|同时/u.test(match[2])
    || !/提醒我|(?:添加|新增|创建|记(?:个|一个|一项)?).*待办|记得叫我|别让我忘|不要让我忘/u.test(match[2])
    || /(?:不要|别|不用|不必|先不|暂时不).*(?:添加|新增|创建|保存|记|提醒)/u.test(match[2])) return;
  const start = request.indexOf(match[1]) + 1;
  return { text: match[2], start, end: start + match[2].length };
}

/** Scope comes from the current user instruction, never from recalled documents. */
export function actionAllowed(action: SecretaryAction, request: string, selectedTodo = false): boolean {
  const quotedTodo = quotedTodoPayload(request);
  if (quotedTodo && action.kind !== 'todo.create') return false;
  // Commands in quoted data are never permission. An explicit tool instruction
  // outside a quoted title remains visible, preserving named records.
  request = request.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|'[^']*'/gu, '');
  if (quotedTodo) request += '，添加待办';
  if (/^\s*(?:朋友|别人|他|她|他们|她们|同事|老板|老师)(?:说|问|让我|叫我)|^\s*(?:例如|比如|假设|引用|小说里)/u.test(request)) return false;
  if (!['diary.search', 'moment.search', 'todo.list', 'app.open'].includes(action.kind)) {
    // Searching existing records must not become a write if the planner chooses the wrong tool.
    request = request.split(/[，,。；;\n]|(?:然后|并且|接着|顺便|同时)|(?=并(?:帮我|把|写|发|加|新增|修改|取消))/u)
      .filter(clause => !/^(?:请|帮我|给我|麻烦)?(?:查|搜|找|看|翻|回顾)/u.test(clause.trim())).join('，');
  }
  const diary = /日记|手账|记一[下笔]|记下来|记录(?:一下|今天|昨天|这件|这段)/u.test(request);
  const moment = /朋友圈|动态|文案/u.test(request);
  const publish = /(?:发布|发(?:布|出|一条|个|条|一下|到)|发(?=朋友圈|动态)|直接发|帮我发)/u.test(request)
    && !/(?:不要|别|先不|暂时不|不用|不必|不)(?:直接|帮我|再|继续|现在)*(?:发|发布)|只(?:写|要).*草稿/u.test(request);
  const todo = selectedTodo || /待办|提醒|安排|日程|计划|加一项|加个|新增|记个任务|记一项/u.test(request);
  const naturalTodo = !/日记|手账|朋友圈|动态|文案/u.test(request)
    && /(?:帮我|替我|给我|麻烦|请).*(?:记上|记一下|记下来|记着)|^(?:请|麻烦)?记上.+|别让我忘(?:了|记)|不要让我忘(?:了|记)|记得叫我(?:一声)?/u.test(request)
    && !/(?:不要|别|不用|不必|先不|暂时不).*?(?:记上|记一下|记下来|记着|保存|叫我)/u.test(request);
  const stepIntent = /步骤|子任务/u.test(request) || explicitStepIndex(request) != null;
  switch (action.kind) {
    // Messaging authorization is handled by the dedicated source-checked workflow.
    case 'character.message.send': return false;
    case 'todo.steps': {
      if (!todo || !(stepIntent || /拆|分解/u.test(request)) || /(?:不要|别|不用|不必).*(?:拆|分解|添加|新增|完成|勾|恢复|保存)|只(?:要|给|提供)?(?:建议|拆分建议)|(?:先不|不)保存/u.test(request)) return false;
      if (action.stepMode === 'add') return /拆|分解|加|新增|补/u.test(request);
      if (action.stepMode === 'complete') return /完成|做完|划掉|勾掉|打勾|办完/u.test(request) && !/取消完成|(?:还?没(?:有)?|未|尚未)(?:做完|完成|办完)/u.test(request);
      if (action.stepMode === 'reopen') return /恢复|重新打开|没做完|还没完成|取消完成/u.test(request);
      return true;
    }
    case 'diary.search': return diary && /查|找|搜|看|读|翻|回顾/u.test(request) && !/(?:不要|别|不用|不必).*(?:查|找|搜|看|读|翻)/u.test(request);
    case 'moment.search': return moment && /查|找|搜|看|翻|回顾/u.test(request) && !/(?:不要|别|不用|不必).*(?:查|找|搜|看|翻)/u.test(request);
    case 'app.open': return /打开|带我|去.*(?:页|日记|待办|朋友圈|记忆|时间线|关系|星域|世界设置)|进入.*页/u.test(request) && !/(?:不要|别|不用|不必).*(?:打开|带我|进入|去)/u.test(request);
    case 'todo.update': return todo && !stepIntent && /改|调整|设|关闭|关掉|清空|取消.*提醒/u.test(request) && !/(?:不要|别|不用|不必).*(?:改|调整|设|关闭|关掉|清空)/u.test(request);
    case 'todo.cancel': return todo && !stepIntent && /取消|删|移除/u.test(request) && !/取消完成|取消.*提醒|(?:不要|别|不用|不必).*(?:取消|删|移除)/u.test(request);
    case 'diary.save': return diary && /写|保存|追加|补充|整理|润色|记(?:一|下|篇|个|到|在|点)|记录/u.test(request) && !/(?:不要|别|不用|不必|先不|暂时不).*(?:保存|写|记|追加|补充|整理|润色|记录)/u.test(request);
    case 'moment.draft': return moment && /写|生成|整理|创建|起草|草稿|改写|润色|文案/u.test(request) && !/(?:不要|别|不用|不必|先不|暂时不).*(?:写|生成|整理|创建|起草|改写|润色)/u.test(request);
    case 'moment.publish': return moment && publish;
    case 'todo.create': return (todo || naturalTodo) && /新增|加|建|记|写|录入|安排|提醒|设|计划|忘/u.test(request)
      && (!stepIntent || /(?:新增|新?建|创建|添加|加(?:一项|个)?|记(?:个|一项)).*?(?:待办|任务)/u.test(request))
      && !/(?:不要|别|不用|不必|先不|暂时不).*?(?:记上|记一下|记下来|记着|叫我)/u.test(request)
      && !/(?:不要|别|不用|不必)(?:再|帮我|继续|现在)*(?:添加|新增|创建|提醒|安排|设置)|(?:不要|别|不用|不必).*(?:加|建|提醒|安排|设).*(?:待办|提醒|事项|日程)/u.test(request);
    case 'todo.list': return /待办|安排|日程|还有什么|没做|未完成|完成了什么/u.test(request);
    case 'todo.complete': return /划掉|勾掉|勾选|完成|做完|办完|交了|交完|打勾/u.test(request)
      && !stepIntent
      && !/(?:还?没(?:有)?|未|尚未|不算)(?:做完|完成|办完)|(?:不要|别|不用|不必).*(?:划掉|勾掉|完成|打勾)/u.test(request);
    case 'todo.reopen': return /恢复|撤销|取消完成|没做完|还没完成|重新打开/u.test(request) && !stepIntent && !/(?:不要|别|不用|不必).*(?:恢复|撤销|取消完成|重新打开)/u.test(request);
    case 'todo.reschedule': return /改|挪|推迟|提前|调整/u.test(request) && (selectedTodo || /待办|安排|日程|提醒|改到|挪到|改成/u.test(request))
      && !stepIntent
      && !/(?:不要|别|不用|不必).*(?:改|挪|推迟|提前|调整)/u.test(request);
  }
}

