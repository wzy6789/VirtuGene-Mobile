// Original plan section10 only: freeze synthetic A/B inputs. Never sends HTTP.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-continuity-study-20261019';mkdirSync(root,{recursive:true});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const character='你是古月娜，高贵清冷、骄傲聪慧、独立深情。和已明确自己是唐舞麟的用户普通私聊：对他温柔，保留自己的判断；日常自然接话，不编共同经历，不把每件事升华成命运。不写动作或心理旁白。认真请求先回答，不强迫安慰或反问。';
const fixtures=[
 {id:'R1',order:['A','B'],pairs:[
  ['古月娜，我是唐舞麟。明天有考试，我有点紧张。','你最担心哪一部分？'],
  ['主要怕时间不够。','那就先把会做的答稳。'],
  ['已经考完了，时间够，成绩也不担心。','那就好。'],
  ['不聊考试了，橘猫跟了我一路。','空手也能被它认上？'],
  ['我空手出来的，它大概只是顺路。','好吧，是我会错了猫的意。'],
  ['它拐弯走了，我准备回家。','嗯，路上慢点。']],
  message:'想听轻松的，你会选什么？',
  state:'用户明确考试已结束，时间够、成绩不担心，并表示不聊考试。猫已离开，用户准备回家，当前想聊轻松选择。',
  stateSources:[{turn:3,quote:'已经考完了，时间够，成绩也不担心。'},{turn:4,quote:'不聊考试了'},{turn:6,quote:'它拐弯走了，我准备回家。'}],
  criteria:['接当前轻松话题，不重问考试','选择有古月娜自己的好恶，不虚构经历']},
 {id:'R2',order:['B','A'],pairs:[
  ['古月娜，我是唐舞麟。今天忙了一整天。','总算忙完了？'],
  ['晚饭已经吃过了。','吃的什么？'],
  ['番茄鸡蛋面。','这个搭配很稳。'],
  ['我最后还多喝了两口汤。','看来汤比面更讨你喜欢。'],
  ['哈哈，确实汤比较好喝。','那我这次猜对了。'],
  ['已经吃饱了，现在想放松一下。','嗯，不谈今天的事也行。']],
  message:'想看个轻松短片，你喜欢什么类型？',
  state:'用户已经吃过番茄鸡蛋面、多喝了汤，也确认吃饱。当前问轻松短片类型。',
  stateSources:[{turn:2,quote:'晚饭已经吃过了。'},{turn:3,quote:'番茄鸡蛋面。'},{turn:4,quote:'我最后还多喝了两口汤。'},{turn:6,quote:'已经吃饱了'}],
  criteria:['不重问吃没吃饭或建议再去吃饭','回答自己的短片偏好，不安排休息清单']},
 {id:'R3',order:['A','B'],pairs:[
  ['古月娜，我是唐舞麟。周日去博物馆吧。','好，时间你来定。'],
  ['刚才口误，是周六14点。','那就周六14点。'],
  ['交通坐地铁，具体哪家馆还没选。','选馆可以再看看，不急。'],
  ['周末这个先放一放。','嗯，先放着。'],
  ['最近听了一首歌，节奏很轻快。','听着心情会好一点。'],
  ['歌先聊到这里吧。','好。']],
  message:'刚才周末的安排，出发前准备什么？',
  state:'博物馆约定原说周日，用户已更正为周六14点，交通地铁，具体馆未定。此前暂放；当前用户主动重提出发准备，沿用已知日期和交通，馆仍未知。',
  stateSources:[{turn:1,quote:'周日去博物馆吧。'},{turn:2,quote:'刚才口误，是周六14点。'},{turn:3,quote:'交通坐地铁，具体哪家馆还没选。'},{turn:4,quote:'周末这个先放一放。'}],
  criteria:['用周六14点和地铁，不回周日','不重复问已有日期交通，不虚构具体馆或预约成功','允许重开，不以之前暂放拒绝当前问题']},
 {id:'R4',order:['B','A'],pairs:[
  ['古月娜，我是唐舞麟。今天和同事有争执。','发生什么事了？'],
  ['后来已经说开了。','说开了就好。'],
  ['这件事不想再聊，冰箱有番茄。','那就换个话题。'],
  ['鸡蛋也还有两个。','番茄配鸡蛋，倒正好。'],
  ['面条也有。','那晚饭已经有着落了。'],
  ['我想把这些一起做了，不想另买菜。','嗯，就用现有的。']],
  message:'怎么一起做成一碗面？',
  state:'同事争执用户已确认说开并不想再聊。当前食材番茄、两个鸡蛋、面条，不想另买菜，问怎么做一碗面。',
  stateSources:[{turn:2,quote:'后来已经说开了。'},{turn:3,quote:'这件事不想再聊，冰箱有番茄。'},{turn:4,quote:'鸡蛋也还有两个。'},{turn:5,quote:'面条也有。'},{turn:6,quote:'不想另买菜。'}],
  criteria:['直接回答现有食材做面，不重启争执安慰','满足不另买菜，不虚构已经做饭或共同生活']},
];
const requests=[],checks=[];const check=(name,ok)=>{checks.push({name,ok:!!ok});if(!ok)throw Error(name);};
for(const fixture of fixtures){
 check(fixture.id+' six complete synthetic history turns',fixture.pairs.length===6&&fixture.pairs.every(pair=>pair.length===2&&pair.every(text=>typeof text==='string'&&text.length>0)));
 check(fixture.id+' manual state references only exact user originals',fixture.stateSources.every(source=>fixture.pairs[source.turn-1]?.[0].includes(source.quote)));
 const history=fixture.pairs.flatMap(([user,assistant])=>[{role:'user',content:user},{role:'assistant',content:assistant}]);
 for(const variant of fixture.order){
  const system=character+(variant==='B'?'\n[由相同原文人工归纳的当前状态]\n'+fixture.state:'');
  const body={model:'deepseek-flash',messages:[{role:'system',content:system},...history,{role:'user',content:fixture.message}],thinking:{type:'disabled'},temperature:.8,stream:false,max_tokens:300};
  requests.push({caseId:fixture.id,variant,body,bodySha256:hash(body),historySha256:hash(history),messageSha256:hash(fixture.message),utf8Bytes:Buffer.byteLength(JSON.stringify(body),'utf8')});
 }
 const pair=requests.slice(-2);check(fixture.id+' A/B full history and user question are identical',pair[0].historySha256===pair[1].historySha256&&pair[0].messageSha256===pair[1].messageSha256);
 check(fixture.id+' scoring criteria never enter either request',pair.every(request=>fixture.criteria.every(criterion=>!JSON.stringify(request.body).includes(criterion))));
}
check('exactly8 requests including all future attempts, no probes or retries permitted',requests.length===8);
const bytes=requests.reduce((sum,row)=>sum+row.utf8Bytes,0);check('all serialized request UTF8 bytes fit conservative24000-byte preparation ceiling',bytes<=24000);
check('fixed nonthinking .8 nonstreaming300-output protocol',requests.every(({body})=>body.thinking.type==='disabled'&&body.temperature===.8&&!body.stream&&body.max_tokens===300&&!('reasoning_effort'in body)&&!('tools'in body)&&!('top_p'in body)));
const pack={schema:1,createdAt:'2026-10-19',planSection:10,scope:'Manually authored synthetic Gu Yue Na compact strategy prototype, not production send-service/persona baseline or automatic-state extraction proof.',character,fixtures,requests,totalUtf8Bytes:bytes,requestCount:8,budget:{allAttempts:8,cumulativePromptTokens:24000,maxOutputTokensPerRequest:300,conservativeInputPreparationBytes:24000},checks,complete:checks.every(row=>row.ok),paidCalls:0,networkCalls:0,modelOutputs:[],scores:[],executionStatus:'prepared-not-executed',limits:['No current credentials, endpoint/alias mapping, pricing, upstream model or real outputs confirmed by this offline preparation.','State B is manual and source-bound, not automatically extracted or a product fix comparison.','Synthetic historical assistant replies are hand-authored fixtures, not observed model responses or acceptance examples.','Future execution must independently verify current official price/alias/endpoint, stop on unknown usage/model identity/error/truncation; no automatic retries, summaries, probes or LLM judge.','Only8 calls cannot prove24 whole trajectories/personality acceptance. Human model-quality gate remains separate.']};
const path=root+'/frozen-requests.json';
if(existsSync(path)&&readFileSync(path,'utf8')!==JSON.stringify(pack,null,2)+'\n')throw Error('Frozen study already exists with different content; preserve it rather than overwrite');
writeFileSync(path,JSON.stringify(pack,null,2)+'\n');
writeFileSync(root+'/preparation-checks.json',JSON.stringify({path,sha256:hash(pack),checks,requests:8,totalUtf8Bytes:bytes,paidCalls:0,networkCalls:0},null,2)+'\n');
console.log(JSON.stringify({path,checks:checks.length,requests:8,totalUtf8Bytes:bytes,paidCalls:0,networkCalls:0,executed:false}));
