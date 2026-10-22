/** Trace authentic pre-change bytes to the plan-review SHA inventory.
 * Does not edit/restore production files or infer a missing baseline. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='release/chat-core-implementation-20261021';
const inventoryPath='release/chat-core-plan-review-20261021/source-inventory.json';
const inventory=JSON.parse(readFileSync(inventoryPath,'utf8').replace(/^\uFEFF/u,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const targets=Object.entries(inventory.sourceHashes).filter(([path])=>/^(?:src|server)\//u.test(path));
const names=new Set(targets.map(([path])=>basename(path)));
const roots=['release','.tmp-preview','.superpowers'].filter(path=>existsSync(path));
const extraGlobs=['*reply*attempt*.ts*','*history*index*.ts*','*gu*yue*na*runtime*','*guyuena*runtime*','*runtime*before*'];
const scan=spawnSync('rg',['--files','--hidden','--no-ignore',...[...names,...extraGlobs].flatMap(name=>['-g',name]),'-g','!**/node_modules/**',...roots],{encoding:'utf8',maxBuffer:5*1024*1024});
if(scan.status!==0)throw Error('Source-copy inventory scan failed');
const candidates=scan.stdout.split(/\r?\n/u).filter(path=>path&&(names.has(basename(path))||/reply.*attempt|history.*index|(?:gu.*yue.*na|guyuena).*runtime|runtime.*before/iu.test(basename(path))));
const byHash=new Map();
const expectedHashes=new Set(targets.map(([,sha])=>sha));
function variants(bytes){const content=bytes.toString('utf8').replace(/^\uFEFF/u,'').replace(/\r\n/gu,'\n');return [['raw',bytes],['lf',Buffer.from(content)],['crlf',Buffer.from(content.replace(/\n/gu,'\r\n'))],['lf-bom',Buffer.from('\uFEFF'+content)],['crlf-bom',Buffer.from('\uFEFF'+content.replace(/\n/gu,'\r\n'))]];}
for(const path of candidates){
  const seen=new Set();
  for(const [encoding,bytes]of variants(readFileSync(path))){const sha=hash(bytes);if(!expectedHashes.has(sha)||seen.has(sha))continue;seen.add(sha);const matches=byHash.get(sha)??[];matches.push({path,encoding});byHash.set(sha,matches);}
}
const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
const files=[];
for(const [path,expected]of targets){
  const current=existsSync(path)?hash(readFileSync(path)):undefined;
  let source=current===expected?{kind:'unchanged-current-bytes',path}:undefined;
  if(!source&&byHash.has(expected))source={kind:'archived-bytes-match-plan-sha',matches:byHash.get(expected)};
  if(!source){
    const blob=spawnSync('git',['show',head+':'+path],{stdio:['ignore','pipe','ignore'],maxBuffer:5*1024*1024});
    if(blob.status===0){
      const found=variants(blob.stdout).find(([,bytes])=>hash(bytes)===expected);
      if(found)source={kind:'git-bytes-match-plan-sha',commit:head,path,encoding:found[0]};
    }
  }
  files.push({path,expectedSha256:expected,currentSha256:current,changed:current!==expected,beforeBytesVerified:!!source,source});
}
const report={at:new Date().toISOString(),inventoryPath,inventorySha256:hash(readFileSync(inventoryPath)),reference:'2026-10-21 plan-review sourceHashes; these hashes predate implementation, not Git HEAD assumptions',head,files,
  summary:{plannedModuleFiles:files.length,unchanged:files.filter(row=>!row.changed).length,changed:files.filter(row=>row.changed).length,changedWithVerifiedBefore:files.filter(row=>row.changed&&row.beforeBytesVerified).length,changedMissingBefore:files.filter(row=>row.changed&&!row.beforeBytesVerified).length},
  missing:files.filter(row=>row.changed&&!row.beforeBytesVerified).map(row=>row.path),
  limitations:['A matching file SHA proves those bytes only, not a complete dependency snapshot or coherent runnable whole-app baseline.','Scope is the plan-review module inventory. New files absent from that inventory need separate creation evidence; parallel changes are not all attributed to this goal.','The paid live comparison still varied only its ten declared files; locating an archive does not retroactively widen that experiment.'],
  productionFilesRestored:0,apiCalls:0,model:'未确认',reasoning:'未确认'};
const output=root+'/review/baseline-coverage-20261022.json';writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,summary:report.summary,missing:report.missing,productionFilesRestored:0,apiCalls:0},null,2));
