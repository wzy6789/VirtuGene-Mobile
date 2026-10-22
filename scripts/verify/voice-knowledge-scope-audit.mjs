import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='.tmp-preview/voice-knowledge-scope-20261015';
const comparison=JSON.parse(readFileSync(dir+'/comparison.json','utf8'));
if(comparison.errors.length||!comparison.promptUnchanged)throw Error('Comparison not verified');
const files=['src/db/knowledge-repo.ts','scripts/verify/voice-knowledge-scope.mjs','scripts/verify/voice-knowledge-scope-check.ts'];
const audit={date:'2026-10-15',workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoning:'未确认',realApiCalls:0,modelTokens:0,apkBuilt:false,versionChanged:false,published:false,
 change:'listKnownBy uses the existing worldId+characterId index; all owner, minimum-level, stable sort and limit rules retained. No authorization cache or reduced context.',
 checks:['48 independent old-query oracle combinations per variant (account/default scope, all levels, limits 0/1/4/200, tied timestamps)',
 'fresh world transfer and knowledge revocation checks per variant', 'full prompt hashes equal on populated real IndexedDB', 'character-memory 415 passed','voice context 56 passed','tsc --noEmit exit 0'],
 summary:comparison.summary,scope:comparison.scope,
 evidence:dir+'/comparison.json',
 limitations:['Desktop results only; no actual ASR/LLM/TTS network, Android or physical sound.',
 'User declined paid tests; still no end-to-end proof of extremely fast real calls. Goal remains active.',
 'No same-condition before/after UI pictures for this data-only change.',
 'No official project move interface available; no internal Codex configuration altered.'],
 hashes:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))};
writeFileSync(dir+'/audit.json',JSON.stringify(audit,null,2));
if(process.argv.includes('--log')){
 const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md',heading='语音准备续验：角色认知按世界索引读取';
 if(!readFileSync(log,'utf8').includes('## '+heading))appendFileSync(log,`\n\n## ${heading}\n\n- 工作目录F:/VirtuGene-Mobile；可见编码模型GPT-6、推理强度未确认，编码实际用量未确认。遵守用户“不允许付费测试，继续本地验证”：产品API0/tokens0、无麦克风、未升版/打包/发布。\n- 发现knowledgeRepo.listKnownBy每查一个世界都会全读该角色各世界认知再过滤。改用现有[worldId+characterId]复合索引；账号、认知级别、learnedAt稳定排序、limit及缺省参数语义保留，不加数据库版本、不缓存授权。跨世界回忆仍逐世界检索并保留授权。\n- 同资料只切换knowledge-repo查询的前后隔离对照，另加入10000条同角色其他世界认知、包含外账号。准备读取58910→38910行，knowledge读取30062→10062；最终6次样本中位652.95→564.25ms（首次对照567.30→496.95ms，桌面调度有波动）。完整模型输入SHA-256一致，不能写成Android普遍时延或真实首声。\n- 增加每版48组旧查询oracle对照（指定/不指定账号、四级认知、limit0/1/4/200、时间并列），以及世界转移和撤权后的下一次fresh查询；全部通过。记忆415、通话context56、最终tsc通过。仅数据查询修改，无本轮前后UI截图/录屏。\n- 文件src/db/knowledge-repo.ts、scripts/verify/voice-knowledge-scope.mjs、voice-knowledge-scope-check.ts、voice-knowledge-scope-audit.mjs。证据F:/VirtuGene-Mobile/${dir}/audit.json、comparison.json、summary.json和before/knowledge-repo.ts；不回滚覆盖并行代码生成基线。\n- 限制：真实服务和Android物理首声/蓝牙听感仍未验，整体极快通话目标仍在进行。未重复请求已拒绝的付费调用许可；侧栏项目迁移缺少可确认官方接口，未改Codex内部状态。\n`);
 const index='D:/月起云归/VirtuGene/手机版/00-总览.md',entry='- [[手机版/开发日志/2026-10-15|语音准备续验 · 认知世界索引]]：减少跨世界认知重复扫描，完整模型输入一致；真实通话速度尚未验收。';
 if(!readFileSync(index,'utf8').includes(entry))appendFileSync(index,'\n'+entry+'\n');
}
console.log(JSON.stringify({evidence:dir+'/audit.json',summary:comparison.summary.map(({label,prepareMedianMs,rows,knowledgeRows})=>({label,prepareMedianMs,rows,knowledgeRows})),goalComplete:false}));
