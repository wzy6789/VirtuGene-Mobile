import {readFileSync,appendFileSync} from 'node:fs';

const root='D:/月起云归/VirtuGene/手机版';
const names=['GUYUENA-LIVE-ORDINARY-DISCOVERY-TRANSFER-R1-2026-10-10.json','LUXUEQI-LIVE-ORDINARY-DISCOVERY-TRANSFER-R1-2026-10-10.json','GUYUENA-LIVE-ORDINARY-DISCOVERY-TRANSFER-R2-2026-10-10.json'];
const reports=names.map(name=>({name,data:JSON.parse(readFileSync('docs/'+name,'utf8'))}));
const marker='## 新日常分享与童年自述来源：保留失败及一次修正';
const log=root+'/开发日志/2026-10-10.md';
if(readFileSync(log,'utf8').includes(marker))throw Error('Evidence batch already journalled');
if(reports.some(({data})=>!data.complete||data.usage.missingUsage||data.providerCalls.some(call=>call.finish!=='stop')))throw Error('Incomplete evidence');
const totals=reports.reduce((s,{data})=>({calls:s.calls+data.usage.calls,input:s.input+data.usage.input,output:s.output+data.usage.output,total:s.total+data.usage.total}),{calls:0,input:0,output:0,total:0});
const entries=reports.map(({name,data:r})=>{
 const path=root+'/聊天验收/'+r.roleName+'-2026-10-10.md';
 const title='## 日常发现与童年来源 / '+name;
 if(readFileSync(path,'utf8').includes(title))throw Error('Dialogue already journalled');
 let entry='\n\n'+title+'\n\n范围：'+r.scope+'\n\n用量 '+JSON.stringify(r.usage)+'。原始证据 F:/VirtuGene-Mobile/docs/'+name+'。\n\n';
 for(const row of r.rows){
  entry+='chatgpt：'+row.input+'\n\n';
  if(r.draftSource)for(const call of row.calls.filter(c=>c.replayed))entry+=r.roleName+'（保存的失败草稿回放，未上屏、无新生成用量）：'+call.raw+'\n\n';
  for(const reply of row.replies)entry+=r.roleName+'：'+reply+'\n\n';
 }
 entry+='复核：这不是作品打分例题。古月娜首轮捏造自己的童年歌记忆并追问想起谁，澄清后仍说「这个我收到了」、自加站着听；观点带抒情和评价。陆雪琪较短，澄清却认领「是我多说了」，此前实际只是询问歌名，不足以证明她做了心理分析。她仍追加问好不好听。重试稿去掉童年自述，但仍推定站着听；「下次叫上我」是愿望，不是已发生或已同意的约定。不能认定全面自然、人物完全贴合或长期稳定。\n';
 return [path,entry];
});
const description=`\n\n${marker}\n\n上一轮用意接续修复、真实两角色对话和无效候选撤回为进展，本轮不是状态复述。新增ordinary-discovery-transfer三轮固定未用日常分享：听见童年歌曲、说明分享用途、讨论是否保存喜欢的东西。没有新增生产示例、关键词答案或原著事实。两角色实际生产发送/IndexedDB，古月娜主动倾向0.5、陆雪琪作者预设0.2；提供方非流式，摘要/提取/结算替身。工具统一transfer集合，固定三轮预算4/max_tokens500，没有升级或打包。\n\n初次两组完整：古月娜首轮「我记得小时候有些歌就是这样」无来源，是用户童年内容被借成角色经历；现有动作域检查没有覆盖。另有长篇解读、问想起何人、站在店门口等未提供细节。陆雪琪较短但澄清后说「是我多说了」，此前只问歌名，不能凭用户补充范围就认领已误解；仍追加好不好听。第三轮能各有观点，但不据此判人物辨识度达标。\n\n补chat-self-report-risk有限明确童年自述入口（我小时候/我记得小时候/我童年时等），不依赖「过」或旧物理动作词根；独立来源需支持整条具体内容，用户童年、例句、引述与负面指令不能作角色经历证据。当下喜好、用户经历、报告、假设、问句、未知自述保留。沿用episode类统一私聊/主动/群聊质检和未上屏整句剥离，不追加模型预算；词法与字面来源不是语义事实完备保证，时间表达域外、改写来源、否定自述以及额外站立细节仍有边界。未知不是证明事件没发生。\n\n表达新增25项后1675通过，独立习惯来源32通过，类型通过，工具语法通过。初次表达失败因测试使用「编一段」而现有创作路由只支持写/创作等入口；换成已支持的「写一段」验证现有豁免，不宣称修好「编」的自然表达边界。失败release/expression-childhood-source-2026-10-10.log及最终expression-childhood-source-final-2026-10-10.log保留。新增12项两角色实际发送/DB/流式检查，chat-stream共137通过：草稿不先闪现、一次重试、安全独立兴趣保留、两次全部不安全则诚实失败、已有独立来源不重试，证据release/chat-stream-childhood-source-2026-10-10.log。传输使用受控替身，不是真实上游流式验收；PowerShell原生命令警告导致退出码1，日志PASS和实际数据另核对。\n\n将保存的古月娜R1首轮失败草稿回放至当前生产检查器，只允许已有预算内真实修正，R2只一轮，非新首次生成、非固定人设对照。检查确实触发一付费修正，输出不再说童年听过，表达想听及下次邀约；仍说「站那儿」，不是事实全闭环。没有再次生成或额外模型评分。工具回放范围仅扩到已知新场景，原输入/角色/一调用/stop/完成来源仍核对，不接受任意素材。\n\n本轮模型用量${JSON.stringify(totals)}：7请求22178tokens，fresh六请求（古月娜7559/497/8056，陆雪琪11101/406/11507），独立修正一请求2479/136/2615；另有一保存草稿无费用回放。各usage完整且finish stop，无首次两组质检重试。凭据仅内存授权第二DeepSeek配置，工具终止finally关代理，未输出密钥。保留docs/${names.join('、docs/')}及release/guyuena-ordinary-discovery-real-2026-10-10.log、luxueqi-ordinary-discovery-real-2026-10-10.log、guyuena-childhood-repair-real-2026-10-10.log。所有成功与失败原话按chatgpt/角色分别追加Obsidian当天聊天验收。\n\n古月娜连续累计470展示轮、84回放、388付费请求，input1241791/output44985/total1286776；本日连续122请求328175tokens。独立修正累计2请求4988tokens，冻结14请求36286及其他独立验收另计，不把独立R2回放加到连续轮数。陆雪琪本轮增加3请求11507tokens，不混入古月娜。仍有动机猜测、风格性长篇、无依据的自责与部分细节编造，目标未完成；下一步优先处理澄清不等于自己说错以及轻松分享的对等回应，用不同情境而非重复例题。维持6.0.13，不打包、不发布，不改官网、电脑版日志。\n`;
for(const [path,entry] of entries)appendFileSync(path,entry);
appendFileSync(log,description);
appendFileSync(root+'/00-总览.md','\n\n- 10月10日新日常分享：两角色未用场景与明确童年自述来源检查；1675表达、137实际发送及类型通过。真实一次修正去掉无来源童年，长篇解读/无依据自责/其他细节仍开放。见[[开发日志/2026-10-10]]与当天角色聊天验收。\n');
console.log('Appended separate role dialogues, mobile evidence and index');
