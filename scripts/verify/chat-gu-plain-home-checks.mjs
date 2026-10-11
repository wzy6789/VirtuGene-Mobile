import {spawn} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
const rows=[];
await Promise.all([
 ['expression',['scripts/verify/chat-expression.mjs']],['gu',['scripts/verify/guyuena-care.mjs']],
 ['lu',['scripts/verify/luxueqi-preset.mjs']],['types',['node_modules/typescript/bin/tsc','--noEmit']],
].map(async([name,args])=>{
 const log=`release/chat-gu-plain-home-${name}-verified-2026-10-11.log`,fd=openSync(log,'w');
 try{const code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{stdio:['ignore',fd,fd],windowsHide:true});p.on('error',reject);p.on('exit',resolve);});rows.push({name,log,code});console.log((code===0?'PASS ':'FAIL ')+name);}finally{closeSync(fd);}
}));
writeFileSync('release/chat-gu-plain-home-checks-2026-10-11.json',JSON.stringify({rows,pass:rows.every(row=>row.code===0),paidModelCalls:0},null,2)+'\n');
if(rows.some(row=>row.code!==0))process.exitCode=1;
