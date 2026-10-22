// Requirement-by-requirement assessment, not a replacement for the cited tests.
import {readFileSync,writeFileSync,readdirSync,statSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root='release/chat-core-implementation-20261021';
const read=path=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/u,''));
const text=path=>{const bytes=readFileSync(path);return bytes.toString(bytes[0]===0xff&&bytes[1]===0xfe?'utf16le':'utf8').replace(/^\uFEFF/u,'');};
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const latest=(dir,re)=>readdirSync(dir).filter(name=>re.test(name)).map(name=>join(dir,name)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];
const stage=read(join(root,'review/stage-evidence-20261022.json'));
const progressPath=join(root,'progress-20261022.json'),progress=read(progressPath);
const planPath='release/chat-core-plan-final-20261021/final-plan.md',plan=readFileSync(planPath,'utf8');
const voice=latest(join(root,'voice'),/^continuity-\d+\.json$/),proactive=latest(root,/^proactive-current-\d+\.json$/);
if(!read(voice).complete||read(voice).checks.length!==26||!read(proactive).complete||read(proactive).checks.length!==33)throw Error('Combined-risk checks are missing');
const evidence={...Object.fromEntries(Object.entries(stage.evidence).map(([key,value])=>[key,value.path])),voice,proactive,sender:latest(join(root,'delivery'),/^current-\d+\.json$/),
  voiceRecovery:join(root,'voice/recovery-current-1792632883427.json'),voiceController:join(root,'voice/controller-current-20261022.json'),
  expression:join(root,'review/expression-after-speaker-window-fix.log'),types:join(root,'review/types-after-speaker-window-fix.log'),
  gateway:join(root,'review/gateway-stream-current.log'),world:join(root,'review/world-stream-current.log')};
