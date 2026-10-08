import type { Character } from '../db';
import { buildHumanConversationSections } from './chat-humanizer';
import { withChatMessagingPolicy } from '../../server/chat-messaging-policy.mjs';
import { inspectChatOutput } from './chat-output-quality';
import { taskChat } from './ai/task-client';
import { resolveModel, findModel, DEEPSEEK_MODEL_ID } from './ai/llm';
import { getDialogueTrajectory } from './chat-evaluation-trajectories';
import { useAuthStore } from '../store/auth-store';
import { voicePromptRevision, voiceIdentityWithoutExamples } from './character-voice';
import {buildChatConversationStateContext,updateChatConversationState,inferReplyAction,type ChatConversationState} from './chat-conversation-state';
import {compileChatContext} from './chat-context-compiler';
import {splitReplyParts} from './chat-pacing';
import {isLongFormRequest} from './reply-quality';
import {buildChatHistoryWindow,boundChatHistory} from './chat-history-window';

export const EXPRESSION_SCENARIOS = [
  '哈哈哈你居然还记得','今天好累，报告你帮我看看呗','我不难过，只是想聊聊','她最近很难过，我不知道怎么陪她',
  '他说“我很累”，你怎么看','终于做完了，但我好累','你不同意我也可以直接说','讲讲你不知道的事情，别瞎编',
  '先别给建议，陪我聊一会儿','算了，不用分析，换个话题','今天去书店了','你是不是每次都只会安慰我',
  '只想说声晚安','那个报告你帮我看看呗','不要猜我的心情，我今天挺好的',
] as const;
export const EVALUATION_PERSONAS = [
  {name:'专业',prompt:'简洁、克制、先核对事实，坦白说明未知。称呼：你\n判断习惯：先看事实，不把安慰当答案。\n对话样本：用户说我好累 → 你说今天先收住。还有哪件必须处理的事？'},
  {name:'搭档',prompt:'自然随和、有自己的意见，陪人理顺事情。称呼：你\n判断习惯：先找眼前卡住的一点，允许不同意。\n对话样本：用户说我好累 → 你说这一天够长的。---先把最急那件拎出来？'},
  {name:'温柔',prompt:'具体体谅、细腻、不过度亲密，不反复灌安慰。称呼：你\n判断习惯：注意没被听懂的地方，先听具体遭遇。\n对话样本：用户说我好累 → 你说那先别急着解释了。想说哪段，我听着。'},
  {name:'元气',prompt:'轻快有活力，但认真时不逼人振作。称呼：你\n判断习惯：先减轻负担，开心时自然庆祝。\n对话样本：用户说终于做完 → 你说好耶！！---今天这关算过了😂'},
  {name:'俏皮',prompt:'有分寸的幽默，有判断，失败时不嘲讽。称呼：你\n判断习惯：轻松时接梗，难受时收住锋芒。\n对话样本：用户说我好累 → 你说今天的电量见底了。---先不加戏，歇会儿。'},
];
export interface EvaluationRow { role:string;scenario:number;input:string;reply:string;issue?:string;durationMs:number;error?:string;truncated?:boolean;attention?:ChatConversationState;focus?:string;usage?:{inputTokens:number;outputTokens:number};ratings?:{naturalness:number;identity:number;context:number;truth:number} }
export interface EvaluationReport { version:1; model:{provider:string;id:string}; startedAt:number; complete:boolean;rows:EvaluationRow[]; budget?:{calls:number;maxOutputTokensPerCall:number}; trajectory?:string; roles?:Array<{name:string;revision:number;proactivity:number}> }
export interface EvaluationOptions { trajectoryId:string }
export function evaluationSummary(report:EvaluationReport) {
  const dimensions=['naturalness','identity','context','truth'] as const;
  const scored=report.rows.filter(row=>row.ratings&&dimensions.every(key=>Number.isFinite(row.ratings![key])&&row.ratings![key]>=1&&row.ratings![key]<=5));
  return {generated:report.rows.length,failed:report.rows.filter(r=>r.error).length,localIssues:report.rows.filter(r=>r.issue).length,
    truncated:report.rows.filter(row=>row.truncated).length,
    rated:scored.length,semanticStatus:report.complete&&!report.rows.some(row=>row.error||row.truncated)&&scored.length===report.rows.length && scored.length>0 ? 'rated' : 'unrated',
    usage:{reportedCalls:report.rows.filter(row=>row.usage).length,unknownCalls:report.rows.filter(row=>!row.usage).length,
      inputTokens:report.rows.reduce((sum,row)=>sum+(row.usage?.inputTokens??0),0),outputTokens:report.rows.reduce((sum,row)=>sum+(row.usage?.outputTokens??0),0)},
    averages:Object.fromEntries(dimensions.map(key=>[key,scored.length ? scored.reduce((sum,r)=>sum+r.ratings![key],0)/scored.length : null]))};
}

