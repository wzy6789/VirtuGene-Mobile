import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const dir = '.tmp-preview/voice-call-followup-20261015';
for (const version of ['before','after']) {
  const file = `${dir}/transmission-${version}.cjs`;
  await build({entryPoints:['scripts/verify/voice-call-transmission-guard.ts'],outfile:file,bundle:true,platform:'node',format:'cjs',
    plugins:version==='before'?[{name:'frozen-controller',setup(b){b.onLoad({filter:/voice-call[\\/]controller\.ts$/},args=>({contents:readFileSync(`${dir}/before/controller.ts`,'utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]:[]});
  const result=spawnSync(process.execPath,[file,...(version==='before'?['--before']:[])],{encoding:'utf8',timeout:20000});
  writeFileSync(`${dir}/transmission-${version}.txt`,(result.stdout??'')+(result.stderr??''));
  if(result.status!==0){console.error(result.stderr);process.exitCode=1;break;}
  const report=JSON.parse(result.stdout.trim());writeFileSync(`${dir}/transmission-${version}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({version,...report}));
}
