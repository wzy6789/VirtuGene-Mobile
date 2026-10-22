import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const out='.tmp-preview/chat-scene-plan-20261019';mkdirSync(out,{recursive:true});
await build({entryPoints:['scripts/verify/chat-scene-contracts.ts'],outfile:out+'/contracts.mjs',bundle:true,platform:'node',format:'esm',target:'node20'});
await import(pathToFileURL(resolve(out+'/contracts.mjs')).href+'?t='+Date.now());
