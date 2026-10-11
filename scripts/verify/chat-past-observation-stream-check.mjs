import {spawn} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
const log='release/chat-past-observation-stream-2026-10-11.log',fd=openSync(log,'w'),startedAt=Date.now();
try{const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/verify/chat-stream.mjs'],{windowsHide:true,stdio:['ignore',fd,fd]});child.on('error',reject);child.on('exit',resolve);});writeFileSync('release/chat-past-observation-stream-2026-10-11.json',JSON.stringify({code,log,durationMs:Date.now()-startedAt,paidModelCalls:0},null,2)+'\n');if(code!==0)process.exitCode=1;}finally{closeSync(fd);}
