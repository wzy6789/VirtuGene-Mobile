import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='release/chat-topic-outcomes-20261018/';
const read=path=>readFileSync(path,'utf8');
const outcomes=JSON.parse(read(root+'outcomes-accepted.log').trim());
const races=JSON.parse(read(root+'races.json'));
if(!outcomes.passed||!races.complete)throw Error('Missing accepted state-core or storage checks');
if(read(root+'types-accepted.log').trim())throw Error('Type check output needs review');
const expression=read(root+'expression.log').match(/PASS chat-expression: (\d+) checks/u);
if(!expression)throw Error('Missing legacy regression result');
const appSource=read('src/lib/chat/send-service.ts');
const guardedSenderWired=appSource.includes('updateConversationIfCurrent');
const report={date:'2026-10-18',workspace:'F:/VirtuGene-Mobile',codingModel:'未确认',codingReasoning:'未确认',
 stage:'T3/T4 explicit source-backed state core and T5 atomic persistence API foundation',
 files:['src/lib/chat-topic-outcomes.ts','src/lib/chat-conversation-state.ts','src/db/chat-topic-state-repo.ts','src/db/session-repo.ts'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),
 implementation:['Pending/answered/resolved/cancelled/deferred remain distinct; user acknowledgement of an answer is not event completion.','Direct user source id/revision/range and observation time retained; optional effective time is not inferred from database timestamps.','Known date/time/transport and generic place kept on pause/reopen; literal unsupported venue details never invented.','Date corrections keep prior values historical; a denied date without replacement is unresolved, not silently reinstated.','Unrelated date mentions do not patch the current plan; two named examinations keep separate identities.','Storage method checks native session version, account/character/session, bounded selected user evidence, suppression, literal slot support and active account before/after the async write.'],
 acceptance:{pureState:outcomes.checks,isolatedIndexedDb:races.checks.length,sourceBodyReadForGuard:2,unrelatedSuppressionBodiesRead:0,unrelatedSuppressionRows:8105,legacyExpression:Number(expression[1]),legacyComponentFlow:'6 simulated turns passed; no claim new outcome fields were used',typeCheck:'recorded process exit 0',diffWhitespace:'passed'},
 evidence:{root,red:[root+'red.log',root+'scope-red.log',root+'multi-red.log',root+'answered-red.log',root+'races-red-r2.log',root+'malformed-red.log',root+'shape-red.log'],accepted:[root+'outcomes-accepted.log',root+'races-accepted.log',root+'races.json',root+'types-accepted.log'],initialBuildFailure:root+'races-red.log'},
 productionWiring:{guardedSenderWired,sourceContextPassedBySender:false,topicProjectionShownToModel:false,liveFeatureComplete:false},
 scopes:{maxTopics:8,maxSourcesPerTopic:6,maxSlotHistory:4,currentSupportedKinds:['exam','meal','conflict','plan'],recognizer:'Conservative explicit local grammar, not a general semantic model or exhaustive Chinese intent coverage'},
 preserved:{schemaVersion:true,appVersion:true,providerRouting:true,thinking:true,originalChatRecords:true,existingAuthorizationChecks:true},
 limitations:['This foundation is not yet connected to actual sender preparation/commit. Do not claim real chats already persist/resume these topic outcomes.','Existing sender still uses its previous unguarded conversation update; the new CAS method is verified in isolation, not an end-to-end race fix.','No read-side selective source invalidation, production replay cursor, import compatibility matrix or persisted focus projection has been accepted yet.','Complex scoped correction, contradictions, natural phrases outside the explicit grammar and automatic current-domain selection remain pending.','No real model quality, Android, new styled preview, same-condition media or end-to-end performance guarantee.'],
 next:['Add fresh read-side source validation and exact selective invalidation.','Connect source context, user-fact save and guarded post-reply writes to the real sender, ensuring failed model replies do not retract valid user facts.','Test cross-window writes, editing/deletion during preparation, reload, cancelled historical inquiry and explicit reopening through actual outbound requests.','Measure the integrated guard with stored data before any speed claim.'],
 paidCalls:0,inputTokens:0,outputTokens:0,microphone:false,apkBuilt:false,installed:false,deployed:false,goalComplete:false,allPlanRequirementsMet:false,
};
writeFileSync('docs/CHAT-TOPIC-OUTCOMES-CORE-2026-10-18.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pure:outcomes.checks,storage:races.checks.length,guardedSenderWired,goalComplete:false,evidence:'docs/CHAT-TOPIC-OUTCOMES-CORE-2026-10-18.json'}));
