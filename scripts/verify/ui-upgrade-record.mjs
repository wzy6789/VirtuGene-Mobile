import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const base='.tmp-preview/ui-overhaul-20261015';
const file=`${base}/requirements.json`,data=JSON.parse(readFileSync(file,'utf8'));
data.goalToolStatus='active: 持续完成这个方案';data.scopeClarification='User explicitly authorized implementation of all six phases; no further routine scope approval required.';
data.updatedAt=new Date().toISOString();
const evidence={
 'M1-01':['baseline/source-manifest.json','baseline/baseline-result.json'],
 'M1-02':['source-audit.json'],
 'M1-03':['concepts/home-draft.png','m2/latest.json'],
 'M1-04':['concepts/chat-v2.png','concepts/call-v2.png'],
 'M1-05':['ui-system/result.json','build-latest.json'],
 'M1-06':['ui-system/result.json'],
 'M2-07':['m2/2026-10-15T07-19-03-593Z/result.json'],
 'M2-08':['m2/2026-10-15T07-19-03-593Z/result.json'],
 'M2-09':['m2/2026-10-15T07-19-03-593Z/result.json'],
 'M2-10':['m2/2026-10-15T07-19-03-593Z/result.json'],
 'M2-11':['m2/2026-10-15T07-19-03-593Z/result.json'],
 'M2-12':['m2/2026-10-15T07-19-03-593Z/result.json'],
 'M3-14':['message-reading/result.json'],
 'M4-21':['voice-stage/result.json'],
 'M4-22':['voice-stage/result.json','voice-stage/existing-ui-regression.json'],
 'M4-23':['voice-stage/source-audit.json'],
 'M4-24':['voice-stage/result.json','voice-stage/existing-text-regression.json'],
};
for(const p of data.packages)if(evidence[p.id]){p.state=p.id==='M1-01'?'verified-baseline':'implemented-or-designed-partial-evidence';p.evidence=[...new Set([...p.evidence,...evidence[p.id]])];}
data.concepts={state:'Implementation reference selected under authorized direction; generated copy/brand/mascot deviations documented, not product screenshots.',imageGenCalls:7,issues:['Preserve existing wordmark and SoulOrb identity rather than generated serif/sprout mascot.','Real authored/stored data replaces generated sample copy.','Chat/call v2 replace rejected photographic default drafts.']};
data.remaining='Full M3 integration/performance, M5 Create/Style/world/memory/settings, complete M6 and Android gates remain. M1 component previews do not prove all production transition contracts.';
writeFileSync(file,JSON.stringify(data,null,2));
const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md';
appendFileSync(log,`\n## 整产品UI升级实施：舞台、角色空间与语音首轮\n\n- 用户已明确“直接按六阶段实施”，并要求持续完成。此前待确认记录由本条补正；总目标40包保持，尚未全部完成。工作目录F:/VirtuGene-Mobile；实际模型/推理强度/编码token费用均未确认，应用模型与麦克风调用0。概念ImageGen累计7次，费用与token未提供。\n- 首页新增TodayCharacterStage与真实最近消息选角；角色页新CharacterCover/character-space-model与角色空间，保留关系/群聊/助理/管理；公共theme-tokens及底栏精修。新增open-character-call走真实归属和会话准备。语音改224px原SoulOrb舞台、四个真实控制、当前字幕及确认播放历史，未伪造音量。\n- soul-handoff支持矩形头像裁切补偿、相同key中断当前位置接管、封面CSS光在聊天底层展开；修复210px头像被旧200px限额拒绝（头像定为200px）；进一步复现React19重复lazy包装导致约300ms重复Suspense使转场寻靶超时，lazyFeature缓存已加载组件并保持本次挂载身份，列表提前只预取聊天模块代码。未读数据、不启动发送。\n- 验证：最新tsc/build退出0；M2最终77项通过，36同条件截图＋大字与导航录屏，12套axe零违规/incomplete保留；旧handoff55通过。语音局部33、既有UI150及文字65通过；设计系统54项及两主题axe零违规。初两轮M2失败原报告完整保存（标签横滚测量修正、真实头像上限和lazy寻靶缺陷），不覆盖成绿。\n- CSS预算曾85799超81832，清理实际源码无引用选择器/未引用keyframes和被替代导航重复定义（保留前文件、逐规则证据）；最新81720gzip，对历史71159基线仍低于+15%，未改预算基线。阅读气泡去厚阴影、代码/列表/安全链接显示层11项检查通过；原传输已丢失的格式无法由UI恢复。\n- 概念和实际截图已view_image对照首页、角色空间、聊天/语音：保留现有字标、小球与真实文案为有意差异；首页舞台/个人空间构图已落地，聊天输入继续改进，不能称整套视觉验收完成。没有改前完整录屏，保留真实改前36截图；不回滚并行代码造基线。\n- 证据F:/VirtuGene-Mobile/.tmp-preview/ui-overhaul-20261015/：requirements.json、baseline、concepts、m2/2026-10-15T07-19-03-593Z/result.json、voice-stage、ui-system、obsolete-css-audit.json、obsolete-keyframes-audit.json、message-reading。并行源码冲突快照在conflict-snapshot，未恢复覆盖他人改动。\n- 本机隔离预览5290（需要node scripts/preview-product-upgrade.mjs --port=5290；服务源码为启动时快照，可能落后最新源码），设计组件5291（node scripts/preview-ui-system.mjs）。模拟角色/本地传输，禁止模型网络、麦克风、播放/native；不是Android真音频、IME、GPU、温升验收。未生成APK、未改版本、未上传官网；项目归属缺可确认官方迁移接口，未改内部数据库。\n`);
appendFileSync('D:/月起云归/VirtuGene/手机版/00-总览.md','\n- [[开发日志/2026-10-15#整产品UI升级实施：舞台、角色空间与语音首轮|整产品UI升级首轮]]：首页/角色空间/语音舞台已实现；M2 77项与handoff55通过，Create/Style/世界/全量验收继续，未打包发布。\n');
console.log('Updated requirement-specific evidence and mobile Obsidian log/index; goal remains active.');
