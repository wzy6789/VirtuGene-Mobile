import {spawn} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
const log='release/chat-retry-choice-stream-2026-10-11.log',fd=openSync(log,'w'),start=Date.now();
try{const code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/verify/chat-stream.mjs'],{windowsHide:true,stdio:['ignore',fd,fd]});p.on('error',reject);p.on('exit',resolve);});writeFileSync('release/chat-retry-choice-stream-2026-10-11.json',JSON.stringify({code,log,durationMs:Date.now()-start,paidModelCalls:0},null,2)+'\n');if(code!==0)process.exitCode=1;}finally{closeSync(fd);}
