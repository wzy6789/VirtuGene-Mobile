import {readFileSync,writeFileSync,copyFileSync,appendFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='release/chat-daily-style-20261019';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const latest=(dir,prefix)=>dir+'/'+readdirSync(dir).filter(name=>name.startsWith(prefix)&&/^\d+\.json$/u.test(name.slice(prefix.length))).sort().at(-1);
const acceptedPath=root+'/checks-1792398800719.json',beforePath=root+'/before-1792398843516.json',stockPath=root+'/stock-1792398947163.json';
const after=read(acceptedPath),before=read(beforePath),stock=read(stockPath);
if(!after.complete||after.checks.length!==262||before.failures.length!==59||!after.stableSources||!before.stableSources||!same(after.sourceHashesAfter,before.sourceHashesAfter))throw Error('Require final source-stable262 /59-failure RED→GREEN');
const file='src/lib/chat-expression-guidance.ts';
for(const [path,testedHash]of Object.entries(after.sourceHashesAfter))if(hash(path)!==testedHash)throw Error('Changed tested dependency: '+path);
const parity=after.rows.map((row,index)=>{
 const old=before.rows[index];
 return {character:row.name,input:row.input,originalMessages:same(row.originals,old.originals),persona:row.personaHash===old.personaHash,pendingItem:same(row.threadBefore,old.threadBefore),wireHistory:same(row.mainRequests[0].messages.slice(1),old.mainRequests[0].messages.slice(1)),parameters:same(Object.fromEntries(Object.entries(row.mainRequests[0]).filter(([key])=>key!=='messages')),Object.fromEntries(Object.entries(old.mainRequests[0]).filter(([key])=>key!=='messages')))};
});
if(parity.length!==24||parity.some(row=>Object.entries(row).some(([key,value])=>!['character','input'].includes(key)&&value!==true)))throw Error('Before/current facts or parameters differ');
const sequenceParity=after.sequence.map((row,index)=>({input:row.input,wireHistory:same(row.mainRequests[0].messages.slice(1),before.sequence[index].mainRequests[0].messages.slice(1)),businessTopics:same(row.conversation.topics,before.sequence[index].conversation.topics)}));
if(sequenceParity.length!==5||sequenceParity.some(row=>!row.wireHistory||!row.businessTopics))throw Error('Gu continuous dialogue parity failed');
if(!stock.complete||!stock.stableSources||!same(stock.sourceHashesAfter,after.sourceHashesAfter))throw Error('Stock is not bound to the final source');
const ordinary=stock.phases.slice(0,2);
if(!ordinary.every(phase=>phase.samples.every(sample=>sample.messagesSha256===ordinary[0].samples[0].messagesSha256&&sample.fixtureSha256===stock.fixture.nativeSha256)))throw Error('Stock/native inputs differ');
const bodyTotals=phase=>phase.samples.map(sample=>Object.values(sample.reads).reduce((sum,row)=>sum+row.bodies,0));
if(!same(bodyTotals(ordinary[0]),bodyTotals(ordinary[1])))throw Error('Ordinary native read cost changed');
copyFileSync(file,root+'/accepted-expression-guidance.ts');
const diff=spawnSync('git',['-c','core.autocrlf=false','diff','--no-index','--ignore-cr-at-eol','--',root+'/before/'+file,file],{encoding:'utf8'});
if(diff.status!==1)throw Error(diff.stderr||'Missing scoped production patch');
writeFileSync(root+'/production.patch',diff.stdout);
const tracePath='release/chat-continuity-trace-2026-10-19T08-33-59-102Z/baseline.json',auditPath='release/chat-continuity-plan-audit-20261019/audit-1792398904001.json';
const trace=read(tracePath),audit=read(auditPath);
if(!trace.complete||trace.rows.length!==24||trace.rows.reduce((sum,row)=>sum+row.turns.length,0)!==172||!audit.complete||audit.checks.length!==66||audit.input!==tracePath)throw Error('Final original trace/audit incomplete');
const expressionLog=readFileSync(root+'/expression-final.log','utf16le');
if(!expressionLog.includes('PASS chat-expression: 3854 checks'))throw Error('Expression regression not complete');
const params=Object.fromEntries(Object.entries(after.rows[0].mainRequests[0]).filter(([key])=>key!=='messages'));
const previewAttempts=readdirSync('release').filter(name=>/^chat-continuity-mobile-179239(?:8696333|8905381)$/u.test(name)).map(name=>{
 const path='release/'+name+'/report.json';try{const report=read(path);return {path,sha256:hash(path),complete:report.complete,checks:report.checks.length,errors:report.errors,video:report.video??null};}catch{return {path,complete:false,status:'pending; no passing claim'};}
});
const previewRunPath='release/chat-continuity-mobile-1792398905381/report.json',previewFramesPath='release/chat-continuity-mobile-1792398905381/decoded-frames.json';
const previewRun=read(previewRunPath),previewFrames=read(previewFramesPath);
if(!previewRun.complete||previewRun.checks.length!==30||!previewFrames.decodedFramesVerified||!previewFrames.visualContentsVerified)throw Error('Final actual styled preview/decoded visual audit incomplete');
for(const source of previewRun.sources)if(hash(source.path)!==source.sha256)throw Error('Preview source changed: '+source.path);
const report={date:'2026-10-19',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',fullPlanComplete:false,
 scope:'Original T4/T7 scoped current emotion and ordinary/request routing, primarily actual current Gu Yue Na with Tang Wulin identity; Lu Xue Qi is the second-role control. Native database and production sender, synthetic data and local transport only.',
 production:[{path:file,sha256:hash(file),beforeSnapshot:root+'/before/'+file,beforeSha256:hash(root+'/before/'+file),acceptedSnapshot:root+'/accepted-expression-guidance.ts'}],
 verificationFiles:['scripts/verify/chat-daily-style.ts','scripts/verify/chat-daily-style.mjs','scripts/verify/chat-daily-style-report.mjs','scripts/verify/chat-continuity-resume-performance.mjs'].map(path=>({path,sha256:hash(path)})),
 patch:{path:root+'/production.patch',sha256:hash(root+'/production.patch'),note:'Frozen pre-phase file; CR at EOL ignored only for readable diff. Original snapshots preserved. Not a historical APK comparison.'},
 changes:[
  'Fold explicit recovery by feeling scope. Named recovery leaves independent joy/distress/fatigue intact, later renewed feelings remain, and explicit mood improvement preserves physical fatigue. Fatigue synonyms recover together.',
  'Recognize courtesy plus detailed/precise direct requests after existing quote, hypothetical and negation checks. The lexical obstacle/courtesy word 麻烦 no longer asserts annoyance.',
  'Only temporary expression clues change. User originals, character text, business-state topics, pending sources and existing voice/runtime decisions stay intact. No new model judge, retrieval, permissions, storage schema or generation request.'
 ],
 tests:{accepted:{path:acceptedPath,checks:262,sha256:hash(acceptedPath)},frozenBefore:{path:beforePath,checks:262,failures:59,sha256:hash(beforePath)},parity,sequenceParity,
  nativeMainRequests:29,nativeDescription:'12 current-persona requests each for Gu/Lu, plus uninterrupted five-turn Gu recovery→new topic→joy→specific request sequence. Every generated reply is the literal local stub 嗯。 and is NOT a naturalness result.',
  failuresPreserved:readdirSync(root).filter(name=>/^(?:checks|before)-\d+\.json$/u.test(name)).map(name=>{const path=root+'/'+name,data=read(path);return {path,complete:!!data.complete,checks:data.checks?.length??0,failures:data.failures?.length??null,error:data.error??null};}),
  fixtureCorrections:['Initial raw legacy Gu preset was not the current adopted app persona; fixtures now use the real current preset migration and explicit owner.',
   'createMany returns a count, not the passed ID: added positive existence/source assertions and real indexed row lookup before comparing pending state.',
   'Uninterrupted sequence facts live in real wire history; the positive assertion checks full actual messages, not only system text. No production fix was made for that fixture error.'],
  expression:{path:root+'/expression-final.log',checks:3854,passed:true},originalTrace:{path:tracePath,trajectories:24,turns:172,sha256:hash(tracePath)},originalAudit:{path:auditPath,checks:66,sha256:hash(auditPath)},
  types:{command:'tsc --noEmit',exitCode:0,log:root+'/types-final.log'},diffCheck:{command:'git diff --check -- scoped changed files',exitCode:0}
 },
 performance:{path:stockPath,sha256:hash(stockPath),checks:22,fixture:stock.fixture,summary:stock.summary,ordinaryBodyTotals:ordinary.map(phase=>({phase:phase.phase,bodies:bodyTotals(phase)})),
  note:'Same native stock and ordinary full model messages:513 messages,50001 threads including50000 irrelevant closed,8105 withdrawals,40 private synthetic diaries. Three samples each; ordinary median first-request preparation48.5→58.2ms, a9.7ms noisy increase, NOT a speedup or phone result. Body reads unchanged; no new query/auth scan. Resume preparation87.3ms is a separate input, never subtracted from ordinary samples. Earlier runs including source-changing runs retained as diagnostics only.'},
 review:{type:'One independent fresh-context whole-plan closing review, read-only',agent:'/root/continuity_final_review',remainingCritical:0,remainingImportant:0,foundAndFixed:'Mood improvement cleared independent fatigue and fatigue synonyms did not recover together. Independent reviewer reran five counterexamples after262 GREEN.',models:'Reviewer coding model/reasoning未确认',limits:'Spot review plus reports, not full semantic/model naturalness certification.'},
 preview:{attempts:previewAttempts,latestAccepted:{path:previewRunPath,sha256:hash(previewRunPath),checks:30,widths:[320,360,390,414],fontSizes:[16,22]},decodedFrames:{path:previewFramesPath,sha256:hash(previewFramesPath),mediaTimes:previewFrames.frames.map(frame=>frame.mediaTime),visualContentsVerified:true,duration:previewFrames.duration},
  service:{url:previewRun.url,requiresService:true,start:'node scripts/verify/chat-continuity-mobile-preview.mjs --serve',liveProcessSession:17594,stop:'Ctrl+C in the exact preview process; no unrelated process termination.',boundaries:'Actual current ChatWindow/styles/native isolated synthetic database, external requests and microphone/audio blocked, mock model replies only.'},
  previousAccepted:'docs/CHAT-CONTINUITY-MOBILE-PREVIEW-2026-10-19.json',beforeAfterComparison:false,note:'Fresh retry passed30checks after initial cold-start load timeout. Initial failure and two incorrect wall-clock-derived frame selections retained; final decoded frames42.24/42.52s visually audited as input before send and visible reply.0.28s is a selected frame interval, not latency. No same-condition pre-fix/post-fix comparison or Android recording.'},
 model:{observedLocalRequest:params,upstreamReturnedModel:null,paidRequests:0,inputTokens:0,outputTokens:0,costUSD:0,meaning:'Params captured from actual app request but sent only to stub. No upstream model identity/quality/usage claim. Coding-agent token usage is未确认.'},
 limitations:['No true model dialogue or human personality/naturalness scoring this phase; original paid8-call research not executed.',
  'Finite explicit Chinese rules are clues, not universal emotion/intent understanding. General semantic correction remains bounded by existing supported cases.',
  'The Gu five-turn sample uses synthetic originals and canned stub replies; never publish it in Obsidian聊天验收 as model output.',
  'No real private content/credential scan, microphone/audio, Android test, app version/schema change, app build, APK, installation or publish.',
  'Codex sidebar project ownership was not officially confirmed; no internal configuration/database was edited.'],
 next:'Keep original scope. Genuine generation and whole-trajectory human assessment remain the quality gate; do not add more unrelated optimization directions or treat local pass counts as full-plan completion.'
};
const path='docs/CHAT-DAILY-STYLE-2026-10-19.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const progressPath='docs/CHAT-CONTINUITY-PLAN-PROGRESS-2026-10-18.json',progress=read(progressPath);
for(const id of ['T4','T7','T8']){const task=progress.tasks.find(row=>row.id===id);task.evidence=[...new Set([...(task.evidence??[]),path])];}
const t7=progress.tasks.find(row=>row.id==='T7');t7.status='local-routing-verified-genuine-dialogue-unverified';t7.remaining='Native Gu/Lu frozen-fact/parameter29 sends and Gu uninterrupted five-turn recovery verified; no true model generations, whole-trajectory naturalness or human character scoring. Local rules do not certify persona quality.';
progress.finalReadOnlyReview={agent:'/root/continuity_final_review',remainingCritical:0,remainingImportant:0,evidence:path,scope:'Original local implementation and spot native/source/backup evidence; not genuine model/personality certification.'};
progress.tasks.find(row=>row.id==='T8').remaining='Fresh actual styled Gu ChatWindow30 checks at320/360/390/414 and16/22px fonts plus decoded before-send/reply frames verified. Original source/branch native reports and24/172 trace remain evidence; genuine model/human whole-dialogue naturalness still unverified. Android optional, not a completion gate.';
progress.next=report.next;progress.fullPlanComplete=false;writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
const appendOnce=(target,marker,body)=>{if(!readFileSync(target,'utf8').includes(marker))appendFileSync(target,body);};
appendOnce('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md','### 原方案T4／T7：古月娜情绪范围与礼貌请求收尾',
 '\n### 原方案T4／T7：古月娜情绪范围与礼貌请求收尾\n'+
 '- 工作目录F:/VirtuGene-Mobile；编码模型／推理强度未确认。生产只改src/lib/chat-expression-guidance.ts；新增chat-daily-style本地验证与报告，存量性能脚本加--daily-style冻结单文件对照。原文／当前人格／事实和参数24组逐一hash及五轮连续古月娜轨迹见项目'+path+'，原始失败稿和生产差异在release/chat-daily-style-20261019。\n'+
 '- 修复明确“好多了”后旧难过仍作当前线索、指定不累时误删独立开心／委屈、心情好转误删身体疲惫、累与疲惫同范围恢复、礼貌具体请求被当分享以及麻烦子串误判烦躁。只改本轮表达线索，不关闭业务事项、不改原文和角色设定、不新增检索或模型评委。保留古月娜／陆雪琪历史不同策略，未统一压成极短回复。\n'+
 '- 同一最终262检查：冻结原版59失败→当前262通过；真实发送29次均本地“嗯。”替身，24次为两角色各12输入，另古月娜连续5轮。原有24组172轮轨迹审计66、表达3854、类型退出0、差异检查退出0。此前原始预设所有权与createMany返回值导致测试夹具失败，已纠正并增加真实落库正断言，不将测试错误写成产品缺陷。\n'+
 '- 存量513消息／50001事项／8105失效记录／40私密合成日记，普通完整messages与原生fixture相同、读取正文数相同。三次中位请求前准备48.5→58.2ms，噪声下增9.7ms，不宣称提速／手机结果；单独恢复输入87.3ms，不能混分母相减。22项成本检查通过。\n'+
 '- 一次独立只读收尾复查发现并协助关闭心情／疲惫范围反例，5个反例独立复核通过；未发现余留Critical／Important本地阻断。不外推全语义理解或真实人味。\n'+
 '- 捕获请求'+JSON.stringify(params)+'；只有本地替身，上游返回模型未确认。本阶段0付费调用／0输入输出token／0费用，编码用量未确认。不将替身原话放入聊天验收。\n'+
 '- 新隔离预览首启load超时，失败原稿保留；重试状态及历史已通过30项预览均单独列入JSON，不将旧截图冒充新验证。无同条件前后截图／Android录屏。真实生成、完整轨迹人物辨识度与人工评分仍未验证，整个方案未达标。没有私人资料／凭据搜索、麦克风／音频、升版、打包、安装或发布；Codex侧栏归属仍未官方确认。\n');
appendOnce('D:/月起云归/VirtuGene/手机版/00-总览.md','原方案古月娜日常262',
 '\n- 2026-10-19 原方案古月娜日常262：情绪恢复按范围保留独立感受，礼貌请求不再误作烦躁；冻结原版59失败→262通过，29次正式发送为本地替身。原有24轨迹172轮审计66、表达3854通过；零付费，未验证真实人物自然度。见[[手机版/开发日志/2026-10-19|当日开发日志]]及项目docs/CHAT-DAILY-STYLE-2026-10-19.json，未升版／打包／发布。\n');
appendOnce('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-19.md','### 原方案T8：本阶段实际古月娜组件预览收尾',
 '\n### 原方案T8：本阶段实际古月娜组件预览收尾\n'+
 '- 本地服务http://127.0.0.1:5198/.tmp-preview/continuity-mobile/index.html?virtugene-preview=mobile；需保持本次预览进程运行，重启用node scripts/verify/chat-continuity-mobile-preview.mjs --serve，Ctrl+C只停止该预览。实际ChatWindow、现有CSS和正式发送／落库，隔离合成资料、本地模拟回复、屏蔽外网／麦克风／音频。未另造假聊天截图。\n'+
 '- 首次冷启动load超过60秒，保留release/chat-continuity-mobile-1792398696333/report.json失败记录；同脚本顺序重试1792398905381通过30项，320／360／390／414宽及16／22px字体、长输入／长回复／收起高度均核。属桌面手机视口，非Android键盘。\n'+
 '- 47.24秒录屏含冷启动过程。初按墙钟抽取的两帧已是回复后／字号改变，另一次还在加载，均记录不当作发送前；最终requestVideoFrameCallback核mediaTime42.24／42.52，人工查看真实解码PNG：前者古月娜已载入、考试消息仍在输入框，后者用户行和两条模拟回复可见。0.28秒只是选择的帧间隔，不是发送／模型／手机耗时。见'+path+'的preview和原始decoded-frames.json。\n'+
 '- 没有本次修复前后同条件对照截图，也未做真实模型／人味评分。原报告的失败与未测项继续保留，不将阶段收尾标为完整目标达标。\n');
console.log(JSON.stringify({path,checks:262,frozenBeforeFailures:59,nativeRequests:29,stockChecks:22,fullPlanComplete:false,paidCalls:0}));
