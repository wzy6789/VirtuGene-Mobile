import './chat-human-live';
import {isTopicInvitation,isDirectAffection,directAffectionSources} from '../../src/lib/chat-expression-boundary';
import {chooseConversationAction,buildHumanConversationContext} from '../../src/lib/chat-humanizer';
const api=window as any,harness=api.liveExpression,owner='isolated-live-expression-owner';
const actual='古月，我是唐舞麟。今天的锻造总算忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？';
let calls:any[]=[];
window.fetch=async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return Response.json({choices:[{message:{content:'我也想你了。'},finish_reason:'stop'}]});};
api.runOpenWords=async()=>{
 const checks:Array<{name:string;ok:boolean}>=[],rows:any[]=[];const check=(name:string,value:unknown)=>checks.push({name,ok:!!value});
 const positive=[actual,'你有没有什么想和我说的？','有没有什么话想对我说？','你有什么想跟我说的吗？','你还有什么话想和我说吗？'];
 for(const input of positive){const action=chooseConversationAction(input,[]),context=buildHumanConversationContext(input,[]);check('open invitation reaches existing actor initiative: '+input,isTopicInvitation(input)&&action==='start-topic'&&(context.includes('这轮由你开话题')||context.includes('也邀请聊些平常话')));rows.push({input,action,context});}
 const bounded=[
  '朋友说，你有没有什么想和我说的？','如果有空，你有没有什么想和我说的？','“你有没有什么想和我说的？”是什么意思？','翻译：你有没有什么想和我说的？','你不用告诉我什么，先别开新话题。','你有没有昨天的经历想跟我说？','关于这个报错，你有没有什么想和我说的？','这件事，你有什么想和我说的吗？','你有没有什么想和我说的？帮我看看报告。','我很难过，努力了很久却失败了。你有没有什么想和我说的？','我很累。你有什么想和我说的吗？','明天几点出发？你有没有什么想和我说的？','你刚才说的是真的吗？有没有什么话想和我说？',
 ];
 for(const input of bounded)check('source, specific question, need and distress keep their actual direction: '+input,!isTopicInvitation(input)&&chooseConversationAction(input,[])!=='start-topic');
 check('exact original situated feeling is recognized',isDirectAffection(actual));
 check('exact original feeling is retained as user-authored source',directAffectionSources(actual).includes('刚闲下来就想你了'));
 check('existing combined invitation keeps affection without a second generic contract',buildHumanConversationContext(actual,[]).includes('先说你自己的心意')&&!buildHumanConversationContext(actual,[]).includes('用户把这轮话题的选择交给你'));
 for(const input of ['一闲下来就想你了。','我刚忙完就想你了。'])check('situated first-person feeling: '+input,isDirectAffection(input));
 for(const input of ['朋友说，刚闲下来就想你了。','古月，我听朋友说，刚闲下来就想你了。','古月，朋友说，刚闲下来就想你了。','如果我闲下来就想你了。','刚闲下来就想你推荐的书了。','我刚想到如果有空就想你了。'])check('situated wording is not third-party, hypothetical or an object preference: '+input,!isDirectAffection(input));
 const native:any[]=[];
 for(const name of ['古月娜','陆雪琪']){
  const preset=harness.presets(true).find((p:any)=>p.name===name);await harness.setup({...preset,createdBy:owner,isPreset:false,isCustom:true},.5);
  const input=name==='古月娜'?actual:'雪琪，我是张小凡。今天的事情忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？';
  calls=[];const result=await harness.turn(input),main=calls.filter(c=>c.messages.at(-1)?.content===input),system=main[0]?.messages.find((m:any)=>m.role==='system')?.content??'';
  check(name+' actual request uses one combined invitation',main.length===1&&!result.failed&&system.includes('用户直接表达了心意，也邀请聊些平常话')&&!system.includes('普通问句也在聊天'));
  check(name+' actual request preserves source rule and main thinking',system.includes('自己的往事、生活习惯和身体感受须有人设或独立生活记录支持')&&main[0]?.thinking?.type==='enabled');
  native.push({name,input,result,mainRequests:main});
 }
 return {complete:checks.every(c=>c.ok),checks,failures:checks.filter(c=>!c.ok),rows,native,paidCalls:0,realModelEffectVerified:false,scope:'Offline routing of exact failed genuine first turn and exclusions, actual sender requests with local fixed transport. Not a newly generated model conversation.'};
};
