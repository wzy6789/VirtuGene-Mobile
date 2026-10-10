import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
const root='D:/月起云归/VirtuGene/手机版';
const evidence='release/chat-selected-identity-replay-2026-10-10.json';
const replay=JSON.parse(readFileSync(evidence,'utf8'));
if(replay.modelCalls!==0||replay.evidence.length!==4||replay.evidence.some(row=>!row.pass))throw Error('Both characters must pass retry/block/save replay');
const checks=readFileSync('release/chat-selected-identity-expression-2026-10-10.log','utf16le');
if(!checks.includes('PASS chat-expression: 2752 checks'))throw Error('Expression verification missing');
if(readFileSync('release/chat-selected-identity-types-2026-10-10.log','utf16le').trim())throw Error('Types must be clean');
const heading='## 两位角色的当前身份选择校验';
if(!readFileSync(root+'/开发日志/2026-10-10.md','utf8').includes(heading)){
 appendFileSync(root+'/开发日志/2026-10-10.md',`\n${heading}\n- 本轮同时包含古月娜与陆雪琪。仅应用认证的未改写预设、当前原话直接选择伴侣身份时启用明确否定校验；不因倾诉、好感、第三方转述、假设而打开亲近。普通独立情绪、拒绝闲聊、引用和否定引用继续放行。\n- 实际Gu长组最后一轮“扮演的不算”是模型违背应用关系。共享inspectChatOutput新增可选已校验角色上下文，明确身份冲突接已有voice-conflict/最多一次纠正。此类当前直接认领先审后显示，即使属于故事扮演也不豁免。两稿仍冲突时走原失败入口，不写assistant、不生成罐头情话。后置统计使用同样上下文。只覆盖私聊当前选择，未宣称所有模式和所有语义变体已覆盖。\n- ${evidence}：实际私聊发送与隔离IndexedDB，分别恢复两组各7轮原始前情，4项流程通过；Gu否定稿为真实旧捕获，复用到Lu以及第二稿“我也想你”为明确的测试替身，仅证明重试/拦截/落库，不证明真实模型人味或实际纠正成功。全部零网络付费，零新增token。\n- 本地聊天2752项与类型检查通过；证据release/chat-selected-identity-expression-2026-10-10.log、release/chat-selected-identity-types-2026-10-10.log。初版正则错误转义导致浏览器启动超时，已修正后完整重跑；回放通过但构建工具的既有import.meta IIFE警告使PowerShell退出状态为1，逐项JSON结果均通过，未重复执行或付费。\n- 保守模式匹配仍有边界，未验证新的真实模型续聊；不能据此认定情感表达、长聊漂移和身份遵循全部达标。未写入聊天精选，未改用户原聊天或人设。6.0.13不变，无打包或发布。\n`);
 appendFileSync(root+'/优化方向/2026-10-10.md','\n## 两位角色的身份接续\n- 古月娜与陆雪琪一起优化，分别记录真实效果。\n- 用户当前明确选择故事身份后，不用旧拒绝否定现在的关系。\n- 保留不同性格与独立情绪，不用统一情话兜底。\n- 本地流程已过，真实纠正与更广表达仍待观察。\n');
 appendFileSync(root+'/00-总览.md','\n- 两位角色当前身份接续校验：聊天2752项、类型和4项私聊DB回放通过，零新增模型调用；真实纠正效果未验收，无发布。\n');
}
writeFileSync('release/chat-selected-identity-evaluation-2026-10-10.json',JSON.stringify({expressionChecks:2752,replayCases:4,modelCalls:0,tokens:0,qualityComplete:false,evidence},null,2)+'\n');
console.log('Recorded mobile-only evidence and limits; zero model calls, no release');
