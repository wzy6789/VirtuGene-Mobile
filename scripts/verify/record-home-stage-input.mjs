import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root='.tmp-preview/ui-overhaul-20261016/home-stage-input';
const input=JSON.parse(fs.readFileSync(root+'/final/result.json','utf8'));
const regression=JSON.parse(fs.readFileSync(root+'/final-regression/result.json','utf8'));
if(!input.pass||!regression.pass)throw Error('Homepage interaction checks must pass before recording.');
const files=['src/components/chat/useTodayStageSwipe.ts','scripts/verify/home-stage-input.mjs'];
const stage={recordedAt:new Date().toISOString(),cwd:process.cwd(),model:'未确认',reasoning:'未确认',actualUsage:{productModelCalls:0,microphoneCalls:0,imageGenerationCalls:0},files:files.map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),checks:{newInput:input.checks.length,existingSwipe:regression.checks.length,typescript:'passed',productionBuild:'passed',cssGzip:81805,cssGrowth:'14.96%'},preview:{url:'http://127.0.0.1:5397/',phone:'http://127.0.0.1:5397/app',pid:13472,command:'node scripts/preview-product-upgrade.mjs --port=5397',needsLocalService:true,syntheticData:true,modelNetworkMicrophoneAudioNativeBridge:'blocked'},limitations:['Chrome mobile viewport and synthetic touch are not Android validation.','No same-condition before/after video; failing before assertions and separate recordings are retained.','No APK, release, version update or website publication.','Existing project-wide UI plan remains incomplete; this record covers the homepage recommendation gesture only.','Codex sidebar project association not verified.'],evidence:{redDirection:root+'/before/result.json',redWheel:root+'/direction-fixed/result.json',redMomentum:root+'/momentum-before/result.json',accepted:root+'/final/result.json',regression:root+'/final-regression/result.json',build:root+'/final-build.log',budget:root+'/budget.log'}};
fs.writeFileSync(root+'/stage.json',JSON.stringify(stage,null,2)+'\n');
const base='D:/月起云归/VirtuGene/手机版';
fs.mkdirSync(path.join(base,'开发日志'),{recursive:true});
fs.appendFileSync(path.join(base,'开发日志/2026-10-16.md'),`

## 首页推荐栏：斜向起步与触控板滑动修复

- 工作目录：F:/VirtuGene-Mobile。实际可见模型及推理强度均未确认；产品模型、麦克风、图像生成实际调用均为0。
- 用户本轮要求修首页列表上方推荐栏滑动。本轮仅修改 useTodayStageSwipe.ts，未继续改写世界记录等并行模块。
- 复现：320px下先偏移8×8px再横向拖动，旧逻辑已锁成纵向，推荐栏不动；方向修复后发现横向wheel完全无反馈。另验证新增wheel初版大惯性会跨过几张卡再吸回，已限制单次连续手势的跟随位移不超过一屏。
- 修复：横/纵向采用对称方向判定，斜向起步保持待定；加入触控板横滑与Shift+滚轮，帧合并跟手、静止后吸附；按下可接管wheel未完成动作，切后台/失焦/尺寸变化/卸载清理延迟动作。保留原有260ms阻尼吸附、首尾阻力、减少动效、点击抑制和纵向列表滚动。
- 验证：320/390/430px新输入39项通过（含Chrome合成触摸斜向起步、横向wheel、中途接管、失焦与减少动效）；原滑动103项通过（深浅色、真实列表纵向滚动、触摸取消、尺寸变化、键盘）。类型检查与生产构建通过；CSS仍81805gzip、原基线+14.96%，本轮未修改CSS或预算基线。
- 证据：F:/VirtuGene-Mobile/${root}/stage.json；before/direction-fixed/momentum-before保留三次失败证据，final与final-regression保留通过记录及独立录屏。已查看final/390.png；没有同条件修改前后截图/录屏，不声称视觉像素对照或真机改善幅度。
- 预览：http://127.0.0.1:5397/，实际组件手机页/app；本地服务必须运行，当前PID13472；启动 node scripts/preview-product-upgrade.mjs --port=5397。模拟资料，模型外网/麦克风/音频/原生桥隔离，不读取真实手机资料。
- 限制：未进行Android真机触摸延迟/GPU验证；未打包、发布、改版本或更新官网；未确认侧栏项目归属。完整UI方案仍未完成。
`,'utf8');
fs.appendFileSync(path.join(base,'00-总览.md'),'\n- 首页推荐栏输入修复：斜向起步误锁纵向、触控板横滑及大惯性回跳已修；39新增+103原滑动检查、类型构建与CSS预算通过。5397预览已更新，Android手感待验。证据见home-stage-input/stage.json与当日开发日志。\n','utf8');
console.log(JSON.stringify(stage));
