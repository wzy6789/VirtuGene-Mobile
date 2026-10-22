import { build } from 'esbuild';
import { mkdirSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir='.tmp-preview/voice-phrase-deadline-20261016/queue';mkdirSync(dir,{recursive:true});
await build({entryPoints:['scripts/verify/voice-speech-deadline-queue.ts'],outfile:`${dir}/verify.cjs`,bundle:true,platform:'node',format:'cjs'});
const run=spawnSync(process.execPath,[`${dir}/verify.cjs`],{encoding:'utf8',timeout:20000});
writeFileSync(`${dir}/run.txt`,(run.stdout??'')+(run.stderr??''));
if(run.status===0){const report=JSON.parse(run.stdout);writeFileSync(`${dir}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}else console.error(run.stderr||run.error);
process.exitCode=run.status??1;
