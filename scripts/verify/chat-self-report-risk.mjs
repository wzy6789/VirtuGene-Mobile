import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/lib/chat-self-report-risk.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {findSelfReportRisk}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let checks=0;
function check(value,label){if(!value)throw Error(label);checks++;console.log('ok '+label);}
for(const output of ['我一般会盯着锁屏等它主动交代','我也经常停留在解锁界面，脑子一片空白','哈哈。我经常喝咖啡到半夜','我通常看电影时吃苹果片','我平时吃苹果片看电影'])
  check(!!findSelfReportRisk(output),'unsupported concrete habitual statement: '+output);
for(const output of ['我喜欢苹果片','这我喜欢','脑子弹了个窗又被自己点掉了','我更喜欢慢节奏的故事','我经常想起你','我一般不会盯着锁屏','我从不盯着锁屏','她说“我一般会盯着锁屏等”','我一般会盯着锁屏吗？','如果有手机的话，我一般会盯着锁屏等它交代','比如你演一个角色，我一般会盯着锁屏等','我通常喝起水来很快','我经常吃亏但长记性了','我一般站在你这边考虑','我通常跑题后自己接回来','我平时看电影喜欢推理片','我经常吃这套说法'])
  check(!findSelfReportRisk(output),'non-declaration or preference remains allowed: '+output);
const candidate='我一般会盯着锁屏等它主动交代';
check(!findSelfReportRisk(candidate,'生活习惯：经常盯着锁屏发呆。'),'authored recurring physical habit supports statement');
check(!findSelfReportRisk(candidate,'',['生活记录：平时盯着锁屏发呆。']),'independent recurring habit record supports statement');
for(const source of ['对话样本：用户说忘了 → 你说我经常盯着锁屏发呆','不要说我经常盯着锁屏发呆','用户经常盯着锁屏发呆','昨天盯着锁屏发呆','喜欢盯着锁屏发呆','他说“我经常盯着锁屏发呆”','[角色声音样本]\n判断习惯：经常盯着锁屏发呆\n[/角色声音样本]'])
  check(!!findSelfReportRisk(candidate,source),'insufficient or different-owner source does not prove a recurring character habit: '+source);
check(!findSelfReportRisk('我经常吃'),'underspecified activity is left to semantic evaluation');
console.log(`PASS chat-self-report-risk: ${checks} source contrasts; no model calls`);
