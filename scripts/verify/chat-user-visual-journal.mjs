import {readFileSync,appendFileSync} from 'node:fs';

const root='D:/月起云归/VirtuGene/手机版';
const evidence='docs/GUYUENA-LIVE-FAMILIARITY-KNOWLEDGE-TRANSFER-R2-2026-10-10.json';
const report=JSON.parse(readFileSync(evidence,'utf8'));
if(!report.complete||report.usage.calls!==1||report.usage.total!==2707)throw Error('Unexpected evidence or usage; inspect before journalling');
const streamLog=readFileSync('release/chat-stream-user-visual-final-2026-10-10.log','utf16le');
if(!streamLog.includes('PASS chat-stream: 149 checks'))throw Error('Stream checks have not completed');
const marker='### 无图感官证据与两稿安全保留（古月娜、陆雪琪）';
const log=root+'/开发日志/2026-10-10.md';
if(readFileSync(log,'utf8').includes(marker))throw Error('Already journalled');
appendFileSync(log,`\n\n${marker}\n\n用户再次明确陆雪琪必须包含；两角色继续分别保留人设，不把古月娜的关系、称呼或原著偏好复制给陆雪琪。生产共用无图感官检查，两角色实际发送/IndexedDB回归都覆盖。\n\n新增chat-user-visual-risk：检查明确完成的看见、检查用户画面的声明；无附图时“我看看像不像……行吧，算你有想象”不能冒充视觉判定。“我看看”请求、文字阅读、看法、引用、假设与正常联想保留。hasUserImageEvidence沿现有有效图片、历史图片裁剪与请求窗口判断，不因forceVision布尔值就认定有图；有图只是允许视觉请求，并不证明模型描述的每个细节正确。私聊调用前后共用质量检查，并对尚未上屏的两次失败稿剔除完整无来源句；主动/群聊共用入口默认不假定有图。源记录不是模型旧自述。\n\n真实回放工具现在能恢复前两轮实际已保存消息及会话注意力，再只回放指定旧稿；隔离数据库、合成时间，不声称原会话时间完全复现。R2恢复2轮8消息、免费回放原第三轮稿，仅花1次DeepSeek Flash修正。结果未达标：“那朵猫我现在没看到，你拍下来没有？”后又写“其实我刚才也看了一眼窗外的云，没想到像猫，光顾着看它跑得快不快了。”这份报告保留的是当时确实落库的失败，不能事后改成成功。\n\n随后扩展既有当前活动检查，覆盖明确刚才/现在看窗外、天空等自己的活动；用户自己看云不是角色也看过的证据，人设明确当前场景或用户直接描述角色行动仍可支持。再修两稿选择：较低风险分数的稿若会被来源过滤删空，不能压过另一稿里独立可保留的回应；优先有可用内容再比较风险分数，最终仍通过各来源过滤。已上屏/取消的流式不隐藏改写，重试预算仍1次，不加第三次调用，不补罐头回应。\n\n本地表达1726检查通过，类型检查通过。流式真实发送替身回归覆盖两角色无图判定、修正、两稿全假失败、实际图片转发，以及第一稿全假、第二稿独立回应加假窗外活动的选择。最终流式检查数见release/chat-stream-user-visual-final-2026-10-10.log；之前147检查见chat-stream-user-visual-2026-10-10.log。表达证据release/expression-user-visual-final-2026-10-10.log。模型边界为替身，不算陆雪琪真实模型或Android验收。\n\n本轮真实付费仅1请求，input2598/output109/total2707，usage完整，stop，输出上限500（含推理）。证据${evidence}、release/guyuena-user-visual-repair-real-2026-10-10.log。Gu独立修正累计由2请求4988变为3请求7695tokens；连续累计仍482展示、84回放、400付费、1317420tokens，不混入独立修正。本轮未新增Lu付费调用。凭据只在授权进程内存中读取，不写日志、不输出。\n\n限制：感官检查与当前活动检查仍是有限语义模式，未封闭所有隐含颜色细节、过去亲历外推或性格辨识度；真实R2在后续检查扩展前失败，本轮没有再花额度证明扩展后的新模型修正一定成功。本地通过不能判定人味达标。保持6.0.13，不打包、不发布、不更新官网，电脑版日志不动。\n`);
let dialogue='\n\n### 无图回放修正 R2：保留失败（2707 tokens）\n\n恢复前2轮实际消息，共8条；时间为隔离测试合成值。原稿免费回放，只有修正付费。后续本地规则已拦住第二条无来源窗外活动，但这里如实保存当时送达文本。\n';
for(const row of report.rows){dialogue+=`\n**chatgpt**：${row.input}\n`;for(const reply of row.replies)dialogue+=`\n**古月娜**：${reply}\n`;}
appendFileSync(root+'/聊天验收/古月娜-2026-10-10.md',dialogue);
appendFileSync(root+'/00-总览.md','\n- 10月10日无图感官检查与两稿安全保留：古月娜、陆雪琪均纳入发送回归，1726表达与类型检查通过；真实Gu修正1次2707tokens仍有虚构窗外活动，保留失败，随后补本地检查。不宣称人味达标。见[[开发日志/2026-10-10]]。\n');
console.log('Appended mobile development evidence and failed real dialogue');
