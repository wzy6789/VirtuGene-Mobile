import {build} from 'esbuild';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const built=await build({entryPoints:['src/lib/chat-fact-audit.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {buildFactAuditMessages,parseFactAudit}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const relation={id:'relation',text:'古月娜与唐舞麟已婚，蓝轩宇是他们的孩子。',scope:'background',independent:true};
const claim='轩宇越来越有自己的主意了。';
const input={candidate:claim,userMessage:'你自己现在想聊什么？',sources:[relation]};
let checks=0;
function check(value,label){if(!value)throw Error(label);checks++;}
const result=(overrides={})=>JSON.stringify({verdict:'pass',claims:[{quote:claim,scope:'change',supported:true,evidenceIds:['relation'],reason:'角色与孩子有亲子关系。',...overrides}]});
check(parseFactAudit(result(),input).invalid,'relationship identity cannot prove a change');
check(parseFactAudit(result({scope:'current'}),input).invalid,'static background cannot prove a current state');
check(parseFactAudit(result({evidenceIds:['invented']}),input).invalid,'invented evidence ID cannot pass');
check(parseFactAudit(result({quote:'他最近很高兴'}),input).invalid,'invented candidate quotation cannot pass');
check(parseFactAudit(result({supported:false,evidenceIds:[]}),input).invalid,'pass with an unsupported claim cannot pass');
check(parseFactAudit(JSON.stringify({verdict:'revise',claims:[]}),input).invalid,'revise requires a located unsupported claim');
const change={id:'change',text:'这阵子轩宇更愿意自己做决定了，我们刚刚聊过这个变化。',scope:'change',independent:true};
check(!parseFactAudit(result({evidenceIds:['change']}),{...input,sources:[change]}).invalid,'an independent change record can support a change');
check(parseFactAudit(result({evidenceIds:['change']}),{...input,sources:[{...change,independent:false}]}).invalid,'previous assistant assertion is not independent evidence');
check(!buildFactAuditMessages({...input,sources:[{...change,independent:false}]})[1].content.includes('这阵子轩宇'),'unverified source text is not sent as evidence');
check(parseFactAudit(result({scope:'past'}),{...input,sources:[{...relation,scope:'current'}]}).invalid,'current status does not establish a past event');
check(parseFactAudit(result({evidenceIds:['relation','relation']}),input).invalid,'duplicate evidence IDs are rejected');
check(!parseFactAudit(JSON.stringify({verdict:'pass',claims:[]}),{...input,candidate:'我喜欢这种自在的聊天。'}).invalid,'a current preference does not require autobiographical evidence');
const hypothesis='如果轩宇越来越有自己的主意，我也愿意听听他的想法。';
check(parseFactAudit(JSON.stringify({verdict:'revise',claims:[{quote:'轩宇越来越有自己的主意',scope:'change',supported:false,evidenceIds:[],reason:'没有变化来源。'}]}),{...input,candidate:hypothesis}).invalid,'an exact substring cannot strip the enclosing hypothetical condition');
check(parseFactAudit(JSON.stringify({verdict:'revise',claims:[{quote:'轩宇越来越有自己的主意',scope:'change',supported:false,evidenceIds:[],reason:'没有变化来源。'}]}),{...input,candidate:'不是轩宇越来越有自己的主意，我刚才说错了。'}).invalid,'a reviewer cannot remove an enclosing correction or negation');
const multi={candidate:'我喜欢这个想法。---我以前这样做过。\n如果有空，我愿意陪你。',userMessage:'你自己呢？',sources:[]};
const fragments=JSON.parse(buildFactAuditMessages(multi)[1].content).candidateFragments;
check(fragments.length===3&&fragments.every(row=>!row.text.includes('---')),'bubble delimiters never enter exact quote locations');
const located=(overrides={})=>JSON.stringify({verdict:'revise',claims:[{fragmentId:'f2',scope:'past',supported:false,evidenceIds:[],reason:'未提供该段过去经历。',...overrides}]});
const locatedAudit=parseFactAudit(located(),multi);
check(!locatedAudit.invalid&&locatedAudit.claims[0].quote==='我以前这样做过。','a located finding resolves to the whole original sentence');
check(parseFactAudit(located({fragmentId:'invented'}),multi).invalid,'unknown fragment IDs cannot authorize a correction');
check(parseFactAudit(located({quote:'我这样做过。'}),multi).invalid,'a valid location cannot authorize a mismatched or shortened quote');
check(parseFactAudit(located({fragmentId:null}),multi).invalid,'explicit malformed location does not fall back to a quote');
check(parseFactAudit(located({fragmentId:'f3',quote:'有空，我愿意陪你。'}),multi).invalid,'location keeps the conditional qualifier intact');
const repeatedClaim=JSON.parse(located());repeatedClaim.claims.push({...repeatedClaim.claims[0]});
check(parseFactAudit(JSON.stringify(repeatedClaim),multi).invalid,'duplicate findings do not inflate evidence');
check(!parseFactAudit(JSON.stringify({verdict:'revise',claims:[{quote:'我以前这样做过。',scope:'past',supported:false,evidenceIds:[],reason:'没有过去来源。'}]}),multi).invalid,'legacy exact whole-sentence diagnostics remain readable');
console.log(`PASS fact-audit: ${checks} source and temporal-scope checks; diagnostic only`);
const [proxy,token,generation='thinking']=process.argv.slice(2);
if(!proxy&&!token)process.exit(0);
if(!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy)||!token||!['thinking','direct'].includes(generation))throw Error('Explicit bounded local bridge and evaluation mode required');
const sourcePath='docs/CHAT-FLASH-SCENE-5-GUYUENA-TASTE-R7-2026-10-09.json';
const row=JSON.parse(readFileSync(sourcePath,'utf8')).rows[4];
const actual={candidate:row.replies.join('---'),userMessage:row.input,sources:[relation]};
const cases=[
 {id:'actual-r29-presupposed-change',input:actual,expected:'revise',source:sourcePath},
 {id:'explicit-independent-change',input:{...actual,sources:[relation,change]},expected:'pass',scope:'synthetic independent record; not an actual user or life event'},
 {id:'hypothetical-change',input:{candidate:'如果轩宇越来越有自己的主意，我也愿意听听他的想法。',userMessage:row.input,sources:[relation]},expected:'pass',scope:'synthetic hypothetical contrast'},
 {id:'old-assistant-is-not-evidence',input:{...actual,sources:[relation,{...change,independent:false}]},expected:'revise',scope:'synthetic unverified assistant contrast'},
];
const output=`docs/CHAT-FACT-AUDIT-${generation==='direct'?'R2-DIRECT':'R1'}-2026-10-09.json`;
if(existsSync(output))throw Error('Existing paid evidence cannot be overwritten');
const report={model:'deepseek-flash',generation,productionReady:false,scope:'diagnostic calibration only, four reviews not four new character conversations; first candidate is actual R29, other evidence contrasts are synthetic; direct changes evaluation only, not app selection',rows:[]};
for(const item of cases){
 const messages=buildFactAuditMessages(item.input);
 const response=await fetch(proxy,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-flash',messages,thinking:{type:generation==='direct'?'disabled':'enabled'},...(generation==='direct'?{temperature:0}:{reasoning_effort:'low'}),stream:false,max_tokens:500}),signal:AbortSignal.timeout(50000)});
 const data=await response.json();if(!response.ok)throw Error('Bounded audit response '+response.status);
 const raw=data.choices?.[0]?.message?.content??'';
 const audit=parseFactAudit(raw,item.input);
 const passed=!audit.invalid&&audit.verdict===item.expected&&data.choices?.[0]?.finish_reason==='stop';
 report.rows.push({...item,messages,raw,audit,passed,usage:data.usage,finish:data.choices?.[0]?.finish_reason});
 writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({id:item.id,expected:item.expected,audit,passed,usage:data.usage}));
}
report.matches=report.rows.filter(row=>row.passed).length;
writeFileSync(output,JSON.stringify(report,null,2));
console.log(`REAL diagnostic ${report.matches}/${cases.length}; productionReady=false`);