if(!text(evidence.expression).includes('PASS chat-expression: 3854 checks')||statSync(evidence.types).size!==0||!text(evidence.gateway).includes('ALL PASS gateway stream assertions')||!text(evidence.world).includes('PASS 19'))throw Error('Relevant integration evidence is missing');
if(hash('src/lib/voice-call/controller.ts')!==read(evidence.voiceController).sourceSha256)throw Error('Old voice-controller result no longer covers this source');
const assessments={
  T0:[
    ['verified-with-scope-limit',['sender','stock'],'实际执行bundle及依赖hash、十份冻结before文件与输入在报告中；并非历史APK整源比较。'],
    ['verified-local',['stock','resume','sender'],'同资料42项完整输入hash/原始行保留/分段发布对照；不是手机呈现帧或P95。'],
    ['verified-accounting',[],'初始6/6、完整72/72；实际78次/320197 tokens，账单未确认，旧历史用量另列。'],
  ],
  T1:[
    ['verified-local',['proactive'],'原生仓储33项，未回复不扣分、重挂载/切号/输入/通话初始化及迟到竞争均覆盖。'],
    ['verified-local',['proactive'],'旧钟点/直接发布入口无效；1200条存量下有界读取，原生回访单次占位。'],
    ['verified-local',['proactive','candidates'],'未读/离线臆测移除，无方向或来源不足可不发；经历素材不自动授权。'],
  ],
  T2:[
    ['verified-local',['output','recorded','expression'],'142契约+39原稿回归覆盖普通扮演旁白、英文所有格、未闭合引用及合法说明；不宣称任意语义都可识别。'],
    ['verified-local',['sender','roundtrip','backup'],'实际sender51，原生进行中/终稿/中断、编辑/删源/切号、重开/导入、迟到后缀及稳定前缀均覆盖。超过四条旧回复的说话人来源仍需核对，独立于短措辞窗口。'],
    ['verified-local',['sender','voice','expression'],'沿用一次质检改写；普通/扮演最终兜底分清说话人，未完成回执和未播文本不作已答。'],
    ['verified-local',['stock','sender'],'同上下文模拟传输下首发布提前；普通原创角色也能早发。高风险/一句话请求仍缓冲，1千小库准备有波动。'],
  ],
  T3:[
    ['verified-local',['topics','recorded','replies'],'同名双事件、改口、同义答复/结论、类别/事项暂停；选择原日期时更新原事件，不新增第三场。'],
    ['verified-local',['topics','candidates','roundtrip'],'原生有来源目标/关怀，编辑/删除/撤回失效，仅撤相关证据；覆盖不足不解释为未回答。'],
    ['verified-local',['voice','sender','proactive'],'进行中或部分语音无完整已答，主动关怀无伪造用户，助理代拟不作用户事实。'],
    ['verified-local',['voice','resume','backup','expression'],'同名考试选择→改期→完成→语音比较、原实例更名/同预设同名副本隔离、跨会话与备份撤权均覆盖。'],
  ],
  T4:[
    ['verified-local-no-hardware',['voiceRecovery','voiceController'],'本地focus/前后台/断网/明确暂停/耳机丢失与迟到事件；controller当前hash与330项记录相符。'],
    ['verified-local-no-hardware',['voiceRecovery'],'13项协调回归，复用原路由/耳机保护，不建第二控制器。'],
    ['verified-local-no-hardware',['voiceRecovery','voiceController','voice'],'保留静音，旧代次无效，确认播放才记已听；完整语音资料新26项。'],
    ['verified-local-no-hardware',['voiceController','voice'],'阶段计时、ASR剩余等待/实际请求、首文本/PCM/播放的时钟和记录区分；无Android声学时延保证。'],
  ],
  T5:[
    ['verified-local',['candidates'],'至多6候选选1，当前意图/来源/暂停/已答/更正日期先过滤。'],
    ['verified-local',['candidates','proactive','sender'],'不新增规划模型，仅实际完整发布才消费方向/关怀；通话启动或用户输入取消迟到开场。'],
    ['verified-local-partial-real',['candidates','sender'],'本地Gu/Lu/普通角色三种选择及旧缓存50；本批真实连续样本集中于Gu/Tang，非三角色真人盲评。'],
    ['verified-local-partial-real',['expression'],'原角色460与总表达3854；实际情绪决定7–9轮顺从合理大事且提醒技术错误，仍有劝解/追问及长聊稳定性限制。'],
  ],
  T6:[
    ['verified-local',['stock','gateway','world'],'42存量、原始对白、状态与入口集成证据已汇总；网关旧夹具改成合法历史并补缺历史零上游拒绝检查。'],
    ['verified-real-material',[],'已加密加载、传输处持久计数，先6试采，再60完整对照+剩余12复采；完整原稿存在，模型传输并不等于人味通过。'],
    ['verified-with-scope-limit',[],'相同角色、请求model、思考配置；只十份冻结发送/回执/历史文件变化，人设等共享，缓存/输出长度不相同，不能作历史APK时延因果。'],
    ['partial-real-quality',[],'三组整段各10轮已选整组不拼句；事实/自然/人物/推进和停止已评。旧原稿存在硬错误，新两类修复本地通过，最后修复后未再付费复采。'],
    ['verified-delivery-artifacts',[],'改动/验证/限制已归档，版本6.1.7无打包发布；实际气泡组件只读预览5396，三场景/320、390、430宽度含尾轮可达18项通过，不连接模型或音频。'],
  ],
};
const tasks=progress.tasks.map(task=>({...task,criteria:task.criteria.map((criterion,index)=>{
  const [status,keys,assessment]=assessments[task.id][index];
  return {...criterion,status,evidence:keys.map(key=>evidence[key]),assessment};
})}));
if(tasks.flatMap(task=>task.criteria).length!==27)throw Error('Do not silently change the original task scope');
const byQuestion={T3:[1,4,43,44,45,46,47,48],T2:[3,6,9,10,36,53,54,55,56],T5:[2,5,8,11,12,13,14,15,16,17,25,26,27,28,29,30,31,34,35,37,42,49,50,51,52,58,60],T1:[7,18,19,20,21,22,23,24,32,33,38,39,40,41],T4:[57],T6:[59]};
const questions=[...plan.matchAll(/^\| Q(\d{2}) \|([^\n]+)$/gmu)].map(match=>{
  const id=Number(match[1]),task=Object.entries(byQuestion).find(([,ids])=>ids.includes(id))?.[0];
  if(!task)throw Error('Unmapped question '+id);
  return {id:'Q'+match[1],originalIndexRow:match[0],ownerTask:task,status:[22,23].includes(id)?'future-feature-not-enabled-per-final-plan':[2,4,7,8,13,14,15,16,17,49,50,59,60].includes(id)?'partially-observed-real-quality':'locally-verified-with-bounded-scope',evidence:tasks.find(item=>item.id===task).criteria.flatMap(item=>item.evidence)};
});
if(questions.length!==60)throw Error('All sixty original questions must stay visible');
const crossRisks=[
  {id:1,status:'verified-local',evidence:[evidence.sender,evidence.replies],assessment:'首句之后改/删源停止后缀，既有前缀不暗换，失效状态不能继续贡献。'},
  {id:2,status:'verified-local',evidence:[evidence.sender,evidence.recorded],assessment:'正常前缀+旁白/伪造经历后缀不泄露；未显后缀省略仍复核，不重置重试预算。'},
  {id:3,status:'verified-local',evidence:[evidence.voice],assessment:'两场同名考试→明确选择→改期→完成一场→下一语音比较，原生26项包含该组合；部分播放资格另有覆盖。'},
  {id:4,status:'verified-local-no-hardware',evidence:[evidence.proactive,evidence.voiceRecovery],assessment:'补发现语音初始化尚未占文字队列的窗口；原生通话busy/saving/finishing现在阻止并取消回访。用户输入和明确语音暂停仍优先；无真实耳机实验。'},
  {id:5,status:'verified-local',evidence:[evidence.voice,evidence.backup,evidence.sender,evidence.stock],assessment:'角色更名/同名同预设隔离、未知回执导入和巨量无关失效记录；仍不按名字合并，不清资料换速度。'},
];
const audit={at:new Date().toISOString(),objective:progress.objective,fullObjectiveAchieved:false,plan:{path:planPath,sha256:hash(planPath)},codingModel:'未确认',codingReasoning:'未确认',tasks,questions,crossRisks,evidence,
  realQualityAssessment:{light:'新稿当前偏好和假设比旧稿的最近习惯更可信；仍有展开偏长与不必要追问。',emotion:'后采合理大事配合与事实独立性更清楚；仍有无来源最近念头，最新本地修复后未复采；安慰有时带劝解。',continuity:'新稿记住改期/地铁、能暂停再恢复并结束；旧current第9轮错误归属保留原稿，已本地修复并有独立后采上下文。',wholeGroupSelection:'三组均为原始完整十轮；不把后采单轮或本地修复文本拼入旧组。'},
  preview:{...read(join(root,'preview/preview-evidence.json')),requiresLocalService:true,start:'node scripts/verify/chat-core-dialogue-preview.mjs'},
  outstanding:['最终两类自述及四轮之外说话人核验修复后的真实输出尚无新采样；既定API额度已用完，不能自行重置继续付费','人物差异和长期自然表达只在有限样本观察，不能宣称全场景或长期真人化达标'],
  conditionalUnverified:['Android已装APK哈希/呈现帧/真实时延','耳机路由、锁屏前后台、真实音频和麦克风；遵守用户安静限制未尝试'],
  excludedClaims:['历史6.0.14/6.1.7整源消融','手机P95或所有网络下固定时延','所有模型人味均已达标'],appVersion:'6.1.7',versionChanged:false,published:false};
