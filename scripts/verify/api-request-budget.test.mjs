import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as budget from './api-request-budget.mjs';
const directory=mkdtempSync(join(tmpdir(),'vg-budget-'));
const checks=[];let sends=0;
const check=(name,ok)=>checks.push({name,ok:!!ok});
const config={phase:'initial-trial',limit:6,model:'deepseek-flash',thinking:{type:'enabled'},reasoningEffort:'low',maxOutputTokens:900};
const execute=(path,work,patch={})=>budget.runBudgetedRequest?.(path,{...config,...patch},work)??work();
try {
  const file=join(directory,'persistent.json');
  for(let i=0;i<6;i++)await execute(file,async()=>{sends++;return {status:200,usage:{prompt_tokens:10,completion_tokens:2}};});
  let seventh=false;try{await execute(file,async()=>{sends++;return {status:200};});}catch{seventh=true;}
  check('seventh request is blocked before transport',seventh&&sends===6);
  let ledger;try{ledger=JSON.parse(readFileSync(file,'utf8'));}catch{}
  check('all attempts and provider usage survive process-local state loss',ledger?.requests.length===6&&ledger.requests.every(r=>r.result?.usage?.prompt_tokens===10));
  let resumed=false;try{await execute(file,async()=>{sends++;return {status:200};});}catch{resumed=true;}
  check('resuming the same phase does not reset its budget',resumed&&sends===6);
  let changed=false;try{await execute(file,async()=>({status:200}),{limit:60});}catch{changed=true;}
  check('existing phase limit cannot be silently raised',changed);
  const errors=join(directory,'errors.json');let failures=0;
  try{await execute(errors,async()=>{failures++;throw Error('transport failed');});}catch{}
  let errorLedger;try{errorLedger=JSON.parse(readFileSync(errors,'utf8'));}catch{}
  check('failed transport still consumes one recorded request',failures===1&&errorLedger?.requests.length===1&&errorLedger.requests[0].result?.status==='transport-error');
  const rejected=join(directory,'rejected.json');let denied=0;
  await execute(rejected,async()=>{denied++;return {status:403};});
  try{await execute(rejected,async()=>{denied++;return {status:200};});}catch{}
  check('authorization or quota failure stops further probing',denied===1);
  const broken=join(directory,'broken.json');writeFileSync(broken,'{broken');let corrupt=false;
  try{await execute(broken,async()=>{sends++;return {status:200};});}catch{corrupt=true;}
  check('corrupt accounting fails closed instead of creating a new phase',corrupt);
  const pending=join(directory,'pending.json');let resumedSends=0;
  await execute(pending,async()=>({status:200}));
  const pendingState=JSON.parse(readFileSync(pending,'utf8'));delete pendingState.requests[0].result;writeFileSync(pending,JSON.stringify(pendingState));
  let uncertain=false;try{await execute(pending,async()=>{resumedSends++;return {status:200};});}catch{uncertain=true;}
  check('crash with an unconfirmed prior transport prevents further paid probing',uncertain&&resumedSends===0);
  const serialized=ledger?JSON.stringify(ledger):'';
  check('accounting contains neither credentials nor dialogue',!!serialized&&!/Authorization|apiKey|messages|content/u.test(serialized));
} finally {rmSync(directory,{recursive:true,force:true});}
console.log(JSON.stringify({complete:checks.every(c=>c.ok),checks,actualProviderRequests:0},null,2));
if(checks.some(c=>!c.ok))process.exitCode=1;
