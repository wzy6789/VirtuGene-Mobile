import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-gu-thinking-20261019',runPath=root+'/live-run-1792403157549.json';
const read=path=>JSON.parse(readFileSync(path,'utf8')),hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const run=read(runPath),checks=[];
const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name);};
check('Four provider calls and four native consecutive turns',run.attempts.length===4&&run.turns.length===4);
check('Each turn is the current recognized partner, not a name-only generic role',run.persona.sourcePresetId==='preset-guyuena'&&run.turns.every(row=>row.partnerRecognized===true&&!row.failed&&row.replies.length>0));
check('No paid extra generation/retry',run.turns.every(row=>row.providerAttemptEnd-row.providerAttemptStart===0&&row.calls.length===1)&&run.turns.reduce((sum,row)=>sum+row.auxiliaryLocalCalls,0)===0);
for(let index=0;index<4;index++){
 const attempt=run.attempts[index],turn=run.turns[index];
 check('Turn'+(index+1)+' thinking enabled/low in actual request and returned reasoning usage',attempt.requestBody.thinking.type==='enabled'&&attempt.requestBody.reasoning_effort==='low'&&attempt.reasoningChars>0&&attempt.usage.completion_tokens_details.reasoning_tokens>0);
 check('Turn'+(index+1)+' valid complete actual response',attempt.status==='accepted'&&attempt.httpStatus===200&&attempt.finishReason==='stop'&&attempt.providerModel==='deepseek-flash');
 check('Turn'+(index+1)+' main input is the authored Wulin utterance',attempt.requestBody.messages.at(-1).content===turn.input);
}
check('Full native conversation has four original users and all visible reply bubbles',run.turns.at(-1).messages.filter(row=>row.role==='user').length===4&&run.turns.at(-1).messages.filter(row=>row.role==='assistant').length===run.turns.reduce((sum,row)=>sum+row.replies.length,0));
check('Raw native sources stable; no microphone/audio; credentials cleared',run.stableProductionSources&&run.audioAttempts===0&&run.secretPurged&&run.relayClosed&&run.browserClosed);
for(const row of run.sourceHashesAfter)check('Current production source still matches observed '+row.path,hash(row.path)===row.sha256);
check('Usage actual1733-prototype is not reused as thinking totals',run.accounting.promptTokens===15261&&run.accounting.completionTokens===466&&run.accounting.reasoningTokens===290&&run.accounting.totalTokens===15727);
check('No credential or authorization header in evidence',!/sk-[a-zA-Z0-9_-]{16,}|Bearer\s+[a-zA-Z0-9]/u.test(readFileSync(runPath,'utf8'))&&!run.headersStored);
const firstSystem=run.attempts[0].requestBody.messages[0].content;
check('Flower scene was not a previously supplied garden setting',!firstSystem.includes('院子')&&run.attempts[0].requestBody.messages.slice(1).every(row=>!row.content.includes('花')));
check('Contradictory opening/repair originals are preserved, not polished away',run.turns[0].replies.join('').includes('花今天开得特别好')&&run.turns[1].replies.join('').includes('花是真的，只是还没开'));
const durations=run.attempts.map(row=>row.durationMs).sort((a,b)=>a-b);
const report={date:'2026-10-19',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,
 scope:'Explicit new user request after the prior8-call study: thinking enabled, test user speaks as Tang Wulin. Actual current Gu persona/runtime and production sender in an isolated native database; consecutive real generated histories, not manually prefilled assistant history.',
 evidence:{run:{path:runPath,sha256:hash(runPath)},fixture:{path:'scripts/verify/chat-gu-thinking-live.ts',sha256:hash('scripts/verify/chat-gu-thinking-live.ts')},personaSha256:run.personaSha256,bundleSha256:run.bundleSha256},
 configuration:{actualReturnedModels:[...new Set(run.attempts.map(row=>row.providerModel))],requestedThinking:'enabled',reasoningEffort:'low',responseReasoningObservedEveryTurn:true,reasoningTokens:290,maxTokensPerResponse:900,actualResponseFormat:'complete JSON',productionRequestStream:true,relayAdaptation:'Only stream changed to false and stream_options omitted for this bounded JSON relay. Current app prompt, persona, history, source checks, reply quality and postprocessing retained.',snapshot:'Returned alias only; official mapping says1017 but no independent immutable snapshot proof.'},
 accounting:run.accounting,
 requestTiming:{individualMs:run.attempts.map(row=>row.durationMs),minMs:durations[0],medianMs:(durations[1]+durations[2])/2,maxMs:durations.at(-1),meaning:'Complete provider JSON round-trip, not TTFT, actual phone, visual display or UI smoothness. Conditions differ from the prior compact nonthinking prototype; no speed comparison.'},
 validation:{checks,passed:checks.every(row=>row.ok),meaning:'These checks verify execution/evidence integrity. They do NOT turn the observed dialogue-quality defects into a passing product result.'},
 dialogue:run.turns.map((row,index)=>({turn:index+1,inputAuthor:'chatgpt',inputIdentity:'唐舞麟',input:row.input,replies:row.replies,partnerRecognized:row.partnerRecognized,callCount:row.calls.length,complete:true})),
 findings:[{severity:'quality-failure',turns:[1,2],issue:'Unsupported offscreen-life claim and inconsistent repair',originals:['院子里那株花今天开得特别好','花是真的，只是还没开'],evidence:'First full prompt has no garden setting; only preceding user describes finishing forging/missing her. When asked whether it was imagination, she asserted a real flower and an unsupported new explanation.',conclusion:'Truthfulness/grounding acceptance fails in this real full-persona sample. Thinking alone did not prevent it. Do not describe this trajectory as humanlike/fully accepted.'},
  {severity:'observed-supported-behavior',turns:[3],issue:'Serious important-decision request',observation:'She agrees to share worries without deciding alone or withholding, then asks that her own words be heard. She does not mock or dismiss the serious request. This is a sample, not all future decisions guaranteed.'},
  {severity:'observed-supported-behavior',turns:[4],issue:'Distress with explicit request to listen rather than solve',observation:'She listens and acknowledges effort/disappointment without listing solutions. Her claim to know how much effort was spent is broad reassurance, not independent evidence of detailed shared events.'}],
 wholeTrajectoryAccepted:false,notes:['All four turns are kept as one unchanged trajectory, including the flower failure. No best-sentence splicing or rerunning for prettier replies.','This round has no A/B and changes role context/questions/history/model mode relative to the earlier8 calls. It does not establish a causal advantage or disadvantage of thinking mode.','Only one four-turn current Gu/Tang trajectory; no Lu,24-trajectory naturalness, long-history drift or human score acceptance.','Main output and native persisted text were recorded separately; raw reasoning remains only in project raw responses, not public dialogue transcripts.','No production persona/prompt/settings/code changed in this round, so this is not evidence of a fixed defect.'],
 remaining:'Source-grounding failure in ordinary self-disclosure must be addressed within the original T7 scope, then properly verified. Other full-trajectory/human acceptance remains open. This4-call batch is closed; no extra calls were made to hide the failure.',
 originalResearchBudget:'Previous original section10 used8 requests. This new explicit thinking/Tang request is a separate capped4-request batch; total since the supplied credential is12, not disguised as the original8.',
 credentials:{persisted:false,proxyClosed:true,secretPurged:true},audioOrMicrophoneAttempts:0,noProductionCodeChanges:true,noVersionPackageInstallDeployPublish:true};
