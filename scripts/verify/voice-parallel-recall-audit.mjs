import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='.tmp-preview/voice-parallel-recall-20261015';
const comparison=JSON.parse(readFileSync(dir+'/comparison.json','utf8'));
const current=readFileSync('src/lib/character-memory.ts','utf8'),before=readFileSync(dir+'/before/character-memory.ts','utf8');
if(current!==before)throw Error('Source differs from experiment baseline; inspect parallel edits before claiming revert');
const audit={date:'2026-10-15',workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoning:'未确认',realApiCalls:0,appVersionChanged:false,apkBuilt:false,published:false,
 retainedProductionChange:false,result:'No speed benefit proven; trial removed with a minimal patch, and original source equality checked.',summary:comparison.summary,scope:comparison.scope,promptUnchanged:comparison.promptUnchanged,
 note:'Only one six-sample desktop comparison. Concurrent machine load may affect timings; this is not proof parallel reads are universally slower. Do not ship a change without observed benefit.',
 checks:{memory:415,context:56,typecheck:'exit 0'},
 sourceSha256:createHash('sha256').update(current).digest('hex'),
 remaining:'Real provider and phone end-to-end extremely fast calling remains unproven. Paid testing was declined. Goal remains active.'};
writeFileSync(dir+'/audit.json',JSON.stringify(audit,null,2));
if(process.argv.includes('--log')){
 const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md',heading='语音准备并发试验：未证明收益，未保留生产改动';
 if(!readFileSync(log,'utf8').includes('## '+heading))appendFileSync(log,`\n\n## ${heading}\n\n- F:/VirtuGene-Mobile；可见编码模型GPT-6、推理强度及本轮编码计费量未确认。付费/产品模型调用0，无麦克风，未升版/打包/发布。\n- 检查四个共享/结束场景/最近结束/进行中片段的独立召回，试用Promise.all并发；保留选取次序、篇幅和最终来源核验。一次同条件6样本对照完整模型输入hash一致、准备读取38910行及认知10062行均不变，但中位533.60→761.20ms，未证明收益。机器调度可能影响，不能据此断言并发普遍更慢。\n- 试验已用最小补丁撤销，src/lib/character-memory.ts与试验前冻结快照逐字相等，不回滚覆盖并行代码。保留独立可复现实验脚本voice-parallel-recall.mjs，试验候选仅在隔离bundle内生成，运行不改生产文件。记忆415、通话context56、类型检查通过。\n- 证据F:/VirtuGene-Mobile/${dir}/audit.json、comparison.json、before/character-memory.ts。本轮没有UI变更或前后UI图，不称为新增提速。真实服务、物理首声、Android/蓝牙与长通话仍未验；用户不允许付费测试，未再请求或调用。整体极快通话目标未完成。\n`);
 const index='D:/月起云归/VirtuGene/手机版/00-总览.md',entry='- [[手机版/开发日志/2026-10-15|语音准备并发试验]]：未证明收益，已撤销试验生产改动，原始对照保留。';
 if(!readFileSync(index,'utf8').includes(entry))appendFileSync(index,'\n'+entry+'\n');
}
console.log(JSON.stringify({evidence:dir+'/audit.json',retainedProductionChange:false,goalComplete:false}));
