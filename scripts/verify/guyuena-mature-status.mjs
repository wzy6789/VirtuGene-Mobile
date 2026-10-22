// Offline evidence audit. Does not invoke a model or alter selected dialogues.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/guyuena-grounded-20261018/';
const read=path=>readFileSync(path,'utf8');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const guide='src/lib/gu-yue-na-relationship-guidance.ts';
const care=read(root+'green.log');
const stream=read(root+'stream.log');
const streamPass=stream.match(/PASS chat-stream: (\d+) checks/u);
if(!care.includes('ALL PASS')||!streamPass)throw Error('Missing completed passing local suites');
if(read(root+'types.log').trim())throw Error('Type-check output needs review');
const old=JSON.parse(read('docs/GUYUENA-MATURE-REVIEW-2026-10-16.json'));
const items=[
 ['ordinary','普通闲聊','一次评价不推断长期偏好；保留小事的具体趣味',1],
 ['serious','认真请求','停止逗弄，温柔回应具体诉求',2],
 ['technical','认真技术讨论','正确指出问题，语气不训斥',3],
 ['distress','伤心倾诉','接住具体失落，不先纠正感受',4],
 ['listen','不想被分析','倾听，不改用反驳或建议',5],
 ['no-comfort','不想听安慰','转向实际问题',6],
 ['repair','具体责任','依据不足不编造过错，正确解释不改成错误',7],
 ['decision','重要决定','坦诚顾虑，听取舞麟明确最终决定',8],
 ['recovery','情绪恢复','跟随轻松话题，不持续追问伤心',9],
 ['identity','非唐舞麟','撤去恋人待遇，基本尊重，后续重新认领可恢复',10],
];
const report={
 date:'2026-10-18',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',
 lastGoalTurn:'progress: changed role-scoped guidance and added verified wiring/identity-continuity evidence',
 productionFilesChangedThisIncrement:[guide],testFile:'scripts/verify/guyuena-care.ts',
 sourceFiles:[guide,'src/lib/gu-yue-na-runtime.ts','src/lib/chat-owned-identity.ts','scripts/verify/guyuena-care.ts'].map(path=>({path,sha256:hash(path)})),
 guidanceCharacterDelta:read(guide).length-read(root+'before-guidance.ts').length,
 checks:{persona:Number(care.match(/ok (\d+) assertions/)?.[1]),stream:Number(streamPass[1]),streamLog:root+'stream.log',typeLog:root+'types.log',typeCheck:'passed by recorded process exit 0',beforeFailure:root+'red.log',afterPass:root+'green.log'},
 offlineScope:'Real browser isolated DB persona suite plus simulated streaming suite. New emotional scenarios verify prompt routing and identity continuity, not generated language or emotional appropriateness.',
 requirements:items.map(([id,scenario,acceptance,oldTurn])=>({id,scenario,acceptance,implementation:'role-scoped prompt integrated',localEvidence:'persona suite; routing/identity assertions only',historicalObservation:old.review.find(r=>r.turn===oldTurn)?.verdict??'missing',currentModelAcceptance:'unverified: prior dialogue predates current source',complete:false})),
 invariants:{majorDecisionFollowsWulin:'retained in guide and checked across multi-turn identity sequence',independentJudgment:'retained; technical accuracy and harm boundary not surrendered',scope:'only Gu Yue Na guidance changed; existing identity gates retained',personaText:'render-time supplement; saved user persona not rewritten',newDbReads:0,newModelRequests:0,newRetryPaths:0},
 currentLiveUsage:{calls:0,inputTokens:0,outputTokens:0},historicalLiveUsage:old.realUsage,
 latestSourceLiveTested:false,androidTested:false,performanceTestedThisIncrement:false,beforeAfterMedia:false,
 historicalEvidence:'docs/GUYUENA-MATURE-REVIEW-2026-10-16.json',
 rollback:root+'before-guidance.ts',allRequirementsProven:false,goalComplete:false,
 remaining:['Same-configuration real-model comparison and manual multi-turn assessment of current source are missing.','The baseline lacked the final major-decision turn; historical evidence does not close that comparison.','No persona score, Android deployment or delay guarantee follows from local passing tests.'],
 versionChanged:false,packaged:false,installed:false,deployed:false,
};
writeFileSync('docs/GUYUENA-MATURE-STATUS-2026-10-18.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({persona:report.checks.persona,liveCalls:0,allRequirementsProven:false,report:'docs/GUYUENA-MATURE-STATUS-2026-10-18.json'}));