const path=join(root,'review/completion-requirements-20261022.json');writeFileSync(path,JSON.stringify(audit,null,2)+'\n');
progress.tasks=tasks;progress.currentCheckpoint.requirementAudit=path;progress.currentCheckpoint.fullObjectiveAchieved=false;progress.currentCheckpoint.implementation.T1='native33: includes call-initialization cancellation';progress.currentCheckpoint.implementation.T2='native sender51 includes attribution beyond last four style replies; latest expression3854/types0';progress.currentCheckpoint.implementation.T4='voice26: includes two same-name exams changed/completed and next voice query, rename and same-preset isolation';progress.currentCheckpoint.preview={url:audit.preview.url,evidence:join(root,'preview/preview-evidence.json'),checks:18,requiresLocalService:true,modelCalls:0,microphoneUsed:false};
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const note='\n\n### 五项交叉风险与27条件逐项审查补充\n- 新补同名两场考试→选原场次→改期→完成一场→下一语音询问的组合，原生26项通过；同实例更名后仍保留确切事项，另一个同名同预设实例不继承。\n- 新复现回访与语音初始化的窗口：通话busy已置位但尚未占文字队列时，旧开场可能发布。两项先失败；现在复用真实通话busy/saving/finishing阻止并取消回访，33项通过，没有启动实际麦克风、TTS或声音。\n- 网关首跑旧辅助夹具缺完整history，按现行合同应被拒绝；保留失败稿，改用合法历史并补400且零上游调用断言。网关流式全部通过，星域19项通过。表达3854与类型检查退出0。\n- 27条件、60问、五项交叉风险逐项结果：'+path+'。这些状态有本地、真实材料、部分真实质量和条件硬件未验证的区别；不把所有项统一涂绿，整体目标仍在收尾。既定API额度0剩余，不追加调用；模型与用量沿前节，编码模型/强度未确认。\n';
const mobileLog='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-22.md';
if(!readFileSync(mobileLog,'utf8').includes(note.trim()))appendFileSync(mobileLog,note,'utf8');
appendFileSync(join(root,'progress.md'),'\nCross-risk audit: voice26 now covers two same-name exams selected/changed/completed and next voice query, rename and same-preset isolation. New Important native repro: voice initializing before its queue reservation allowed return opener; source now observes actual call busy/saving/finishing and cancels/blocks opener, RED33(2fail)→GREEN33. No hardware/audio. Gateway obsolete missing-history fixture corrected with explicit400/zero-upstream assertion; gateway and world19 pass. Requirement audit: '+path+'. Full objective remains incomplete; final delivery/preview and real-quality limits are explicitly retained.\n','utf8');
console.log(JSON.stringify({path,taskCriteria:27,questions:questions.length,crossRisks:crossRisks.length,fullObjectiveAchieved:false,outstanding:audit.outstanding},null,2));
