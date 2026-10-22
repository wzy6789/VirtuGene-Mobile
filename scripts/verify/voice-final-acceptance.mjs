import { readFileSync,writeFileSync,appendFileSync,copyFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
const dir='.tmp-preview/voice-final-acceptance-20261015';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const checks=[
 {requirement:'Default captions off; user can enable actual speaking text',status:'verified-local',evidence:'.tmp-preview/voice-call/ui-result.json',scope:'actual component and browser fixtures'},
 {requirement:'Continuous speech, long pauses, resumed clauses and short noise preserve real user text',status:'verified-local',evidence:'.tmp-preview/voice-call-boundary-audit-20261015/after.json',scope:'actual controller with manual ASR and synthetic PCM'},
 {requirement:'Overlap ASR, track setup and one next TTS without playing stale/future speech',status:'verified-local',evidence:'.tmp-preview/voice-call-latency-20261015/after.json',scope:'controlled virtual timing and cancellation; not real latency'},
 {requirement:'Fresh owner/source authorization before model transmission and audio',status:'verified-local',evidence:'.tmp-preview/voice-call-followup-20261015/transmission-after.json',scope:'revoked prepared-context contract'},
 {requirement:'Source checks do not repeatedly scan unrelated suppressed/continuity/moment rows',status:'verified-local',evidence:'.tmp-preview/voice-selected-suppression-20261015/full-call-summary.json',scope:'populated real IndexedDB with simulated model/audio'},
 {requirement:'World-specific knowledge query preserves context and reads only that world',status:'verified-local',evidence:'.tmp-preview/voice-knowledge-scope-20261015/audit.json',scope:'full model input hashes plus old-query oracle'},
 {requirement:'Out-of-order overlapping synthesis usage persists under correct request',status:'verified-local',evidence:'.tmp-preview/voice-latency-native-20261015/usage-after.json',scope:'actual store/controller and isolated DB; synthetic usage receipts'},
 {requirement:'Bluetooth route/start behavior and stable actual audio',status:'unverified-hardware',evidence:'.tmp-preview/voice-latency-native-20261015/playback-start-result.json',scope:'configuration doubles and Java compilation do not prove physical audio'},
 {requirement:'Extremely fast real-call response including ASR, provider queue, network, TTS and physical first sound',status:'unverified',evidence:'.tmp-preview/voice-call-provider-latency-20261015/dry-run-2026-10-15T06-32-56-279Z/report.json',scope:'dry-run only; user explicitly declined paid tests'},
 {requirement:'Natural rhythm under repeated real conversations and long calls',status:'unverified',scope:'no end-to-end human listening evaluation this iteration'},
];
const ui=read('.tmp-preview/voice-call/ui-result.json');
if(ui.checks!==151||ui.realApiCalls!==0)throw Error('Default-caption browser evidence missing');
const files=['src/lib/voice-call/controller.ts','src/lib/voice-call/utterance.ts','src/lib/voice-call/context.ts','src/lib/voice-call/mimo.ts','src/lib/character-memory.ts','src/db/knowledge-repo.ts','src/db/memory-source-tombstone-repo.ts','src/store/voice-call-store.ts','src/components/chat/VoiceCallDialog.tsx','scripts/verify/voice-call-ui.mjs'];
const audit={date:'2026-10-15',workdir:'F:/VirtuGene-Mobile',model:'GPT-6',reasoning:'未确认',goalComplete:false,checks,
 actualProviderCalls:0,microphone:false,apkBuilt:false,versionChanged:false,published:false,
 currentIterationFix:'Restored default captions false; browser tests now assert no subtitle panel even while actual fixture speech is playing, then manual opt-in works.',
 currentRegression:{controller:327,latencyBoundaries:62,priorBugs:4,ui:151},
 assessment:'Local implementation is reviewable. No evidence supports claiming actual calling speed achieved. Further speculative changes without a measured bottleneck are not justified.',
 preview:{command:'node scripts/verify/voice-call-rhythm-preview.mjs --serve --port 4206',address:'http://127.0.0.1:4206/?virtugene-preview=mobile',requiresLocalServer:true,scope:'Actual component UI, simulated state; no model, microphone or audible sound. Existing server may hold an earlier in-memory bundle; restart after closing it to load current source.'},
 noBeforeAfterScreenshotsThisIteration:true,
 hashes:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))};
copyFileSync('.tmp-preview/voice-call/ui-result.json',dir+'/ui-result.json');
writeFileSync(dir+'/audit.json',JSON.stringify(audit,null,2));
if(process.argv.includes('--log')){
 const log='D:/月起云归/VirtuGene/手机版/开发日志/2026-10-15.md',heading='语音当前状态对齐：字幕默认回退修复与未达标项';
 if(!readFileSync(log,'utf8').includes('## '+heading))appendFileSync(log,`\n\n## ${heading}\n\n- 工作目录F:/VirtuGene-Mobile；可见编码模型GPT-6、推理强度未确认。实际产品模型API0、tokens0，无麦克风；用户已拒绝付费测试，不再重复询问或发请求。未升版/打包发布。\n- 当前源码对齐时发现VoiceCallDialog的captions已变成true，与用户明确默认不需要字幕冲突；只把默认恢复false，保留手动开启、说话内容与原文查看，其余并行UI不覆盖。验证脚本旧注释也默认on，改为检查播放中仍无字幕，再手动开启；151项浏览器检查通过。没有本轮同条件改前UI截图，不伪造。\n- 本轮当前控制器327、调度62、前轮4个bug回归通过；tsc与网页构建通过，保留已有混合引用/包体积警告。此次字幕布尔初值修改后再次通过实际组件UI回归；完整前轮套件不重复声称全本轮复跑。\n- 逐项验收清单与当前文件hash：F:/VirtuGene-Mobile/${dir}/audit.json。本地已证明连续语音与迟续说不丢、短噪声不永久等待、逐包来源/撤权与用量归属、已选来源精确读取；这些证据的范围均标为模拟或真实隔离DB，不混成物理通话。\n- 缺失：真实ASR/模型排队/网络/TTS首音频及Android物理首声；蓝牙硬件稳定与长通话人类听感。当前没有证据可认定“反应极快、达到真实电话”已实现，不调用complete，不缩小原目标。没有明确测得的本地瓶颈时不追加猜测式改动。用户已拒绝付费/此前未要求真机，继续尊重边界。\n- 预览启动node scripts/verify/voice-call-rhythm-preview.mjs --serve --port 4206，地址http://127.0.0.1:4206/?virtugene-preview=mobile，需本地服务，真实UI＋模拟状态，模型/麦克风/声音隔离；旧常驻进程可能持有旧bundle，当前源码须重新启动服务才更新。无官方侧栏迁移接口，未编辑Codex内部数据库。\n`);
 const index='D:/月起云归/VirtuGene/手机版/00-总览.md',entry='- [[手机版/开发日志/2026-10-15|语音验收状态对齐]]：修复字幕默认开启回退；本地与真实通话验收逐项区分，整体速度目标未达标确认。';
 if(!readFileSync(index,'utf8').includes(entry))appendFileSync(index,'\n'+entry+'\n');
}
console.log(JSON.stringify({evidence:dir+'/audit.json',goalComplete:false,unverified:checks.filter(x=>x.status.startsWith('unverified')).map(x=>x.requirement)}));
