import {readFileSync as read,writeFileSync as write} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',date='2026-10-11';
function log(path){const b=read(path);return b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');}
const paths={gu:`release/chat-family-stage-gu-${date}.log`,expression:`release/chat-family-stage-expression-${date}.log`,types:`release/chat-family-stage-types-${date}.log`};
if(!log(paths.gu).includes('ok 324 assertions')||!log(paths.expression).includes('PASS chat-expression: 3483 checks')||log(paths.types).trim())throw Error('Local evidence missing');
if(JSON.parse(read('package.json','utf8')).version!=='6.0.22')throw Error('Cancelled release version must be restored');
const evidence=`release/chat-family-stage-evidence-${date}.json`;
write(evidence,JSON.stringify({version:'6.0.22',paths,guAssertions:324,expressionAssertions:3483,typecheck:true,actualModelCalls:0,tokens:0,qualityComplete:false,publicationCancelled:true,source:'https://www.69shuba.com/txt/29586/25167995',limitations:['Original novel text read through an unofficial mirror, not publisher verification.','Chapter 1611 supports independent son and daughter-in-law relationship, not a numeric age or already completed Dragon God advancement.','Runtime compact context change has not had a fresh real model generation.','Two-day mental history, praise-seeking question and cold stranger accusation in prior R2 remain unresolved.']},null,2)+'\n');
for(const [name,role] of [['古月娜','唐舞麟'],['陆雪琪','张小凡']]){
 const p=`${root}/聊天验收/${name}-${date}.md`;let speaker=role;
 const s=read(p,'utf8').split('\n').map(line=>{if(line.startsWith('## '))speaker=role;if(/^\*\*chatgpt\*\*：/u.test(line)){const content=line.slice('**chatgpt**：'.length);if(/(?:先不|不再|不扮演|退出).{0,30}(?:我叫|我是|我叫做)阿远/u.test(content)||/(?:我叫|我是)阿远/u.test(content))speaker='阿远';return `**${speaker}**：${content}`;}return line;}).join('\n');write(p,s);
}
const p=root+'/开发日志/'+date+'.md',heading='## 普通开题保留团圆家庭阶段';
if(!read(p,'utf8').includes(heading))write(p,read(p,'utf8')+`\n${heading}\n\n- 复核《终极斗罗》第1611章原文：轩宇与秀秀各自融合斗铠、命名并返回自己的任务，文本明确公公与儿媳妇关系；古月娜仍用“孩子”称呼家人。读取渠道为非官方原文镜像，未得到出版社版本核验。[原文](https://www.69shuba.com/txt/29586/25167995)。据此不能断言数值年龄或当章已成龙神。\n- 完整原人设已定义团圆后、不把成年子女当幼童；精简背景以前仅保留“蓝轩宇是孩子”。只改只读运行时精简背景，保留长大、独立生活与白秀秀关系；亲属称呼不表示幼童，明确童年回忆或假设保留自己的时间范围。不改用户原文、数据库或完整家族资料。\n- 古月娜324项、聊天表达3483项和类型检查通过。证据：${evidence}及三个日志；这是本地机制检查，未新增真实模型对话，不能宣称模型已消除该误判。\n- 本轮模型调用0、token0。此前“再大一点学魂导器”缺少当前阶段依据；成年后学习新技能本身并非不可能，不能仅凭“学魂导器”判假。两天心理近况、索要夸奖式补问、对已退出身份者追加指责仍未解决。长期漂移与陆雪琪完整优化仍开放。\n- 按最新要求将今天的验收输入标签改为唐舞麟／张小凡，明确退出后的阿远仍标阿远，保留各整组原句与全部项目原稿；不把陌生人的话冒标为伴侣。今后仅测两个对应伴侣，不重新付费生成历史样例。\n`);
const directions=root+'/优化方向/'+date+'.md',direction='## 家常开题保留当前家庭阶段';
if(!read(directions,'utf8').includes(direction))write(directions,read(directions,'utf8')+'\n'+direction+'\n\n- 儿子已长大；亲属称呼不改成年龄判断。\n- 童年回忆、假设和当前日常分开；不为开题编近况。\n- 先继续古月娜，再优化陆雪琪；保持伴侣亲近、外人冷淡。\n');
const index=root+'/00-总览.md';if(!read(index,'utf8').includes('普通开题保留团圆家庭阶段'))write(index,read(index,'utf8')+'\n- 2026-10-11：普通开题保留团圆家庭阶段；本地324/3483项通过，无新增模型调用。[[手机版/开发日志/2026-10-11|证据与未解决项]]。\n');
console.log('Recorded stage projection, cancelled publication and speaker labels; zero new model calls');
