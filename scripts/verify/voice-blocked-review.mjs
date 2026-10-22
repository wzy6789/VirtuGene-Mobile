import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='.tmp-preview/voice-final-acceptance-20261015';
const base=JSON.parse(readFileSync(dir+'/audit.json','utf8'));
const changed=base.hashes.filter(row=>createHash('sha256').update(readFileSync(row.path)).digest('hex')!==row.sha256).map(row=>row.path);
const path=dir+'/blocked-reviews.json';
const reviews=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):[];
if(!reviews.length){const first=JSON.parse(readFileSync(dir+'/evidence-check.json','utf8'));reviews.push({turn:1,checkedAt:first.checkedAt,changed:first.changedSinceAcceptance,blocker:'No authorized real provider/phone evidence for real-call response goal.'});}
const next={turn:reviews.length+1,checkedAt:new Date().toISOString(),changed,blocker:'No authorized real provider/phone evidence for real-call response goal.',model:'GPT-6',reasoningEffort:'未确认',apiCalls:0,apkBuilt:false,published:false};
reviews.push(next);writeFileSync(path,JSON.stringify(reviews,null,2));
appendFileSync('D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md',`\n- 语音目标同一验收限制第${next.turn}个连续续轮复核：当前目标相关文件hash变动${JSON.stringify(changed)}；用户未新增真实/付费测试授权，缺真实服务及物理首声证据。未重复模拟用例、未调用API、未改业务源码/版本、未打包发布；GPT-6，推理强度未确认，工作目录F:/VirtuGene-Mobile。证据${path}。${next.turn<3?'连续三轮阈值未满足，目标暂保持active。':'是否blocked仍须由当前轮确认无安全可用实质进展后决定。'}\n`);
console.log(JSON.stringify({latest:next,eligibleConsecutiveTurns:changed.length?0:reviews.length,evidence:path,goalAchieved:false}));
