import { build } from 'esbuild';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir='.tmp-preview/voice-phrase-deadline-20261016/controller',before=process.argv.includes('--before'),label=before?'before':'after';mkdirSync(`${dir}/${label}`,{recursive:true});
await build({entryPoints:['scripts/verify/voice-phrase-deadline-controller.ts'],outfile:`${dir}/${label}/verify.cjs`,bundle:true,platform:'node',format:'cjs',
 plugins:before?[{name:'frozen-controller-and-buffer',setup(b){b.onLoad({filter:/voice-call[\\/](controller|utterance)\.ts$/},args=>{const file=args.path.split(/[\\/]/).pop();return {contents:readFileSync(`.tmp-preview/voice-phrase-deadline-20261016/before/${file}`,'utf8'),loader:'ts',resolveDir:dirname(args.path)};});}}]:[]});
const run=spawnSync(process.execPath,[`${dir}/${label}/verify.cjs`,...(before?['--before']:[])],{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
writeFileSync(`${dir}/${label}/run.txt`,(run.stdout??'')+(run.stderr??''));
if(run.status===0){const report=JSON.parse(run.stdout);writeFileSync(`${dir}/${label}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:report.rows.length,cancellations:report.cancellations.length}));}else console.error(run.stderr||run.error);process.exitCode=run.status??1;
