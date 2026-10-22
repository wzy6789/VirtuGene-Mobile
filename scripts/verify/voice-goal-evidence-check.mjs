import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='.tmp-preview/voice-final-acceptance-20261015';
const acceptance=JSON.parse(readFileSync(dir+'/audit.json','utf8'));
const changed=acceptance.hashes.filter(({path,sha256})=>createHash('sha256').update(readFileSync(path)).digest('hex')!==sha256).map(x=>x.path);
const report={checkedAt:new Date().toISOString(),workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoningEffort:'未确认',
 changedSinceAcceptance:changed,missing:acceptance.checks.filter(x=>x.status.startsWith('unverified')),
 userConstraint:'Paid service testing explicitly declined; no new authorization. Do not inspect private credentials to bypass this.',
 actualApiCalls:0,apkBuilt:false,published:false,goalAchieved:false,
 nextAction:changed.length?'Review changed source before reusing prior evidence.':'No new source changes or reproducible local blocker identified. Real provider and physical audio evidence required for actual-call acceptance; remain incomplete without performing disallowed tests.',
 blockedAudit:'First impasse-only continuation after the last completed code fix. Not eligible to mark blocked until the same impasse recurs for three consecutive goal turns.'};
writeFileSync(dir+'/evidence-check.json',JSON.stringify(report,null,2));
if(process.argv.includes('--log')){
 const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md',heading='语音目标证据限制复核';
 if(!readFileSync(log,'utf8').includes('## '+heading))appendFileSync(log,`\n\n## ${heading}\n\n- F:/VirtuGene-Mobile；GPT-6，推理强度未确认。当前接受文件hash对比变动：${JSON.stringify(changed)}。未发真实API，未读凭据绕过用户拒绝，未升版/打包/发布。\n- 当前目标要求的是实际通话反应极快，缺真实网络/ASR/回复/TTS及手机物理首声、蓝牙与长通话听感证据。上一轮本地通过不能证明这些；本轮没有新测得本地瓶颈，继续猜测改动无法提供真实验收。\n- 用户明确暂不允许付费测试；不重复索要，不把旧模拟或编译写成真实通话。此为修复后首次仅剩外部验收条件的续轮，目标保持未完成；未满足连续三轮同一阻塞条件，暂不标blocked。记录F:/VirtuGene-Mobile/${dir}/evidence-check.json。\n`);
}
console.log(JSON.stringify(report));
