import {createRoot} from 'react-dom/client';
import {db} from '../../src/db';
import {useAuthStore} from '../../src/store/auth-store';
import {fakeCharacter} from './world-harness';
import {ChatQualityPanel} from '../../src/components/settings/ChatQualityPanel';
import {assessExpressionSignals,expressionDirection} from '../../src/lib/chat-expression-guidance';
import {detectHumanTurn,buildCharacterVoiceCard} from '../../src/lib/chat-humanizer';
import {inspectChatOutput} from '../../src/lib/chat-output-quality';
import {recordQualityEvent,recordChatQuality,chatQualityReport,clearChatQuality} from '../../src/lib/chat-quality-metrics';
import {voiceCacheStatus} from '../../src/lib/chat/voice-sample-cache';
import {EXPRESSION_SCENARIOS,EVALUATION_PERSONAS,runExpressionEvaluation,evaluationSummary} from '../../src/lib/chat-expression-evaluation';
import {EXPRESSION_SIGNAL_CORPUS} from '../../src/lib/chat-expression-corpus';
const owner='quality-test-owner';let root:ReturnType<typeof createRoot>|undefined;
async function run(){
  let checks=0;const ok=(value:unknown,label:string)=>{if(!value)throw Error(label);checks++;console.log('ok '+label);};
  await db.delete();await db.open();useAuthStore.getState().login(owner,'测试','isolated-test-key','');clearChatQuality();
  const role=fakeCharacter('quality-role','小林',owner,{systemPrompt:'称呼：小友\n判断习惯：先核对事实\n对话样本：用户说你好 → 你说在呢，小友'});await db.characters.add(role);
  const mixed=assessExpressionSignals('我累死了，那个报告你帮我看看呗');
  ok(EXPRESSION_SIGNAL_CORPUS.length===150,'fixed signal corpus contains 150 contrasting utterances');
  for(const entry of EXPRESSION_SIGNAL_CORPUS){const signals=assessExpressionSignals(entry.text);ok(signals.request===entry.request&&(!entry.situation||signals.situation===entry.situation),`fixed utterance: ${entry.text}`);}
  ok(mixed.request&&mixed.situation==='tired'&&mixed.emotionConfidence>=.8,'request and tiredness coexist');
  ok(detectHumanTurn('那个报告你帮我看看呗').mode==='request','postposed request chooses request action');
  for(const text of ['我不难过','她最近很难过','他说“我很累”','如果我很累呢','怎么安慰难过的人？'])ok(assessExpressionSignals(text).situation==='neutral',`no false personal feeling: ${text}`);
  for(const text of ['不用分析，陪我聊聊','不要帮我写报告','他说“帮我分析一下”'])ok(!assessExpressionSignals(text).request,`no invented request: ${text}`);
  ok(expressionDirection(assessExpressionSignals('难过')).includes('线索不足'),'uncertain emotion does not dictate tone');
  ok(inspectChatOutput('哈哈😂',{mode:'private',persona:'表情：不用 emoji'}).check.issue==='voice-conflict','explicit emoji preference has a local check');
  ok(inspectChatOutput('哈哈😂',{mode:'private',persona:'表情：不用 emoji',userMessage:'加个表情'}).check.ok,'current user expression choice overrides preference');
  ok(inspectChatOutput('老板，你看这个',{mode:'private',persona:'禁用称呼：老板、宝贝'}).check.issue==='voice-conflict','explicit forbidden address detected');
  ok(inspectChatOutput('嗯',{mode:'private',persona:'温柔'}).check.ok,'personality never forces padding or catchphrase');
  ok(voiceCacheStatus(role)==='authored'&&buildCharacterVoiceCard(role).includes('小友'),'authored voice stays authoritative');
  recordQualityEvent(owner,{mode:'proactive',retries:1,blocked:true,streamed:false,issue:'generic',durationMs:50});
  recordQualityEvent(owner,{mode:'group',retries:0,blocked:false,streamed:false});
  recordQualityEvent(owner,{mode:'private',retries:0,blocked:false,streamed:true,issue:'voice-conflict'});
  const report=chatQualityReport();ok(report.byMode.proactive.blocked===1&&report.byMode.group.checked===1&&report.byMode.private.streamedUnresolved===1,'mode diagnostics distinguish retries, blockage and visible issues');
  ok(!JSON.stringify(report).includes('老板'),'diagnostics store no message text');
  useAuthStore.getState().login('other-owner','别人','isolated-test-key','');
  recordQualityEvent(owner,{mode:'group',retries:0,blocked:false,streamed:false});ok(chatQualityReport().events.length===0,'late diagnostics cannot cross account boundary');
  useAuthStore.getState().login(owner,'测试','isolated-test-key','');ok(chatQualityReport().events.length===3,'original account restores only own diagnostics');
  recordChatQuality(owner,'（顿了顿，把手机放下）今天\n路过书店','今天路过书店',0,true,{durationMs:200,firstVisibleMs:50,streamed:true});
  const measured=chatQualityReport();
  ok(measured.samples[0].actionRemovedChars!>0&&measured.samples[0].collapsedLineBreaks===1&&measured.samples[0].introducedChineseSpaces===0,'cleanup metrics distinguish actions, newlines and introduced Chinese spaces');
  ok(measured.byMode.private.averageFirstVisibleMs===50,'first visible latency uses actual publication evidence');
  let calls=0;const original=window.fetch;const prompts:string[]=[];
  window.fetch=async(_url,init)=>{const payload=JSON.parse(String(init?.body));prompts.push(payload.messages[0].content);calls++;return new Response(JSON.stringify({choices:[{message:{content:`我想听你继续说这件事，第${calls}句。`},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
  try {
    const roles=EVALUATION_PERSONAS.map((p,i)=>({...role,id:`eval-${i}`,name:p.name,systemPrompt:p.prompt}));
    const matrix=await runExpressionEvaluation(roles,15,new AbortController().signal,()=>{});
    ok(matrix.complete&&matrix.rows.length===75&&calls===75,'five-role fixed matrix produces exactly 75 actual task calls');
    ok(EXPRESSION_SCENARIOS.length===15&&prompts.every(p=>p.includes('[人物声音卡]')),'each evaluation call receives authoritative voice context');
    ok(evaluationSummary(matrix).semanticStatus==='unrated','local success never pretends to be semantic acceptance');
    matrix.rows[0].ratings={naturalness:5,identity:0,context:5,truth:5};ok(evaluationSummary(matrix).rated===0,'partial manual scoring stays unaccepted');
    matrix.rows.forEach(r=>{r.ratings={naturalness:4,identity:4,context:4,truth:5};});ok(evaluationSummary(matrix).rated===75,'complete ratings aggregate explicitly');
    const long=await runExpressionEvaluation([role],30,new AbortController().signal,()=>{});ok(long.rows.length===30&&long.complete,'30-round continuity fixture completes without role rewrites');
    const cancel=new AbortController();cancel.abort();const before=calls;await runExpressionEvaluation([role],15,cancel.signal,()=>{});ok(calls===before,'cancelled evaluation performs zero model calls');
    ok(await db.messages.count()===0&&await db.sessions.count()===0&&(await db.characters.get(role.id))?.systemPrompt===role.systemPrompt,'evaluation writes no chats, sessions or persona changes');
    let published=0;
    window.fetch=async()=>{useAuthStore.getState().login('other-owner','别人','isolated-test-key','');return new Response(JSON.stringify({choices:[{message:{content:'这是旧账号的迟到回复'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
    const switched=await runExpressionEvaluation([role],15,new AbortController().signal,()=>published++);
    ok(switched.rows.length===0&&published===0,'account switch rejects late evaluation replies and progress');
    useAuthStore.getState().login(owner,'测试','isolated-test-key','');
  } finally{window.fetch=original;}
  return {checks};
}
function mount(){root?.unmount();root=createRoot(document.getElementById('app')!);root.render(<ChatQualityPanel open onClose={()=>root?.render(<div>已返回</div>)}/>);}
(window as any).qualityTest={run,mount};
