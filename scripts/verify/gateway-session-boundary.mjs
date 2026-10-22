import fs from 'node:fs';import assert from 'node:assert/strict';import {build} from 'esbuild';
const root='.tmp-preview/ui-overhaul-20261016/gateway-session-boundary';fs.mkdirSync(root,{recursive:true});
const output=await build({stdin:{contents:"export * from './src/lib/ai/availability';",resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'esm',metafile:true,define:{'import.meta.env':'{}'}});
const inputs=Object.keys(output.metafile.inputs),unexpected=inputs.filter(file=>/\/ai\/(llm|provider-protocols|deepseek)\.ts$/.test(file));
fs.writeFileSync(root+'/'+(process.argv.includes('--before')?'before':'after')+'.json',JSON.stringify({pass:unexpected.length===0,inputs,unexpected,scope:'Static availability dependency boundary only; actual bundle requests verified separately.'},null,2));
assert.deepEqual(unexpected,[],'availability/auth state must not pull chat request and SSE protocol implementations');
console.log('PASS availability defers chat transport and protocol implementation');
