import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
const dir='.tmp-preview/voice-call-bugcheck-20261013';const before=process.argv.includes('--before');
await build({entryPoints:['scripts/verify/voice-call-bugcheck.ts'],outfile:dir+'/bugcheck.cjs',bundle:true,platform:'node',format:'cjs',plugins:before?[{name:'before-controller',setup(b){b.onLoad({filter:/voice-call[\\/]controller\.ts$/},args=>({contents:readFileSync(dir+'/before/controller.ts','utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]:[]});
const result=spawnSync(process.execPath,[dir+'/bugcheck.cjs'],{encoding:'utf8',timeout:20000});writeFileSync(dir+(before?'/before-result.txt':'/after-result.txt'),(result.stdout??'')+(result.stderr??'')+(result.error??''));console.log(result.stdout);console.error(result.stderr);process.exitCode=result.status??1;
