import './chat-human-live';
import {db} from '../../src/db';
import {compactOwnedJudgmentEcho} from '../../src/lib/chat-owned-judgment-compaction';
import {guYueNaPromptForTurn} from '../../src/lib/gu-yue-na-runtime';
import {buildCharacterVoiceCard} from '../../src/lib/chat-humanizer';
import {authoredVoiceFields} from '../../src/lib/character-voice-fields';
import {voiceIdentityWithoutExamples} from '../../src/lib/character-voice';
const api=window as any,harness=api.liveExpression,owner='isolated-live-expression-owner';
const input='古月，我是唐舞麟。今天的锻造总算忙完了，刚闲下来就想你了。你呢，有没有什么想和我说的？';
let calls:any[]=[];
window.fetch=async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return Response.json({choices:[{message:{content:'我也想你了。'},finish_reason:'stop'}]});};
api.runRuntimeVoiceEcho=async()=>{
 const checks:Array<{name:string;ok:boolean}>=[],rows:any[]=[];const check=(name:string,value:unknown)=>checks.push({name,ok:!!value});
 const gu=harness.presets(true).find((p:any)=>p.name==='古月娜'),lu=harness.presets(true).find((p:any)=>p.name==='陆雪琪');
 for(const text of [input,'古月，我是唐舞麟。想和你聊聊轩宇自己的兴趣。']){
  const projected=guYueNaPromptForTurn(gu,text,[],true),card=buildCharacterVoiceCard({...gu,systemPrompt:projected},text);
  const head=voiceIdentityWithoutExamples(projected),prompt=head+'\n\n'+card,result=compactOwnedJudgmentEcho(prompt,gu);
  const fields=authoredVoiceFields(projected,['判断习惯','在意的事']);
  const copied=fields.filter(f=>card.split('\n').some(l=>l.startsWith('人物判断依据')&&l.split('：').slice(1).join('：').split(' / ').includes(f.line)));
  check('at least one complete runtime judgment can transfer: '+text,copied.length>0);
  check('only a complete card-backed runtime duplicate is removed: '+text,copied.every(f=>result.split(f.line).length-1===1));
  check('the complete final voice card is byte-identical: '+text,result.endsWith(card));
  const withoutCopies=(value:string)=>value.split('\n').filter(line=>!copied.some(f=>f.line===line)).join('\n');
  check('all other head context is byte-identical: '+text,withoutCopies(result.slice(0,result.indexOf('[人物声音卡]')))===withoutCopies(head+'\n\n'));
  check('uncopied full fields and factual persona remain: '+text,fields.filter(f=>!copied.includes(f)).every(f=>result.includes(f.line))&&result.includes('银龙王'));
  check('runtime echo removal is idempotent: '+text,compactOwnedJudgmentEcho(result,gu)===result);
  const partial=card.replace('[/人物声音卡]',''),prefix='人物判断依据（具体设定优先于通用标签）：';
  const samples='[人物声音卡]\n声音样本：'+copied[0].line+'\n[/人物声音卡]';
  for(const [name,value]of [['unclosed',head+'\n'+partial],['samples',head+'\n'+samples],['two cards',prompt+'\n'+card]])check(name+' keeps original head: '+text,compactOwnedJudgmentEcho(value,gu)===value);
  const short='[人物声音卡]\n'+prefix+copied[0].line.slice(0,-1)+'\n[/人物声音卡]';
  check('truncated final field never authorizes deleting the full source: '+text,compactOwnedJudgmentEcho(head+'\n'+short,gu)===head+'\n'+short);
  check('other preset source does not authorize compaction: '+text,compactOwnedJudgmentEcho(prompt,{...gu,sourcePresetId:'another-role'})===prompt);
  const edited={...gu,systemPrompt:gu.systemPrompt.replace('判断习惯：','用户编辑的判断习惯：')};
  check('edited owned core is left intact: '+text,compactOwnedJudgmentEcho(prompt,edited)===prompt);
  rows.push({input:text,projected,card,prompt,result,copied:copied.map(f=>f.line),removedChars:prompt.length-result.length});
 }
 const native:any[]=[];
 for(const [preset,text]of [[gu,input],[lu,'雪琪，我是张小凡。刚闲下来就想你了。你有没有什么想和我说的？']]){
  await harness.setup({...preset,createdBy:owner,isPreset:false,isCustom:true},.5);
  const original=(await db.characters.get('isolated-live-role'))!.systemPrompt;
  calls=[];const result=await harness.turn(text),main=calls.filter(c=>c.messages.at(-1)?.content===text),body=main[0],system=body?.messages.find((m:any)=>m.role==='system')?.content??'';
  const card=system.match(/\[人物声音卡\][\s\S]*?\[\/人物声音卡\]/u)?.[0]??'';
  const fields=card.match(/人物判断依据[^：]*：(.*)/u)?.[1]?.split(' / ')??[];
  check(preset.name+' native sender retains one full copy of displayed judgments',main.length===1&&!result.failed&&fields.length>0&&fields.every((line:string)=>system.split(line).length-1===1));
  check(preset.name+' stored persona remains unchanged',(await db.characters.get('isolated-live-role'))?.systemPrompt===original);
  check(preset.name+' source contract and thinking remain intact',system.includes('事实来自用户直接陈述、人设和独立记录')&&body?.thinking?.type==='enabled');
  native.push({name:preset.name,input:text,result,mainRequests:main,originalPersona:original});
 }
 return {complete:checks.every(c=>c.ok),checks,failures:checks.filter(c=>!c.ok),rows,native,paidCalls:0,scope:'Exact app-owned complete judgment echoes only. Reaction hints, unique facts, stored personas and generation remain; fixed local transport is not model acceptance.'};
};
