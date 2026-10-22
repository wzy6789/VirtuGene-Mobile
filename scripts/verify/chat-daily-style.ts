import './chat-human-live';
import {db,type Message} from '../../src/db';
import {PRESET_CHARACTERS} from '../../src/lib/seed-init';
import {useChatStore} from '../../src/store/chat-store';
import {assessChatSituation,assessExpressionSignals,type ChatSituation} from '../../src/lib/chat-expression-guidance';
import {buildCharacterVoiceCard,buildHumanConversationSections} from '../../src/lib/chat-humanizer';
import {guYueNaRelationshipForTurn} from '../../src/lib/gu-yue-na-runtime';
import {luXueQiRelationshipForTurn} from '../../src/lib/lu-xue-qi-runtime';
import {continuityRepo} from '../../src/db/continuity-repo';
import {captureContinuityChatEvidence} from '../../src/lib/continuity-sources';
import {inspectChatOutput} from '../../src/lib/chat-output-quality';
import {polishChatResponse} from '../../src/lib/reply-quality';
import {splitReplyParts} from '../../src/lib/chat-pacing';
import {allowsDramaticReply} from '../../src/lib/chat-expression-boundary';
const api=window as any,harness=api.liveExpression,owner='isolated-live-expression-owner',actor='isolated-live-role',sessionId='isolated-live-session';
let calls:any[]=[];
window.fetch=async(url,init)=>{
 if(!String(url).includes('/chat/completions'))throw Error('No external transport in daily-style fixture');
 const body=JSON.parse(String(init?.body));calls.push(body);
 return Response.json({choices:[{message:{content:'嗯。'},finish_reason:'stop'}]});
};
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
const cases:Array<[string,ChatSituation]>=[
 ['昨天很难过，不过我现在好多了。','neutral'],
 ['我今天挺开心，现在不累了。','celebration'],
 ['我今天很累，现在不难过了。','tired'],
 ['我很委屈，现在不担心了。','distress'],
 ['我今天有点紧张，现在不生气了。','distress'],
 ['我有点难过，现在不累了。','distress'],
 ['刚才很难过，现在好了，但还是好累。','tired'],
 ['我刚才已经好了，现在又有点难过。','distress'],
 ['我今天很开心，现在好多了，但还是累。','mixed'],
 ['我今天很开心，现在好了。','celebration'],
 ['我现在好多了。昨天很难过。','neutral'],
 ['我现在没事了。昨天很难过。','neutral'],
 ['昨天的事现在仍让我难过，我现在不累了。','distress'],
 ['我很难过。现在好多了吗？','distress'],
 ['我很难过。朋友说“我现在好多了”。','distress'],
 ['我很难过。如果我现在好了就好了。','distress'],
 ['我很难过，没说我现在好了。','distress'],
 ['我难过，现在电脑好了。','distress'],
 ['我很难过。她现在没事了。','distress'],
 ['我很累。好了，不聊了。','tired'],
 ['现在不难过了，但还有点委屈。','distress'],
 ['我刚才很难过，但现在已经不难过了。','neutral'],
 ['好多了。','neutral'],
 ['昨天很难过，现在好多了，帮我解释这段代码。','neutral'],
 ['我很难过，明天就好了。','distress'],
 ['我今天很开心，也很累，现在不累了。','celebration'],
 ['麻烦你具体看看这个错误。','neutral'],
 ['我很烦，麻烦你具体看看这个错误。','distress'],
 ['我今天很累，麻烦你先具体说说这个错误。','tired'],
 ['这事让我很烦。','distress'],
 ['麻烦解决了。','neutral'],
 ['我今天很累，刚才有点难过，现在心情好多了。','tired'],
 ['我今天很累，心情好多了。','tired'],
 ['我今天很累，现在情绪好了。','tired'],
 ['我很疲惫，现在不累了。','neutral'],
 ['我很累，现在不疲惫了。','neutral'],
 ['我很难过，也很疲惫，现在不累了。','distress'],
 ['我现在不累了，但后来又很疲惫。','tired'],
];
const politeInputs=new Set(['请详细解释这段代码为什么出错。','我今天很累，麻烦你先具体说说这个错误。']);
const nativeCases:Array<[string,ChatSituation]>=[cases[0],cases[1],cases[2],cases[3],cases[6],cases[10],cases[12],cases[23],['请详细解释这段代码为什么出错。','neutral'],['我今天很累，麻烦你先具体说说这个错误。','tired'],['我今天很累，刚才有点难过，现在心情好多了。','tired'],['我很疲惫，现在不累了。','neutral']];
api.runDailyStyle=async()=>{
 const checks:Array<{name:string;ok:boolean}>=[],pure:any[]=[],rows:any[]=[];const check=(name:string,ok:unknown)=>checks.push({name,ok:!!ok});
 for(const [input,expected]of cases){const actual=assessChatSituation(input);pure.push({input,expected,actual});check('current scoped affect: '+input,actual===expected);}
 const request=assessExpressionSignals(cases[23][0]);check('recovery does not consume an explicit request',request.request&&request.requestConfidence>=.8);
 const politeCases:Array<[string,boolean]>=[['请详细解释这段代码。',true],['麻烦你先具体说说这个错误。',true],['请你仔细看看这段代码。',true],['请介绍一下这里的结构。',true],['请说明这一点。',true],['朋友说“请详细解释这段代码”。',false],['请不要详细解释，我只是吐槽。',false],['如果我说“请详细解释”，你会怎样？',false],['我今天请假了。',false],['请柬写得挺漂亮。',false],['我很委屈，不过请先别分析。',false]];
 for(const [text,expected]of politeCases)check('polite request scope: '+text,assessExpressionSignals(text).request===expected);
 for(const name of ['古月娜','陆雪琪'])for(const [input,expected]of nativeCases){
  const preset=harness.presets(true).find((row:any)=>row.name===name)!;
  await harness.setup({...preset,createdBy:owner,isPreset:false,isCustom:true},.5);
  const identity=name==='古月娜'?'我是唐舞麟。':'我是张小凡。';
  await harness.restoreSavedTurns([{input:identity,replies:['嗯。']},{input:'周六14点去博物馆，坐地铁。晚上不喝咖啡。',replies:['嗯。']},{input:'昨天心情不好，那件事还没有解决。',replies:['嗯。']}]);
  const originals=await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
  const premise=originals.find(row=>row.content.startsWith('周六14点'))!;
  const created=await continuityRepo.createMany([{userId:owner,characterId:actor,kind:'plan',title:'博物馆计划',detail:'周六14点去博物馆，坐地铁。',origin:'ai',sourceMessageIds:[premise.id],sourceEvidence:captureContinuityChatEvidence(originals,[premise.id])}]);
  await db.memories.put({id:'daily-style-preference',userId:owner,characterId:actor,type:'manual',pinned:true,content:'用户晚上不喝咖啡。',createdAt:1,updatedAt:1});
  const before=await db.continuityThreads.where('[userId+characterId+title]').equals([owner,actor,'博物馆计划']).first();
  check(name+' fixture has a real source-backed pending item '+input,created===1&&before?.status==='open'&&before.sourceEvidence?.sources.some(ref=>ref.messageId===premise.id));
  const originalHash=await digest(originals),personaHash=await digest(preset.systemPrompt);calls=[];
  const result=await harness.turn(input),main=calls.filter(call=>call.messages.at(-1)?.content===input);
  const system=main[0]?.messages[0]?.content??'';
  const current=(await db.characters.get(actor))!;
  const relation=name==='古月娜'?guYueNaRelationshipForTurn(current,input,[identity]):luXueQiRelationshipForTurn(current,input,[identity]);
  check(name+' one actual main request and durable reply '+input,!result.failed&&result.replies.length>0&&main.length===1);
  check(name+' actual prompt keeps known facts '+input,system.includes('14点')&&system.includes('地铁')&&system.includes('晚上不喝咖啡'));
  check(name+' emotion recovery never completes the pending item '+input,!!before&&JSON.stringify(before)===JSON.stringify(await db.continuityThreads.get(before.id)));
  const refreshed=await db.messages.bulkGet(originals.map(row=>row.id));
  check(name+' original facts/persona stay untouched '+input,originalHash===await digest(refreshed)&&personaHash===await digest(current.systemPrompt));
  check(name+' own identity still controls the relationship '+input,relation.recognized===true&&!!relation.context);
  const hidden=system.match(/\[本轮交流的隐藏节奏\][\s\S]*?(?=\[人物声音卡\])/u)?.[0]??'';
  check(name+' native current affect stays scoped '+input,assessChatSituation(input)===expected);
  if(politeInputs.has(input))check(name+' actual request gets task guidance instead of ordinary sharing '+input,hidden.includes('这个请求')&&!/轻松交流，从这件事|接这件小事/u.test(hidden));
  if(expected==='neutral')check(name+' restored affect is not reintroduced as current distress '+input,!/当前话里有难受或受挫|本轮涉及受挫与难过/u.test(hidden));
  if(expected==='celebration')check(name+' independent joy keeps its own reaction '+input,/当前话里有开心或进展|本轮涉及进展或开心/u.test(hidden));
  rows.push({name,input,expected,originalHash,personaHash,originals,threadBefore:before,threadAfter:before?await db.continuityThreads.get(before.id):null,mainRequests:main,auxiliaryLocalRequests:calls.length-main.length,conversation:(await db.sessions.get(sessionId))?.conversation,result});
 }
 // One uninterrupted Gu Yue Na dialogue, rather than resetting the history
 // between every assertion. Stub text proves routing, never model empathy.
 const gu=harness.presets(true).find((row:any)=>row.name==='古月娜')!;
 await harness.setup({...gu,createdBy:owner,isPreset:false,isCustom:true},.5);
 await harness.restoreSavedTurns([{input:'我是唐舞麟。',replies:['嗯。']},{input:'周六14点去博物馆，坐地铁。晚上不喝咖啡。',replies:['嗯。']}]);
 const sequence:any[]=[];
 const sequenceInputs:Array<[string,ChatSituation]>=[
  ['我努力了很久，还是失败了，真的很难受。','distress'],
  ['现在好多了，这件事先放一放。','neutral'],
  ['给你看个好玩的，我今天看到一只猫趴在自动门上。','neutral'],
  ['我今天很开心，也很累，现在不累了。','celebration'],
  ['我现在不想听安慰，麻烦你具体看看这个错误。','neutral'],
 ];
 for(const [input,expected]of sequenceInputs){
  calls=[];const result=await harness.turn(input),main=calls.filter(call=>call.messages.at(-1)?.content===input);
  const system=main[0]?.messages[0]?.content??'',hidden=system.match(/\[本轮交流的隐藏节奏\][\s\S]*?(?=\[人物声音卡\])/u)?.[0]??'';
  check('Gu continuous dialogue single main request '+input,!result.failed&&result.replies.length>0&&main.length===1);
  const all=JSON.stringify(main[0]?.messages??[]);
  check('Gu continuous dialogue original known arrangement retained '+input,all.includes('14点')&&all.includes('地铁')&&all.includes('晚上不喝咖啡'));
  check('Gu continuous dialogue current affect '+input,assessChatSituation(input)===expected);
  if(expected==='neutral')check('Gu continuous dialogue follows recovery/new topic '+input,!/当前话里有难受或受挫|本轮涉及受挫与难过/u.test(hidden));
  if(input.includes('麻烦你'))check('Gu continuous dialogue request beats comfort '+input,hidden.includes('这个请求')&&!/轻松交流，从这件事|接这件小事/u.test(hidden));
  sequence.push({input,expected,mainRequests:main,result,conversation:(await db.sessions.get(sessionId))?.conversation});
 }
 const currentPersonas=harness.presets(true).filter((row:any)=>['古月娜','陆雪琪'].includes(row.name));
 const voiceCards=currentPersonas.map((role:any)=>({name:role.name,card:buildCharacterVoiceCard(role,'我不太同意这个观点。',[])}));
 const judgments=voiceCards.map((row:any)=>row.card.split('\n').find((line:string)=>line.startsWith('人物判断依据'))??'');
 check('authored judgments remain distinct beyond character names',voiceCards.length===2&&judgments.every((line:string)=>line.length>60)&&judgments[0].replace(/古月娜|陆雪琪/gu,'')!==judgments[1].replace(/古月娜|陆雪琪/gu,''));
 for(const reply of ['哈哈哈','确实。','嗯？怎么了？？','这也行！！🙂']){
  const polished=polishChatResponse(reply);check('oral reaction carrier survives polishing: '+reply,polished===reply&&splitReplyParts(polished).join('')===reply);
 }
 const plain=inspectChatOutput('我不这么想。认真回你比每次秒回更重要。',{mode:'private',userMessage:'朋友就应该每次都秒回。'});
 check('ordinary disagreement is not filtered into obedience',plain.check.ok);
 const story='写一段故事：我们站在湖边，古月抬起头。';
 check('explicit creative request keeps its dramatic boundary',allowsDramaticReply(story));
 for(const role of currentPersonas){
  const text='请详细解释这段代码为什么出错。',sections=buildHumanConversationSections(text,[],role);
  check(role.name+' detailed request is not treated as ordinary sharing',assessExpressionSignals(text).request&&!/轻松交流，从这件事|接这件小事/u.test(sections[0].text));
 }
 return {complete:checks.every(row=>row.ok),checks,failures:checks.filter(row=>!row.ok),pure,rows,sequence,voiceCards,paidCalls:0,modelTransport:'local stub only; no actual-model voice score'};
};
