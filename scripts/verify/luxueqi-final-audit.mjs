import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const root = 'D:/月起云归/VirtuGene/手机版';
const files = [
  ...readdirSync('src/lib').filter(n=>n.startsWith('lu-xue-qi')).map(n=>'src/lib/'+n),
  ...readdirSync('scripts/verify').filter(n=>n.startsWith('luxueqi-')).map(n=>'scripts/verify/'+n),
  ...readdirSync('docs').filter(n=>n.startsWith('LUXUEQI-')).map(n=>'docs/'+n),
  root+'/角色设定/陆雪琪.md',root+'/聊天验收/陆雪琪-2026-10-09.md',root+'/聊天验收/陆雪琪-2026-10-10.md',root+'/开发日志/2026-10-09.md',root+'/开发日志/2026-10-10.md',root+'/00-总览.md',
];
const secretFiles = files.filter(file=>/sk-[A-Za-z0-9_-]{16,}/u.test(readFileSync(file,'utf8')));
// Report counts only; never print found values or their surrounding text.
if(secretFiles.length)throw Error('Secret scan found sensitive data in '+secretFiles.length+' artifacts');
const summary=JSON.parse(readFileSync('docs/LUXUEQI-USAGE-2026-10-10.json','utf8'));
const card=readFileSync(root+'/角色设定/陆雪琪.md','utf8');
const source=readFileSync('src/lib/lu-xue-qi-preset.ts','utf8').match(/systemPrompt: `([\s\S]+?)`,\s*\n\};/u)[1];
const log=readFileSync(root+'/开发日志/2026-10-10.md','utf8');
const pass=Object.values(summary.audit).every(Boolean)&&card.includes(source)
  &&log.includes(String(summary.totals.total))&&log.includes(String(summary.cumulative.total))
  &&JSON.parse(readFileSync('package.json','utf8')).version==='6.0.13';
const report={date:new Date().toISOString(),pass,secretScanFiles:files.length,secretMatches:0,currentCardMatchesSource:card.includes(source),audit:summary.audit,modelUsage:summary.cumulative,limits:summary.limits};
writeFileSync('docs/LUXUEQI-FINAL-AUDIT-2026-10-10.json',JSON.stringify(report,null,2));
if(!pass)throw Error('Final documentation or completion audit failed');
console.log(JSON.stringify({pass,secretScanFiles:files.length,secretMatches:0,currentCardMatchesSource:true,totalActualCalls:summary.cumulative.calls,localChecks:summary.checks}));
