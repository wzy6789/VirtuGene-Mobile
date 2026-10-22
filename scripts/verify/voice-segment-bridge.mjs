import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir='.tmp-preview/voice-segment-playback-20261015';
for(const mode of ['before','after']){
  const outfile=`${dir}/bridge-${mode}.cjs`;
  await build({entryPoints:['scripts/verify/voice-segment-bridge.ts'],outfile,bundle:true,platform:'node',format:'cjs',plugins:mode==='before'?[{name:'frozen-drain-bridge',setup(b){b.onLoad({filter:/voice-call[\\/]native-audio\.ts$/},args=>({contents:readFileSync(`${dir}/before/native-audio.ts`,'utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]:[]});
  const run=spawnSync(process.execPath,[outfile,...(mode==='before'?['--before']:[])],{encoding:'utf8',timeout:20000});writeFileSync(`${dir}/bridge-${mode}.txt`,(run.stdout??'')+(run.stderr??''));assert.equal(run.status,0,run.stderr||String(run.error));
  const report=JSON.parse(run.stdout.trim());writeFileSync(`${dir}/bridge-${mode}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
