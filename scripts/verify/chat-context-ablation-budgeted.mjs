import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {startLiveTestProxy} from './live-test-proxy.mjs';

// Diagnostic bridge only. The secret never enters argv, reports or the child.
const [keyFile,source,indices,variant,output]=process.argv.slice(2);
if(!keyFile||!/^\d+(?:,\d+)?$/u.test(indices??'')||!['duplicate-fields-only','body-guidance-reduced','agency-framing','clarification-framing','reaction-brief','voice-style-tail','shared-joy-framing','focused-reactions'].includes(variant)
  ||![source,output].every(name=>/^[A-Z0-9][A-Z0-9._-]+\.json$/u.test(name??'')))throw Error('Explicit bounded diagnostic inputs required');
const usagePath='docs/'+output.replace(/\.json$/u,'-USAGE.json');
if(existsSync('docs/'+output)||existsSync(usagePath))throw Error('Existing evidence must not be overwritten');
let document=readFileSync(keyFile,'utf8');
const lines=document.split(/\r?\n/u);
const start=lines.findIndex(line=>/^\*\*Deepseek:\*\*/iu.test(line.trim()));
const end=lines.findIndex((line,index)=>index>start&&/^\*\*[^*]+\*\*/u.test(line.trim()));
const keys=start>=0?lines.slice(start,end>start?end:lines.length).join('\n').match(/sk-[A-Za-z0-9_-]{16,}/gu)??[]:[];
let apiKey=keys[1]; keys.fill('');lines.fill('');document='';
if(!apiKey)throw Error('Authorized second DeepSeek configuration unavailable');
const bridge=await startLiveTestProxy({apiKey,maxCalls:indices.split(',').length*2,maxTokens:500});
apiKey=undefined;
let exitCode;
try {
  const child=spawn(process.execPath,['scripts/verify/chat-context-ablation-live.mjs',bridge.url,bridge.token,source,indices,variant,output],{stdio:['ignore','inherit','inherit'],windowsHide:true});
  exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
} finally {
  const observations=bridge.getObservations();
  const totals=observations.reduce((sum,row)=>({calls:sum.calls+1,input:sum.input+(row.usage?.prompt_tokens??0),output:sum.output+(row.usage?.completion_tokens??0),total:sum.total+(row.usage?.total_tokens??0),missingUsage:sum.missingUsage+Number(!row.usage)}),{calls:0,input:0,output:0,total:0,missingUsage:0});
  writeFileSync(usagePath,JSON.stringify({exitCode,totals,observations},null,2));
  await bridge.close();
  console.log(JSON.stringify({totals,usagePath}));
}
if(exitCode!==0)process.exitCode=1;