/** Explicitly started evaluation only; no chat/life writes, no raw reply storage. */
export async function runExpressionEvaluation(characters:Character[], rounds:number, signal:AbortSignal, onProgress:(report:EvaluationReport)=>void, options?:EvaluationOptions):Promise<EvaluationReport> {
  const trajectory=options?getDialogueTrajectory(options.trajectoryId):undefined;
  if(trajectory&&characters.length!==1) throw Error('连续小测只能选择一个角色。');
  const owner=useAuthStore.getState().userId, apiKey=useAuthStore.getState().apiKey ?? '', model=trajectory?findModel(DEEPSEEK_MODEL_ID,'deepseek'):resolveModel();
  if(!model) throw Error('未找到 DeepSeek V4.1 Flash。');
  if(!owner) throw Error('请先登录。');
  const turnCount=trajectory?trajectory.turns.length:Math.min(60,Math.max(1,rounds)),maxTokens=trajectory?320:500;
  const report:EvaluationReport={version:1,model:{provider:model.provider,id:model.id},startedAt:Date.now(),complete:false,rows:[],trajectory:trajectory?.title,budget:{calls:characters.length*turnCount,maxOutputTokensPerCall:maxTokens},roles:characters.map(c=>({name:c.name,revision:voicePromptRevision(c),proactivity:c.proactivity??.5}))};
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort);
  const unsubscribe=useAuthStore.subscribe(state=>{if(state.userId!==owner) controller.abort();});
  if(signal.aborted) controller.abort();
  try {
    for(const character of characters) {
      const history:Array<{id:string;role:'user'|'assistant';content:string;isProactive:boolean;replyToUserMessageId?:string;replyBatchId?:string}>=[];
      let attention:ChatConversationState|undefined;
      const replyTurns:string[][]=[];
      for(let i=0;i<turnCount;i++) {
        if(controller.signal.aborted || useAuthStore.getState().userId!==owner) return report;
        const input=trajectory?.turns[i].input??EXPRESSION_SCENARIOS[i%EXPRESSION_SCENARIOS.length], start=performance.now();
        const row:EvaluationRow={role:character.name,scenario:i,input,reply:'',durationMs:0,focus:trajectory?.turns[i].focus};
        try {
          const previousUser=history.filter(item=>item.role==='user').slice(-1)[0]?.content??'';
          const currentId=`evaluation-user-${i}`;
          const modelHistory=boundChatHistory(buildChatHistoryWindow(history,currentId)).map(({role,content})=>({role,content}));
          const currentAttention=updateChatConversationState(attention,input,'',undefined,Date.now(),previousUser);
          const compiled=compileChatContext(voiceIdentityWithoutExamples(character.systemPrompt),[
            {key:'conversation-state',text:buildChatConversationStateContext(currentAttention),priority:98},
            ...buildHumanConversationSections(input,modelHistory,character,{turnNumber:currentAttention.turnCount,recentReplyTurns:replyTurns.slice(-4),adviceStyle:currentAttention.topicAdvice??currentAttention.preferences.adviceStyle}),
          ]);
          const prompt=withChatMessagingPolicy(compiled.prompt);
          const result=await taskChat({apiKey,messages:[{role:'system',content:prompt},...modelHistory,{role:'user',content:input}],maxTokens,signal:controller.signal,timeoutMs:60000},model);
          if(controller.signal.aborted || useAuthStore.getState().userId!==owner) return report;
          const inspected=inspectChatOutput(result.content,{mode:'private',userMessage:input,recentReplies:modelHistory.filter(h=>h.role==='assistant').map(h=>h.content).slice(-4),recentUserMessages:modelHistory.filter(h=>h.role==='user').map(h=>h.content),catchphrase:character.catchphrase,persona:character.systemPrompt});
          row.reply=inspected.content;row.issue=inspected.check.issue;
          if(result.truncated) {row.truncated=true;row.error='回复达到输出上限，已停止小测；这条不能作为完整回复验收。';}
          else if(!row.reply.trim()) row.error='模型未返回可显示的回复，已停止小测。';
          if(result.usage&&[result.usage.inputTokens,result.usage.outputTokens].every(n=>Number.isFinite(n)&&n>=0)) row.usage=result.usage;
          if(!row.error) {
            attention=updateChatConversationState(attention,input,row.reply,inferReplyAction(input,row.reply),Date.now(),previousUser);
            row.attention=attention;
            replyTurns.push(splitReplyParts(row.reply,4,{longForm:isLongFormRequest(input)}));
          }
          history.push({id:currentId,role:'user',content:input,isProactive:false});
          splitReplyParts(row.reply,4,{longForm:isLongFormRequest(input)}).forEach((content,part)=>history.push({id:`evaluation-reply-${i}-${part}`,role:'assistant',content,isProactive:false,replyToUserMessageId:currentId,replyBatchId:`evaluation-batch-${i}`}));
        } catch(error) { if(controller.signal.aborted) return report;row.error='模型调用失败，请检查连接或额度。'; }
        row.durationMs=Math.round(performance.now()-start);report.rows.push(row);onProgress({...report,rows:[...report.rows]});
        if(row.error) return report; // Avoid repeating a configuration/credit failure.
      }
    }
    report.complete=true;return report;
  } finally {unsubscribe();signal.removeEventListener('abort',abort);}
}
