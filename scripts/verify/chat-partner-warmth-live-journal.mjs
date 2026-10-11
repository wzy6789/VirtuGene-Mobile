import {readFileSync as read,writeFileSync as write,appendFileSync as append,existsSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版',date='2026-10-11';
const paths=['GUYUENA','LUXUEQI'].map(role=>`docs/${role}-LIVE-PARTNER-DAILY-WARMTH-HOLDOUT-R1-${date}.json`);
const groups=paths.map(path=>({path,...JSON.parse(read(path,'utf8'))}));
if(groups.some(group=>!group.complete||group.usage.missingUsage||group.rows.some(row=>row.failed)))throw Error('Incomplete live evidence');
const usage=groups.reduce((sum,g)=>({calls:sum.calls+g.usage.calls,input:sum.input+g.usage.input,output:sum.output+g.usage.output,total:sum.total+g.usage.total}),{calls:0,input:0,output:0,total:0});
const evidence=`release/chat-partner-warmth-live-evaluation-${date}.json`;
write(evidence,JSON.stringify({usage,groups:groups.map(g=>({path:g.path,usage:g.usage,rows:g.rows.map(row=>({input:row.input,replies:row.replies}))})),qualityComplete:false,assessment:{gu:'Invents a real cooking premise, follows user choice then criticizes a position the user explicitly did not take.',lu:'Softer ordinary response but changes choice toward the user, and adds a conditional action instead of expressing more of her own preference.',identity:'Both terminate partner warmth on explicit identity exit in this sample.'},scope:'Actual private send and isolated IndexedDB; production thinking enabled, max output 500; summaries/extraction/settlement mocked. Three turns each, no baseline comparison or broad naturalness score.'},null,2)+'\n');
const log=root+'/开发日志/'+date+'.md',heading='## 伴侣日常亲近：新话题真实三轮检查';
if(!read(log,'utf8').includes(heading))append(log,`\n${heading}\n- 上轮是具体关系表达方向修订，本轮使用新日常条件问句（一道菜淡了）→不同偏好→退出身份，不重复旧整理屋子/小葱样例。两位角色分别从独立会话开始，真实私聊send-service与IndexedDB，DeepSeek Flash生产思考开启low，每调用输出上限500；每组三轮，总调用最多6。原先生成的角色自述不作为独立新事实。\n- Gu首轮追问是不是自己做淡了，将假设转向未经提供的近况；第二轮放弃加调味的选择，最后“你要是非说每一口都要刚好…较真”与用户明确“不一定追求”相反。Lu首轮较柔和，第二轮从加调味转到同意淡着吃，未体现稳定的独立取舍；替添盐是条件里的行动意愿，不宣称真正做过，但也没有带来鲜明观点。两角退出后都冷淡，不能用这一通过掩盖前三轮整体表达问题。\n- 两组都完成、每轮仅一次首稿stop，不等于人味达标。没有成对旧配置基线，不能因Lu单样本柔和便宣称修改有稳定因果收益。无额外评审、摘要、提取或结算付费，真实上游非流式，非Android真机。\n- 实际6调用/input ${usage.input}/output ${usage.output}/total ${usage.total}，含推理；Gu8183、Lu10704，全部usage齐全。原稿${paths.join('、')}；汇总${evidence}；日志release/chat-partner-warmth-gu-live-${date}.log与chat-partner-warmth-lu-live-${date}.log。\n- 对话原话整组保留手机版聊天验收，不拼接、不删问题句；目前每角色此新场景只有R1，作为唯一版本留档，不标优秀或达标。技术判断单记这里。\n- 当前方向尚未改善Gu，后续应查声音参考与具体问句理解，而非继续堆温柔禁令。版本6.0.14保持，本轮未打包发布，近真人目标仍未完成。\n`);
for(const g of groups){
 const file=root+`/聊天验收/${g.roleName}-${date}.md`;
 if(!existsSync(file))write(file,`# ${g.roleName} · ${date}\n`);
 const heading='## partner-daily-warmth-holdout / r1（饭菜口味、不同偏好与退出身份）';
 if(!read(file,'utf8').includes(heading))append(file,'\n'+heading+'\n\n'+g.rows.map(row=>`**chatgpt**：${row.input}\n\n`+row.replies.map(reply=>`**${g.roleName}**：${reply}`).join('\n\n')).join('\n\n')+'\n');
}
const direction=root+'/优化方向/'+date+'.md',mark='## 日常亲近实测仍有失败';
if(!read(direction,'utf8').includes(mark))append(direction,`\n${mark}\n- Gu仍猜动机，并批评用户已经否定的立场。\n- Lu柔和了，但意见改变需要真实理由。\n- 新话题声音参考与内容理解优先，少堆抽象亲近要求。\n- 退出冷淡正确，不代替日常人味达标。\n`);
const index=root+'/00-总览.md',markIndex='伴侣日常真实检查：6调用/18887token';
if(!read(index,'utf8').includes(markIndex))append(index,`\n- ${markIndex}，两角色整组原话见[[手机版/聊天验收/古月娜-${date}|古月娜]]及[[手机版/聊天验收/陆雪琪-${date}|陆雪琪]]；失败与用量见[[手机版/开发日志/${date}|日志]]。尚未达标，未发布。\n`);
console.log(JSON.stringify({usage,evidence,qualityComplete:false}));