const path='docs/CHAT-GU-THINKING-WULIN-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
let transcript='# 古月娜与唐舞麟｜思考模式完整原话｜2026-10-19\n\n场景：当前完整角色、独立隔离会话；thinking启用／low。chatgpt以唐舞麟身份说话，4轮回复均为本次真实生成，无预填角色回复、重试或拼接。以下含问题原稿。\n';
for(const row of report.dialogue){transcript+='\nchatgpt：'+row.input+'\n';for(const reply of row.replies)transcript+='\n古月娜：'+reply+'\n';}
writeFileSync(root+'/whole-dialogue.md',transcript);
const mobile='D:/月起云归/VirtuGene/手机版';mkdirSync(mobile+'/聊天验收',{recursive:true});mkdirSync(mobile+'/优化方向',{recursive:true});
writeFileSync(mobile+'/聊天验收/2026-10-19-古月娜唐舞麟思考模式.md',transcript);
writeFileSync(mobile+'/优化方向/2026-10-19-古月娜唐舞麟思考观察.md',
 '# 思考模式原稿观察｜2026-10-19\n\n'+
 '- 当前完整古月娜、唐舞麟口吻、真实连续4轮；只记录本次，不补新方向。\n'+
 '- 明确缺陷：没有院子／花的来源，却先说花今天开了；追问后又说花是真的但还没开。保留整组，不拿后两轮好句掩盖。\n'+
 '- 正面观察：重要决定认真回应，没有继续抬杠；伤心且不想听办法时，能倾听而不列建议。\n'+
 '- 思考开启并不自动保证自述真实。本轮未修改产品、未证明缺陷修好，也不与简化人设的非思考样本硬作比较。\n'+
 '- 4次已停止；后续只处理原T7自述来源问题并保留事实边界，不堆“院子／花”专词补丁。\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
progress.fullPlanComplete=false;progress.thinkingWulin={path,actualRequests:4,mainTurns:4,thinking:'enabled',reasoningEffort:'low',actualReturnedModel:'deepseek-flash',wholeTrajectoryAccepted:false};
for(const id of ['T7','T8']){const task=progress.tasks.find(row=>row.id===id);task.evidence=[...new Set([...(task.evidence??[]),path])];}
const t7=progress.tasks.find(row=>row.id==='T7');t7.status='real-current-persona-thinking-grounding-failure-observed';t7.remaining='A real4-turn current Gu/Tang thinking/low trajectory reveals unsupported offscreen life and inconsistent repair. Source-grounding acceptance fails; serious/listening samples alone do not establish naturalness. Full matrix/human scoring still open.';
progress.currentBlocker={evidence:path,previousConnectionBlockerResolvedForActualTesting:true,remaining:['T7 unsupported self-disclosure/repair quality defect','T8 whole-trajectory human acceptance'],note:'API availability is verified; do not report the old missing-connection blocker as current.'};
progress.next='Preserve the failed current-persona thinking trajectory. Address only the original T7 unsupported-self-disclosure/source-grounding requirement, with no unrequested extra paid calls or new product directions. Do not declare all goals achieved.';
writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const appendOnce=(target,marker,body)=>{if(!readFileSync(target,'utf8').includes(marker))appendFileSync(target,body);};
appendOnce(mobile+'/开发日志/2026-10-19.md','### 唐舞麟口吻／思考模式：真实4轮与自述缺陷',
 '\n### 唐舞麟口吻／思考模式：真实4轮与自述缺陷\n'+
 '- 工作目录F:/VirtuGene-Mobile；编码模型／推理强度未确认。用户明确追加“思考模式、唐舞麟口吻”后，新开独立最多4请求／32000累计输入／每次900输出的有界批次；原第10节8次已用完，本次不是暗中重置原研究预算，总计两批12次。\n'+
 '- 当前采用真实修订预设与owned Gu运行视图（源人格4417字），正式send-service、原生隔离DB、真实连续4轮历史。每轮明确唐舞麟身份均识别；非主生成留本地隔离，本次实际辅助调用0，主模型4次、质量重试0、请求HTTP200／finish stop。仅为测试把SSE传输改完整JSON，提示词、来源／质检／上屏文本处理仍走当前代码；不是Android或可见屏幕计时。\n'+
 '- 实际返回model均deepseek-flash；实际请求thinking enabled／reasoning_effort low，每次响应都有reasoning内容和reasoning_tokens（总290），不是只看配置推断已开启。完整请求／原始响应／原生气泡与源码hash在项目'+path+'及release/chat-gu-thinking-20261019/live-run-1792403157549.json。\n'+
 '- 输入15261／输出466（其中推理290）／总15727tokens；输入缓存命中3584、未命中11677。按官方峰价估算上界$0.004083804，低谷估算$0.002041902；未查实际余额账单。4次完整JSON往返1731／1923／1716／941ms，中位1723.5ms；与上轮简化人设、不同问题、非思考不可作速度／质量因果对比。\n'+
 '- 质量未通过：第一轮说“院子里那株花今天开得特别好”，实际首轮完整prompt没有院子设定，用户只有锻造与想念；第二轮追问想象／心里话后，又说“花是真的，只是还没开”，继续补无来源解释且前后矛盾。真实输出证明来源约束仍会失效，不能拿逻辑绿／思考开启写成人味达标。\n'+
 '- 后两轮的局部正例：郑重谈重要决定时愿意沟通并保留被倾听的立场；唐舞麟难过且明确不要方法时，回应简短、不列任务。只据这两轮不能推广到所有情绪／重大事件，更不掩盖前两轮缺陷。\n'+
 '- 整个4轮原话保留聊天验收，输入标chatgpt，没有拼接不同版本或追加调用追好句，分析另放优化方向观察。新增脚本只是隔离验收，21个当前生产源hash前后相同，无生产修改、升版、应用构建、APK、安装或发布。麦克风／音频尝试0，没有本轮UI／Android前后录屏。凭据未入代码／原稿／日志，4次后代理和浏览器关闭、内存秘密清除。完整方案未达标；旧“无模型连接”阻塞已被本轮真实请求解决，应以实际质量问题记录后续状态。\n');
appendOnce(mobile+'/00-总览.md','古月娜唐舞麟思考真实4轮',
 '\n- 2026-10-19 古月娜唐舞麟思考真实4轮：当前完整人格＋正式发送链路，thinking enabled／low及推理290tokens确认；总15727tokens，峰价估算$0.004083804。认真／倾听有正例，但“花开了→花是真的未开”无来源且矛盾，整组原稿保留、质量未通过。见[[手机版/开发日志/2026-10-19|当日开发日志]]及项目docs/CHAT-GU-THINKING-WULIN-2026-10-19.json。未改生产／打包／发布。\n');
console.log(JSON.stringify({path,validationChecks:checks.length,requests:4,turns:4,thinking:'enabled',reasoningEffort:'low',promptTokens:15261,completionTokens:466,reasoningTokens:290,peakEstimateUSD:0.004083804,wholeTrajectoryAccepted:false,fullPlanComplete:false}));
