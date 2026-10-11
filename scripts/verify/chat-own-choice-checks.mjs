import {spawn} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
const rows=[];
async function run(name,args){
 const log=`release/chat-own-choice-${name}-final-2026-10-11.log`,fd=openSync(log,'w');
 try{
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',fd,fd]});child.on('error',reject);child.on('exit',resolve);});
  rows.push({name,log,code});console.log(code===0?'PASS '+name:'FAIL '+name);
 }finally{closeSync(fd);}
}
await Promise.all([
 run('expression',['scripts/verify/chat-expression.mjs']),
 run('types',['node_modules/typescript/bin/tsc','--noEmit']),
 run('gu',['scripts/verify/guyuena-care.mjs']),
 run('lu',['scripts/verify/luxueqi-preset.mjs']),
]);
await run('stream',['scripts/verify/chat-stream.mjs']);
writeFileSync('release/chat-own-choice-checks-2026-10-11.json',JSON.stringify({pass:rows.every(row=>row.code===0),rows,paidModelCalls:0},null,2)+'\n');
if(rows.some(row=>row.code!==0))process.exitCode=1;
