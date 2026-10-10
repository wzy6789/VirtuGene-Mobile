import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const sources=['docs/GUYUENA-LIVE-VENT-TO-HELP-HOLDOUT-R1-2026-10-10.json','docs/LUXUEQI-LIVE-VENT-TO-HELP-HOLDOUT-R1-2026-10-10.json'];
const reports=sources.map(path=>JSON.parse(readFileSync(path,'utf8')));
if(reports.some(r=>!r.complete||r.rows.length!==3||r.usage.missingUsage||r.rows.some(row=>row.failed||row.calls.at(-1)?.finish!=='stop')))throw Error('Complete paired lifecycle evidence required');
if(!readFileSync('release/chat-listening-boundary-final-2026-10-10.log','utf16le').includes('PASS chat-expression: 2656'))throw Error('Local checks missing');
if(readFileSync('release/chat-listening-boundary-types-2026-10-10.log','utf16le').replace(/^\uFEFF/,'').trim())throw Error('Typecheck not clean');
const usage=reports.reduce((s,r)=>({calls:s.calls+r.usage.calls,input:s.input+r.usage.input,output:s.output+r.usage.output,total:s.total+r.usage.total}),{calls:0,input:0,output:0,total:0});
const chats=reports.map((r,i)=>{
 const name=i===0?'古月娜':'陆雪琪',path=root+'/聊天验收/'+name+'-2026-10-10.md';
 const before=readFileSync(path,'utf8'),heading='## vent-to-help-holdout / r1（生产对话）';
 const transcript=r.rows.map(row=>'**chatgpt**：'+row.input+'\n\n'+row.replies.map(reply=>'**'+name+'**：'+reply).join('\n\n')).join('\n\n');
 return {path,before,after:before.includes(heading)?before:before+'\n\n'+heading+'\n\n'+transcript+'\n'};
});
const evidence='release/chat-listening-boundary-evaluation-2026-10-10.json';
writeFileSync(evidence,JSON.stringify({sources,usage,checks:2656,typeCheck:true,qualityComplete:false,chats,findings:['Fixed a real parse gap: 先不想办法 is a current temporary boundary, unlike unrecognized 不想 + 想办法 double-verb assumption.','Use the same current-topic parser in the humanizer and persisted state; explicit current corrections override inherited advice style.','Paired fresh three-turn sends honor no-solutions, then explicit help, then goodbye. No additional assessment call or semantic enforcement layer.','Current sample replies still contain I-am-listening framing; Lu generalizes about the feeling. Character distinctiveness and conversational naturalness remain incomplete.','One current sample per role; no same-input before/after causal control, no long-chat quality proof.','Existing outsider cold branch and source truth guards remain unchanged; no version, package or publication change.']},null,2)+'\n');
for(const chat of chats)writeFileSync(chat.path,chat.after);
const path=root+'/开发日志/2026-10-10.md',heading='## 先倾诉、后求助的同事项接续';
if(!readFileSync(path,'utf8').includes(heading)){
 appendFileSync(path,`\n${heading}\n- 前轮产生有效失败证据和收窄指引：Gu仍违背不想找办法，观点趋同。本轮核查adviceForCurrentTopic、turnAttention、buildHumanConversationSections及真实请求。原不想找办法可识别，但先不想办法因为正则按不想+想办法/找办法解析而漏，导致新短说法没有临时状态。第一次新增本地流程测试因此失败，修为可选找/想+办法；仍按独立声明、问题/转述/否定原边界解析，不将它固定为永久偏好。\n- 导出复用已有adviceForCurrentTopic，humanizer当前声明覆盖继承adviceStyle，无持久私聊状态的caller也不丢当前边界。具体任务、亲近、用户开题与告别仍按原优先级；后续明确求办法能释放临时状态。增强原listen段说明语气体贴的条件式建议仍是办法，不靠说等一会儿再做/我陪你补上绕过拒绝。这是提示语义与本地状态修复，没有声称完成语义输出强制，也没有新付费评审。\n- 12项两角色raw/no caller options/继承direct覆盖/持久状态释放/继承listen仍求助/第三方无边界/告别不干扰；新增先不想办法进入原6项持久/同题/换题矩阵。最终2656项过，release/chat-listening-boundary-final-2026-10-10.log；类型release/chat-listening-boundary-types-2026-10-10.log过。中间失败识别留在开发记录，复跑日志为最终结果。\n- 新vent-to-help-holdout三轮：写作被打断烦躁先不想办法→现在求一个简单办法→告别。Gu第一轮短反应、没建议；Lu第一轮回应感受没建议；两者第二轮都建议断处留下一句提示，第三轮直接道别。这组改口流程真实生产发送/落库/历史回喂通过。具体建议提前留提示在突然打断时未必可做，不是万能方法。\n- 人味尚不足：两人仍说我听着，Lu说最恼人的往往是那口气断了，仍有概括感受的分析口吻；此次不能据方法相同判性格稳定，功能接续是进展而非满分。每角色仅一版该新场景，完整保存为当前该组记录，没有同输入未修复A/B或长聊证明，不拼版本；所有原稿留${sources.join('、')}，${evidence}含完整精选前后和限制。chatgpt输入、聊天与分析分开，电脑版不改。\n- deepseek-flash真实${usage.calls}调用/input ${usage.input}/output ${usage.output}/total ${usage.total}，Gu8025、Lu11220；complete/final stop/usage齐，无真实质检重试，无隐藏提取/摘要/评审。其余本地零模型。\n- 下一步减少倾听宣言和情绪点评，强化自己的具体反应、独立偏好问题理解与长聊人物区别。冷淡身份/原著引用/消息场景约束未弱化。整体目标未完成。6.0.13未变，无打包发布。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 倾诉与后来求助\n- 先不想办法也是临时边界，体贴的条件式安排仍是建议。\n- 后来求办法就正常帮忙，告别不拖回旧事。\n- 三轮真实接续过，但我听着与感受点评仍要减少。\n');
 appendFileSync(root+'/00-总览.md',`\n- 倾诉→求助→告别：修先不想办法识别与共用当前边界，2656项/类型过，两角色各3轮真实接续，${usage.calls}调用/${usage.total}token。完整组单版保留，性格与长聊仍未达标，无发布。\n`);
}
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
