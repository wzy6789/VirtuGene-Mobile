import {readFileSync as read,writeFileSync as write,appendFileSync as append} from 'node:fs';
const date='2026-10-11',root='D:/月起云归/VirtuGene/手机版';
const paths=[`docs/GUYUENA-LIVE-PARTNER-FAMILY-SMALL-TALK-HOLDOUT-R2-${date}.json`,`docs/GUYUENA-LIVE-SHARING-SCOPE-REACTION-HOLDOUT-R1-${date}.json`];
const groups=paths.map(path=>({path,...JSON.parse(read(path,'utf8'))}));
if(groups.some(g=>!g.complete||g.rows.length!==3||g.rows.some(r=>r.failed)))throw Error('Complete originals required');
for(const g of groups){const prompt=g.rows[1].calls[0].messages.find(m=>m.role==='system').content;if(!prompt.includes('接话本身体现听懂了')||prompt.includes('用户正在更正这次交流的用意'))throw Error('Current scope guidance not wired');}
const usage=groups.reduce((a,g)=>{for(const k of ['calls','input','output','total'])a[k]+=g.usage[k];return a},{calls:0,input:0,output:0,total:0});
const evidence=`release/chat-scope-reaction-evaluation-${date}.json`;
write(evidence,JSON.stringify({usage,groups:paths,bestFamilyWholeGroup:paths[0],humanQualityComplete:false},null,2)+'\n');
const journal=root+'/开发日志/'+date+'.md',mark='## 范围澄清接具体内容，减少防御说明';
if(!read(journal,'utf8').includes(mark))append(journal,`\n${mark}\n\n- 上轮是有效进展：实际消融证明撤除原句来源会误收器物好恶，已恢复；新家庭题暴露教学和防御。读取实际第二轮system发现范围澄清同时描述“正在更正、预先说明、误解、怎样倾听”，把接事变成评价交流过程。\n- 修改chat-humanizer respond-clarification为正向具体接话：“按本轮明确的交流范围…说感兴趣细节、自己的看法或感受，接话本身体现听懂了”。保留事实确需纠正时的更正和自己的不同好恶；没有改意图识别、授权、事实契约、身份或模型配置。不是为筷子新增规则。\n- 家庭R2实际三调用10277token：澄清轮没有“我没教你/你问得对”，回应孩子讲自己的道理，末轮退出舞麟后“不会”保持冷淡。但首轮仍追加拍照及菜凉，第二轮也转饭菜凉的坚持，有趣程度和温柔均未充分证明。首轮提示与上一版相同，首轮变化不能归因本次修改。整组R2优于R1防御版本，完整替换原话。\n- 新便签题三调用8278token：澄清轮没有争辩，沿笑脸细节聊，收尾简短；但首轮“好意思/小时候不觉得丑”刻薄且未给年龄，第二轮“肯定边画边笑”无来源判断，假设夹书补问也是多余。规则质检均首稿通过，不能据此认定好脾气或来源准确。只保存唯一整组作为待改进证据，不宣称合格。\n- 最初表达检查失败是旧提示措辞断言“仍保留你自己的感受和看法”，不是路由错误。更新对应输出契约断言，保留路由、引用、假设、新任务不覆盖的检查。最终表达2882项与类型检查通过，证据release/chat-scope-reaction-expression-final-${date}.log、chat-scope-reaction-types-${date}.log；初次失败release/chat-scope-reaction-expression-${date}.log保留。\n- 实际${usage.calls}调用/input ${usage.input}/output ${usage.output}/total ${usage.total}，usage齐全；每组最多6调用、输出500，没有额外付费评分/摘要。原稿${paths.join('、')}；汇总${evidence}；实际请求验证第二轮含新方向、不含旧说明。日志release/chat-gu-family-small-talk-r2-live-${date}.log、chat-gu-sharing-scope-live-${date}.log。\n- 原话chatgpt标记，与简短优化方向分开；Gu仍有刻薄打趣、动机与历史细节猜测，下一步检查亲近角色的幽默落点与来源，Lu未在本轮调用。未打包、未发布、版本6.0.16不变，完整目标未完成。\n`);
let chat=read(root+'/聊天验收/古月娜-'+date+'.md','utf8');
for(const [g,scene,revision,title] of [[groups[0],'partner-family-small-talk-holdout','r2','家庭小事与退出身份'],[groups[1],'sharing-scope-reaction-holdout','r1','便签分享与告别']]){
chat=chat.split(/\n(?=## )/u).filter(block=>!block.startsWith('## '+scene+' /')).join('\n').trimEnd()+`\n\n## ${scene} / ${revision}（${title}）\n\n`+g.rows.map(r=>`**chatgpt**：${r.input}\n\n`+r.replies.map(s=>`**古月娜**：${s}`).join('\n\n')).join('\n\n')+'\n';
}write(root+'/聊天验收/古月娜-'+date+'.md',chat);
const direction=root+'/优化方向/'+date+'.md',markDirection='## 澄清范围后接事情';
if(!read(direction,'utf8').includes(markDirection))append(direction,`\n${markDirection}\n- 缩短范围说明，接具体内容，不评价聊天过程。\n- 家庭题减少防御，仍多余安排。\n- 便签新题仍刻薄、补心理与年龄，未达标。\n`);
const index=root+'/00-总览.md',line=`- 范围澄清改进：${usage.calls}调用/${usage.total}token；家庭少防御，新题仍有刻薄与猜测，见[[手机版/开发日志/${date}|日志]]。`;
if(!read(index,'utf8').includes(line))append(index,'\n'+line+'\n');
console.log(JSON.stringify({usage,evidence,humanQualityComplete:false}));
