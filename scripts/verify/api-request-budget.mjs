// Durable, fail-closed accounting at the actual live transport boundary.
// This module never receives a key, request headers or dialogue.
import {openSync,closeSync,unlinkSync,mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,fsyncSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

function fixedConfig(config){
  const {phase,limit,model,thinking,reasoningEffort,maxOutputTokens}=config;
  // The named final material check inherits 92 already-spent receipts and has
  // an explicitly announced 12-attempt supplement. Other phases retain100.
  const ceiling=phase==='chat-core-user-casual-final-20261022'?112:phase==='chat-core-required-identity-material-20261022'?104:100;
  if(typeof phase!=='string'||!phase||!Number.isSafeInteger(limit)||limit<1||limit>ceiling
    ||typeof model!=='string'||!model||thinking?.type!=='enabled'||reasoningEffort!=='low'
    ||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>900)throw Error('Invalid live verification budget configuration');
  return {phase,limit,model,thinking:{type:thinking.type},reasoningEffort,maxOutputTokens};
}
function locked(file,config,change){
  mkdirSync(dirname(file),{recursive:true});
  const lock=file+'.lock',fd=openSync(lock,'wx');
  try {
    const stored=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schema:1,config,requests:[]};
    if(stored.schema!==1||JSON.stringify(stored.config)!==JSON.stringify(config)||!Array.isArray(stored.requests)
      ||stored.requests.some((row,index)=>!row.id||row.sequence!==index+1)||stored.requests.length>config.limit)throw Error('Live budget identity or accounting mismatch');
    const result=change(stored);
    const temporary=file+'.'+randomUUID()+'.tmp',out=openSync(temporary,'wx');
    try{writeFileSync(out,JSON.stringify(stored,null,2));fsyncSync(out);}finally{closeSync(out);}
    renameSync(temporary,file);
    return result;
  } finally {closeSync(fd);unlinkSync(lock);}
}
function safeUsage(usage){
  if(!usage||typeof usage!=='object')return undefined;
  const result={};
  for(const key of ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']){
    if(Number.isSafeInteger(usage[key])&&usage[key]>=0)result[key]=usage[key];
  }
  const reasoning=usage.completion_tokens_details?.reasoning_tokens;
  if(Number.isSafeInteger(reasoning)&&reasoning>=0)result.completion_tokens_details={reasoning_tokens:reasoning};
  return Object.keys(result).length?result:undefined;
}
/** Every actual request/probe/retry calls this exactly once before transport.
 * A reservation survives a crash; it is never returned to the budget. */
export async function runBudgetedRequest(file,input,transport){
  const config=fixedConfig(input);
  const reservation=locked(file,config,state=>{
    if(state.stopped||state.requests.length>=config.limit||state.requests.some(request=>!request.result))throw Error('Live request budget exhausted, stopped or awaiting an unconfirmed receipt');
    const entry={id:randomUUID(),sequence:state.requests.length+1,reservedAt:new Date().toISOString()};
    state.requests.push(entry);return entry;
  });
  try {
    const result=await transport({...reservation});
    locked(file,config,state=>{
      const entry=state.requests.find(row=>row.id===reservation.id);
      if(!entry||entry.result)throw Error('Live request receipt mismatch');
      const status=Number.isInteger(result?.status)?result.status:'unconfirmed';
      entry.result={status,finishedAt:new Date().toISOString(),usage:safeUsage(result?.usage)};
      if(typeof status!=='number'||status<200||status>=300){state.stopped=true;state.stopReason='provider-or-billing-status-unconfirmed';}
    });
    return result;
  }catch(error){
    locked(file,config,state=>{
      const entry=state.requests.find(row=>row.id===reservation.id);
      if(entry&&!entry.result)entry.result={status:'transport-error',finishedAt:new Date().toISOString()};
      state.stopped=true;state.stopReason='transport-or-accounting-unconfirmed';
    });
    throw error;
  }
}
