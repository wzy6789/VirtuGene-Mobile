import fs from 'node:fs';
import crypto from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const scale=read('docs/CHAT-SPEED-SCALE-2026-10-14.json');
const current=read('docs/CHAT-SPEED-SCALE-2026-10-14-header-confirmed.json');
const partial=read('docs/CHAT-PARTIAL-INDEX-2026-10-14.json');
const upgrade=read('docs/CHAT-INDEX-UPGRADE-2026-10-14-final.json');
const indexChecks=read('docs/HISTORY-SEARCH-INDEX-CHECKS-2026-10-14-partial-v4.json');
if(![scale,current,partial,upgrade,indexChecks].every(r=>r.complete))throw Error('Incomplete evidence');
if(!fs.readFileSync('release/chat-speed-stream-2026-10-14-release-check.log','utf8').includes('PASS chat-stream: 268 checks'))throw Error('Incomplete stream regression');
const files=['src/db/index.ts','src/db/session-repo.ts','src/lib/chat-history-index.ts','src/lib/character-memory.ts','src/lib/chat/send-service.ts','src/lib/chat-quality-metrics.ts','src/components/settings/ChatQualityPanel.tsx'];
const comparisons=[1000,10000,50000].map(count=>{
 const select=(r,label)=>r.versions.find(v=>v.label===label).samples.find(s=>s.count===count&&s.text!=='你好');
 const old=select(scale,'6.0.14'),released=select(scale,'6.1.3'),fixed=select(current,'working-source');
 if(released.promptChars!==fixed.promptChars||released.historyChars!==fixed.historyChars)throw Error('Unexpected context reduction');
 return {count,oldPreparationMs:old.preparationMs,releasedPreparationMs:released.preparationMs,fixedPreparationMs:fixed.preparationMs,releasedFirstVisibleMs:released.firstVisibleMs,fixedFirstVisibleMs:fixed.firstVisibleMs,releasedSessionBodyReads:released.reads.sessions.bodyRows,fixedSessionBodyReads:fixed.reads.sessions.bodyRows,fixedMessageBodyReads:fixed.reads.messages.bodyRows,promptChars:fixed.promptChars,historyChars:fixed.historyChars};
});
const evidence=['docs/CHAT-SPEED-VERSIONS-2026-10-14-before.json','docs/CHAT-SPEED-VERSIONS-2026-10-14-confirmed.json','docs/CHAT-SPEED-SCALE-2026-10-14.json','docs/CHAT-SPEED-SCALE-2026-10-14-header-confirmed.json','docs/CHAT-PARTIAL-INDEX-2026-10-14.json','docs/CHAT-INDEX-UPGRADE-2026-10-14-final.json','docs/HISTORY-SEARCH-INDEX-CHECKS-2026-10-14-partial-v4.json'];
const report={date:'2026-10-14',workdir:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',version:read('package.json').version,newApkBuilt:false,published:false,paidModelCalls:0,realTokens:0,deviceConnected:false,model:'6.1.3 DeepSeek private-chat default thinking disabled retained; actual phone model/reasoning unknown',baseline:'6.0.14 source archive 2caa822; 6.1.3 source frozen at task start; no shared workspace rollback',comparisons,checks:{index:indexChecks.checks,memory:415,stream:268,summary:22,settingsUI:4,total:indexChecks.checks+415+268+22+4},files:files.map(path=>({path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),evidence,fixes:['Bounded top-K, stable primary-key ties, competitive upper-bound long-phrase verification.','Fresh scoped index-only ownership/type checks and final ownership revalidation; no cross-turn authorization cache.','Recent uncovered context projects only the loaded candidate provenance instead of copying the full history maps.','Backfill writes derived metadata only; unrelated audio/display updates do not rebuild postings.','One shared maintenance job; Dexie.ignoreTransaction prevents inheriting expired readonly transactions across idle yields.','Partial indexes merge existing candidates and exact missing originals immediately; no historical source is silently dropped.','Separate numeric first-answer and first-visible timings, without storing prompts/keys/reply content.'],limits:['CPU-throttled desktop Chrome, isolated real IndexedDB and simulated 100ms transport; not Android/provider latency or real output quality.','Single-pass synthetic samples, not statistical means. Heap includes fixture generation/retention and uncontrolled GC; not device or peak memory.','Header-confirmation full-coverage performance preceded the final partial branch, inactive in complete indexes. Final partial branch has separate real DB comparisons and regression coverage.','Short greetings are not uniformly faster than 6.0.14; fresh summary validation/common postings still scale with archive size.','No complete attribution of the actual OPPO 4-5 second delay. Existing reviewed-role quality gate and one-repair budget remain.','No same-condition phone before/after screenshots or recording. No APK build/publication this round.'],preview:{url:'http://127.0.0.1:4197/?virtugene-preview=mobile',pid:40076,start:'node scripts/verify/chat-speed-settings-preview.mjs --serve --current',scope:'Actual settings component; isolated account/DB, network/model/microphone blocked; requires local service'},failedRunsRetained:['Initial CLI --after fixture parsing corrected.','Closed-DB core instrumentation replaced with native put counter.','Partial-coverage regression exposed TransactionInactiveError; background transaction inheritance fixed and source/ranking/repaired-coverage checks passed.']};
const destination='docs/CHAT-SPEED-REFORM-2026-10-14-AUDIT.json';
if(fs.existsSync(destination))throw Error('Preserve existing audit');
fs.writeFileSync(destination,JSON.stringify(report,null,2));
const log=`
# 2026-10-14 手机版开发日志

## 6.0.14／6.1.3速度对照与索引升级修复

- 用户要求排查6.1.3仍慢并优化算法。目录F:/VirtuGene-Mobile；编码模型与推理强度未确认。6.0.14沿用2caa822归档，6.1.3源码冻结于本轮开始；未回滚共享工作区，未改版本／打包／发布。adb设备列表为空，未实测OPPO。真实模型调用0、tokens0；私聊默认关闭思考沿用6.1.3，手机实际模型／推理配置未确认。
- 改动文件：${files.join('、')}。数据库v38新增会话归属与类型复合索引，发送入口及已选中来源核验不再反复反序列化巨大摘要映射；仍在核验阶段末重新读取归属，无跨轮授权缓存。近期未覆盖上下文仅投影当前候选字段，不复制全历史字典。
- 精确二字候选有界top-K，不做全量排序。长词交集只当作分数上界，分批回查原文，只有严格不可能超过真实第K名才停止；密集重复、旧高分、并列时间主键排序与旧扫描逐条对照。音频／显示元数据更新不重建索引。
- 后台补建直接批量写派生索引，原文写入0；单个并发维护任务。发现从只读检索事务启动补建会继承事务，空闲后报TransactionInactiveError，旧错误处理会静默忽略；改为Dexie.ignoreTransaction隔离根事务，并验证前台检索后仍补齐。不能认定它是手机唯一原因。
- 部分索引立即生效，仅扫描缺失原文并合并评分，不要求重说或截断历史。5000条／90%覆盖：6.1.3读取5003条正文、291.4ms，当前503条、133.5ms，召回完全一致。旧数据补建5000条（控制空闲调度，不是用户总等待）7744.2→1936.2ms，原文重写5000→0。
- 完整覆盖、4倍CPU节流、模拟100ms传输：普通话题准备时间1千／1万／5万条，6.0.14为163／1052.9／5693.7ms，6.1.3为158.9／547.9／2776.7ms，当前149.3／319.2／1714.2ms。完整会话读取10→1次，当前消息正文33条。当前与6.1.3提示及历史字符数完全相同，不靠缩上下文。
- 如实限制：5万条问候准备6.0.14为654.2ms、6.1.3为974.7ms、当前756.7ms，并非全面快过旧版。新鲜摘要核验／高频索引键仍随规模增长。单次合成资料样本；堆采样含造数、保留夹具和非受控GC，不代表Android内存或峰值。完整覆盖性能确认先于最后部分覆盖分支（该分支在完整覆盖不进入）；部分覆盖另测实库正确性／读取行数／对照时间。
- 新增“首段正文／首次显示”数值统计，区分生成与整段审查、必要重试、上屏等待，不保存原文／密钥。实际SSE UI验证分段相加等于总时间；旧记录不补造。古月娜／陆雪琪完整草稿审查仍保留，未增加普通角色缓冲。
- 801项本地验收：92索引／迁移／部分覆盖／删改／回滚／归属／思考请求，415记忆，268实际发送及流式UI，22摘要来源索引，4设置UI。类型／renderer构建／空白检查通过。参数误作fixture、未开库core计数、事务失效的失败原稿均保留，修正后复跑通过。
- 证据总入口${destination}；原始JSON见其evidence，日志release/chat-speed-*-2026-10-14*.log、chat-partial-index-2026-10-14.log、chat-index-upgrade-2026-10-14-final.log。本地6.1.3 APK保持SHA256 cbb8c78a902d1b62523d250817e7bbab132d6d6d9335d3005db957fb627e1e9b，尚未包含今天改动。
- 实际组件隔离预览http://127.0.0.1:4197/?virtugene-preview=mobile（PID40076）；启动node scripts/verify/chat-speed-settings-preview.mjs --serve --current，需要本地服务，隔离账户／数据库，模型网络／麦克风阻断。无同条件手机前后截图／录屏，不作为手机速度证据。
- 未验证OPPO、真实网络／服务商排队、关闭思考的真实表达、设备升级与内存；实际4～5秒尚未全部归因。后续应读取真机分段统计定位。Codex项目归属无已确认官方移动接口，未改内部数据库、不建重复任务；未声称Library保存。
`;
fs.appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-14.md',log);
fs.appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- [[手机版/开发日志/2026-10-14|2026-10-14 · 6.0.14/6.1.3速度对照与索引升级修复]]：修复重复完整会话读取、候选排序／核验、补建重写与事务失效，部分覆盖立即参与召回；801项本地检查通过。1万条准备约1.05秒／0.55秒／当前0.32秒；未付费调用、未改版本／打包／发布，真机未验证，超长问候未全面快过旧版。\n');
console.log(JSON.stringify({audit:destination,checks:report.checks.total,version:report.version,newApkBuilt:false}));
