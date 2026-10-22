import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
const dir='.tmp-preview/voice-call-rhythm-20261013';mkdirSync(dir,{recursive:true});
await build({entryPoints:['scripts/verify/voice-call-rhythm.ts'],outfile:dir+'/rhythm.cjs',bundle:true,platform:'node',format:'cjs'});
const result=spawnSync(process.execPath,[dir+'/rhythm.cjs'],{encoding:'utf8',timeout:20000});
writeFileSync(dir+'/rhythm-result.txt',(result.stdout??'')+(result.stderr??'')+(result.error??''));console.log(result.stdout);console.error(result.stderr);process.exitCode=result.status??1;
