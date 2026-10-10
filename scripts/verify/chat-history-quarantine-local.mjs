import {build} from 'esbuild';
const b=await build({entryPoints:['src/lib/chat-history-quarantine.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {quarantineReviewedHistory:apply}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
let checks=0;const ok=(v,label)=>{if(!v)throw Error(label);checks++;};
const sources=[{id:'identity',text:'用户直接认领舞麟。',scope:'background',independent:true}],candidate='我也想你。\n---\n昨天我去看过一棵树。它长高了。';
const snapshot={persona:'角色原文',input:{candidate,userMessage:'我是舞麟。',sources},raw:JSON.stringify({verdict:'revise',claims:[{quote:'昨天我去看过一棵树。',scope:'past',supported:false,evidenceIds:[],reason:'没有事件来源。'}]})};
const messages=[{role:'system',content:'角色原文'},{role:'user',content:'我是舞麟。'},{role:'assistant',content:candidate,image:'image-ref',sourceMessageIds:['a','b']},{role:'user',content:'那棵树长高了没？'}],before=JSON.stringify(messages);
const result=apply(messages,snapshot,'角色原文',sources);
ok(result.applied&&result.messages[2].content==='我也想你。','independent emotion survives while the unsupported bubble and dependent pronoun are isolated');
ok(result.messages[3]===messages[3],'the current user question is never rewritten');
ok(result.messages[2].sourceMessageIds===messages[2].sourceMessageIds&&result.messages[2].image===messages[2].image,'source identity and image metadata stay attached');
ok(JSON.stringify(messages)===before,'stored source objects are unchanged');
ok(result.quotes[0]==='昨天我去看过一棵树。','correction context points to the complete original sentence');
for(const change of [{persona:'编辑过的角色'}, {sources:[{...sources[0],text:'改变的身份事实'}]}, {messages:messages.map(m=>m.role==='assistant'?{...m,content:candidate+'新修改。'}:m)}, {messages:messages.map(m=>m.role==='user'&&m.content==='我是舞麟。'?{...m,content:'我是访客。'}:m)}, {messages:[...messages,...messages.slice(1,3)]}, {snapshot:{...snapshot,raw:'{broken'}}, {snapshot:{...snapshot,raw:JSON.stringify({verdict:'uncertain',claims:[]})}}, {snapshot:{...snapshot,raw:JSON.stringify({verdict:'pass',claims:[]})}}]){
 const r=apply(change.messages??messages,change.snapshot??snapshot,change.persona??'角色原文',change.sources??sources);
 ok(!r.applied,'edited, ambiguous, invalid or unapproved snapshots cannot rewrite history');
}
const fragments={...snapshot,raw:JSON.stringify({verdict:'revise',claims:[{quote:'我去看过一棵树',scope:'past',supported:false,evidenceIds:[],reason:'部分引用'}]})};
ok(!apply(messages,fragments,'角色原文',sources).applied,'a partial quote cannot isolate a sentence out of its original conditions');
const only={...snapshot,input:{...snapshot.input,candidate:'昨天我去看过一棵树。'}};
const all=apply(messages.map(m=>m.role==='assistant'?{...m,content:only.input.candidate}:m),only,'角色原文',sources);
ok(all.applied&&all.messages.length===messages.length-1&&!all.messages.some(m=>m.role==='assistant'),'fully unsupported history is omitted without a replacement or a false denial');
console.log(`PASS history-quarantine: ${checks} source, revision, dependency and identity checks; evaluation stage only`);
