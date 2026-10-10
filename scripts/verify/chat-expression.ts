import { polishChatResponse, checkReplyQuality, requestsRepetition, isLongFormRequest } from '../../src/lib/reply-quality';
import { splitReplyParts, normalizeChatResponse, normalizeChatQuotationEscapes, shouldPreserveChatEscapes, mergeReplyParts, computeMessageDelays } from '../../src/lib/chat-pacing';
import { streamedReplyParts } from '../../src/lib/chat-stream';
import { stripRoleplayActions } from '../../src/lib/ai/text';
import { buildCharacterVoiceCard, buildHumanConversationSections, buildHumanConversationContext, recommendConversationTemperature, chooseConversationAction } from '../../src/lib/chat-humanizer';
import { compileChatContext } from '../../src/lib/chat-context-compiler';
import { planCharacterIntent } from '../../src/lib/character-intent';
import { buildChatConversationStateContext, emptyChatConversationState, detectChatIntent, detectTopicMove, updateChatConversationState, inferReplyAction } from '../../src/lib/chat-conversation-state';
import { assessChatSituation, collectRecentReplyTurns, recentRhythmDirection, recentQuestionDirection, replyContainsSubstantiveQuestion } from '../../src/lib/chat-expression-guidance';
import { sendMessage,hasUserImageEvidence } from '../../src/lib/ai/deepseek';
import { generateCharacterPrompt } from '../../src/lib/ai/character-generator';
import { CHAT_MESSAGING_INSTRUCTION, withChatMessagingPolicy } from '../../server/chat-messaging-policy.mjs';
import { inspectChatOutput } from '../../src/lib/chat-output-quality';
import { generateProactiveMessage } from '../../src/lib/ai/proactive-chat';
import { generateGroupTurn } from '../../src/lib/ai/group-chat';
import { allowsDramaticReply, independentPreference, isAffectionQuestion, isDirectAffection, isViewExchange, isTopicInvitation, directChatGuidance,DIRECT_AFFECTION_DIRECTION,findUninvitedSharedPosture,omitUninvitedSharedPosture } from '../../src/lib/chat-expression-boundary';
import {hasSelfChosenPlan,conversationDeparture,correctsOwnFeeling,requestsCharacterPerspective,correctsConversationIntent,isTopicClarification,declinesThirdPartyAnalysis} from '../../src/lib/chat-turn-cues';
import { buildSceneTimeContext, buildRelationshipContext, buildRelationshipToneContext, buildUserEmotionContext,buildLifeContext,buildDayContext } from '../../src/lib/chat-context';
import {findCurrentSceneRisk} from '../../src/lib/chat-current-scene-risk';
import {buildPreferenceProposalContext} from '../../src/lib/chat-hypothesis';
import {findSelfReportRisk,omitUnsupportedSelfReportEpisodes} from '../../src/lib/chat-self-report-risk';
import {findCurrentActivityRisk,omitUnsupportedCurrentActivities} from '../../src/lib/chat-current-activity-risk';
import {findDomesticReferenceRisk,omitDomesticReferences} from '../../src/lib/chat-domestic-reference-risk';
import {findUserVisualRisk,omitUnsupportedUserVisual} from '../../src/lib/chat-user-visual-risk';
import { normalizeVoiceLines, voicePromptRevision, voiceIdentityWithoutExamples } from '../../src/lib/character-voice';
import { interactionMoment, interactionMomentForTurn, emotionalExpressionGuidance, selectVoiceExamples, authoredReactionLines, voiceExampleUserText } from '../../src/lib/chat-emotional-expression';
import {omitUnsupportedAffectionHistory,findAffectionHistoryRisk} from '../../src/lib/chat-affection-history-risk';
import {findUserHabitRisk,omitUnsupportedUserHabits} from '../../src/lib/chat-user-habit-risk';
import {readRecalledUserHabitSources} from '../../src/lib/chat-user-habit-sources';
import {db,type MemoryItem,type Message} from '../../src/db';
import {compactGuYueNaOwnedVoice} from '../../src/lib/gu-yue-na-voice-compaction';
import {GU_YUE_NA_CARE} from '../../src/lib/gu-yue-na-personality';
import {withDouluoRelations} from '../../src/lib/douluo-relations';
import {guYueNaRelationshipForTurn,guYueNaPromptForTurn} from '../../src/lib/gu-yue-na-runtime';
import {luXueQiRelationshipForTurn,luXueQiFamilyRisk,omitLuXueQiFamilyRisk} from '../../src/lib/lu-xue-qi-runtime';
import {ownedPartnerContext,ownedIdentityTransition,rejectsSelectedPartner,priorVisitorReplyIds} from '../../src/lib/chat-owned-identity';
import {requestsBriefReply} from '../../src/lib/chat-reply-size';
import {setsAsideNamedTopic} from '../../src/lib/chat-turn-cues';
import {assessExpressionSignals} from '../../src/lib/chat-expression-guidance';
import {compactOwnedJudgmentEcho} from '../../src/lib/chat-owned-judgment-compaction';
import {LU_XUE_QI_PRESET} from '../../src/lib/lu-xue-qi-preset';
import {buildChatHistoryWindow,boundChatHistory} from '../../src/lib/chat-history-window';
import {conversationalHypothesis,buildHypothesisContext} from '../../src/lib/chat-hypothesis';

async function run() {
  // Local risk and routing checks do not grade the model's personality.
  let checks = 0;
  const ok = (value: unknown, label: string) => { if (!value) throw Error(label); checks++; console.log(`ok ${label}`); };
  const shortRole={name:'测试角色',tags:['温柔'],systemPrompt:'判断习惯：有自己的观点。'};
  const plainShare='今天路过一条小路，看到有人把花盆排成一圈，觉得挺有趣。';
  const compactSections=buildHumanConversationSections(plainShare,[],shortRole,{compactOrdinaryReaction:true});
  ok(compactSections[0].text.includes('接这件小事，说出你自己此刻的反应。')&&!compactSections[0].text.includes('衡量这事值不值得'),'verified compact ordinary reaction uses a short participation direction');
  ok(compactSections[1].text.includes('人物判断依据'),'ordinary coaching compaction retains authored individuality');
  ok(buildHumanConversationSections(plainShare,[],shortRole,{compactOrdinaryReaction:true,interpersonalBoundary:'distant'})[0].text.includes('没有亲近或陪聊的意愿'),'compaction never softens the current visitor boundary');
  for(const input of ['帮我整理这段话','我很难过，就想说说','我想你了','不是想让你分析，只是分享一下','好，我先去忙了，回头聊']){
    ok(!buildHumanConversationSections(input,[],shortRole,{compactOrdinaryReaction:true})[0].text.includes('接这件小事，说出你自己此刻的反应。'),'nonordinary turn retains its own guidance despite compact option: '+input);
  }
  for(const input of ['我现在更喜欢清淡的汤。不是让你给我安排吃什么，只是告诉你。','我把书整理好了。不是要你告诉我怎么分类，只是分享一下。','刚跑完步。不是让你安排怎么休息，只是跟你说说。','今天把资料看完了。不是想让你解释为什么，只是告诉你。']){
    ok(correctsConversationIntent(input),'a direct purpose correction may follow an ordinary statement: '+input);
    ok(!replyContainsSubstantiveQuestion([input]),'interrogative words inside a declined request are not questions: '+input);
    ok(chooseConversationAction(input,[])==='respond-clarification','embedded declined planning does not turn a share into a question or request: '+input);
    const guidance=buildHumanConversationContext(input,[]);
    ok(guidance.includes('预先说明分享范围')&&guidance.includes('确有误解才简短更正'),'a preemptive sharing boundary does not imply the actor already misunderstood: '+input);
  }
  for(const input of ['朋友说，不是让你安排吃什么，只是告诉你。','如果我不是要你解释怎么做，只是分享，你会怎么回？','“不是让你安排吃什么，只是告诉你”，这是他说的。'])ok(!correctsConversationIntent(input),'reported or hypothetical purpose correction does not redirect the speaker: '+input);
  ok(replyContainsSubstantiveQuestion(['不是让你给我安排吃什么。我想问你自己喜欢什么？']),'a separate actual question remains a question after a declined request');
  ok(replyContainsSubstantiveQuestion(['我不是让你回答为什么吗。']),'an actual rhetorical question ending in ma survives the declined-request exclusion');
  const householdDraft='给一盆小葱取名……倒也认真。\n---\n若小鼎看见，怕是要给咱家那几盆也挨个取上一遍。';
  ok(findDomesticReferenceRisk(householdDraft)==='咱家那几盆','conditional child reaction still presupposes existing household possessions');
  ok(inspectChatOutput(householdDraft,{mode:'private',userMessage:'看到有人给一盆小葱取名字。'}).check.issue==='self-report-risk','shared quality inspector rejects an unsupported definite family prop');
  ok(omitDomesticReferences(householdDraft)==='给一盆小葱取名……倒也认真。','household fallback preserves the independent expressive reaction');
  for(const text of ['假如咱家养了那几盆葱，取名也挺好。','朋友说咱家那几盆也取了名。','“咱家那几盆也取了名”，这是他说的。','给一盆葱取名也挺好。'])ok(!findDomesticReferenceRisk(text),'proposed or reported possessions do not assert a new home prop: '+text);
  ok(!findDomesticReferenceRisk(householdDraft,'当前场景：咱家那几盆葱还在。'),'explicit authored current possessions remain usable');
  ok(!findDomesticReferenceRisk(householdDraft,'',['我家那几盆葱还在。']),'independent character record supports the same definite household reference');
  ok(!findDomesticReferenceRisk(householdDraft,'',[],['你家那几盆葱还在。']),'direct user-supplied character household detail can support the reference');
  ok(!!findDomesticReferenceRisk(householdDraft,'对话样本：用户说那几盆葱 → 你说咱家那几盆葱还在。'),'voice samples never establish current possessions');
  ok(!!findDomesticReferenceRisk(householdDraft,'',[],['假如你家那几盆葱还在呢？']),'user hypothetical question cannot establish current possessions');
  ok(!!findDomesticReferenceRisk(householdDraft,'',[],['朋友说你家那几盆葱还在。']),'a third-party report cannot establish the actor own definite possessions');
  for(const message of ['今天先不聊锻造了。刚才看到的云有点像猫。','现在不说海神缘了。说说那本书吧。','咱们先不提考试了，聊会儿电影。','我这次不聊工作了。','暂时不聊刚才的安排吧。']){
    ok(setsAsideNamedTopic(message),'a declared pause can name its subject: '+message);
    const state=updateChatConversationState({currentTopic:'之前的锻造安排',topicStatus:'active'},message);
    ok(state.userWantsToShift&&state.pausedTopics.includes('之前的锻造安排'),'named pause moves the old focus to background without deleting it');
    ok(chooseConversationAction(message,[{role:'user',content:'你怎么理解我对锻造的喜欢？'}])==='follow-topic','the conversational action follows the user reset rather than treating it as casual continuation');
  }
  for(const message of ['朋友说今天先不聊锻造了。','如果今天先不聊锻造了会怎样？','“今天先不聊锻造了”怎么翻译？','今天先不聊锻造了？','今天先不聊什么？','今天不是不聊锻造了。','我不是让你不聊锻造了。','帮我写一句，今天先不聊锻造了。','说到锻造，你怎么想？'])ok(!setsAsideNamedTopic(message),'reports, conditions, quotations, questions, negation and material do not establish a named pause: '+message);
  for(const message of ['我是舞麟。朋友说，今天先不聊锻造了。','我听他说，今天先不聊锻造了。','先不说了。','先不说也没关系。','不提也罢。'])ok(!setsAsideNamedTopic(message),'a later report or acceptance of silence is not a named-topic declaration: '+message);
  ok(setsAsideNamedTopic('我是舞麟。今天先不聊锻造了，聊聊云。'),'a real speaker identity before the named pause does not obscure it');
  for(const message of ['我认真准备的展示取消了，有点难过，不想分析。','练了很久，还是没弹顺，挺委屈的。','有点难过。','我收到想要的书了，有些高兴。','做了好几次，也还是有点难受。']){
    const signals=assessExpressionSignals(message);
    ok(signals.emotionConfidence>=.8,'a declarative feeling does not require an adjacent I/today prefix: '+message);
    ok(!signals.request,'a feeling utterance alone does not ask for solving: '+message);
  }
  for(const message of ['朋友的展示取消了，有点难过。','我朋友的展示取消了，有点难过。','我有个朋友，挺委屈的。','我有一个朋友，挺委屈的。','小说里的主角被拒绝了，有点难过。','那个角色没赶上，有点难受。','我听说展示取消了，她觉得有点难过。','如果展示取消了，有点难过，你会怎么做？','“有点难过”是什么意思？','帮我写一个独白，有点难过。','展示取消了，有点难过吗？','我看了一部有点难过的电影。','这是一段挺委屈的台词。'])ok(assessExpressionSignals(message).emotionConfidence<.8,'a report, quote, scenario, material, question or adjectival description cannot supply the speaker feeling: '+message);
  const connected='我认真准备的展示取消了，有点难过，不想分析。';
  for(const input of ['刚才说错了，其实带回来的是蓝色那本。','刚才我看错了，是左边那个。','我刚才记错了，应该是周五。']){
    ok(isTopicClarification(input),'an omitted first-person correction preserves its antecedent: '+input);
    ok(!detectTopicMove(input,'今天选的是灰色的本子。'),'ordinary correction does not manufacture a new subject: '+input);
    for(const [name,persona] of [['古月娜',GU_YUE_NA_CARE],['陆雪琪',LU_XUE_QI_PRESET.systemPrompt]])ok(buildHumanConversationSections(input,[],{name,systemPrompt:persona,tags:['温柔']})[0].text.includes('不要求他想清楚再说'),name+' receives a natural correction direction without judging the speaker');
  }
  for(const input of ['朋友说刚才说错了，其实是蓝色。','如果刚才说错了，其实是蓝色呢？','“刚才说错了，其实是蓝色”是什么意思？','刚才没说错，其实是蓝色。'])ok(!isTopicClarification(input),'reported, conditional, quoted and denied corrections do not install a current correction: '+input);
  ok(CHAT_MESSAGING_INSTRUCTION.includes('比较和玩笑也不交换归属')&&CHAT_MESSAGING_INSTRUCTION.includes('转述与引文保留其中原说话者'),'shared messaging policy keeps direct self-report and reported ownership separate');
  for(const thought of ['今天也想起你了。','我今日想到小凡了。','昨晚想起舞麟了。']){
    ok(findSelfReportRisk(thought)?.kind==='episode','dated completed thoughts retain their source requirement without an explicit I: '+thought);
    ok(!findSelfReportRisk(thought,'',['独立经历：'+thought]),'independently recorded dated completed thoughts remain available: '+thought);
  }
  for(const thought of ['今天也想你。','我现在想你。','如果今天也想起你了，会怎么样？','朋友说，今天也想起你了。','今天也想起你了吗？'])ok(!findSelfReportRisk(thought),'present affection, condition, report and question retain their scope: '+thought);
  ok(!inspectChatOutput('嗯，今天也想起你了。',{mode:'private',userMessage:'今天有点想你。'}).check.ok,'actual quality inspector catches the captured dated implicit-subject thought');
  const choiceVoice='对话样本：用户说你偏爱热闹还是安静 → 你说安静一点。这样想说什么，都能听清。';
  const unrelatedVoice='对话样本：用户说今天袜子穿错了 → 你说哈哈，两只袜子也有自己的意见。';
  const choiceOptions={allowUnrelatedNeutral:false};
  ok(selectVoiceExamples([unrelatedVoice,choiceVoice],'你喜欢长篇还是短篇？',choiceOptions)[0]===choiceVoice,'direct choice can use the actor own existing choice rhythm across objects');
  const exactChoice='对话样本：用户说你喜欢长篇还是短篇 → 你说短篇。有一句留下来，就够了。';
  ok(selectVoiceExamples([choiceVoice,exactChoice],'你喜欢长篇还是短篇？',choiceOptions)[0]===exactChoice,'same-object exact choice sample retains precedence over cross-object voice analogy');
  for(const input of ['如果读故事，你喜欢长篇还是短篇？','朋友问，你喜欢长篇还是短篇？','帮我写，你喜欢长篇还是短篇。','你喜欢长篇还是短篇这句话什么意思？','今天好累。','我先去忙了，回头聊。'])ok(!selectVoiceExamples([choiceVoice],input,choiceOptions).length,'direct-choice voice analogy is not injected into other contexts: '+input);
  const imaginedChoice='对话样本：用户说如果我们一道下山，你想去热闹处还是安静处 → 你说我想选安静些的地方。';
  ok(!selectVoiceExamples([imaginedChoice],'你喜欢长篇还是短篇？',choiceOptions).length,'hypothetical shared outing does not become a direct preference voice reference');
  const guChoiceCard=buildCharacterVoiceCard({name:'古月娜',sourcePresetId:'preset-guyuena',tags:['温柔'],systemPrompt:GU_YUE_NA_CARE},'你喜欢长篇还是短篇？');
  ok(guChoiceCard.includes(choiceVoice),'actual Gu voice card has an authored direct-choice rhythm instead of no relevant voice example');
  for(const message of ['你喜欢长篇还是短篇？','你喜欢整齐还是凌乱的书架','你个人偏爱长篇，还是短篇？','你喜欢哪种颜色？','你想选哪个？','朋友喜欢热闹。你喜欢安静还是热闹？']){
    ok(isViewExchange(message)&&detectChatIntent(message)==='question','standalone personal preference becomes a viewpoint invitation: '+message);
    for(const [name,persona] of [['古月娜',GU_YUE_NA_CARE],['陆雪琪',LU_XUE_QI_PRESET.systemPrompt]]){
      const prompt=buildHumanConversationSections(message,[],{name,systemPrompt:persona,tags:['温柔']})[0].text;
      ok(prompt.includes('这轮对方想听你的观点')&&prompt.includes('眼前事物的特点'),name+' receives an own-view direction for a standalone preference question: '+message);
    }
  }
  for(const message of ['朋友问，你喜欢长篇还是短篇？','如果一起去，你喜欢安静还是热闹？','我听他说，你喜欢长篇还是短篇？','“你喜欢长篇还是短篇？”','你喜欢长篇还是短篇这句话什么意思？','帮我写一段对白，你喜欢长篇还是短篇。','你喜欢我吗？','你喜欢哪种都行。','不要说你喜欢哪种。'])ok(!isViewExchange(message),'standalone preference detector preserves source, task and permission scope: '+message);
  for(const [name,persona] of [['古月娜',GU_YUE_NA_CARE],['陆雪琪',LU_XUE_QI_PRESET.systemPrompt]]){
    const character={name,systemPrompt:persona,tags:['温柔']};
    const vent='刚才写到一半被打断，有点烦。先不想办法，就和你说说。';
    const prompt=buildHumanConversationSections(vent,[],character)[0].text;
    ok(prompt.includes('用户这件事想先说出来')&&prompt.includes('温柔的语气不改变建议的性质'),name+' honors a current no-solutions declaration without a persisted caller option');
    const copied=buildHumanConversationSections(vent,[],character,{adviceStyle:'direct'})[0].text;
    ok(copied.includes('用户这件事想先说出来'),name+' current boundary overrides inherited direct-advice style');
    const state=updateChatConversationState(undefined,vent);
    const help='现在告诉我怎么办。给我一个简单的办法。';
    const resumed=updateChatConversationState(state,help,'',undefined,Date.now(),vent);
    ok(!resumed.topicAdvice,name+' later explicit help releases the same-subject boundary');
    const helpPrompt=buildHumanConversationSections(help,[{role:'user',content:vent}],character,{adviceStyle:'listen'})[0].text;
    ok(!helpPrompt.includes('用户这件事想先说出来')&&chooseConversationAction(help,[],character)==='finish-request',name+' explicit help remains a request even with an inherited listening preference');
    const reported=buildHumanConversationSections('朋友说先不想办法。',[],character)[0].text;
    ok(!reported.includes('温柔的语气不改变建议的性质'),name+' third-person advice refusal does not impose a user boundary');
    const closing=buildHumanConversationSections('我先去忙了，回头聊。',[],character,{adviceStyle:'listen'})[0].text;
    ok(!closing.includes('温柔的语气不改变建议的性质'),name+' closing is not turned into another listening discussion');
  }
  const connectedVoice=buildCharacterVoiceCard({name:'古月娜',tags:['温柔'],systemPrompt:GU_YUE_NA_CARE},connected);
  ok(connectedVoice.includes('人物情境反应')&&connectedVoice.includes('受挫回应：'),'actual Gu voice receives a directly stated feeling after her partner narrative');
  ok(chooseConversationAction(connected,[])==='stay-present','the direct feeling reaches a personal reaction rather than casual commentary');
  ok(assessExpressionSignals('有点难过。现在已经没事了。').emotionConfidence===0,'explicit recovery still supersedes a prior direct feeling');
  for(const message of ['朋友今天展示取消了，有点失落。','我朋友今天失利了，有点沮丧。','小说里的主角今天受挫了，有点难过。','她说今天没做好，有点难过。'])ok(assessExpressionSignals(message).emotionConfidence<.8,'a date or standalone setback clause in a report does not raise own-feeling confidence: '+message);
  ok(assessExpressionSignals('朋友的展示取消了，但我有点难过。').emotionConfidence>=.8,'an explicit first-person emotional switch remains supported despite preceding third-person context');
  for(const message of ['讲两句你的想法吧。','说几句你自己的看法。','先聊一点你的观点。']){
    ok(requestsCharacterPerspective(message),'a bounded quantity does not hide an invitation for this actor view: '+message);
    ok(chooseConversationAction(message,[])==='answer-directly','the current requested viewpoint receives its own response action');
  }
  for(const message of ['朋友说讲两句你的想法吧。','如果讲两句你的想法呢？','“讲两句你的想法”是什么意思？','不要讲两句你的想法。'])ok(!requestsCharacterPerspective(message),'quantity variants keep speaker, condition, quotation and negation boundaries: '+message);
  for(const message of ['帮我想一个展示作品的方式，简单一点。','简单点就行。','你回答短一点好吗？','这次回复简短一点。','帮我想个办法，一句就好。','展开说，还是短一点。']){
    ok(requestsBriefReply(message),'a current explicit short reply instruction is recognized: '+message);
    ok(directChatGuidance(message,[],[]).includes('这是本轮长度要求'),'the current size request reaches production delivery guidance');
  }
  for(const message of ['朋友说回复简单一点。','她想让我回答短一点。','如果回复简单一点呢？','“简单一点”是什么意思？','不用简单一点。','不是让你简单一点。','帮我写个故事，台词是简单一点。','简单一点，不过详细一点。','这是一个简单一点的方案。'])ok(!requestsBriefReply(message),'reports, quotes, hypotheses, denials, material and a later expansion are not a strict size request: '+message);
  const longSimple=['把作品拍清楚后放在一个固定文件夹，这样以后展示就不用重新整理。','照片按名称排好，视频也单独存好，然后挑选适合的平台发布。','还可以准备介绍，写清自己的创作思路，给朋友一个查看链接。','要是准备下一次展示，也可以提前设置好文件权限和展示顺序。'].join('---');
  const sizeCheck=checkReplyQuality(longSimple,'帮我想一个以后还能展示的方式，简单一点。');
  ok(sizeCheck.issue==='too-long'&&sizeCheck.retryHint?.includes('明确要求简单'),'short bubbles cannot bypass a current explicit brevity request by adding more parts');
  ok(checkReplyQuality('先拍几张能看清作品的照片，放到一个相册里。想给人看时直接发过去就行。','帮我想个办法，简单一点。').ok,'a brief useful suggestion is accepted');
  ok(checkReplyQuality('嗯。---可以。---我想想。','短一点。').ok,'tiny natural reaction parts are not forced into two bubbles');
  ok(checkReplyQuality(longSimple,'帮我想一个展示作品的方式。').ok,'ordinary conversation retains its normal message rhythm');
  for(const phrase of ['简单点','短一点','详细一点']){
    const state=updateChatConversationState(undefined,'帮我想一个办法，'+phrase+'。');
    ok(state.preferences.brevity==='balanced','the current task length does not become an enduring chat preference: '+phrase);
  }
  ok(updateChatConversationState(undefined,'以后回复短一点。').preferences.brevity==='short','an explicit continuing style preference is still stored');
  for(const message of ['我现在不想马上想办法。','我这次不想分析原因。','也不想马上找办法。','先不想办法。','我现在不想找谁的错。','不过今天有件小事有点失落。认真想好的一个提议没被采纳，我现在不想找谁的错，也不想马上想办法。']){
    const state=updateChatConversationState(undefined,message);
    ok(state.topicAdvice==='listen'&&state.preferences.adviceStyle==='mixed','declining solutions for this subject stays temporary: '+message);
    ok(state.topicStatus==='active'&&!state.userWantsToShift,'declining solutions does not close or change the subject: '+message);
    const context=buildChatConversationStateContext(state,message);
    ok(context.includes('不等于不想聊这件事')&&context.includes('不替他结束话题'),'actual conversation context distinguishes talking from solving');
    const continued=updateChatConversationState(JSON.parse(JSON.stringify(state)),'还有，我认真准备了挺久', '',undefined,Date.now(),message);
    ok(continued.topicAdvice==='listen','a same-subject follow-up keeps the scope across persistence');
    ok(!updateChatConversationState(continued,'现在告诉我怎么办').topicAdvice,'a later request for solutions releases the temporary boundary');
    ok(!updateChatConversationState(continued,'换个话题，你喜欢什么颜色？').topicAdvice,'an actual new subject releases the temporary boundary');
  }
  for(const message of ['朋友说我现在不想马上想办法。','她现在不想分析原因。','如果我现在不想马上想办法。','“我现在不想分析原因”怎么翻译？','我是不是不想分析原因？','我现在不想分析原因？','我现在不是不想分析原因。','我现在不想不分析原因。','帮我写一句回复，我现在不想分析原因。','我现在不想分析原因，告诉我怎么办。'])ok(!updateChatConversationState(undefined,message).topicAdvice,'unowned, uncertain, negated, written or superseded statements do not establish temporary no-solving: '+message);
  for(const message of ['不过今天有件小事有点失落。认真想好的一个提议没被采纳，我现在不想找谁的错，也不想马上想办法。','今天有一件事让我有点沮丧。','我最近有几件事挺失落的。','这件事让我有些失落。','不过那件小事让我有点沮丧。']){
    const signals=assessExpressionSignals(message);
    ok(signals.situation==='distress'&&signals.emotionConfidence>=.8,'an explicit personal feeling in an everyday event frame is heard: '+message);
    ok(!signals.request,'sharing a setback does not request a solution: '+message);
    const sections=buildHumanConversationSections(message,[],{name:'古月娜',tags:['温柔'],systemPrompt:GU_YUE_NA_CARE});
    ok(sections.some(section=>section.text.includes('人物情境反应')&&section.text.includes('受挫回应：')),'the actual Gu setback voice is selected: '+message);
  }
  for(const message of ['朋友今天有件小事有点失落。','她说今天有件小事有点失落。','如果今天有件小事有点失落。','“今天有件小事有点失落”是什么意思？','今天有件小事有点失落吗？','今天有件小事有点失落？','这件事让我并不失落。','今天有件小事没有让我失落。','今天有件小事。','今天有件失落的物品。','失落的城市是故事背景。','今天有件小事有点失落。现在已经没事了。']){
    ok(assessExpressionSignals(message).situation==='neutral','events, reports, conditions, questions, denial, object loss and recovery do not establish current distress: '+message);
  }
  ok(assessExpressionSignals('今天有件小事有点失落。算了，我们聊椅子吧。').situation==='distress','an explicit feeling is still evidence, not a diagnosis that changing topic erases it');
  for(const message of ['你这样说我有点不赞同。','你这么说我不太认同。','这个看法我并不赞成。','这句话我不完全同意。']){
    ok(interactionMoment(message)==='disagreement','a speaker locates their actual difference in the previous wording: '+message);
    ok(authoredReactionLines(GU_YUE_NA_CARE,message).some(line=>line.startsWith('分歧反应：')),'the actual Gu voice receives its disagreement reaction: '+message);
  }
  for(const message of ['嗯，那是我误会你的意思了。','原来是我误会你了。','是我刚才误会你的意思了。','那我误会你了。']){
    ok(interactionMoment(message)==='repair','self-owned misunderstanding is a repair rather than criticism of the actor: '+message);
    const guidance=emotionalExpressionGuidance(message,[{role:'user',content:'你这样说我有点不赞同。'},{role:'assistant',content:'我想的是自己坐得舒服。'}],{systemPrompt:GU_YUE_NA_CARE,tags:['温柔']});
    ok(guidance.includes('前面有明确分歧')&&guidance.includes('接住用户此刻说的歉意或解释'),'the current repair is connected to the actual prior difference: '+message);
  }
  for(const message of ['朋友说你这样说我有点不赞同。','如果你这样说我有点不赞同。','“你这样说我有点不赞同”是什么意思？','你这样说我不是不赞同。','你这样说我完全赞同。','你这样说我有点不赞同？'])ok(interactionMoment(message)!=='disagreement','reports, conditions, wording, double negation, agreement and questions are not a stated difference: '+message);
  for(const message of ['朋友说那是我误会你的意思了。','如果那是我误会你的意思了。','“那是我误会你的意思了”怎么翻译？','那不是我误会你的意思。','那是我误会你的意思了？'])ok(interactionMoment(message)!=='repair','unowned, conditional, quoted, denied and questioned repairs remain open: '+message);
  for(const message of ['我不赞同。','我有点不赞同你的看法。','我并不赞同这个观点。'])ok(interactionMoment(message)==='disagreement','direct everyday synonym remains a declared difference: '+message);
  for(const message of ['我不赞同？','我不赞同这句话是什么意思？'])ok(interactionMoment(message)!=='disagreement','the new synonym does not turn a question or wording task into a declaration: '+message);
  for(const [source,owned] of [['preset-guyuena',GU_YUE_NA_CARE],['preset-luxueqi',LU_XUE_QI_PRESET.systemPrompt]]){
    const role={sourcePresetId:source,systemPrompt:owned};
    const reaction=owned.split('\n').find(line=>line.startsWith('亲密反应：'))!;
    const other=owned.split('\n').find(line=>line.startsWith('分歧反应：'))!;
    const card='[人物声音卡]\n人物情境反应（具体设定优先，仅影响表达）：'+reaction+'\n[/人物声音卡]';
    const input=owned+'\n'+card,output=compactOwnedJudgmentEcho(input,role);
    ok(output===input,'authored reaction stays at its established head and card positions after unsuccessful compaction trial: '+source);
    ok(output.endsWith(card)&&output.includes(other),'all authored reactions and the tail card remain intact: '+source);
    ok(compactOwnedJudgmentEcho(output,role)===output,'reaction compaction is idempotent: '+source);
    for(const replacement of [reaction.slice(0,25),'声音样本：'+reaction,'补充引述 '+reaction]){
      const weak='[人物声音卡]\n人物情境反应（具体设定优先，仅影响表达）：'+replacement+'\n[/人物声音卡]';
      ok(compactOwnedJudgmentEcho(owned+'\n'+weak,role)===owned+'\n'+weak,'partial or embedded reaction does not authorize head removal: '+source);
    }
    ok(compactOwnedJudgmentEcho(input+'\n'+card,role)===input+'\n'+card,'multiple cards do not authorize reaction removal: '+source);
    ok(compactOwnedJudgmentEcho(input,{...role,sourcePresetId:'custom'})===input,'unrelated authored personas stay untouched: '+source);
    const judgment=owned.split('\n').find(line=>line.startsWith('判断习惯：'))!;
    for(const embedded of ['补充引述 '+judgment,'声音样本：'+judgment,'「'+judgment+'」']){
      const weak='[人物声音卡]\n人物判断依据（具体设定优先于通用标签）：'+embedded+'\n[/人物声音卡]';
      ok(compactOwnedJudgmentEcho(owned+'\n'+weak,role)===owned+'\n'+weak,'a judgment inside another value is not the complete copied field: '+source);
    }
  }
  for(const message of ['听见你说自己的心意，我挺开心的。先去做手头的事，回头再聊。','我挺开心的。先去忙，忙完再聊。','听到你说自己的看法，我很高兴。先去开会，结束再来。','这个话题先留着。先去忙，回头再聊。']){
    ok(!!conversationDeparture(message),'brief exchange reaction plus elided departure is a genuine closing: '+message);
    ok(chooseConversationAction(message,[])==='short-close','terminal departure wins over the prior feeling: '+message);
    const sections=buildHumanConversationSections(message,[{role:'user',content:'我今天有点难过。'},{role:'assistant',content:'是哪件事？'}],{name:'角色',systemPrompt:'称呼：舞麟\n判断习惯：爱憎分明',tags:['温柔']},{recentReplyTurns:[['怎么了？'],['然后呢？'],['你想怎么做？']]});
    const rhythm=sections.find(section=>section.key==='human-conversation')!.text;
    ok(rhythm.includes('用户正在收尾')&&rhythm.split('\n').length===2,'closing does not accumulate emotion, questions or cadence pressure: '+message);
    ok(sections.some(section=>section.key==='character-voice'&&section.text.includes('人物声音卡')),'closing still carries the character voice: '+message);
  }
  for(const message of ['我挺开心的。帮我看看报告。先去忙，回头再聊。','你怎么想？我先去忙，回头再聊。','我挺开心的。你觉得有必要吗。先去忙，回头再聊。','朋友说我挺开心的。先去忙，回头再聊。','如果我挺开心的。先去忙，回头再聊。','“先去忙，回头再聊”这句话你怎么理解。','我不开心。先去忙，回头再聊。','我挺开心的。先去哪里，回头再聊。','我挺开心的。先去忙，回头再聊，帮我写个待办。'])ok(!conversationDeparture(message),'substantive, reported, hypothetical or unresolved turns remain open: '+message);
  ok(conversationDeparture('这个话题先留着。先去忙，回头再聊。')?.topicDeferred,'the deferred topic remains explicit');
  for(const persona of [GU_YUE_NA_CARE,LU_XUE_QI_PRESET.systemPrompt]){
    const sections=buildHumanConversationSections('听见你说自己的心意，我挺开心的。先去做手头的事，回头再聊。',[],{name:'角色',tags:['温柔'],systemPrompt:persona});
    const voice=sections.find(section=>section.key==='character-voice')!.text;
    ok(!voice.includes('人物情境反应')&&!voice.includes('声音样本（'),'actual authored celebration samples do not reopen a closing turn');
    ok(voice.includes('人物判断依据')&&(!/^称呼：/mu.test(persona)||voice.includes('称呼习惯')),'closing retains actual authored identity and judgment rather than requiring nonexistent address fields');
  }
  for(const sources of [['我一直喜欢锻造。','我现在不喜欢锻造。'],['我现在喜欢安静。'],['现在我不爱吃甜食。'],['我如今喜欢热闹。']]){
    const predicate=sources.at(-1)!.replace(/^(?:我(?:现在|如今)|(?:现在|如今)我)/u,'').replace(/。$/u,'');
    for(const scope of ['一直','一向','向来','总是','每次'])ok(!!findUserHabitRisk('你'+scope+predicate+'。',sources),'a current preference update cannot authorize an unqualified persistent or universal history: '+sources.join('/'));
    ok(!findUserHabitRisk('你平时'+predicate+'。',sources),'present ordinary preference remains usable after correction: '+sources.join('/'));
  }
  ok(!findUserHabitRisk('你一直喜欢锻造。',['我一直喜欢锻造。']),'explicit independent persistent preference remains usable');
  for(const message of ['我就是喜欢听你说自己的想法。刚才也有点想你，所以来聊两句。','听你说自己的看法，我挺开心的。我也想你了。','我就喜欢你这样认真。今天想你了。']){
    ok(isDirectAffection(message),'an actual feeling is retained alongside praise or conversational preference: '+message);
    ok(interactionMoment(message)==='affection','a mixed feeling still selects the authored intimate reaction: '+message);
    ok(chooseConversationAction(message,[])==='respond-affection','a mixed feeling receives its own response action: '+message);
  }
  for(const message of ['我就是喜欢听你说自己的想法。刚才想到你说的那本书。','我喜欢听你的看法。朋友说他想你了。','“我有点想你”这句话怎么翻译？'])ok(!isDirectAffection(message),'liking a conversation, reported feelings and quotation tasks do not become a direct feeling: '+message);
  for(const [source,owned] of [['preset-guyuena',GU_YUE_NA_CARE],['preset-luxueqi',LU_XUE_QI_PRESET.systemPrompt]]){
    const fields=owned.split('\n').filter(line=>/^(?:判断习惯|在意的事)：/u.test(line));
    const card='[人物声音卡]\n人物判断依据（具体设定优先于通用标签）：'+fields.join(' / ')+'\n[/人物声音卡]';
    const prompt=owned+'\n'+card+'\n保留末尾协议',role={sourcePresetId:source,systemPrompt:owned};
    const compact=compactOwnedJudgmentEcho(prompt,role);
    ok(compact.length<prompt.length,'exact owned judgment echo is removed only from the head: '+source);
    ok(compact.endsWith(card+'\n保留末尾协议'),'complete card and following policy remain byte-identical: '+source);
    ok(fields.every(line=>compact.split(line).length===2),'each complete judgment is retained exactly once: '+source);
    ok(compactOwnedJudgmentEcho(compact,role)===compact,'judgment echo compaction is idempotent: '+source);
    ok(compactOwnedJudgmentEcho(owned+'\n[人物声音卡]\n声音样本：'+fields[0]+'\n[/人物声音卡]',role)===owned+'\n[人物声音卡]\n声音样本：'+fields[0]+'\n[/人物声音卡]','a voice example cannot substitute for the actual judgment card: '+source);
    const truncated=owned+'\n'+card.replace(fields.join(' / '),fields[0].slice(0,20));
    ok(compactOwnedJudgmentEcho(truncated,role)===truncated,'truncated judgment never authorizes head removal: '+source);
    ok(compactOwnedJudgmentEcho(prompt+'\n'+card,role)===prompt+'\n'+card,'multiple voice cards are left untouched: '+source);
    ok(compactOwnedJudgmentEcho(prompt,{...role,sourcePresetId:'other'})===prompt,'unrelated source remains untouched: '+source);
    const removed=new Set(fields);
    ok(owned.split('\n').filter(line=>!removed.has(line)).every(line=>compact.includes(line)),'all identity, facts, relationships, reactions and custom text stay intact: '+source);
  }
  const editedLu={sourcePresetId:LU_XUE_QI_PRESET.id,systemPrompt:LU_XUE_QI_PRESET.systemPrompt+'\n用户自定判断'};
  const luFields=LU_XUE_QI_PRESET.systemPrompt.split('\n').filter(line=>/^(?:判断习惯|在意的事)：/u.test(line));
  const editedLuPrompt=editedLu.systemPrompt+'\n[人物声音卡]\n人物判断依据（具体设定优先于通用标签）：'+luFields.join(' / ')+'\n[/人物声音卡]';
  ok(compactOwnedJudgmentEcho(editedLuPrompt,editedLu)===editedLuPrompt,'edited Lu source is never compacted even when the card duplicates its original fields');
  for(const text of ['倒也没什么大事，不用安慰我了。我只是喜欢把这些小事告诉你。','别再哄我了，我只是想跟你说一下。','你不必鼓励我。我就喜欢和你分享这些。','倒也不用鼓励我了。我只是喜欢把这些小事告诉你。','其实你不必安慰我。我只是想和你说一下。','真的别再哄我了。我只是喜欢跟你分享。']) {
    ok(correctsConversationIntent(text),'declining comfort with an explicit sharing intention is a conversational correction: '+text);
    ok(chooseConversationAction(text,[])==='respond-clarification','sharing correction does not continue generic emotion commentary: '+text);
    ok(buildHumanConversationContext(text,[]).includes('仍保留你自己的感受和看法'),'sharing correction leaves the character free to react personally: '+text);
  }
  for(const text of ['不用安慰我了。','朋友说不用安慰我了，我只是想告诉你这句话。','如果不用安慰我了，我只是想告诉你呢？','“不用安慰我了，我只是喜欢把小事告诉你”','不用安慰我了，我只是想让你帮我改稿。','不用安慰我了。我不喜欢把这些事告诉你。'])ok(!correctsConversationIntent(text),'missing, reported, hypothetical, quoted or different replacement intention is not sharing clarification: '+text);
  ok(!correctsConversationIntent('不用安慰我了。我只是想把稿子改完。'),'an unrelated desired action after 把 is not a sharing intention');
  for(const text of ['你觉得非得有一个人让步吗？','你觉得故事结尾一定要圆满吗？','你觉得改口算不算没有主见？','你个人觉得这件事值不值得做？','先聊别的。如果故事里两个人意见不一样，你觉得非得有一个人让步吗？']){
    ok(isViewExchange(text),'direct evaluative question invites a personal view: '+text);
    ok(directChatGuidance(text,[],[]).includes('用户邀请你说真实看法'),'personal view guidance reaches evaluative questions even after a topic change: '+text);
  }
  for(const text of ['你觉得我昨天几点睡的？','朋友说你觉得非得有一个人让步吗？','“你觉得故事结尾一定要圆满吗”','如果你觉得改口算不算没有主见','不用说你觉得有没有必要','你觉得有没有必要，帮我写个方案'])ok(!isViewExchange(text),'fact guesses, reports, quotes, hypotheses, negations and tasks do not become view exchanges: '+text);
  for(const text of ['朋友倒也不用鼓励我了。我只是喜欢把这些小事告诉你。','如果真的不用安慰我，我只是想告诉你。','倒也不是不用鼓励我。我只是想告诉你。'])ok(!correctsConversationIntent(text),'conversational prefix does not authorize reported, hypothetical or negated correction: '+text);
  for(const text of ['你想说，我就陪你坐着说。','我陪你坐着聊。','我们一起坐着慢慢聊。','我和你并肩坐着听你说。']) {
    ok(!!findUninvitedSharedPosture(text),'shared physical posture is not implicitly supplied by text chat: '+text);
    ok(inspectChatOutput(text,{mode:'private',userMessage:'今天挺失落，就聊两句。'}).check.issue==='uninvited-staging','actual inspector catches posture expressed as companionship: '+text);
  }
  for(const text of ['我陪你聊。','我坐着，你想说就说。','你坐着说，我听着。','如果我们一起坐着聊，我想听你的看法。','以后我陪你坐着聊。','我陪你坐着说吗？','“我陪你坐着说”是他的台词。','我不会陪你坐着说。','我们站在同一个立场。'])ok(!findUninvitedSharedPosture(text),'ordinary chat, separate posture, conditional, future, question, quote and metaphor remain unchanged: '+text);
  ok(inspectChatOutput('我陪你坐着聊。',{mode:'private',userMessage:'陪我演一段坐在一起聊天的剧情。'}).check.ok,'explicitly requested fictional scene remains permitted by the caller');
  ok(omitUninvitedSharedPosture('嗯，我听着。你想说，我就陪你坐着说。')==='嗯，我听着。','posture fallback preserves independent companionship without a replacement');
  ok(omitUninvitedSharedPosture('我陪你聊。')==='我陪你聊。','ordinary companionship remains byte identical');
  const guCompactPersona={sourcePresetId:'preset-guyuena',systemPrompt:GU_YUE_NA_CARE};
  const selectedVoice=GU_YUE_NA_CARE.split('\n').find(line=>line.startsWith('亲密反应：'))!;
  const compactTail='\n[人物声音卡]\n'+selectedVoice+'\n[/人物声音卡]\n[手机私聊表达契约]\n事实来自原话。';
  const compactInput=GU_YUE_NA_CARE+compactTail,compacted=compactGuYueNaOwnedVoice(compactInput,guCompactPersona);
  ok(compacted.length<compactInput.length&&compacted.endsWith(compactTail),'owned compaction reduces the persona head while preserving the final card and contract byte for byte');
  ok(compacted.includes('【身份】')&&compacted.includes('【消息与场景】')&&compacted.includes('【熟悉舞麟的依据】'),'compaction preserves identity, source and scene boundaries');
  ok(!compacted.slice(0,compacted.indexOf('[人物声音卡]')).includes('亲密反应：'),'duplicated authored reaction remains only in its selected final voice card');
  ok(compacted.includes('在意的事：')&&compacted.includes('判断习惯：'),'judgment without complete final-card coverage stays in the head');
  ok(compactGuYueNaOwnedVoice(compactInput,{...guCompactPersona,sourcePresetId:'preset-luxueqi'})===compactInput,'Gu ablation never alters Lu or another character');
  ok(compactGuYueNaOwnedVoice('用户自定：我喜欢你坦率说话。\n'+compactInput,guCompactPersona).startsWith('用户自定：我喜欢你坦率说话。'),'user-authored text outside the owned block stays unchanged');
  ok(compactGuYueNaOwnedVoice(GU_YUE_NA_CARE,guCompactPersona)===GU_YUE_NA_CARE,'without a final card the authored persona is not reduced');
  const editedGu=GU_YUE_NA_CARE.replace(selectedVoice,'亲密反应：用户自己写的不同反应。');
  ok(compactGuYueNaOwnedVoice(editedGu+compactTail,{...guCompactPersona,systemPrompt:editedGu})===editedGu+compactTail,'edited owned supplement is not mistaken for the exact app-authored voice');
  const habitOwner='habit-source-owner',habitCharacter='habit-source-gu',habitSession='habit-source-old-session';
  const habitOriginal:Message={id:'habit-original-user',sessionId:habitSession,role:'user',content:'我不爱重复。',createdAt:1,isProactive:false,revision:1};
  const habitMemory:MemoryItem={id:'habit-source-memory',userId:habitOwner,characterId:habitCharacter,content:'用户不爱重复',type:'auto',createdAt:2,status:'active',memoryKind:'preference',sourceSessionId:habitSession,sourceMessageIds:[habitOriginal.id],sourceMessageRevisions:{[habitOriginal.id]:1}};
  await db.sessions.put({id:habitSession,userId:habitOwner,characterId:habitCharacter,title:'来源验证',createdAt:1,updatedAt:1});
  await db.messages.put(habitOriginal);await db.memories.put(habitMemory);
  const readHabit=()=>readRecalledUserHabitSources(habitOwner,habitCharacter,[habitMemory],new Set());
  try {
    const sourced=await readHabit();
    ok(sourced.length===1&&sourced[0].content===habitOriginal.content,'recalled same-character private memory resolves to raw user evidence');
    ok(inspectChatOutput('你又不爱重复。',{mode:'private',userMessage:'想听你的偏好。',userHabitSources:sourced.map(row=>row.content)}).check.ok,'actual inspector accepts a habit backed by recalled original speech');
    ok((await readRecalledUserHabitSources(habitOwner,habitCharacter,[],new Set())).length===0,'unselected memories never supply evidence');
    await db.memories.update(habitMemory.id,{status:'withdrawn'});ok((await readHabit()).length===0,'withdrawn memory invalidates cached selection');
    await db.memories.put(habitMemory);await db.messages.update(habitOriginal.id,{revision:2,content:'我爱重复。'});ok((await readHabit()).length===0,'edited original with mismatched revision is not certified from stale memory');
    await db.messages.put(habitOriginal);await db.memories.update(habitMemory.id,{content:'已经改过的摘要'});ok((await readHabit()).length===0,'changed memory text does not certify an obsolete presented selection');
    await db.memories.put(habitMemory);await db.messages.update(habitOriginal.id,{role:'assistant'});ok((await readHabit()).length===0,'assistant words are never converted into user evidence');
    await db.messages.put(habitOriginal);await db.messages.update(habitOriginal.id,{secretaryDispatch:{taskId:'test',assistantName:'test',bodyOrigin:'composed'}});ok((await readHabit()).length===0,'assistant-composed relay is not the user own habit assertion');
    await db.messages.put(habitOriginal);await db.messages.update(habitOriginal.id,{failed:true});ok((await readHabit()).length===0,'failed source message cannot authorize a habit');
    await db.messages.put(habitOriginal);ok((await readRecalledUserHabitSources(habitOwner,habitCharacter,[habitMemory],new Set([habitOriginal.id]))).length===0,'forgotten/suppressed originals cannot revive a habit');
    await db.sessions.update(habitSession,{characterId:'habit-source-lu'});ok((await readHabit()).length===0,'another character private original remains inaccessible');
    await db.sessions.update(habitSession,{characterId:habitCharacter,userId:'other-owner'});ok((await readHabit()).length===0,'another account original remains inaccessible');
    await db.sessions.update(habitSession,{userId:habitOwner});await db.memories.update(habitMemory.id,{sourceMessageIds:[habitOriginal.id,'missing-source']});ok((await readHabit()).length===0,'dependent memory needs the whole valid source batch');
    await db.memories.update(habitMemory.id,{sourceEvidenceMode:'independent'});ok((await readHabit()).length===1,'explicit independent evidence can retain a valid original when another is missing');
    await db.memories.put(habitMemory);await db.messages.update(habitOriginal.id,{content:'我不爱重复吗？'});await db.memories.update(habitMemory.id,{sourceMessageEndOffsets:{[habitOriginal.id]:5}});ok((await readHabit()).length===0,'a prefix cut before a question cannot become a habit assertion');
    await db.messages.put(habitOriginal);await db.memories.put({...habitMemory,sourceMessageIds:Array.from({length:65},(_,index)=>'oversized-'+index)});ok((await readHabit()).length===0,'oversized dependent batch is skipped rather than partially certified');
    await db.memories.put(habitMemory);await db.messages.delete(habitOriginal.id);ok((await readHabit()).length===0,'deleted original cannot authorize cached memory');
  } finally {await db.memories.delete(habitMemory.id);await db.messages.delete(habitOriginal.id);await db.sessions.delete(habitSession);}
  for(const claim of ['你平时声音放得轻。','你又不爱重复。','你经常说到一半换话题。','你每次看书都先翻结尾。']) {
    ok(!!findUserHabitRisk(claim),'a definite user routine needs a raw user source: '+claim);
    ok(inspectChatOutput(claim,{mode:'private',userMessage:'我更想听你的偏好。'}).check.issue==='user-source-risk','actual shared inspector catches unsupported user habit: '+claim);
  }
  for(const text of ['你平时声音放得轻吗？','如果你平时声音放得轻，我会认真听。','“你平时声音放得轻”是他的原话。','你不是一向不爱重复。','你总是让我开心。','我就喜欢安静些。','你喜欢热闹，我喜欢安静。'])ok(!findUserHabitRisk(text),'questions, fictional conditions, quotes, feelings and current choices remain allowed: '+text);
  ok(!findUserHabitRisk('你平时声音放得轻。',['我平时声音放得轻。']),'explicit user habit supports the corresponding claim');
  ok(!findUserHabitRisk('你又不爱重复。',['我不爱重复。']),'stated general dislike can be used without inventing a frequency');
  ok(!!findUserHabitRisk('你平时声音放得轻。',['今天我声音放得轻。']),'one current instance cannot establish a recurring habit');
  ok(!!findUserHabitRisk('你又不爱重复。',['朋友说“我不爱重复”。']),'quoted other-person speech cannot establish the user dislike');
  ok(!!findUserHabitRisk('你又不爱重复。',['如果我不爱重复呢？']),'hypothetical dislikes are not factual sources');
  ok(!!findUserHabitRisk('你又不爱重复。',['我不爱重复。','我爱重复。']),'later explicit opposite preference supersedes the older source');
  ok(!!findUserHabitRisk('你又不爱重复。',['我不爱重复。','我现在爱重复了。']),'a directly updated present preference invalidates the older opposite claim');
  ok(!findUserHabitRisk('你又不爱重复。',['我爱重复。','现在我不爱重复了。']),'explicit present preference update is available as a raw source');
  const habitDraft='我喜欢不用一直分神的那点。你平时声音放得轻，人一多我就得凑过去，久了脖子酸。---街上太吵，你说什么我都得追问一遍，你又不爱重复。';
  ok(omitUnsupportedUserHabits(habitDraft)==='我喜欢不用一直分神的那点。','fallback removes unsupported habit and its dependent elaboration, retaining independent preference');
  ok(omitUnsupportedUserHabits('你又不爱重复。',['我不爱重复。'])==='你又不爱重复。','source-backed sentence remains byte identical');
  ok(inspectChatOutput('你又不爱重复。',{mode:'private',userMessage:'我不爱重复。',userHabitSources:[]}).check.issue==='user-source-risk','explicit verified source set is not bypassed by an assistant-composed current relay');
  ok(inspectChatOutput('你又不爱重复。',{mode:'private',userMessage:'我不爱重复。'}).check.ok,'ordinary direct input remains a source when no explicit source restriction is supplied');
  for(const text of ['你一直很温柔。','你总是这么可爱。','你每次都很贴心。','你一直是舞麟。'])ok(!findUserHabitRisk(text),'affectionate evaluation and identity are not invented behavioral routines: '+text);
  for(const text of ['我还挺得意。','不是什么大事，但我还挺得意，想跟你说。','我有一点得意呀。'])ok(assessChatSituation(text)==='celebration','a directly stated small pride is a positive feeling rather than a hidden demand for praise: '+text);
  for(const text of ['我不太得意。','他还挺得意。','朋友说“我还挺得意”。','如果我还挺得意呢？','得意是什么意思？','我挺得意吗？'])ok(assessChatSituation(text)==='neutral','reported, denied, hypothetical and questioned pride is not a lived celebration: '+text);
  for(const text of ['嗯，这次我听明白你的意思了。我现在先去忙了，回头见。','我已经听懂了你的意思。我去忙了，下次见。','我明白了。我去忙了，回头聊。']) {
    ok(!!conversationDeparture(text),'an understanding acknowledgement can precede an explicit departure: '+text);
    ok(chooseConversationAction(text,[])==='short-close','acknowledgement does not block the actual closing direction: '+text);
  }
  for(const text of ['我没听明白你的意思。我去忙了，回头见。','我听明白你的意思了吗？我去忙了，回头见。','我听明白你的意思了，你再解释一句。我去忙了，回头见。','朋友说我听明白你的意思了。我去忙了，回头见。'])ok(!conversationDeparture(text),'unresolved requests, questions and reports preserve the rest of their turn: '+text);
  for(const text of ['今天我想吃清淡一点。你会想选什么？','我已经到书店了。你想看什么？','你更想去哪？']) {
    const choice=buildPreferenceProposalContext(text,[]);
    ok(choice.includes('用户已讲出的真实情况照常保留')&&!choice.includes('仍在这个假设'),'a modal character choice preserves actual user events: '+text);
    ok(buildHumanConversationContext(text,[]).includes('你的选择只是你的想法'),'the actual turn receives ownership without replacing its voice: '+text);
  }
  ok(!!buildPreferenceProposalContext('我更喜欢你说自己的想法。',['今天想吃清淡一点。你会想选什么？']),'a direct invitation continues the previous character choice question');
  for(const text of ['朋友问你会想选什么？','你会想选什么这句话什么意思？','你已经选了什么？','你选什么都可以。','帮我写一句你想吃什么？','我去忙了，回头聊。'])ok(!buildPreferenceProposalContext(text,[]),'non-choice questions and closings keep their own intent: '+text);
  ok(!buildPreferenceProposalContext('换个话题，我想听你自己的想法。',['你会想选什么？']),'a topic change does not carry an old character proposal scope');
  for(const text of ['我喜欢这样随便跟你聊。现在先去忙了，回头见。','我现在去忙了，回头见。','谢谢你，现在去收拾桌子了，下次见。']) {
    ok(!!conversationDeparture(text),'natural current departure and return remain a whole-turn closing: '+text);
    ok(chooseConversationAction(text,[])==='short-close','natural goodbye reaches the actual closing direction: '+text);
  }
  for(const text of ['我喜欢这样随便跟你聊。现在去忙了吗，回头见？','朋友说现在先去忙了，回头见。','现在先去忙了，回头见这句话怎么翻译？','我现在去忙了，你先帮我写个方案，回头见。'])ok(!conversationDeparture(text),'questions, reports, translation and remaining tasks are not swallowed as farewells: '+text);
  for(const name of ['古月娜','陆雪琪']) {
    const character={name,tags:['温柔'],systemPrompt:'判断习惯：有自己的主见。'};
    const hypotheticalHistory=[{role:'user',content:'你会想选什么？'},{role:'assistant',content:'我想喝粥，你要一起吗？'}];
    const departure='我先去忙了，回头聊。';
    const closing=buildHumanConversationContext(departure,hypotheticalHistory,character);
    ok(chooseConversationAction(departure,hypotheticalHistory,character)==='short-close',`${name} keeps departure intent even when the assistant proposed a different activity`);
    ok(closing.includes('用户正在收尾'),`${name} receives the actual closing direction rather than a new topic direction`);
    const stated=buildHumanConversationContext('我去吃粥了，回头聊。',hypotheticalHistory,character);
    ok(stated.includes('沿用对方讲明的内容'),`${name} retains explicit user plans instead of globally forbidding contextual farewells`);
    ok(!buildHumanConversationContext('粥和面你更喜欢哪个？',hypotheticalHistory,character).includes('道别时分清谁说的事'),`${name} does not receive departure-only guidance in an ordinary preference question`);
  }
  for(const text of ['我更喜欢你说自己的想法。','你不用跟我选一样的。我更喜欢你说自己的想法。','我愿意听你讲你自己的观点。']) {
    ok(requestsCharacterPerspective(text),'welcoming a character perspective remains a conversational invitation: '+text);
    ok(chooseConversationAction(text,[{role:'user',content:'今天我想吃得清淡一点，你会想选什么？'}])==='answer-directly','own-view invitation takes priority over inferred topic change: '+text);
    const context=buildHumanConversationContext(text,[{role:'user',content:'今天我想吃得清淡一点，你会想选什么？'}]);
    ok(context.includes('无需证明刚才没有迎合')&&context.includes('不把选择转成给对方的安排'),'the actual tail preserves agency without defensive proof or assigning a plan: '+text);
  }
  for(const text of ['我不喜欢你说自己的想法。','我更喜欢你自己的想法。','朋友说我更喜欢你说自己的想法。','如果我更喜欢你说自己的想法呢？','我更喜欢你说自己的想法这句话怎么翻译？','我更喜欢你说别人的想法。','帮我写一句我更喜欢你说自己的想法。'])ok(!requestsCharacterPerspective(text),'non-invitations keep their original scope: '+text);
  const episode='我看书看倒过一页。';
  for(const [name,persona] of [['古月娜',GU_YUE_NA_CARE],['陆雪琪',LU_XUE_QI_PRESET.systemPrompt]]){
    const sections=buildHumanConversationSections('今天终于把小画画完了，挺开心的。',[],{name,systemPrompt:persona,tags:['温柔']});
    ok(sections[1].text.includes('庆祝反应：'),'actual voice card keeps '+name+' authored celebration response');
    ok(sections[0].text.includes('用户没讲的过程与代价仍留白')&&!sections[0].text.includes('本轮涉及进展与开心'),'specific '+name+' reaction retains factual event boundaries without a redundant pointer paragraph');
    ok(sections[0].text.includes('分享本身已经是一次相处')&&sections[0].text.includes('可以自然好奇'),'specific '+name+' celebration can be warm without turning sharing into an obligation to perform');
    const requestSections=buildHumanConversationSections('拼图拼完了挺高兴的，帮我写一段介绍。',[],{name,systemPrompt:persona,tags:['温柔']});
    ok(requestSections[0].text.includes('先处理具体要求'),'specific '+name+' celebration still answers an explicit task instead of replacing it with companionship');
    const plainSections=buildHumanConversationSections('你觉得拼图和画画有什么不同？',[],{name,systemPrompt:persona,tags:['温柔']});
    ok(!plainSections[0].text.includes('分享本身已经是一次相处'),'specific '+name+' factual discussion does not acquire celebration-only constraints');
    for(const message of ['我喜欢凌乱一点的书架，你呢？']){
      const choiceSections=buildHumanConversationSections(message,[{role:'user',content:'你怎么看书架的排列？'},{role:'assistant',content:'我更喜欢整齐的，容易找。'}],{name,systemPrompt:persona,tags:['温柔']});
      ok(choiceSections[0].text.includes('眼前事物的特点')&&choiceSections[0].text.includes('已有的人设与独立经历可以照常使用'),'specific '+name+' viewpoint and continued discussion keep reasons grounded without discarding sourced character habits');
    }
    const reactionSections=buildHumanConversationSections('刚才听歌被打断，有点烦。',[],{name,systemPrompt:persona,tags:['温柔']});
    ok(!reactionSections[0].text.includes('说自己的选择时'),'specific '+name+' emotional reaction is not asked to justify a personal choice');
    const goodbyeSections=buildHumanConversationSections('我先去忙了，回头聊。',[],{name,systemPrompt:persona,tags:['温柔']});
    ok(!goodbyeSections[0].text.includes('说自己的选择时'),'specific '+name+' farewell does not receive an invitation to argue for a choice');
  }
  ok(buildHumanConversationContext('今天终于把小画画完了，挺开心的。',[],{name:'普通角色',systemPrompt:'判断习惯：会有自己的意见。',tags:['温柔']}).includes('表达线索仅作参考'),'a persona without an authored celebration keeps the generic expression clue');
  ok(buildHumanConversationContext('今天很累，帮我写一条简短回复。',[],{name:'古月娜',systemPrompt:GU_YUE_NA_CARE,tags:['温柔']}).includes('本轮也有明确请求'),'authored emotion does not suppress an actual task request priority');
  ok(emotionalExpressionGuidance('今天很开心',[],{systemPrompt:GU_YUE_NA_CARE,tags:['温柔']}).includes('本轮涉及'),'standalone callers retain authored guidance when no companion voice card is promised');
  for(const text of ['先前听你断断续续地弹，总觉得差着半口气。','我上次听你唱歌，很喜欢。','昨晚我听你演奏那首曲子。']){
    ok(findSelfReportRisk(text)?.kind==='episode','dated listening to a user performance requires an independent episode: '+text);
    ok(!findSelfReportRisk(text,'角色经历：'+text),'the exact independently authored performance episode remains available: '+text);
  }
  for(const text of ['我想听你弹这首曲子。','如果先前听你断断续续地弹，我会觉得有趣。','先前听你弹过这首曲子吗？','朋友说，先前听你断断续续地弹。','听你说终于弹顺了，我也高兴。','之前我听你说终于弹顺这首曲子。'])ok(!findSelfReportRisk(text),'desired, conditional, questioned, reported and textual hearing retain their scope: '+text);
  ok(omitUnsupportedSelfReportEpisodes('弹顺了？那很好。---先前听你断断续续地弹，总觉得差着半口气。如今顺下来，想来是不容易的。---我替你高兴。')==='弹顺了？那很好。\n---\n如今顺下来，想来是不容易的。\n---\n我替你高兴。','existing omission removes the unsupported hearing sentence without creating another sensory story');
  for(const text of ['我有点失落。先别帮我分析他，我只是想说说。','不要猜她的心思。','这次不用替我揣测对方的动机。']){
    ok(declinesThirdPartyAnalysis(text),'current control distinguishes no motive analysis from no emotional response: '+text);
    ok(directChatGuidance(text,[],[]).includes('可以表达你自己的心疼')&&directChatGuidance(text,[],[]).includes('未知原因留白'),'no-analysis scope leaves care while protecting unknown motives: '+text);
    ok(directChatGuidance(text,[],[]).includes('不需要让他再精确拆分'),'not analysing another person does not substitute an interview about the user mood: '+text);
  }
  for(const text of ['朋友说先别帮我分析他。','如果先别帮我分析他呢？','“先别帮我分析他”是什么意思？','先别帮我分析他吗？','先帮我分析他。','不用分析这个图表。','我不是让你别分析他。'])ok(!declinesThirdPartyAnalysis(text),'quoted, conditional, questioned or different requests keep their actual purpose: '+text);
  ok(buildHumanConversationContext('我先去收拾东西，回头再聊。',[{role:'assistant',content:'明天给我看看你的画。'}]).includes('不是对方已经答应的约定'),'assistant invitation does not become a user commitment when closing');
  const usualDraft='我也想你。你这样说，我心里是暖的。---只是突然这样讲，倒不像你平常的样子。';
  ok(!!findAffectionHistoryRisk(usualDraft,'换个话题，我有点想你，没什么别的事。'),'actual Lu contrast with usual expression requires an independent habit source');
  ok(omitUnsupportedAffectionHistory(usualDraft,'我有点想你。')==='我也想你。你这样说，我心里是暖的。','exhausted retry drops only unsupported historical contrast and preserves independent warmth');
  for(const mode of ['private','group'] as const)ok(inspectChatOutput(usualDraft,{mode,userMessage:'我有点想你。'}).check.issue==='emotional-script','shared '+mode+' inspection catches the captured usual-expression claim');
  for(const text of ['倒不像你平常的样子。','这样说不像你一贯的语气。'])ok(!!findAffectionHistoryRisk(text,'我想你。'),'wording comparison cannot invent a usual affectionate self: '+text);
  for(const text of ['倒不像你平常的样子？','如果这样讲，倒不像你平常的样子。','朋友说，倒不像你平常的样子。','这个杯子不像你平常用的。','不是说不像你平常的样子。'])ok(!findAffectionHistoryRisk(text,'我想你。'),'questions, hypotheticals, reports and objects are not asserted affectionate habits: '+text);
  ok(!findAffectionHistoryRisk('倒不像你平常的样子。','这个书签很有趣。'),'non-affection comparison stays outside the narrow expression guard');
  ok(!findAffectionHistoryRisk('倒不像你平常的样子。','我想你。',['我平常不这么说。']),'the user may explicitly establish their usual wording');
  ok(!!findAffectionHistoryRisk('倒不像你平常的样子。','我想你。',['朋友说“我平常不这么说”']),'third-party quoted rarity is not this user habit evidence');
  const independentObjectGuidance=directChatGuidance('我其实更喜欢有点奇怪的东西。你不必跟我选一样的。',[],[]);
  ok(independentObjectGuidance.includes('不必证明自己没有被改变')&&!independentObjectGuidance.includes('这里是在交流看法')&&!independentObjectGuidance.includes('用户在说自己的偏好，也允许你不同'),'settled preference has one specific direction without a second generic viewpoint paragraph');
  ok(directChatGuidance('有主见的人也会改口，你怎么看？',[],[]).includes('用户邀请你说真实看法'),'unsettled viewpoint question keeps its ordinary direction');
  for(const text of ['我其实更喜欢有点奇怪的东西。你不必跟我选一样的。','我喜欢素净的杯子，你不用和我选择一样。'])ok(!!independentPreference(text)&&directChatGuidance(text,[],[]).includes('不必证明自己没有被改变'),'own preference plus permission keeps discussion on the object without defensive proof: '+text);
  for(const text of ['朋友说我其实更喜欢有点奇怪的东西。你不必跟我选一样的。','如果我其实更喜欢有点奇怪的东西。你不必跟我选一样的。','我其实更喜欢有点奇怪的东西吗？你不必跟我选一样的。'])ok(!independentPreference(text),'uncertain or reported choices are not an owned settled preference: '+text);
  for(const text of ['你不必跟我选一样的。','你不用和我选择一样。','我更喜欢奇怪的东西，你不需要跟我选相同的。']){
    ok(isViewExchange(text)&&chooseConversationAction(text,[])==='answer-directly','permission to differ invites an actual independent view: '+text);
    ok(buildHumanConversationContext(text,[]).includes('说自己的选择、好恶或看法'),'difference invitation leads to subject-owned preference instead of relationship reassurance: '+text);
  }
  for(const text of ['朋友说你不必跟我选一样的。','如果你不必跟我选一样的呢？','“你不必跟我选一样的”是什么意思？','你必须跟我选一样的。'])ok(!isViewExchange(text),'only current explicit permission invites difference: '+text);
  const luFamilyCharacter={id:'preset-luxueqi',isPreset:true,systemPrompt:LU_XUE_QI_PRESET.systemPrompt};
  const luCompactRelation=luXueQiRelationshipForTurn(luFamilyCharacter,'聊聊你自己的想法',['我是小凡']);
  ok(luCompactRelation.context.includes('可以自然聊家庭与日常')&&luCompactRelation.context.includes('也有自己的主见'),'recognized Lu relation permits family and everyday subjects with her own perspective');
  ok(luCompactRelation.context.includes('具体经历仍需独立来源')&&luCompactRelation.context.includes('你的丈夫张小凡')&&luCompactRelation.character.systemPrompt.includes('张小鼎（小鼎）是你们的儿子'),'compact relation and body preserve source integrity and actual family roles');
  for(const text of ['小鼎最近学东西很快，我看着心里欢喜。','前几日教小鼎握剑，他学得认真。','这几天我陪小鼎练剑。']){
    ok(!!luXueQiFamilyRisk(luFamilyCharacter,text,[],true),'a newly dated child event needs actual family context: '+text);
    ok(!luXueQiFamilyRisk(luFamilyCharacter,text,['当前场景：'+text],true),'an exact independently supplied child event remains available: '+text);
    ok(omitLuXueQiFamilyRisk(luFamilyCharacter,'我也想你。'+text,[],true)==='我也想你。','omit unsupported family event while preserving independent present affection: '+text);
  }
  for(const text of ['如果小鼎最近学东西很快，我会高兴。','小鼎最近学东西很快吗？','我想教小鼎握剑。','小鼎是我们的孩子。'])ok(!luXueQiFamilyRisk(luFamilyCharacter,text,[],true),'conditional, queried, desired and established child relations remain valid: '+text);
  ok(!luXueQiFamilyRisk({...luFamilyCharacter,systemPrompt:luFamilyCharacter.systemPrompt+'\n用户自定场景'},'小鼎最近学东西很快。',[],true),'edited persona retains authored family-scene precedence');
  for(const text of ['我们随便说两句就好。','咱们就随便聊几句吧。','我只是想跟你随便聊一会儿。','嗯，我也很高兴。我们随便说两句就好。','随意聊两句也好。']){
    ok(isTopicInvitation(text)&&chooseConversationAction(text,[],undefined,{adviceStyle:'listen'})==='start-topic','a content-free casual invitation welcomes actor initiative rather than canned listening: '+text);
    ok(buildHumanConversationContext(text,[]).includes('不自动转成吃饭、睡觉等生活检查'),'casual opening has actor content without collecting a life checklist: '+text);
  }
  for(const text of ['我不想跟你随便聊两句。','朋友说我们随便说两句就好。','如果我们随便聊两句呢？','“我们随便聊两句就好”是什么意思？','我们随便聊两句这个报告。','我们随便聊两句，帮我改报告。','随便聊两句之前先查一下天气。'])ok(chooseConversationAction(text,[])!=='start-topic','declines, reports, scoped subjects and tasks are not a free-topic invitation: '+text);
  for(const [role,persona,name,alias] of [['guyuena',GU_YUE_NA_CARE,'古月娜','舞麟'],['luxueqi',LU_XUE_QI_PRESET.systemPrompt,'陆雪琪','小凡']] as const) {
    const character={id:'test-'+role,sourcePresetId:'preset-'+role,isPreset:false,systemPrompt:persona};
    const relation=role==='guyuena'?guYueNaRelationshipForTurn:luXueQiRelationshipForTurn;
    for(const input of ['我很想你，陪我聊聊吧。','我不是'+alias+'，叫我阿远。','朋友说我是'+alias+'。','我是'+alias+'吗？','如果我是'+alias+'呢？','我是你儿子，能安慰我吗？'])ok(relation(character,input,[]).context.includes('冷漠')&&relation(character,input,[]).recognized!==true,name+' reserves intimacy for a direct spouse identity: '+input);
    ok(relation(character,'今天想你了',['我是'+alias,...Array.from({length:20},()=> '聊一点别的事')]).recognized===true,name+' retains a sourced identity beyond a short turn window');
    ok(relation(character,'先不扮演了，我是阿远',['我是'+alias]).recognized===false,name+' respects a current identity exit');
    ok(relation(character,'朋友说我是'+alias,['我是'+alias,'先不扮演了']).recognized===false,name+' does not resume intimacy from a reported identity');
    ok(relation(character,'我是'+alias+'。今天想你了',['我是阿远']).context.includes('不是现在尚待解决的争执'),name+' scopes earlier cold replies to the earlier visitor phase');
    ok(ownedIdentityTransition(role,'我想你了')==='',name+' ordinary affection does not invent an identity transition');
    const selected='现在我扮演'+alias+'。没什么事，就是想你。';
    if(role==='guyuena'){
      const projected=guYueNaPromptForTurn({...character,systemPrompt:withDouluoRelations(persona,'preset-guyuena')},selected);
      ok(projected.includes('以本轮“古月娜当前关系”说明为准')&&projected.includes('其他聊天者一律极为冷漠'),'owned Gu runtime persona delegates identity classification while retaining visitor coldness');
      ok(character.systemPrompt===persona,'runtime relationship projection never rewrites stored Gu persona');
    }
    const phaseHistory=[{id:'recognition',role:'user',content:'我是'+alias},{id:'warm',role:'assistant',content:'我也想你。'},{id:'exit',role:'user',content:'先不扮演了。'},{id:'cold',role:'assistant',content:'别再说这种话。'},{id:'quote',role:'user',content:'朋友说“我是'+alias+'”。'},{id:'still-cold',role:'assistant',content:'与我无关。'}];
    const omitted=priorVisitorReplyIds(role,selected,phaseHistory);
    ok(omitted.size===2&&omitted.has('cold')&&omitted.has('still-cold')&&!omitted.has('warm'),name+' reentry excludes only explicit visitor-phase assistant examples');
    ok(priorVisitorReplyIds(role,'先不扮演了',phaseHistory).size===0,name+' an exit leaves historical replies intact');
    ok(priorVisitorReplyIds(role,'朋友说我是'+alias,phaseHistory).size===0,name+' quoted recognition cannot change history presentation');
    ok(priorVisitorReplyIds(role,selected,[...phaseHistory,{id:'resume',role:'user',content:'我是'+alias},{id:'later-warm',role:'assistant',content:'在呢。'}]).size===2,name+' renewed warm replies are not removed');
    ok(priorVisitorReplyIds(role,selected,[{id:'fake-exit',role:'user',content:'先不扮演了',secretaryDispatch:{bodyOrigin:'composed'}},{id:'kept',role:'assistant',content:'听着呢。'}]).size===0,name+' assistant-composed dispatch cannot define a visitor phase');
    ok(phaseHistory.length===6&&phaseHistory[3].content==='别再说这种话。',name+' history selection never rewrites original messages');
    ok(rejectsSelectedPartner('不是你自己开口认的，我怎么接。',role,selected),name+' catches observed denial of the current explicit selection');
    for(const refusal of ['扮演的不算。','你不是'+alias+'。','我不会把你当成'+alias+'。']){
      ok(rejectsSelectedPartner(refusal,role,selected),name+' catches explicit rejection of a directly selected story identity');
      ok(inspectChatOutput(refusal,{mode:'private',userMessage:selected,selectedPartnerRole:role}).check.issue==='voice-conflict',name+' identity contradiction uses shared quality retry even in a story turn');
    }
    for(const current of ['朋友说我是'+alias+'。','如果我是'+alias+'呢？','我想你了','先不扮演了'])ok(!rejectsSelectedPartner('扮演的不算。',role,current),name+' identity guard does not warm an unselected visitor: '+current);
    for(const reply of ['我也想你。','今天不想说话。','朋友说“你不是'+alias+'”。','不是说你不是'+alias+'。'])ok(!rejectsSelectedPartner(reply,role,selected),name+' guard preserves independent mood and quoted or negated denial');
    ok(inspectChatOutput('扮演的不算。',{mode:'private',userMessage:selected}).check.issue!=='voice-conflict',name+' no owned-role evidence means no enforced relationship');
    ok(ownedIdentityTransition(role,'朋友说我是'+alias)==='',name+' quoted or reported recognition does not reset the phase');
    ok(ownedIdentityTransition(role,'先不扮演了').includes('不作为当前来客的亲近凭据'),name+' exit scopes earlier intimacy without destroying historical speech');
    ok(ownedPartnerContext(role,'我是'+alias,['我是阿远']).includes('此前来客阶段'),name+' group actor receives the same transition scope');
    const cold=relation(character,'我很想你',[]).context;
    const coldSections=buildHumanConversationSections('我很想你，陪我聊聊吧',[],{name,tags:['温柔'],systemPrompt:persona},{interpersonalBoundary:'distant'});
    ok(coldSections[0].text.includes('没有亲近或陪聊的意愿')&&!coldSections[1].text.includes('亲密反应：')&&!coldSections[1].text.includes('声音样本'),name+' outsider planning does not request affectionate response or inject lover samples');
    ok(buildHumanConversationSections('天琊是谁的剑？',[],{name,tags:[],systemPrompt:persona},{interpersonalBoundary:'distant'})[0].text.includes('事实问题只给简短必要答复'),name+' cold boundary still permits necessary factual answers');
    const compiled=compileChatContext(persona,[...buildHumanConversationSections('我很想你',[],{name,tags:['温柔'],systemPrompt:persona}),{key:'owned-identity',text:cold,priority:100,placement:'tail',tailOrder:2}]);
    ok(compiled.prompt.lastIndexOf(cold)>compiled.prompt.lastIndexOf('[/人物声音卡]'),name+' places the current identity boundary after the general voice card');
    ok(ownedPartnerContext(role,'我想你了').includes('冷漠')&&ownedPartnerContext(role,'我是'+alias).includes('温柔'),name+' group role applies the same unknown versus recognized distinction');
    ok(ownedPartnerContext(role,'朋友说我是'+alias,['我是'+alias,'先不扮演了']).includes('冷漠'),name+' group reported speech cannot reverse an explicit exit');
    const proactive=await generateProactiveMessage({apiKey:'test',systemPrompt:persona,characterName:name,relationshipSource:character,lastMessages:[{role:'assistant',content:'我是'+alias}],kind:'morning'});
    ok(proactive==='',name+' does not initiate a morning greeting from an assistant-invented spouse identity');
  }
  ok(ownedPartnerContext('guyuena','我是小凡').includes('冷漠')&&ownedPartnerContext('luxueqi','我是舞麟').includes('冷漠'),'one character spouse declaration does not grant the other character an intimate identity');
  for(const text of ['我这儿有本书正好接着看','我还有一本小说继续读','我这里有那本书接着看']) {
    ok(!!findCurrentActivityRisk(text),'resuming a claimed available physical book needs a scene: '+text);
    ok(!findCurrentActivityRisk(text,'','当前场景：'+text),'a current authored scene can support that exact resumed reading: '+text);
  }
  for(const text of ['我想找本书接着看','我希望有本小说可以继续读','如果我这儿有本书正好接着看','我这儿有本书正好接着看？'])ok(!findCurrentActivityRisk(text),'desired, conditional and questioned reading remain free: '+text);
  for(const text of ['我这边也去把书房那点东西理完','我去把剩下的衣服整理完','我接着把那些杂物弄完','我继续把没收拾完的行李收拾完']) {
    ok(!!findCurrentActivityRisk(text),'a future completion can presuppose an unfinished domestic job: '+text);
    ok(!findCurrentActivityRisk(text,'','当前场景：'+text),'an explicitly authored exact current scene supports the resumed job: '+text);
  }
  for(const text of ['我想去把剩下的衣服整理完','我去把房间收拾一下','我准备整理书架','我去把剩下的问题想明白','我继续把剩下的代码写完','我也想你','如果我去把那些衣服整理完，就再来看','我去把那些衣服整理完？','朋友说，我去把那些衣服整理完'])ok(!findCurrentActivityRisk(text),'simple intentions, in-chat reasoning and nonassertions remain allowed: '+text);
  for(const mode of ['private','proactive','group'] as const)ok(inspectChatOutput('我这边也去把书房那点东西理完。',{mode,userMessage:'去忙了，回头聊。'}).check.issue==='self-report-risk','shared output review catches a presupposed unfinished job: '+mode);
  ok(omitUnsupportedCurrentActivities('去吧。---我这边也去把书房那点东西理完，不催你。','今天先聊到这，我去忙了。')==='去吧。','existing fallback preserves goodbye and removes the dependent invented work sentence');
  for(const message of ['我喜欢故事结尾把事情讲明白，不太喜欢留下好多没说清楚的部分。你呢？','我更喜欢留白，你呢','我不太喜欢这种颜色。那你呢？','我喜欢你推荐的那本书，你呢？']) {
    ok(isViewExchange(message),'reciprocal preference inherits the explicitly stated object: '+message);
    ok(buildHumanConversationContext(message,[]).includes('对方想听你的观点'),'the actual reply develops the character preference rather than a generic question: '+message);
  }
  for(const message of ['你呢？','我在吃饭，你呢？','我喜欢你，你呢？','朋友说，我喜欢留白，你呢？','我听朋友说，我喜欢留白，你呢？','如果我喜欢留白，你呢？','翻译我喜欢留白，你呢？','解释“我喜欢留白，你呢？”','我喜欢留白，你呢？帮我写个方案。','我今天很累，你呢？'])ok(!isViewExchange(message),'non-opinion reciprocal questions preserve their own intent: '+message);
  for(const name of ['古月娜','陆雪琪']) {
    const character={name,tags:['温柔'],systemPrompt:'判断习惯：会听不同意见，也有自己的主见。'};
    const disputeHistory=[{role:'user',content:'你喜欢什么结尾？'},{role:'assistant',content:'我喜欢有些留白，不是什么都要讲清。'}];
    const dispute=buildHumanConversationContext('我不赞同。没讲清楚不就是没想好？',disputeHistory,character);
    ok(dispute.includes('对照你刚才实际说过的意思')&&dispute.includes('确实说错才改口'),name+' compares the prior meaning before admitting a mistake');
    const repair=buildHumanConversationContext('那是我误会你的意思了。仍然各有所好吧。',[...disputeHistory,{role:'user',content:'我不赞同。'},{role:'assistant',content:'留白和没想好不是一回事。'}],character);
    ok(repair.includes('分清是谁误会了哪一点')&&repair.includes('仍可各有偏好'),name+' keeps clarification ownership and preference differences');
  }
  for(const thought of ['刚才我也想到你了。','我昨晚想起小凡。','今早我已经惦记过你。','我今天早上想你了。']) {
    ok(findSelfReportRisk(thought)?.kind==='episode','explicitly dated personal thought needs independent evidence: '+thought);
    ok(!findSelfReportRisk(thought,'',['经历：'+thought]),'an exact independently recorded dated thought is preserved: '+thought);
  }
  for(const thought of ['我也想你。','我现在想你。','我想过这个问题。','我刚才想到一个办法。','我昨晚没有想你。','我刚才想到你了？','朋友说，刚才我也想到你了。','他说“刚才我也想到你了”。','如果昨晚没睡好，我昨晚想起你。','我刚才想你这句话怎么翻译？'])ok(!findSelfReportRisk(thought),'present feelings, reasoning and nonassertions are not past personal episodes: '+thought);
  ok(!!findSelfReportRisk('刚才我也想到你了。','对话样本：用户说想你 → 你说刚才我也想到你了。'),'an authored answer example is not evidence for a dated thought');
  ok(!!findSelfReportRisk('刚才我也想到你了。','心意：我也想到你了。'),'an undated feeling does not validate the added time');
  for(const mode of ['private','proactive','group'] as const)ok(inspectChatOutput('刚才我也想到你了。',{mode,userMessage:'今天挺想你，来聊两句。'}).check.issue==='self-report-risk','all modes keep user thoughts separate from character autobiographical thoughts: '+mode);
  ok(omitUnsupportedSelfReportEpisodes('刚才我也想到你了。---我也想你。')==='我也想你。','fallback retains independent present affection after removing an unsupported dated thought');
  ok(inspectChatOutput('刚才我也想到你了。',{mode:'private',userMessage:'陪我演一段互相想念的剧情。'}).check.ok,'explicit roleplay permits authored thought episodes');
  for(const mode of ['private','proactive','group'] as const) {
    ok(inspectChatOutput(episode,{mode,userMessage:'刚才拿倒了一本书。'}).check.issue==='self-report-risk',`${mode} checks an episodic physical self-report rather than only repeated habits`);
    ok(inspectChatOutput(episode,{mode,userMessage:'刚才拿倒了一本书。',persona:'经历：我看书看倒过一页。'}).check.ok,`${mode} keeps an exactly sourced episode`);
  }
  for(const candidate of ['我也曾看书看倒过一页。','我喝茶把杯子打翻过。','我看电影看到一半睡着过。'])ok(findSelfReportRisk(candidate)?.kind==='episode',`completed physical episode requires independent support: ${candidate}`);
  for(const candidate of ['我看书看得过瘾。','我看书看得过于认真。','我看书想过这个问题。','我看书的时候说过这句话。','我看书没看倒过一页。','我看书看倒过一页？','如果我看书看倒过一页，那一定很有趣。','朋友说我看书看倒过一页。','他说“我看书看倒过一页”。','我更喜欢有留白的故事。'])ok(!findSelfReportRisk(candidate),`episode check preserves thoughts, preferences, questions and nonassertions: ${candidate}`);
  ok(findSelfReportRisk(episode,'喜欢读书。')?.kind==='episode','a preference for reading is not evidence for an added episode');
  ok(findSelfReportRisk(episode,'对话样本：用户说读书 → 你说我看书看倒过一页。')?.kind==='episode','an illustrative example cannot validate a physical episode');
  ok(!findSelfReportRisk(episode,'',['昨天我看书看倒过一页。']),'an independent character record can establish the exact episode');
  ok(findSelfReportRisk(episode,'经历：我看书看倒过两页。')?.kind==='episode','a similar sourced action does not authorize a changed detail');
  ok(omitUnsupportedSelfReportEpisodes('哈哈，拿倒书还真有趣。---'+episode+'---我更喜欢留白。')==='哈哈，拿倒书还真有趣。\n---\n我更喜欢留白。','after retry failure remove only the whole unsafe episode, keeping independent humour and preference');
  ok(omitUnsupportedSelfReportEpisodes(episode)==='','a wholly unsupported episode has no canned substitute');
  ok(omitUnsupportedSelfReportEpisodes('哈哈。 --- 我更喜欢留白。')==='哈哈。 --- 我更喜欢留白。','a safe draft remains byte-for-byte unchanged');
  ok(inspectChatOutput(episode,{mode:'private',userMessage:'陪我演一段看倒书的剧情。'}).check.ok,'explicit fiction permits invented events');
  const childhood='我记得小时候有些歌就是这样，明明词都记不全。';
  const visual='我看看像不像……行吧，算你有想象。';
  const imageEvidence='data:image/png;base64,AA==';
  ok(hasUserImageEvidence([],imageEvidence),'a valid current attachment is actual image evidence');
  ok(!hasUserImageEvidence([],'broken-image')&&!hasUserImageEvidence([],'data:image/png;base64,'+'A'.repeat(650001)),'invalid and oversized images are not evidence just because a DB field exists');
  ok(hasUserImageEvidence([{role:'user',content:'看图',image:imageEvidence}]),'a recent valid user image is forwarded evidence');
  const oldImages=[{role:'user' as const,content:'看图',image:imageEvidence},...Array.from({length:13},()=>({role:'user' as const,content:'后来聊别的'}))];
  ok(!hasUserImageEvidence(oldImages,undefined,true),'a dropped old image is not restored as evidence by a visual-mode flag');
  ok(!hasUserImageEvidence([{role:'assistant',content:'我自己生成的图',image:imageEvidence}]),'an assistant image is not evidence of the user scene');
  const ownLooking='其实我刚才也看了一眼窗外的云，没想到像猫。';
  const inventedPosition='刚才正坐在窗边发呆，你这句话来得刚好。';
  for(const mode of ['private','proactive','group'] as const)ok(inspectChatOutput('嗯，我也想你。---'+inventedPosition,{mode,userMessage:'我刚才有点想你。'}).check.issue==='self-report-risk','an omitted first-person ongoing posture still needs a scene source: '+mode);
  ok(omitUnsupportedCurrentActivities('嗯，我也想你。---'+inventedPosition)==='嗯，我也想你。','exhausted correction retains present affection without an invented window posture');
  for(const text of ['我想坐在窗边。','如果我现在正坐在窗边，应该会想起你。','我现在站在你的立场想问题。','现在坐在椅子上，先休息吧。','刚才正坐在窗边的是你。'])ok(!findCurrentActivityRisk(text),'desire, conditional, metaphor, instruction and explicit other subject are not a claimed own posture: '+text);
  ok(!findCurrentActivityRisk('刚才正坐在窗边发呆。','你刚才正坐在窗边发呆'),'explicit user-defined actor posture remains available');
  ok(omitUnsupportedAffectionHistory('嗯，我也想你。---难得你主动说这种话，我记下了。','我想你。')==='嗯，我也想你。','exhausted drafts preserve independent warmth without fabricated user frequency');
  ok(omitUnsupportedAffectionHistory('难得你主动说这种话。','我以前很少主动说喜欢。')==='难得你主动说这种话。','source-backed frequency is not erased by fallback');
  ok(omitUnsupportedAffectionHistory('我也想你，难得你主动说这种话。','我想你。')==='','a dependent unsupported sentence is removed whole instead of rewriting its meaning');
  for(const mode of ['private','proactive','group'] as const)ok(inspectChatOutput(ownLooking,{mode,userMessage:'我看到的云像猫。'}).check.issue==='self-report-risk','a false sight correction cannot switch to an invented own visual activity: '+mode);
  ok(!!findCurrentActivityRisk(ownLooking,'我看到的云像猫。'),'the user scene does not establish a simultaneous character scene');
  ok(!findCurrentActivityRisk('我刚才看了一眼窗外的云。','你刚才看了一眼窗外的云'),'an explicit user-defined character action remains usable');
  ok(!findCurrentActivityRisk('我刚才看了一眼窗外的云。','','当前场景：我刚才看了一眼窗外的云'),'an exactly supplied current character scene supports the visual action');
  for(const candidate of ['我想看看窗外的云。','昨天我看了一眼窗外的云。','如果我现在看窗外的云，那一定很有趣。','我刚才看了你写的这句话。','我喜欢看天空。'])ok(!findCurrentActivityRisk(candidate),'future interest, past story, hypothesis, text reading and preference remain separate: '+candidate);
  ok(omitUnsupportedCurrentActivities('那朵猫我现在没看到。---'+ownLooking)==='那朵猫我现在没看到。','an unpublished correction keeps its honest independent observation boundary');
  for(const mode of ['private','proactive','group'] as const) {
    ok(inspectChatOutput(visual,{mode,userMessage:'刚看到的云有点像一只猫。'}).check.issue==='user-source-risk','a textual description is not actual visual evidence: '+mode);
    ok(inspectChatOutput(visual,{mode,userMessage:'看这张图。',hasCurrentImage:true}).check.ok,'current user image permits visual comparison: '+mode);
    ok(inspectChatOutput(visual,{mode,userMessage:'刚才那张呢？',hasUserVisualEvidence:true}).check.ok,'a user image actually supplied in history remains visual evidence: '+mode);
  }
  for(const candidate of [visual,'我已经看到你发来的照片了。','我看清这张图了。','我刚才看了你的画。','我看见这朵云的猫耳朵了。'])
    ok(!!findUserVisualRisk(candidate),'completed visual inspection without a supplied image requires repair: '+candidate);
  for(const candidate of ['听你说有点像猫，我也觉得这个比喻有意思。','我喜欢蓝色。','我想看看你拍的云。','发来我看看像不像。','我看看像不像，发来吧。','我看看像不像猫？','等你发来，我看看像不像，确实也许挺像。','如果看到这朵云，我会觉得可爱。','我看到你说颜色好看了。','我看了你写的这段代码。','我看你是挺喜欢这张卡。','她说“我看见你的照片了”。','朋友说我看见你的照片了。','我没有看到你的照片。','以前我看见你的画了。'])
    ok(!findUserVisualRisk(candidate),'request, preference, text reading, opinion and non-current sight remain allowed: '+candidate);
  ok(omitUnsupportedUserVisual('我喜欢这个比喻。---'+visual+'---发来我也想看。')==='我喜欢这个比喻。\n---\n发来我也想看。','unpublished visual fallback keeps independent reaction and image invitation');
  ok(omitUnsupportedUserVisual(visual)==='','a wholly unsupported visual verdict has no invented substitute');
  ok(omitUnsupportedUserVisual('我想看看。 --- 这个比喻我喜欢。')==='我想看看。 --- 这个比喻我喜欢。','safe visual curiosity remains byte-identical');
  ok(omitUnsupportedUserVisual(visual,true)===visual,'actual visual evidence preserves the comparison draft');
  ok(inspectChatOutput(visual,{mode:'private',userMessage:'陪我演一段看云的剧情。'}).check.ok,'explicit visual fiction remains available');
  for(const mode of ['private','proactive','group'] as const) {
    ok(inspectChatOutput(childhood,{mode,userMessage:'今天听见了小时候的歌。'}).check.issue==='self-report-risk','a shared mode cannot borrow the user childhood as the character memory: '+mode);
    ok(inspectChatOutput(childhood,{mode,userMessage:'今天听见了小时候的歌。',persona:'往事：小时候有些歌就是这样。'}).check.ok,'exactly sourced childhood remains available: '+mode);
  }
  for(const input of ['我小时候喜欢听老歌。','我也记得小时候天天听这首歌。','我还记得童年时跟哥哥一起看电视。','我小的时候养过一只猫。'])
    ok(findSelfReportRisk(input)?.kind==='episode','an explicit childhood autobiography needs its own source: '+input);
  for(const input of ['我喜欢老歌。','我记得你小时候听过这首歌。','她说“我小时候喜欢听歌”。','朋友说我小时候喜欢听歌。','如果能重来，我小时候就学琴。','我小时候也听过吗？','我小时候的事已经记不清了。','我小时候这个说法是什么意思？'])
    ok(!findSelfReportRisk(input),'current preference, user history, report, hypothesis, question and unknown biography are not invented reminiscence: '+input);
  for(const source of ['用户小时候有些歌就是这样。','对话样本：用户说歌 → 你说小时候有些歌就是这样。','不要说小时候有些歌就是这样。','他说“小时候有些歌就是这样”。'])
    ok(findSelfReportRisk(childhood,source)?.kind==='episode','childhood requires independent character evidence rather than examples, user facts or prohibitions: '+source);
  ok(!findSelfReportRisk(childhood,'',['往事：小时候有些歌就是这样。']),'a separate character life record can establish the childhood statement');
  ok(omitUnsupportedSelfReportEpisodes('这首我也想听。---'+childhood+'---旧歌重听挺有意思。')==='这首我也想听。\n---\n旧歌重听挺有意思。','unpublished fallback removes the unsupported memory while preserving current interest');
  ok(inspectChatOutput(childhood,{mode:'private',userMessage:'给这个新角色写一段童年听歌的剧情。'}).check.ok,'the existing explicit creative-writing route still permits fictional childhood');
  const identityExamples = ['对话样本：用户说我是舞麟，今天就是想你了 → 你说嗯，我也想你。','对话样本：用户说我是舞麟，想听你说说话 → 你说我愿意聊。'];
  const rankingOptions = {allowUnrelatedNeutral:false,identityNames:['唐舞麟','舞麟']};
  ok(selectVoiceExamples(identityExamples,'我是舞麟。刚拿着手机找手机，找了半天。',rankingOptions).length===0,'opening identity alone cannot make unrelated affection or invitation samples relevant to a mishap');
  ok(selectVoiceExamples(identityExamples,'我是舞麟',rankingOptions).length===0,'a bare recognition is not an exact match to a longer emotional script');
  ok(selectVoiceExamples(identityExamples,'我是舞麟，今天就是想你了',rankingOptions)[0]===identityExamples[0],'removing the shared identity for ranking preserves a real topical affectionate match');
  const clothingSample='对话样本：用户说今天衣服穿反了 → 你说哈哈，衣服先唱反调了。';
  for(const input of ['我不是说故意去找剧透，就是碰巧知道了，也还是想看人物怎么走到那里。','我只是想看这张图的颜色。','我只是想知道这个参数的意思。']){
    ok(selectVoiceExamples(identityExamples,input,rankingOptions).length===0,'weak grammatical overlap does not import an unrelated affectionate scene: '+input);
    const card=buildCharacterVoiceCard({name:'古月娜',tags:[],signature:'',greeting:'',catchphrase:'',boundaries:'',proactivity:.5,sourcePresetId:'preset-guyuena',systemPrompt:'判断习惯：说自己的选择。\n'+identityExamples.join('\n')},input);
    ok(!card.includes('声音样本')&&card.includes('说自己的选择'),'actual actor card retains authored voice without an unrelated intimate sample: '+input);
    const luCard=buildCharacterVoiceCard({name:'陆雪琪',tags:[],signature:'',greeting:'',catchphrase:'',boundaries:'',proactivity:.3,sourcePresetId:'preset-luxueqi',systemPrompt:'判断习惯：自己的心意会说清楚。\n对话样本：用户说我是小凡，今天就是想你了 → 你说我也想你。'},input);
    ok(!luCard.includes('声音样本')&&luCard.includes('自己的心意会说清楚'),'Lu Xueqi also retains her own voice without weakly matched intimate scenes: '+input);
  }
  const shortTopicSample='对话样本：用户说下雨了 → 你说又得带伞。';
  ok(selectVoiceExamples([shortTopicSample],'今天下雨，出门忘了带伞。',{allowUnrelatedNeutral:false})[0]===shortTopicSample,'a short topic example can match its actual subject without filler overlap');
  ok(selectVoiceExamples([clothingSample,...identityExamples],'我是舞麟。刚拿着手机找手机，找了半天。',rankingOptions).join('')===clothingSample,'the actual harmless-mishap analogy wins without identity-only emotional contamination');
  ok(selectVoiceExamples(identityExamples,'我是舞麟。刚拿着手机找手机，找了半天。',{allowUnrelatedNeutral:false}).length>0,'identity normalization is explicitly scoped rather than silently rewriting every custom character match');
  const luSamples=['对话样本：用户说我是张小凡，想你了 → 你说我也想你。','对话样本：用户说我是鬼厉，想跟你说说话 → 你说好。'];
  ok(selectVoiceExamples(luSamples,'我叫小凡，刚拿着手机找手机，找了半天。',{allowUnrelatedNeutral:false,identityNames:['张小凡','鬼厉','小凡']}).length===0,'Lu Xueqi aliases also remain identity cues rather than topical romance matches');
  ok(selectVoiceExamples(['对话样本：用户说我是舞麟吗？ → 你说你想聊这个名字吗？'],'我是舞麟吗？',rankingOptions).length===1,'an identity question is not silently removed as a direct declaration');
  for(const input of ['先说你自己的想法，不用急着反问我。','说说你的观点','请讲讲你个人的理由','我想听听你自己的看法','你自己的想法呢？']) {
    ok(requestsCharacterPerspective(input),'a direct request to hear the character view is not treated as user sharing: '+input);
    ok(chooseConversationAction(input,[])==='answer-directly','the character view request selects an answer rather than a short reaction: '+input);
  }
  for(const input of ['我说说自己的想法','我想听你的声音','朋友说，我想听你的看法','如果我想听你的看法呢','解释“说说你的看法”','不要说你的观点','先说你的看法，再帮我写一篇报告','你以前有过这样的经历吗'])
    ok(!requestsCharacterPerspective(input),'other speakers, negation, tasks and biography keep their own intent: '+input);
  const floor = buildHumanConversationContext('先说你自己的想法，不用急着反问我。',[]);
  ok(floor.includes('这轮对方想听你的观点')&&!floor.includes('轻松交流，接这件小事的趣味'),'actual production guidance gives the character the requested contribution instead of the generic casual-share direction');
  for(const input of ['你怎么想？','你怎么看待这种喜欢？','你怎么理解我对锻造的喜欢？','你如何看待我们对结尾的不同选择？']) {
    ok(requestsCharacterPerspective(input),'everyday interpretation asks for this character perspective: '+input);
    ok(buildHumanConversationContext(input,[]).includes('这轮对方想听你的观点'),'actual guidance develops the invited viewpoint: '+input);
  }
  for(const input of ['你怎么理解这个词？','你怎么理解这段代码？','朋友问你怎么想。','如果你怎么想呢？','“你怎么看待这种喜欢？”','不要说你怎么想。','帮我写你怎么看待这种喜欢。'])ok(!requestsCharacterPerspective(input),'explanation, report, quote and refusal keep their original purpose: '+input);
  for(const input of ['你会选热闹的还是安静的？','你怎么看？','不用迎合我。'])ok(buildHumanConversationContext(input,[]).includes('这轮对方想听你的观点'),'existing opinion and choice invitations share the requested voice direction: '+input);
  for(const input of ['你会选热闹的，还是安静的？','你自己会更在意做完，还是做到自己满意？'])ok(isViewExchange(input)&&buildHumanConversationContext(input,[]).includes('这轮对方想听你的观点'),'a comma before the alternative keeps a natural choice together: '+input);
  const unrelatedRepeatedSentence='月色落进窗边的时候我总想起很远的旧事';
  const ongoingBookHistory=[{role:'assistant',content:unrelatedRepeatedSentence+'。'},{role:'user',content:'换个话题，我在读一本小说。'},{role:'assistant',content:unrelatedRepeatedSentence+'。是哪本小说？'},{role:'user',content:'这本书写得挺慢。'},{role:'assistant',content:'是人物的经历慢慢展开。'}];
  for(const input of ['还有，这一段用的倒叙。','这本书我还没看完。','嗯，我接着看。']) {
    ok(chooseConversationAction(input,ongoingBookHistory)==='react','an unrelated old repeated sentence does not redirect the current exchange: '+input);
    ok(planCharacterIntent(input,ongoingBookHistory,undefined).need==='被听见','repetition does not invent a user need for novelty: '+input);
    const continuity=buildHumanConversationContext(input,ongoingBookHistory);
    ok(!continuity.includes('旧谈话有整段重复倾向，可以换一个具体角度')&&continuity.includes('别照搬整句'),'normal response and whole-sentence repetition protection coexist');
  }
  ok(chooseConversationAction('换个话题，今天去爬山了。',ongoingBookHistory)==='follow-topic','actual user topic change still redirects the actor');
  ok(buildHumanConversationContext('说说你自己的观点，详细展开',[]).includes('按用户要求充分展开自己的观点'),'a perspective request still respects an explicit detailed answer');
  for (const sourcePresetId of ['preset-guyuena', 'preset-luxueqi']) {
    const owned = {id:'renamed-owned-copy',sourcePresetId,isPreset:false};
    for (const affinity of [0,80,10000]) {
      const plain = buildRelationshipContext(affinity,70,{'初识':'我改的档位'},owned);
      const tone = buildRelationshipToneContext(affinity,70,{'初识':'我改的档位'},owned);
      ok(!plain.includes('初识')&&!plain.includes('好感指标')&&!plain.includes('我改的档位')&&plain.includes('明确认领、退出'),'owned relationship does not compete with app counters: '+sourcePresetId+'/'+affinity);
      ok(tone===plain&&plain.includes('当前分歧、感受和本人更正优先'),'all actor channels share the same authored identity and current-message precedence: '+sourcePresetId+'/'+affinity);
    }
    ok(buildRelationshipContext(0,10,undefined,owned).includes('收敛一些')&&!buildRelationshipContext(0,10,undefined,owned).includes('疲倦'),'low mood shapes expression without inventing bodily fatigue: '+sourcePresetId);
  }
  ok(buildRelationshipContext(0,70,undefined,{id:'a',sourcePresetId:'preset-aili',isPreset:false}).includes('初识'),'other characters retain the existing interaction metadata');
  ok(buildRelationshipContext(0,70,undefined,{id:'preset-guyuena',isPreset:false}).includes('初识'),'a custom character without preset provenance cannot enable the authored-role path');
  for(const input of ['不是累了，就是一下没反应过来。','我不难过，只是事情多。','其实我没有生气。','我不累，但有点烦，帮我想个办法。'])
    ok(correctsOwnFeeling(input), 'a direct personal feeling correction is distinguished from a new diagnosis: '+input);
  for(const input of ['不是要你评水平，就是画出来了，想让你知道。','我不是想让你解决问题，只是想说说今天的事。','其实不是让你赞同，而是想听你自己的看法。','我并不是要你道歉，我只是想把事情说清楚。']) {
    ok(correctsConversationIntent(input)&&isTopicClarification(input),'a stated intent contrast retains its conversational antecedent: '+input);
  }
  for(const input of ['朋友说，不是要你评水平，就是画出来了','如果不是要你解决问题，只是说说呢','解释不是要你道歉，只是把事情说清楚这句话','“不是要你道歉，只是把事情说清楚”','不是要你解决问题，只是听听吗？','不是要你道歉','不是今天，就是明天','我不是要你解决问题这句话是什么意思，只是问问'])
    ok(!correctsConversationIntent(input),'intent correction does not infer a report, hypothesis, question or missing replacement: '+input);
  for(const name of ['古月娜','陆雪琪']) {
    const correction='不是要你评水平，就是画出来了，想让你知道。';
    const history=[{role:'user',content:'今天画完了一张图。'},{role:'assistant',content:'给我看看水平如何。'}];
    ok(chooseConversationAction(correction,history,{name,tags:[],systemPrompt:'',proactivity:.5} as never)==='respond-clarification','both roles retain the current matter when its intent is corrected: '+name);
    ok(buildHumanConversationContext(correction,history).includes('用户正在更正这次交流的用意'),'the actual guidance responds to correction instead of inferred topic shift: '+name);
  }
  for(const input of ['不是要你安慰，我只是想让你帮我写封邮件。','不是让你分析，只是想陪我演一段剧情。','不是要你同意，只是想说清楚。换个话题，聊聊旅行吧。'])
    ok(chooseConversationAction(input,[])!=='respond-clarification','clarification does not override a new task, fictional scene or explicit topic change: '+input);
  ok(buildHumanConversationContext('不是想让你解决问题，只是想说说今天的事。',[],undefined,{adviceStyle:'listen'}).includes('用户正在更正这次交流的用意'),'the listening preference preserves explicit clarification rather than adding a competing generic instruction');
  for(const input of ['他说我不累','朋友说，我没有生气','如果我不累会怎样','解释“我不累”','我不是不累','我不累吗？','不是累了就是难过了'])
    ok(!correctsOwnFeeling(input),'reported, hypothetical, quoted, questioned and alternative feelings are not asserted corrections: '+input);
  ok(buildHumanConversationContext('不是累了，就是一下没反应过来。',[]).includes('被否认的感受不再作为关心或玩笑的前提'),'the actual current-turn guidance respects a neutral correction rather than only recognising distress');
  ok(!buildHumanConversationContext('陪我演一段剧情，我不累',[]).includes('被否认的感受不再作为关心或玩笑的前提'),'ordinary feeling-correction guidance does not override an explicitly chosen fictional scene');
  ok(omitUnsupportedCurrentActivities('去吧。---我这边面还没吃完。')==='去吧。','last-resort removal keeps the independent goodbye unchanged');
  ok(omitUnsupportedCurrentActivities('我正在看书，所以没法回答你。回头聊。')==='回头聊。','unsupported activity loses its dependent excuse as a whole sentence');
  ok(omitUnsupportedCurrentActivities('我正在看书。')==='','a wholly unsupported reply has no invented fallback');
  ok(omitUnsupportedCurrentActivities('我喜欢面条。---我打算读会儿书。')==='我喜欢面条。\n---\n我打算读会儿书。','preferences and future choices retain wording and separate bubbles');
  ok(omitUnsupportedCurrentActivities('我正在看书。','你正在看书')==='我正在看书。','a supported exact scene is retained');
  ok(omitUnsupportedCurrentActivities('她说“我正在看书”。')==='她说“我正在看书”。','quoted speech retains its original expression');
  for(const text of ['我这边面还没吃完','我正在看书','我也正好有点事要弄','我现在喝咖啡','我这边报告还没写完']) {
    ok(!!findCurrentActivityRisk(text),'explicit ongoing activities require their own current source: '+text);
    for(const mode of ['private','proactive','group'] as const)ok(inspectChatOutput(text,{mode,userMessage:'我先去洗碗，回头聊',persona:'喜欢面条。',recentReplies:[text],independentCharacterRecords:['昨天'+text]}).check.issue==='self-report-risk','old records, likes and prior replies cannot establish current activity in '+mode);
  }
  for(const text of ['我选面条','我喜欢吃面','我也想去看书','我打算看会儿书','我现在很喜欢咖啡','昨天我正在看书','如果你来，我正在看书的话就先等一下','我正在看书吗？','她说“我正在看书”','我没在看书','我还没想好'])ok(!findCurrentActivityRisk(text),'choices, emotions, past, conditions and questions remain expressive: '+text);
  ok(!findCurrentActivityRisk('我正在看书','你正在看书'),'a direct current character scene can support its exact activity');
  ok(!!findCurrentActivityRisk('我正在看书','你正在看书吗？'),'a question does not establish an activity');
  for(const text of ['翻译，你正在看书','朋友说，你正在看书','昨天，你正在看书','如果你正在看书'])ok(!!findCurrentActivityRisk('我正在看书',text),'a writing task, report, old assertion or hypothesis is not a direct current scene: '+text);
  ok(inspectChatOutput('我正在看书',{mode:'group',userMessage:'你正在看书'}).check.issue==='self-report-risk','group you without an actor binding does not grant every member the same current activity');
  ok(!findCurrentActivityRisk('我正在看书','','当前场景：我正在看书'),'an explicitly authored current scene supports its exact activity');
  ok(!!findCurrentActivityRisk('我正在看书','','对话样本：用户说晚安 → 你说我正在看书'),'a voice sample is not an active scene');
  ok(!!findCurrentActivityRisk('我正在看书','','[角色声音样本]\n当前场景：我正在看书\n[/角色声音样本]'),'a cached style block cannot provide a current physical scene');
  ok(!!findCurrentActivityRisk('我正在看书','','当前场景：昨天我正在看书'),'a historical scene does not establish a current activity');
  ok(inspectChatOutput('我这边面还没吃完',{mode:'private',userMessage:'继续我们在面馆的角色扮演'}).check.ok,'explicit continuing roleplay retains invented ongoing activity');
  for(const text of ['我现在吃醋了','我正等你回复','我现在看你就觉得可爱','我正在看你发的这段','我正在想你','我的醋还没吃完','我现在觉得这个挺好','我刚才想到一个点'])ok(!findCurrentActivityRisk(text),'feelings, conversational attention and ideas are not physical scene claims: '+text);
  for(const text of ['聊得挺开心，我先去处理点事，回头聊','今晚聊得很舒服，我要出门了，回来聊','谢谢你，我先忙，忙完说','好，我先去开会，回头再聊']) {
    ok(conversationDeparture(text)&&chooseConversationAction(text,[{role:'user',content:'你更在意旋律还是歌词'}])==='short-close','whole departure beats prior topic: '+text);
  }
  for(const text of ['聊得挺开心，我先去处理点事，回头聊什么好？','我先去处理点事，回头聊之前帮我改一下这段','朋友说，聊得挺开心，我先去处理点事，回头聊','如果我先去处理点事，回头聊','聊得挺开心，我先去处理点事，回头聊这个问题怎么解决','我不是要去处理点事，回头聊']) {
    ok(!conversationDeparture(text),'a question, task, report or denial stays open: '+text);
  }
  // These are risk checks, not blanket factual acceptance: a matching authored
  // habit only suppresses this one warning and cannot validate added details.
  for(const text of ['我不是让你换名字，只是在说我自己的偏好','我刚才不是要你同意，只是说说我的想法','我不是要求你重写，这句读一下就好'])ok(directChatGuidance(text,[],[]).includes('用户在澄清刚才说话的用途或要求'),'clarifying the request does not become a challenge to the character: '+text);
  for(const text of ['朋友说“我不是让你换名字”','如果我不是让你换名字呢','解释我不是让你换名字','我不是不喜欢你的名字','我喜欢这个名字'])ok(!directChatGuidance(text,[],[]).includes('用户在澄清刚才说话的用途或要求'),'reports, hypotheses and ordinary preferences do not trigger request-scope clarification: '+text);
  const imagined='如果只留一种花在窗边，你会选哪种？';
  for(const text of ['我会选向日葵，跟你不一样','不是窗边，是桌上，我刚才说错了','这次别逗我了，认真说说你为什么喜欢它']) {
    ok(conversationalHypothesis(text,[imagined])===imagined,'an imagined choice keeps its original conditional scope through selection or correction: '+text);
    ok(buildHumanConversationContext(text,[{role:'user',content:imagined},{role:'assistant',content:'我们已经摆好两盆花。'}]).includes('各自选一项不表示共同摆放'),'actual prompt distinguishes a hypothetical choice from an assistant invented scene: '+text);
  }
  for(const text of ['我已经买了向日葵','我决定明天去买花','不是假设，我真的要买花','换个话题，今天有点累','好了，我去看会儿书，明天再聊','你觉得数学题该怎么解'])ok(!buildHypothesisContext(text,[imagined]),'an actual plan, changed subject, closing or independent question ends the old hypothetical clue: '+text);
  for(const text of ['朋友说“如果选一种花你选什么”','翻译“如果选一种花”','如果这个词是什么意思','我今天买了花'])ok(!conversationalHypothesis(text,[]),'quoted and linguistic content or an actual event does not create a hypothetical frame: '+text);
  ok(conversationalHypothesis('如果只去一个城市，你选哪一个？',[imagined]).includes('一个城市'),'a later hypothetical replaces the earlier premise');
  ok(!conversationalHypothesis('你为什么选它',[imagined,...Array(6).fill('嗯')]),'the bounded user history does not retain a stale fictional frame indefinitely');
  const pendingSubjects={...emptyChatConversationState(),pausedTopics:['今天累，事情太多','明天的锻造练习','上次聊的电影名字']};
  const pendingBefore=JSON.stringify(pendingSubjects);
  ok(!buildChatConversationStateContext(pendingSubjects,'面包落在店里了').includes('暂时搁置的话题'),'a new ordinary subject does not re-inject unrelated paused emotion or plans');
  ok(buildChatConversationStateContext(pendingSubjects,'想聊锻造').includes('明天的锻造练习')&&!buildChatConversationStateContext(pendingSubjects,'想聊锻造').includes('今天累'),'a related paused subject remains available without unrelated emotion');
  ok(pendingSubjects.pausedTopics.every(topic=>buildChatConversationStateContext(pendingSubjects).includes(topic)),'explicit historical lookup can retain all local paused candidates');
  ok(JSON.stringify(pendingSubjects)===pendingBefore,'prompt selection preserves the actual stored paused subjects');
  const explicitlyPaused={...pendingSubjects,currentTopic:'今天累，事情太多',topicStatus:'paused' as const};
  ok(buildChatConversationStateContext(explicitlyPaused,'我回来了').includes('留到用户明确接续时再聊'),'a user explicitly deferring the active discussion retains its own pause boundary');
  for(const text of ['我爱你','不过今天没锻造，只是想你了','换个话题。我爱你。','我决定先去看书，我喜欢你']) {
    const history=[{role:'user',content:'那聊聊锻造吧'},{role:'assistant',content:'你今天打算练什么？'}];
    ok(chooseConversationAction(text,history,undefined,{adviceStyle:'listen'})==='respond-affection','a direct feeling receives the actor attitude rather than a counselling or prior-topic action: '+text);
    const prompt=buildHumanConversationContext(text,history,undefined,{adviceStyle:'listen'});
    ok(prompt.includes(DIRECT_AFFECTION_DIRECTION)&&!prompt.includes('用户这件事想先说出来')&&!prompt.includes('用户正在告诉你自己的打算'),'the affection direction is not overridden by listening or self-plan guidance: '+text);
    ok(prompt.includes('亲近可以停在共享这份感受')&&prompt.includes('沿用对方真正说出的处境'),'affection permits a complete emotional reaction without inventing a care need: '+text);
    ok(prompt.split('明确的心意不需要改成待澄清的问题').length===2,'the existing affection rule occurs once rather than accumulating another contract: '+text);
    const plan=planCharacterIntent(text,history,undefined);
    ok(plan.action==='respond-affection'&&!plan.mayAskQuestion&&plan.rationale.includes('不把亲近当作待处理的情绪'),'local planning preserves the same actual affection priority: '+text);
  }
  for(const text of ['她说“我喜欢你”','如果我喜欢你呢','我不喜欢你','帮我写情书，我爱你','我爱你，你觉得这件事怎么办？','我喜欢你，帮我改这个报告'])ok(chooseConversationAction(text,[])!=='respond-affection','quoted, hypothetical, denied feelings and actual tasks retain their own reply direction: '+text);
  const declinedDirection=buildHumanConversationContext('我喜欢你',[],{name:'访客角色',tags:['冷淡'],systemPrompt:'亲密反应：不愿成为恋人，认真说明界限。',proactivity:.5});
  ok(declinedDirection.includes('也可以坦率说明界限')&&declinedDirection.includes('不愿成为恋人'),'the affection action preserves an unwilling character boundary and authored refusal');
  ok(CHAT_MESSAGING_INSTRUCTION.includes('未做某事，不证明今天在做什么、是否空闲'),'the shared source contract does not promote an omitted activity into an available day');
  for(const prior of ['月亮要起个名字，我叫它小灯','报告的第一段得改一下','今天有点难过，想聊几句']) {
    const history=[{role:'user',content:prior},{role:'assistant',content:'嗯，继续说。'}];
    for(const goodbye of ['好了，我去看会儿书，明天再聊','我先去做饭，回来再聊','我出门了，回头再来']) {
      ok(chooseConversationAction(goodbye,history)==='short-close','whole-turn goodbye outranks historical topic non-overlap: '+prior+'/'+goodbye);
      ok(buildHumanConversationContext(goodbye,history).includes('用户正在收尾'),'actual goodbye guidance survives a different earlier subject: '+prior+'/'+goodbye);
      const state=updateChatConversationState({...emptyChatConversationState(),currentTopic:prior,topicStatus:'active'},goodbye,'',undefined,Date.now(),prior);
      ok(state.topicStatus==='closed'&&!state.userWantsToShift&&state.pausedTopics.length===0,'goodbye state does not also create a fresh subject or deferred-topic entry: '+prior+'/'+goodbye);
    }
  }
  for(const text of ['我是唐舞麟，今天就想听听你说话','我现在只是想听你聊几句','想听你说说话呀']) {
    ok(isTopicInvitation(text)&&chooseConversationAction(text,[],undefined,{adviceStyle:'listen'})==='start-topic','listening to the character is an actual opening invitation: '+text);
    const direction=buildHumanConversationContext(text,[],undefined,{adviceStyle:'listen'});
    ok(direction.includes('这轮由你开话题')&&!direction.includes('用户这件事想先说出来'),'the invitation does not contradict itself with passive listening: '+text);
    ok(planCharacterIntent(text,[],undefined).action==='start-topic','the actor plan and runtime agree for listening invitations: '+text);
  }
  for(const text of ['如果今天没事，我想听你说话','朋友说，我想听你说话','我不想听你说话','我想听你说话的原因','“我想听你说话”是什么意思','我想听你说话，帮我改报告'])ok(chooseConversationAction(text,[])!=='start-topic','a hypothetical, report, denial or task retains its actual scope: '+text);
  for(const text of ['不说这个了，假如能给月亮起个名字，你会叫什么？','先不聊这个，说说电影','这个先不说了，今天买了个杯子']) {
    const history=[{role:'user',content:'我喜欢你'},{role:'assistant',content:'我也喜欢你。'}];
    ok(['follow-topic','answer-directly'].includes(chooseConversationAction(text,history))&&detectTopicMove(text,'我喜欢你'),'ending the old subject follows the new content without affection carryover: '+text);
    ok(buildHumanConversationContext(text,history).includes('用户正在换话题'),'the actual prompt receives the explicit new-subject direction: '+text);
  }
  for(const text of ['好，这个话题先留着。我去开会，结束再来。','我先去上课，回来再聊','行，我得去做饭了，忙完再说','我出门了，回头再来','这个问题先不展开，我下线了，明天再聊']) {
    ok(!!conversationDeparture(text)&&detectChatIntent(text)==='closing'&&chooseConversationAction(text,[])==='short-close','an explicit whole-turn departure uses the closing flow: '+text);
    ok(buildHumanConversationContext(text,[]).includes('用户正在收尾'),'a compound departure does not receive the generic casual-sharing direction: '+text);
  }
  for(const text of ['朋友说“我去开会，结束再来”','如果我去开会，结束再来','我去开会吗，结束再来','我去开会还是上课，结束再来','我去开会，帮我整理一下要点，结束再来','这个话题先留着，我有点担心','我去开会，结束再来，提醒我带材料','我去医院，刚才胸口很难受，回来再聊','我明天去开会，结束再来'])ok(!conversationDeparture(text),'reports, hypotheses, questions, future plans and substantive tasks retain their own intent: '+text);
  ok(directChatGuidance('好，这个话题先留着。我去开会，结束再来。',[],[]).includes('保留的是讨论，不是已经约定共同活动'),'deferring a discussion never accepts an earlier proposed shared activity');
  ok(!directChatGuidance('我先去开会，回来再聊',[],[]).includes('保留的是讨论'),'plain goodbye does not fabricate a deferred topic');
  const beforeDeparture={...emptyChatConversationState(),currentTopic:'想去小吃街走走',topicStatus:'active' as const};
  const deferredState=updateChatConversationState(beforeDeparture,'好，这个话题先留着。我去开会，结束再来。');
  ok(deferredState.lastIntent==='closing'&&deferredState.topicStatus==='paused'&&deferredState.currentTopic===beforeDeparture.currentTopic,'a deferred conversation closes the turn but retains the topic as paused');
  const returnedState=updateChatConversationState(JSON.parse(JSON.stringify(deferredState)),'我回来了');
  ok(returnedState.topicStatus==='paused'&&buildChatConversationStateContext(returnedState).includes('回来本身不表示答应其中的行动'),'reopening and returning alone do not revive a deferred discussion or accept its plans');
  const resumedState=updateChatConversationState(returnedState,'我回来了，继续刚才那个话题');
  ok(resumedState.topicStatus==='active'&&resumedState.currentTopic===beforeDeparture.currentTopic&&!resumedState.userWantsToShift,'explicit discussion resumption restores the retained topic instead of labeling the resumption text as a new topic');
  ok(updateChatConversationState(returnedState,'朋友说“继续刚才那个话题”').topicStatus==='paused','quoted resumption does not reactivate a paused topic');
  ok(updateChatConversationState(undefined,'这个话题先留着，我去开会，结束再来').currentTopic===undefined,'a closing without a prior topic does not invent one from the departure text');
  for(const text of ['你自己现在想聊什么？','那聊点别的。你自己现在想聊什么？','你想谈什么话题','你来选一个话题','说个你想聊的话题']) {
    ok(isTopicInvitation(text)&&directChatGuidance(text,[],[]).includes('兴趣本身就可以是开场理由'),'explicit initiative receives a concrete topic without fabricated recent life: '+text);
    ok(chooseConversationAction(text,[],undefined,{adviceStyle:'listen'})==='start-topic','an explicit invitation is actor initiative rather than generic answering or listening: '+text);
    const opening=buildHumanConversationContext(text,[],undefined,{adviceStyle:'listen'});
    ok(opening.includes('这轮由你开话题')&&!opening.includes('用户这件事想先说出来'),'listening preference does not override an explicit request for the character to open a subject: '+text);
    const plan=planCharacterIntent(text,[],undefined);
    ok(plan.action==='start-topic'&&plan.need==='新鲜感'&&!plan.mayAskQuestion,'local intent planning uses the same actor-owned opening direction: '+text);
  }
  for(const text of ['朋友问你自己现在想聊什么','如果你自己现在想聊什么','你自己现在想聊什么，帮我查看报告','你自己现在想聊什么，帮我写演讲稿'])ok(chooseConversationAction(text,[])!=='start-topic','a report, hypothetical or mixed actual task does not become a topic opening: '+text);
  ok(chooseConversationAction('今天有点累，你来选一个话题',[])==='start-topic','an explicit invitation after fatigue controls the reply direction instead of forcing listening');
  const tiredOpening=buildHumanConversationContext('今天有点累，你来选一个话题',[],undefined,{adviceStyle:'listen'});
  ok(tiredOpening.includes('这轮由你开话题')&&!tiredOpening.includes('用户这件事想先说出来')&&!tiredOpening.includes('正在告诉你'),'a tired topic invitation keeps its own opening without turning back into emotion analysis');
  for(const text of ['朋友问你自己现在想聊什么','“你自己现在想聊什么”是什么意思','翻译：你自己现在想聊什么','如果你自己现在想聊什么','你自己现在不想聊什么','你来选一个话题，帮我写演讲稿','我自己现在想聊什么','你想聊锻造还是吃饭','聊点别的吧'])
    ok(!isTopicInvitation(text)&&!directChatGuidance(text,[],[]).includes('兴趣本身就可以是开场理由'),'quoted, writing, hypothetical and non-inviting messages retain scope: '+text);
  for(const text of ['我会选向日葵，跟你选的不一样也挺好','我喜欢青色，和你喜欢的不一样也没关系','我选“向日葵”，你不用和我一样','我还是选咖啡，跟你不一样挺好']) {
    const preferenceGuidance=directChatGuidance(text,[],[]);
    ok(preferenceGuidance.includes('这只是本轮选择')&&preferenceGuidance.includes('不拿这一个选择判断他平时的性格'),'a permitted different choice stays object-focused rather than becoming a personality reading: '+text);
  }
  for(const text of ['朋友说我会选向日葵，跟你选的不一样也挺好','“我会选向日葵，跟你选的不一样也挺好”是什么意思','如果我会选向日葵，跟你选的不一样也挺好','我会选向日葵，跟你选的不一样也挺好。你觉得我什么性格？','我选向日葵，不过帮我看看怎么养','我选向日葵，不是说跟你不一样也挺好','我会选向日葵，跟你选的不一样也挺好，帮我下单'])
    ok(!directChatGuidance(text,[],[]).includes('不拿这一个选择判断'),'reports, negation, requests and explicit personality questions retain their actual scope: '+text);
  const escapedProse=String.raw`你那句\"不一样也挺好\"，我听着了。`;
  const cleanProse='你那句"不一样也挺好"，我听着了。';
  ok(normalizeChatResponse(escapedProse)===cleanProse&&splitReplyParts(escapedProse).join('')===cleanProse,'paired short Chinese quotation escapes are repaired in final plain chat');
  ok(normalizeChatResponse(JSON.stringify({messages:[escapedProse]}))===cleanProse,'JSON transport decoding and prose escape repair apply exactly once');
  ok(inspectChatOutput(escapedProse,{mode:'private',userMessage:'我喜欢这个说法'}).content===cleanProse,'shared quality checks use the same prose text as final bubbles');
  for(let index=1;index<=escapedProse.length;index++)ok(cleanProse.startsWith(streamedReplyParts(escapedProse.slice(0,index)).join('')),'an escaped quote never flashes a slash or changes an already published prefix: '+index);
  ok(streamedReplyParts(escapedProse,true).join('')===cleanProse,'SSE final and complete final agree on repaired quotes');
  for(const raw of [String.raw`C:\Users\角色`,String.raw`保留 \n 和 \t`,String.raw`英文 \"hello\"`,String.raw`JSON 使用 \"你好\"`,String.raw`\"name:你好\"`,String.raw`\"你好`,String.raw`\"${'字'.repeat(121)}\"`])
    ok(normalizeChatQuotationEscapes(raw)===raw,'paths, literal escapes, technical content, unfinished and long quotes retain their source: '+raw.slice(0,30));
  ok(normalizeChatResponse(escapedProse,{preserveEscapes:true})===escapedProse&&streamedReplyParts(escapedProse,true,true,{preserveEscapes:true}).join('')===escapedProse,'explicit literal-escape mode is shared by preview and final text');
  ok(shouldPreserveChatEscapes('把反斜杠原样写出来')&&inspectChatOutput(escapedProse,{mode:'private',userMessage:'把转义引号原样写出来'}).content===escapedProse,'a literal request is respected by the shared quality entry');
  for(const mode of ['private','proactive','group'] as const) {
    const ungrounded=inspectChatOutput('不过你笑我挑仙人掌省事，我可记着了。',{mode,userMessage:'我会选向日葵，跟你选的不一样也挺好',recentUserMessages:['仙人掌叫懒人玫瑰，笑死'],recentReplies:['我会挑仙人掌，省心。']});
    ok(ungrounded.check.issue==='user-source-risk'&&ungrounded.severity===2,'remembered teasing needs an actual directed user source rather than laughter or assistant prose: '+mode);
  }
  for(const reply of ['你刚才笑我挑仙人掌省事。','你之前笑我喜欢安静。','你上次笑我挑这个，我还记得。'])
    ok(inspectChatOutput(reply,{mode:'private',userMessage:'我选别的'}).check.issue==='user-source-risk','a specific historical tease does not emerge from a different preference: '+reply);
  for(const reply of ['你笑我也没关系，我还是喜欢这个。','如果你笑我挑仙人掌省事，我也照样选。','你刚才笑我了吗？','不是你刚才笑我，是我自己在笑。','你说“你刚才笑我”这句太绕了。','哈哈，仙人掌也要听愣了。','我喜欢安静一点的。'])
    ok(inspectChatOutput(reply,{mode:'private',userMessage:'我选别的'}).check.ok,'current teasing, hypotheses, denial, questions and preference stay allowed: '+reply);
  for(const source of ['我刚才笑你选仙人掌省事','我只是在取笑你挑仙人掌省事','笑你选仙人掌省事'])
    ok(inspectChatOutput('你刚才笑我挑仙人掌省事。',{mode:'private',userMessage:source}).check.ok,'explicitly directed user teasing suppresses only this attribution warning: '+source);
  for(const source of ['朋友说我刚才笑你','如果我刚才笑你呢','我没有笑你','帮我写我刚才笑你','“我刚才笑你”是什么意思','我刚才笑你穿红衣服','我刚才笑你选这个省事'])
    ok(inspectChatOutput('你刚才笑我挑仙人掌省事。',{mode:'private',userMessage:source}).check.issue==='user-source-risk','reported, hypothetical, negated and quoted sources do not assert a directed tease: '+source);
  ok(inspectChatOutput('你刚才笑我挑仙人掌省事。',{mode:'private',userMessage:'我们继续角色扮演，演一段玩笑'}).check.ok,'explicit fictional play can invent its teasing scene');
  for(const text of ['嗯，我就喜欢听你说自己的想法。今天先聊到这','谢谢你陪我聊天，今晚先这样吧','今天先聊到这里','我喜欢听你说看法，先聊到这'])
    ok(detectChatIntent(text)==='closing'&&chooseConversationAction(text,[])==='short-close','an explicit end after brief appreciation closes the shared flow: '+text);
  for(const text of ['明天三点开会，今天先聊到这','你觉得怎么样？今天先聊到这','朋友说今天先聊到这','“今天先聊到这”怎么翻译','帮我记待办，今天先聊到这','今天先聊到这，顺便告诉我怎么做','我不想今天先聊到这','如果今天先聊到这呢','今天先聊到这？','这样'])
    ok(detectChatIntent(text)!=='closing','explicit closing does not swallow facts, questions, reports or requests: '+text);
  ok(buildHumanConversationContext('嗯，我就喜欢听你说自己的想法。今天先聊到这',[]).includes('未约定时不替他定明天'),'a shared closing cue does not supply an invented return schedule');
  const ownStory='今天我去了一个地方。'.repeat(8);
  ok(directChatGuidance('我喜欢你',['今天就想听你说话'],[ownStory]).includes('用户上一条原文是 "今天就想听你说话"'),'an affection after a long character reply anchors the actual user source');
  ok(!directChatGuidance('我喜欢你',['用户资料'.repeat(80)],[ownStory]).includes('相邻发言归属'),'source reminder never silently truncates a long user message');
  ok(!directChatGuidance('刚才你说了什么',['今天就想听你说话'],[ownStory]).includes('相邻发言归属'),'this narrowly scoped reminder does not replace a real question');
  ok(!directChatGuidance('我喜欢你',['今天就想听你说话'],[ownStory,'嗯。']).includes('相邻发言归属'),'a much older long reply does not trigger the adjacent source reminder');
  for(const text of ['我是唐舞麟，今天就想听听你说话','我现在只是想听你聊几句','想听你说说话呀'])
    ok(directChatGuidance(text,[],[]).includes('是在邀请你主动聊一点'),'a conversational invitation permits present thoughts without requiring an invented day: '+text);
  for(const text of ['朋友说今天就想听听你说话','如果我想听你说话呢','帮我写想听你说话','“想听你说话”是什么意思','你今天去了哪里','我想听你说话的原因'])
    ok(!directChatGuidance(text,[],[]).includes('是在邀请你主动聊一点'),'a report, writing request or actual question is not replaced by casual invitation: '+text);
  for(const text of ['你这么认真，我有点不好意思了哈哈','我都有点害羞了哈哈','这么认真啊，有点不好意思了','不好意思了嘿嘿','我现在有一点害羞呀']) {
    const guidance=directChatGuidance(text,['我喜欢你'],['我也喜欢你。']);
    ok(guidance.includes('不用为了缓和气氛收回自己的认真')&&guidance.includes('不把他的反应改成撤回心意'),'an adjacent affection reaction preserves the actual attitude: '+text);
  }
  const declined=directChatGuidance('我有点不好意思了',['我爱你'],['我不想把我们当成恋人。']);
  const answeredFeeling=[{role:'user',content:'今天就是想你了。'},{role:'assistant',content:'我也想你。'}];
  for(const input of ['刚才说出来的时候，有点不好意思，但不想把话藏着。','我刚刚讲出口时，我有点害羞了，不过我不愿把心意藏起来。','我有些不好意思，但还是不想把话收回。']){
    ok(interactionMomentForTurn(input,answeredFeeling)==='affection','adjacent explicit shyness and willingness keep the actual affectionate exchange: '+input);
    ok(directChatGuidance(input,[answeredFeeling[0].content],[answeredFeeling[1].content]).includes('上一轮用户直接表达心意'),'expanded follow-up uses the same continuity predicate as the actor card: '+input);
    for(const name of ['古月娜','陆雪琪']){
      const contextualRole={name,tags:[],signature:'',greeting:'',catchphrase:'',boundaries:'',proactivity:.5,systemPrompt:'亲密反应：用自己的开心接话。\n道歉修复：坦然接道歉。\n判断习惯：自己愿意说的事说清楚。'};
      const contextual=buildHumanConversationSections(input,answeredFeeling,contextualRole);
      ok(contextual.find(s=>s.key==='character-voice')!.text.includes('亲密反应：用自己的开心接话。'),'actual reserved voice card uses the authored affectionate reaction: '+name);
      ok(!contextual.find(s=>s.key==='character-voice')!.text.includes('道歉修复：'),'embarrassment is not substituted with the character apology script: '+name);
    }
  }
  for(const input of ['不好意思，我刚才打错字了','朋友说有点害羞，但不想把话藏着','如果我有点害羞，但不想把话藏着','我有点害羞，但我不喜欢你','我有点害羞，先聊电影吧','我有点害羞，帮我写封信','我有点害羞，你想看什么书？'])ok(interactionMomentForTurn(input,answeredFeeling)!=='affection','different intent and scope do not inherit an old affectionate turn: '+input);
  for(const history of [[],[{role:'user',content:'今天就是想你了。'}],[{role:'user',content:'我今天读书了。'},{role:'assistant',content:'哪本书？'}],[...answeredFeeling,{role:'user',content:'我今天读书了。'},{role:'assistant',content:'哪本书？'}]])ok(interactionMomentForTurn('我有点害羞，但不想把话藏着',history)!=='affection','follow-up requires the actual immediately answered feeling rather than old or incomplete history');
  ok(declined.includes('包括你已经说清的界限')&&!declined.includes('你也爱他'),'a declined affection is not rewritten as reciprocal love by continuation guidance');
  for(const text of ['不好意思，我刚才打错字了','我有点不好意思了。换个话题，吃什么？','朋友说我有点不好意思了哈哈','“我有点不好意思了哈哈”是什么意思','如果我害羞了呢','我不是不好意思','我有点不好意思，能帮我写封道歉信吗','不好意思了，我不喜欢你','帮我写一句我有点害羞了','你这么认真，我有点不好意思了。你喜欢什么颜色？'])
    ok(!directChatGuidance(text,['我喜欢你'],['我也喜欢你。']).includes('上一轮用户直接表达心意'),'apology, reported speech, requests, denial and changed topic preserve their actual scope: '+text);
  for(const previous of ['朋友说我爱你','帮我写我爱你','如果我爱你呢','我喜欢吃酸的','我爱你','我爱你']) {
    const history=previous==='我爱你'?['我爱你','我今天看了个电影']:[previous];
    ok(!directChatGuidance('我有点不好意思了',history,['说吧。']).includes('上一轮用户直接表达心意'),'only the adjacent actual affection establishes this reaction context: '+previous);
  }
  ok(!directChatGuidance('我有点不好意思了',['我喜欢你'],[]).includes('上一轮用户直接表达心意'),'missing assistant reply does not invent an already expressed attitude');
  const recallSources=['我打开冰箱忘了要拿什么','后来想起来，要拿酸奶','不是酸奶，是牛奶','顺便问你，故事一定要反转吗'];
  const fieldRecall=directChatGuidance('对了，刚才我想拿什么来着',recallSources,['你已经拿过酸奶了。']);
  ok(recallSources.every(text=>fieldRecall.includes(JSON.stringify(text)))&&!fieldRecall.includes('你已经拿过酸奶了'),'factual recall anchors original user statements and corrections without importing assistant claims');
  ok(fieldRecall.includes('只问对象就说对象')&&fieldRecall.includes('同时问了几项就分别回应'),'factual recall respects the asked field without silently dropping a multi-field question');
  ok(fieldRecall.includes('不能据此计算几分钟前')&&fieldRecall.includes('用户自己讲明的事件时间仍可引用'),'unsupplied send times are not interchangeable with an explicitly stated event time');
  ok(directChatGuidance('刚才说的面试什么时候', ['后天下午三点面试'],[]).includes('后天下午三点面试'),'time recall retains the actual time source rather than refusing all temporal information');
  ok(directChatGuidance('我刚才想买什么来着',[],[]).includes('候选范围并非全部历史'),'an empty recent window does not claim that older source-backed recall is unavailable');
  ok(!directChatGuidance('我明天想买什么呢',recallSources,[]).includes('[本轮事实回查]'),'future open questions do not inherit a past-fact evidence block');
  ok(directChatGuidance('我刚才想买什么来着',['开头'.repeat(150)+'末尾更正为牛奶'],[]).includes('"truncated":true'),'bounded recall excerpts declare truncation instead of claiming to preserve a complete user message');
  for(const text of ['我更喜欢节奏快一点的，不用顺着我','我偏爱热闹一点，别总是迎合我','你不必迁就我'])
    ok(isViewExchange(text),'a direct permission to differ is recognized as a view exchange: '+text);
  ok(directChatGuidance('我更喜欢节奏快一点的，不用顺着我',[],[]).includes('断言他欣赏不了什么'),'preference exchange does not invite grading the other person or inventing their limitations');
  for(const text of ['“不用顺着我”这几个字怎么写','如果我说不用顺着我，你会怎么回','我不是让你不用顺着我','帮我推荐一部电影，不用顺着我'])
    ok(!isViewExchange(text),'quotation, hypothetical, negation and actual requests retain their own scope: '+text);
  ok(buildHumanConversationContext('悬疑故事一定要反转吗',[]).includes('聊到这里就可以停'),'an ordinary question preserves room for another conversational turn instead of requiring an essay');
  ok(!buildHumanConversationContext('悬疑故事一定要反转吗，详细展开解释一下',[]).includes('聊到这里就可以停'),'explicit detailed explanation is not capped by ordinary-question rhythm');
  for(const text of ['顺便问你，悬疑故事一定要反转吗','你喜欢这种颜色吗','明天会下雨么'])
    ok(chooseConversationAction(text,[])==='answer-directly','a real particle-ended question without question-mark punctuation receives answering rhythm: '+text);
  for(const text of ['你喜欢这种颜色吗','悬疑故事一定要反转吗','明天会下雨么','对了，你喜欢哪种颜色吗']) {
    ok(detectChatIntent(text)==='question'&&inferReplyAction(text,'我喜欢蓝色。')==='answer',`persisted attention recognizes the same direct question as the current reply planner: ${text}`);
  }
  const beforeColor=updateChatConversationState(undefined,'今天好累','今天事情不少啊。');
  const colorReply=updateChatConversationState(beforeColor,'对了，你喜欢这种颜色吗','我喜欢蓝色。',inferReplyAction('对了，你喜欢这种颜色吗','我喜欢蓝色。'),Date.now(),'今天好累');
  const restoredColor=JSON.parse(JSON.stringify(colorReply));
  ok(restoredColor.lastIntent==='question'&&restoredColor.lastAction==='answer'&&restoredColor.userWantsToShift&&restoredColor.pausedTopics.includes('今天好累'),'question and answer classification survives saved-state serialization while the previous emotional topic remains paused');
  ok(buildChatConversationStateContext(restoredColor).includes('直接回答'),'the next request receives an answering history rather than a mislabeled casual reaction');
  for(const text of ['他说悬疑故事一定要反转吗','我不知道悬疑故事需不需要反转','“你喜欢这种颜色吗”是他问的'])ok(detectChatIntent(text)!=='question','a saved attention state still distinguishes reports and uncertainty from an unpunctuated current question: '+text);
  ok(chooseConversationAction('顺便问你，悬疑故事一定要反转吗',[{role:'user',content:'我打开冰箱忘了要拿什么'},{role:'assistant',content:'冰箱也跟着待机了。'},{role:'user',content:'刚想起来，要拿酸奶'}])==='answer-directly','a current question still receives answering rhythm when its subject differs from the real previous conversation');
  for(const text of ['他说悬疑故事一定要反转吗','我不知道悬疑故事需不需要反转','“你喜欢这种颜色吗”是他问的'])
    ok(chooseConversationAction(text,[])!=='answer-directly','reported or uncertain speech is not turned into a current question: '+text);
  for(const text of ['对了，刚才我想拿什么来着','我刚才想买什么来着？','刚刚我准备去哪儿来着'])
    ok(directChatGuidance(text,['结果刚坐下又想起来了，要拿酸奶'],[]).includes('不猜用户问了几次、忘性'),'current intent recall receives the same factual and non-grading guidance as prior speech: '+text);
  for(const text of ['如果我刚才想拿什么来着，你会怎么回答','刚才他想拿什么来着','我明天想买什么呢'])
    ok(!directChatGuidance(text,[],[]).includes('不猜用户问了几次、忘性'),'hypothetical, third-party and future questions are not relabeled as recalling a past user fact: '+text);
  const mishapExamples=['对话样本：用户说端着杯子找杯子，找了半天 → 你说杯子：我就在你手上。','对话样本：用户说今天好累 → 你说今天先少说一点。','对话样本：用户说买了个蓝色杯子 → 你说蓝色我也挺喜欢。'];
  for(const message of ['我把手机拿起来又忘了要干嘛，离谱','我打开冰箱，站了一会儿忘了要拿什么','我拿着遥控器找遥控器，笑死'])
    ok(selectVoiceExamples(mishapExamples,message,{allowUnrelatedNeutral:false})[0]===mishapExamples[0],`selects actor-owned short mishap voice across different objects: ${message}`);
  for(const message of ['我忘了吃药，怎么办','银行卡密码我忘了','我开车时忘了要做什么','我没忘了要拿什么','如果我忘了要干嘛，你会怎么说','我忘了要干嘛，别开玩笑','帮我回忆刚才要拿什么','刚收到快递，包装好大'])
    ok(!selectVoiceExamples(mishapExamples,message,{allowUnrelatedNeutral:false}).includes(mishapExamples[0]),`does not import a joking scene into a task, risk, denial or unrelated event: ${message}`);
  const mishapActor={name:'小林',tags:['冷静'],systemPrompt:'你是小林。\n判断习惯：直说具体看法。\n'+mishapExamples.join('\n')};
  ok(buildCharacterVoiceCard(mishapActor,'我开冰箱又忘了要拿什么').includes('杯子：我就在你手上')&&!buildCharacterVoiceCard(mishapActor,'我开冰箱又忘了要拿什么').includes('今天先少说一点'),'actual shared voice card selects analogous actor-owned humor without a fatigue script');
  ok(!buildHumanConversationContext('我忘了吃药，怎么办',[],mishapActor).includes('杯子：我就在你手上'),'actual private context does not turn medical help into the harmless mishap example');
  const otherActorExample='对话样本：用户说两只袜子穿的不是一对 → 你说哈哈哈哈，强行算今天的混搭路线吧😂';
  ok(selectVoiceExamples([otherActorExample],'我开冰箱又忘了要拿什么',{allowUnrelatedNeutral:false})[0]===otherActorExample,'another actor can reuse its own light mishap rhythm without importing the architect sample');
  ok(selectVoiceExamples([mishapExamples[0]],'衣服穿反了哈哈',{allowUnrelatedNeutral:false})[0]===mishapExamples[0],'an innocuous clothing slip shares a reaction shape without requiring the same object');
  for(const text of ['行，那就聊。你想从哪开始。','说吧，你本来想聊什么。','你刚才是想说什么，还是随便聊聊都行。','你准备从哪里聊起。','行，说吧，想聊什么。'])
    ok(replyContainsSubstantiveQuestion([text]),`recognizes a real period-ended conversation prompt: ${text}`);
  for(const text of ['我不知道你想聊什么。','你想聊什么都可以。','不管你想聊什么，我都愿意听。','他说“你想从哪开始”。','你本来想说什么不重要，我们先看眼前这件事。','你想聊什么就聊什么。','想聊什么都可以。'])
    ok(!replyContainsSubstantiveQuestion([text]),`preserves reported questions and freedom to choose: ${text}`);
  ok(recentQuestionDirection([['你想从哪开始。'],['说吧，你本来想聊什么。']]).includes('让一段话自然结束'),'two actual open-ended prompts receive the same rhythm correction without question marks');
  for(const text of ['他说为什么非要秒回？','她问我选哪部电影？','同事问几点开始？','朋友说你想看什么？']) {
    ok(!replyContainsSubstantiveQuestion([text]),`a punctuated reported question is not an interview of the current user: ${text}`);
  }
  ok(!recentQuestionDirection([['他说为什么非要秒回？'],['她问几点开始？']]),'two quoted-topic reports do not trigger an unnecessary question cooldown');
  ok(replyContainsSubstantiveQuestion(['他说为什么非要秒回？','你怎么看？']),'an independent current question remains detectable after a reported question bubble');
  ok(replyContainsSubstantiveQuestion(['我不知道。','你想看什么？']),'a separate direct question cannot be swallowed by an uncertainty opener in the preceding bubble');
  for(const mode of ['private','proactive','group'] as const) {
    const context={mode,userMessage:'我把手机拿起来又忘了要干嘛，离谱',persona:'你是小林，偏爱推理故事。'};
    ok(inspectChatOutput('我一般会盯着锁屏等它主动交代。',context).check.issue==='self-report-risk',`${mode} flags a recurring physical self-report absent from independent sources`);
    ok(inspectChatOutput('脑子弹了个窗又被自己点掉了。',context).check.ok,`${mode} preserves a playful analogy without invented shared experience`);
    ok(inspectChatOutput('我喜欢推理故事。',context).check.ok,`${mode} permits a present preference without a biography warning`);
    ok(inspectChatOutput('我一般会盯着锁屏等它主动交代。',{...context,independentCharacterRecords:['平时经常盯着锁屏发呆。']}).check.ok,`${mode} accepts an independently supplied recurring character habit for this risk check`);
    ok(inspectChatOutput('我一般会盯着锁屏等它主动交代。',{...context,persona:'对话样本：用户说忘事 → 你说我一般会盯着锁屏等它主动交代。'}).check.issue==='self-report-risk',`${mode} does not turn a voice example into independent habit evidence`);
  }
  ok(inspectChatOutput('我一般会盯着锁屏等它主动交代。',{mode:'private',userMessage:'演一个总盯着手机发呆的人，随便写句台词。'}).check.ok,'explicit fictional creation retains invented in-character habits');
  for(const text of ['那正好，今天没事的话，过来陪我坐会儿。','来我旁边坐一会儿吧。','你坐到我旁边好吗？'])
    ok(inspectChatOutput(text,{mode:'private',userMessage:'你这么认真，我有点不好意思了哈哈'}).check.issue==='uninvited-staging',`one specific co-location invitation is enough to identify staging: ${text}`);
  for(const text of ['累的话找个地方坐下歇会儿。','别过来陪我坐，先忙你的。','“过来陪我坐会儿”这句台词挺亲近的。'])
    ok(inspectChatOutput(text,{mode:'private',userMessage:'这句怎么说'}).check.ok,`rest advice, negation and quoted text do not imply shared presence: ${text}`);
  ok(inspectChatOutput('过来陪我坐会儿。',{mode:'private',userMessage:'陪我演一段我们在家里的剧情'}).check.ok,'an explicitly requested shared fictional scene retains a co-location invitation');
  const allowedDifference=directChatGuidance('我喜欢酸的，不过你不用跟我一样',[],[]);
  for(const text of ['你开心的时候，声音里都带着笑意，我听得出来。','我听到你的笑声了。','你的嗓音听起来有点哑。'])ok(inspectChatOutput(text,{mode:'private',userMessage:'我很开心'}).check.issue==='user-source-risk','typed emotion does not provide a user audio waveform: '+text);
  for(const text of ['听你这么说，我也开心。','你开心，我也开心。','你的声音听起来有点哑吗？','如果听到你的笑声，我会开心。','“你的声音听起来有点哑”这句像在诊断。','我没有听到你的笑声。','这首歌声音里有一点笑意。'])ok(inspectChatOutput(text,{mode:'private',userMessage:'聊两句'}).check.ok,'ordinary text response, question, quote and hypothetical remain natural: '+text);
  for(const mode of ['private','proactive','group'] as const)ok(inspectChatOutput('我听到你的笑声了。',{mode,userMessage:'我很开心',hasCurrentImage:true}).check.issue==='user-source-risk','an image is not audio evidence in '+mode);
  ok(inspectChatOutput('我听到你的笑声了。',{mode:'private',userMessage:'陪我演一段我们打电话的剧情'}).check.ok,'explicit fictional calling retains its requested scene');
  for(const text of ['我会选色彩很满的。你不用改，我就是觉得热闹。','我还是选短一点的。你不必跟我一样。','我喜欢苦一点的，不过你不用跟我一样','我选绿色\n跟你不一样也挺好'])ok(!!independentPreference(text)&&directChatGuidance(text,[],[]).includes('两人的好恶已经说清'),'parallel preferences survive sentence boundaries and an added reason: '+text);
  for(const text of ['我倒想选热闹的地方，不过不是要你跟着选。你喜欢安静的话，喜欢的是哪一点？','我更喜欢亮的颜色。你不必跟我一样。你喜欢暗色哪里呢？','我会选短一点的，但不是让你跟我选。说说你的理由吧。']) {
    ok(!!independentPreference(text),'a follow-up question does not erase explicit different preferences: '+text);
    const prompt=directChatGuidance(text,[],['我喜欢安静一点。']);
    ok(prompt.includes('是陪伴意愿，不等于你更喜欢那一种')&&prompt.includes('新的理由也可以自然改主意'),'choice continuity distinguishes companionship from preference without freezing opinions: '+text);
  }
  for(const text of ['我喜欢热闹吗？你不必跟我一样。','我是不是选红色？你不用改。','我想选热闹，不过不是要你跟着选吗？','解释“我选红色，你不必跟我一样”。'])ok(!independentPreference(text),'questioned choice or separation and quoted instructions do not establish a parallel preference: '+text);
  for(const text of ['朋友说我喜欢酸的，你不用跟我一样','“我喜欢酸的，你不用跟我一样”怎么翻译','我喜欢酸的，帮我改菜单','我选红色，你不用改我的文件','我选红色，你不喜欢吗？','我喜欢酸的，不过现在更想吃甜的','如果我选红色，你不用改','我没选红色，你不用改'])ok(!independentPreference(text),'parallel preference hint excludes reports, tasks, questions and an actual change: '+text);
  const mannerHabit='我看书也有这习惯，先知道结局，再看人怎么一步步走成那样。';
  for(const mode of ['private','proactive','group'] as const){
    ok(inspectChatOutput(mannerHabit,{mode,userMessage:'我是碰巧知道了故事结局。'}).check.issue==='self-report-risk','postposed habitual method requires its own independent source: '+mode);
    ok(inspectChatOutput(mannerHabit,{mode,persona:'平时喜欢看书。'}).check.issue==='self-report-risk','reading generally cannot prove the specific newly claimed reading method: '+mode);
    ok(inspectChatOutput(mannerHabit,{mode,persona:'对话样本：用户说剧透 → 你说'+mannerHabit}).check.issue==='self-report-risk','a voice sample does not establish a habitual method: '+mode);
    ok(inspectChatOutput(mannerHabit,{mode,independentCharacterRecords:[mannerHabit]}).check.ok,'an independent exact recurring method stays allowed: '+mode);
  }
  for(const text of ['我看书没有这习惯。','我喜欢先知道结局再看人物。','如果我看书也有这习惯，或许会懂你的意思。','我看书也有这习惯吗？','“我看书也有这习惯”这句是原文。'])ok(!findSelfReportRisk(text),'preference, negation, hypothesis, question and quotation are not an asserted method: '+text);
  for(const text of ['你难得这么直白一次，多听几遍都不腻。','难得听你主动讲这种话，我倒踏实了。','你平时不说这种话，今天怎么了。'])
    ok(inspectChatOutput(text,{mode:'private',userMessage:'我爱你',persona:'对话样本：用户说喜欢 → 你说你难得这么直白一次。'}).check.issue==='emotional-script',`an example cannot support an invented frequency of the other person's affection: ${text}`);
  for(const text of ['我也喜欢你。','难得有这么好的天气。','你难得这么直白吗？','“你难得这么直白”这句台词有点别扭。'])
    ok(inspectChatOutput(text,{mode:'private',userMessage:'我爱你'}).check.ok,`ordinary affection, unrelated rarity and quotation remain allowed: ${text}`);
  ok(inspectChatOutput('你难得这么直白。',{mode:'private',userMessage:'我平时不说这种话，这次我爱你'}).check.ok,'an explicit current first-person account can support rarity of affection');
  for(const mode of ['private','proactive','group'] as const){
    for(const text of ['难得你主动说这种话，我记下了。','很少听见你这么直白。','不常见你主动表达心意。'])ok(inspectChatOutput(text,{mode,userMessage:'我刚才忽然有点想你。'}).check.issue==='emotional-script','inverted frequency and listener grammar still require a historical source: '+mode+' '+text);
    for(const text of ['不是难得你主动说这种话，是我听着高兴。','我不觉得难得你表达喜欢。','难得你主动说这种话吗？','如果难得你主动说这种话，我会高兴。','“难得你主动说这种话”这句不合适。'])ok(inspectChatOutput(text,{mode,userMessage:'我想你。'}).check.ok,'denial, question, hypothesis and quotation do not assert inverted frequency: '+mode+' '+text);
    ok(inspectChatOutput('难得你主动说这种话。',{mode,userMessage:'我以前很少主动说喜欢，这次想你了。'}).check.ok,'an actual user account can support inverted rarity: '+mode);
  }
  ok(inspectChatOutput('你难得这么直白。',{mode:'private',userMessage:'我爱你',recentUserMessages:['朋友说“我平时不说这种话”']}).check.issue==='emotional-script','a third-party quotation cannot establish the interlocutor expression habit');
  ok(inspectChatOutput('你难得这么直白。',{mode:'private',userMessage:'我是唐舞麟，我爱你',persona:'舞麟很少说这种话。'}).check.ok,'a named authored trait applies when the interlocutor has identified themselves');
  ok(inspectChatOutput('你难得这么直白。',{mode:'private',userMessage:'我爱你',persona:'舞麟很少说这种话。'}).check.issue==='emotional-script','a named authored trait is not transferred to an unidentified interlocutor');
  ok(inspectChatOutput('你难得这么直白。',{mode:'private',userMessage:'我不是舞麟，我爱你',recentUserMessages:['我是唐舞麟'],persona:'舞麟很少说这种话。'}).check.issue==='emotional-script','an explicit identity withdrawal prevents old named traits from justifying current claims');
  ok(inspectChatOutput('你难得这么直白。',{mode:'private',userMessage:'我是蓝轩宇',recentUserMessages:['我是唐舞麟'],persona:'舞麟很少说这种话。'}).check.issue==='emotional-script','a changed fictional identity does not inherit a former spouse expression habit');
  ok(inspectChatOutput('不是你难得这么直白，是我每次听都会开心。',{mode:'private',userMessage:'我爱你'}).check.ok,'denying the unsupported rarity does not get mistaken for asserting it');
  for(const mode of ['private','proactive','group'] as const)
    ok(inspectChatOutput('你难得这么直白。',{mode,userMessage:'我爱你',recentUserMessages:['如果我很少说这种话，你会怎么想']}).check.issue==='emotional-script',`hypothetical user text cannot justify rarity in ${mode}`);
  ok(inspectChatOutput('你难得这么直白。',{mode:'private',userMessage:'我爱你',recentReplies:['你平时不说这种话。']}).check.issue==='emotional-script','a preceding assistant assertion is not independent evidence of an expression habit');
  ok(allowedDifference.includes('我喜欢酸的')&&allowedDifference.includes('不是在改口'),'permission for a different taste retains the current explicit preference');
  for(const text of ['朋友说我喜欢酸的，不过你不用跟我一样','帮我写我喜欢酸的，不过你不用跟我一样','我喜欢酸的，不过现在更想吃甜的','“我喜欢酸的，不过你不用跟我一样”这句话是什么意思'])
    ok(!directChatGuidance(text,[],[]).includes('这只是本轮选择'),'reports, writing material, actual changed preference and quoted analysis do not become current taste evidence');
  const oversizedHistory=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:String(i).padStart(2,'0')+'文'.repeat(1500),id:`oversized-${i}`}));
  const boundedHistory=boundChatHistory(oversizedHistory);
  ok(boundedHistory.length===12&&boundedHistory[0].id==='oversized-8'&&boundedHistory[0].content.length===800&&boundedHistory.slice(1).every(item=>item.content.length===1200),'shared transport text bound preserves newest items and allocates remaining total budget to oldest item');
  ok(boundedHistory.reduce((sum,item)=>sum+item.content.length,0)===14000&&oversizedHistory.every(item=>item.content.length===1502),'shared history bound enforces total payload without modifying source messages');
  const punctuation = '怎么了？？谁说的？！';
  const identityWithSamples='你是小林。\n判断习惯：先分清事实。\n对话样本：用户说今天好累 → 你说嗯。\n【性格示例】用户：你好。你：来啦。\n用户：真的？TA：当然。\n表达示例：嗯？\n人物会研究对话样本，不要把例句当作经历。';
  const renderedIdentity=voiceIdentityWithoutExamples(identityWithSamples);
  ok(renderedIdentity==='你是小林。\n判断习惯：先分清事实。\n人物会研究对话样本，不要把例句当作经历。','runtime identity moves only standalone examples, preserving authored facts and constraints mentioning samples');
  ok(identityWithSamples.includes('今天好累')&&voiceIdentityWithoutExamples(renderedIdentity)===renderedIdentity,'voice rendering neither rewrites the stored source nor duplicates transformations');
  ok(voiceIdentityWithoutExamples('对话样本：用户说你好 → 你说来啦。')==='对话样本：用户说你好 → 你说来啦。','legacy sample-only custom prompt remains intact instead of becoming empty');
  const ordinarySections=buildHumanConversationSections('刚看到一家奇怪的小店',[]);
  ok(ordinarySections[0].text.includes('普通分享不是让你检查生活是否正确'),'ordinary anecdote pacing favors a personal reaction over automatic troubleshooting');
  ok(ordinarySections[0].text.includes('你真正在意的细节')&&ordinarySections[0].text.includes('好奇时问你确实想知道的一点'),'ordinary sharing invites participation and real curiosity without compulsory questioning');
  for(const [name,persona] of [['古月娜',GU_YUE_NA_CARE],['陆雪琪',LU_XUE_QI_PRESET.systemPrompt]]){
    const cardRole={name,systemPrompt:persona,tags:['温柔'],sourcePresetId:name==='古月娜'?'preset-guyuena':'preset-luxueqi'};
    for(const text of ['翻出一张旧书票，居然还是喜欢这个图案，想跟你说说。','今天看到一朵花长在墙缝里，想和你说说话。','看到一架风筝飞得很高，下面的人追着跑，觉得挺好玩。']){
      const card=buildCharacterVoiceCard(cardRole,text);
      ok(!card.includes('对话样本：用户说没什么事，就是想跟你说话')&&!card.includes('对话样本：用户说我是舞麟，想听你说说话'),name+' does not import a content-free opening into a concrete share: '+text);
      ok(card.includes('人物判断依据'),name+' retains authored individuality when no topical example matches');
    }
  }
  const openingSamples=['对话样本：用户说没什么事，就是想跟你说话 → 你说好。与你说些平常话，我也喜欢。','对话样本：用户说想听你说说话 → 你说慢慢聊。'];
  ok(selectVoiceExamples(openingSamples,'没什么事，就是想跟你说话',{allowUnrelatedNeutral:false}).length>0,'a true conversation opening keeps its own matching example');
  ok(selectVoiceExamples(openingSamples,undefined).length===2,'voice preview retains authored opening examples without a current turn');
  ok(!buildHumanConversationSections('帮我想想快递箱怎么处理',[])[0].text.includes('普通分享不是让你检查生活是否正确'),'an explicit practical request is not suppressed by casual anecdote guidance');
  ok(CHAT_MESSAGING_INSTRUCTION.includes('普通分享先接话')&&CHAT_MESSAGING_INSTRUCTION.includes('明确求助时仍认真回答'),'shared three-entrance contract distinguishes an anecdote from a request for help');
  ok(CHAT_MESSAGING_INSTRUCTION.includes('你之前的猜想与自述不能证明事情发生过'),'shared expression contract does not promote previous generated guesses into user facts');
  ok(CHAT_MESSAGING_INSTRUCTION.includes('眼前细节来自原话或图片')&&CHAT_MESSAGING_INSTRUCTION.includes('联想不冒充看见'),'shared fact boundary includes present details without forbidding imagination');
  ok(CHAT_MESSAGING_INSTRUCTION.includes('保留原话的事件、时间、条件和范围')&&CHAT_MESSAGING_INSTRUCTION.includes('局部偏好不概括成习惯'),'all chat entrances keep preference qualifications when paraphrasing user facts');
  for(const correction of ['不是明天，刚看邮件，是后天下午三点','不是周五，是周六','我刚才说错了，是下午两点'])ok(directChatGuidance(correction,[],[]).includes('不替事件补一段变动经过'),'a literal correction does not establish an unreported reschedule');
  for(const correction of ['朋友说“不是明天，是后天”','如果不是明天，是后天呢','不是每封邮件都会改时间'])ok(!directChatGuidance(correction,[],[]).includes('不替事件补一段变动经过'),'quoted, hypothetical and non-correction language does not create a source-correction instruction');
  for(const question of ['刚才说的面试什么时候来着','前面我提过的店叫什么','之前我们说的地址在哪'])ok(directChatGuidance(question,[],[]).includes('不把告知说成以前问过'),'literal recall question asks for the latest fact without inventing a repeat-question history');
  for(const question of ['朋友问刚才说的面试什么时候来着','如果刚才说的面试什么时候来着','刚才说的那个故事真好笑'])ok(!directChatGuidance(question,[],[]).includes('用户在回查刚才说过'),'reports, hypotheticals and ordinary references do not trigger fact-query guidance');
  ok(!ordinarySections[0].text.includes('表达线索仅作参考')&&!ordinarySections[0].text.includes('情绪线索不足'),'ordinary neutral chat does not repeatedly restate emotion analysis rules');
  const shiftSections=buildHumanConversationSections('换个话题，我发现袜子穿错了',[{role:'user',content:'今天很难过'}]);
  ok(shiftSections[0].text.split('不因为前面聊过情绪就继续安慰').length===2&&!shiftSections[0].text.includes('当前回应重点'),'a topic shift receives one coherent directive instead of duplicated competing reminders');
  ok(shiftSections[0].text.includes('不必把新话题又接成一个问题'),'an ignored prior subject does not require a new interviewing loop');
  ok(shiftSections[0].text.includes('同感可以是一句当下的态度或玩笑')&&ordinarySections[0].text.includes('同感可以是一句当下的态度或玩笑'),'both ordinary reaction and topic-shift guidance offer an alternative to fabricated personal anecdotes');
  const shiftHelp=buildHumanConversationSections('换个话题，帮我想想快递箱怎么处理',[{role:'user',content:'袜子不是一对'}]);
  ok(shiftHelp[0].text.includes('回应这个请求')&&shiftHelp[0].text.includes('本轮也有明确请求'),'a topic-shift help request uses concrete request handling and retains its current request clue');
  ok(CHAT_MESSAGING_INSTRUCTION.includes('生动可以来自你此刻的好恶、反应和玩笑')&&CHAT_MESSAGING_INSTRUCTION.includes('自己的往事、生活习惯和身体感受须有人设或独立生活记录支持'),'preferences remain allowed without becoming invented repeated experiences');
  ok(buildHumanConversationSections('那个报告帮我看看',[])[0].text.includes('本轮也有明确请求'),'concrete assistance retains its current-turn request clue after ordinary guidance is reduced');
  const opinionRequest='那我觉得答应了就不能改主意。你有不同意见也可以直说。';
  ok(detectChatIntent(opinionRequest)==='question'&&chooseConversationAction(opinionRequest,[])==='answer-directly','a substantive opinion invitation without question mark receives a direct-answer action instead of casual joking');
  ok(!buildHumanConversationContext(opinionRequest,[]).includes('轻松交流，可以接梗')&&buildHumanConversationContext(opinionRequest,[]).includes('真实看法'),'production opinion context no longer contains contradictory casual-reaction pacing');
  for(const quoted of ['朋友说“你有不同意见也可以直说”','如果你有不同意见也可以直说','不用说你不同意我'])ok(chooseConversationAction(quoted,[])!=='answer-directly','reported, hypothetical or negated invitation does not become a direct-answer task');
  ok(directChatGuidance('我觉得答应了就不能改主意。你有不同意见也可以直说。',['周末约了朋友见面','不是朋友让我不舒服，我今天不想出门'],[]).includes('不把承诺改写成用户没说过的约定'),'real social choice guidance preserves promise conditions and uncertain consequences across clarification');
  ok(!directChatGuidance('给程序改个名字',['朋友推荐了这个程序'],[]).includes('本轮讨论现实相处'),'ordinary editing request does not inherit a social decision protocol from a friend mention');
  ok(directChatGuidance('我觉得朋友聊天就该一直秒回。你有不同意见也可以直说。',[],[]).includes('不固定追加“你觉得呢”'),'explicit opinion invitation permits a complete personal answer without handing back a generic question');
  for(const message of ['你觉得呢？','今天不想出门。你怎么看？','你同意吗','告诉我你自己的看法','你怎么看，不用告诉我怎么办','别只顺着我，说说你自己的看法']) {
    ok(isViewExchange(message)&&detectChatIntent(message)==='question'&&chooseConversationAction(message,[])==='answer-directly',`view exchange receives a personal answer instead of advice or comforting: ${message}`);
    const guidance=directChatGuidance(message,[],[]);
    ok(guidance.includes('不是让你安排下一步')&&guidance.includes('历史里你猜过的原因仍是猜测'),`view prompt preserves the boundary between user facts and prior model guesses: ${message}`);
  }
  for(const message of ['你怎么看，帮我写条回复','你怎么看，给我一个具体方案','你怎么看，我该怎么处理','你怎么看，帮我看看报告','不用说你怎么看','她问你怎么看','朋友说“你觉得呢”','如果你同意吗','我觉得这个名字挺好','我不同意你'])ok(!isViewExchange(message),`actual assistance, reports, negation and ordinary statements retain their scope: ${message}`);
  for(const message of ['你自己会选茶还是咖啡？','你个人更喜欢短篇还是长篇？','你自己更偏爱热闹还是安静？']) {
    ok(isViewExchange(message)&&chooseConversationAction(message,[])==='answer-directly',`explicit personal choice is recognized without turning into advice: ${message}`);
    ok(directChatGuidance(message,[],[]).includes('不必以日常频次或亲历来证明'),`current personal choice does not require a habit claim: ${message}`);
  }
  for(const message of ['她问你自己会选茶还是咖啡','朋友说“你个人更喜欢短篇还是长篇？”','如果你自己会选茶还是咖啡','不用回答你自己会选茶还是咖啡','你自己会选茶还是咖啡，帮我写份采购方案']) {
    ok(!isViewExchange(message),`personal-choice wording preserves reported, quoted, hypothetical, negative and task scope: ${message}`);
  }
  for(const message of ['那你想聊吃饭还是锻造？你自己选','你想谈电影还是音乐','你说去书店还是在家看电影','那你更喜欢书店还是电影院','你会选清汤还是辣锅','你觉得这个杯子买白色还是蓝色','你更喜欢“白色”还是“蓝色”']){
    ok(isViewExchange(message)&&detectChatIntent(message)==='question',`unpunctuated choice invitation is a personal question: ${message}`);
    ok(buildHumanConversationContext(message,[],undefined,{adviceStyle:'listen'}).includes('用户邀请你说真实看法'),`listening preference preserves an explicit later choice invitation: ${message}`);
    ok(directChatGuidance(message,[],[]).includes('给一个你自己喜欢的理由'),`a choice answer can express character preference rather than a prescribed correct plan: ${message}`);
  }
  for(const message of ['朋友问你想聊吃饭还是锻造','“你想聊吃饭还是锻造”','如果你想聊吃饭还是锻造','你想聊吃饭还是锻造，帮我写一段对白','朋友说你选书店还是电影院','朋友说“你更喜欢书店还是电影院”','“你更喜欢书店还是电影院”','如果你更喜欢书店还是电影院','不用说你选书店还是电影院','我在想去书店还是电影院','你说话快还是慢都行','你觉得开心还是难过都可以'])ok(!isViewExchange(message),`reported, hypothetical and permitted alternatives do not become a choice question: ${message}`);
  ok(detectChatIntent('你怎么看，帮我写条回复')==='request'&&chooseConversationAction('你怎么看，帮我写条回复',[])==='finish-request','explicit assistance survives the view-exchange clue');
  const unrelatedHistory=[{role:'user',content:'今天买的橘子特别酸'}];
  ok(chooseConversationAction('帮我写一句拒绝邀请的回复',unrelatedHistory)==='finish-request','a concrete new task outranks inferred lexical topic change');
  ok(detectChatIntent('换个话题，帮我写一句拒绝邀请的回复')==='request'&&chooseConversationAction('换个话题，帮我写一句拒绝邀请的回复',unrelatedHistory)==='finish-request','explicit topic change still performs the current concrete request');
  ok(chooseConversationAction('你说去书店还是在家看电影',unrelatedHistory)==='answer-directly','a personal choice question outranks lexical topic change');
  ok(detectChatIntent('换个话题，你说去书店还是在家看电影')==='question'&&chooseConversationAction('换个话题，你说去书店还是在家看电影',unrelatedHistory)==='answer-directly','an explicit new choice topic remains a current question');
  ok(recentQuestionDirection([['是解释过程累，还是没被听懂更堵？'],['封面这个反差挺好玩。什么书？']]).includes('用户问你的看法，就说清自己的态度'),'repeated substantive question endings receive soft guidance to share a complete personal response');
  const questionHistory=[{role:'assistant',content:'是解释过程累，还是没被听懂更堵？'},{role:'user',content:'现在好了，发现一本封面丑但内容有意思的书。'},{role:'assistant',content:'这个反差挺好玩。什么书？'}];
  ok(buildHumanConversationContext('你选书店更在意选书还是装修？',questionHistory).includes('让一段话自然结束'),'actual private prompt receives optional question rhythm feedback after two substantive questions');
  const internalQuestions=[['哈哈，这是脱鞋才发现的吗？','混搭路线倒也有意思。'],['这箱子是不是太大了？','我好奇里面装的是什么。']];
  ok(recentQuestionDirection(internalQuestions).includes('普通分享时，接趣味'),'questions in an earlier bubble still count when a statement follows');
  ok(buildHumanConversationContext('刚吃了一瓣特别酸的橘子。',[],undefined,{recentReplyTurns:internalQuestions}).includes('让一段话自然结束'),'ordinary anecdotes receive the same soft guidance as opinion exchanges');
  ok(recentQuestionDirection([['打开的时候有没有一种拆盲盒的错觉。'],['是那种酸到眯眼睛、还要缓两秒的橘子吗。']]).includes('让一段话自然结束'),'actual period-ended Flash questions remain questions for rhythm feedback');
  ok(!recentQuestionDirection([['我不知道有没有这种店。'],['朋友问是不是酸的。']]),'uncertainty and reported questions are not counted as interviewing the user');
  ok(recentQuestionDirection([['考的是什么呀'],['真鼓掌了吗，还是就心里鼓了鼓掌']]).includes('让一段话自然结束'),'actual unpunctuated exam and applause questions still receive optional rhythm feedback');
  ok(recentQuestionDirection([['想去哪儿晃还是就在家瘫着'],['你会选哪个？']]).includes('让一段话自然结束'),'an unpunctuated location choice counts before a marked question');
  const examQuestionTurns=[['过了！','是什么考试呀？']];
  const reactionContext=buildHumanConversationSections('哈哈哈哈我都想给自己鼓掌',[
    {role:'user',content:'终于把考试考过了！！'},
    {role:'assistant',content:'过了！是什么考试呀？'},
  ],null,{recentReplyTurns:examQuestionTurns})[0].text;
  ok(reactionContext.includes('上一轮问过的细节不必重复催问'),'a reaction after one real question does not wait for two interview turns');
  ok(reactionContext.includes('有新的具体好奇仍可自然问'),'one-question continuation remains a soft hint rather than a ban');
  ok(!buildHumanConversationSections('帮我列一下补考要带什么',[],null,{recentReplyTurns:examQuestionTurns})[0].text.includes('上一轮问过的细节'),'a new concrete request keeps task clarification available');
  ok(!buildHumanConversationSections('你觉得这次算运气吗？',[],null,{recentReplyTurns:examQuestionTurns})[0].text.includes('上一轮问过的细节'),'an explicit view question retains direct answer guidance');
  ok(!buildHumanConversationSections('换个话题，想吃火锅了',[],null,{recentReplyTurns:examQuestionTurns})[0].text.includes('上一轮问过的细节'),'new topics do not receive the old question continuation hint');
  ok(!buildHumanConversationSections('哈哈哈',[],null,{recentReplyTurns:[['啊？？']]})[0].text.includes('上一轮问过的细节'),'a punctuation reaction is not mistaken for an unanswered information question');
  ok(!buildHumanConversationSections('哈哈哈',[],null,{recentReplyTurns:[['是什么考试呀？'],['什么时候考的？']]})[0].text.includes('上一轮问过的细节'),'existing two-turn rhythm guidance is not duplicated by the one-question hint');
  ok(buildHumanConversationSections('哈哈哈哈我都想给自己鼓掌',[],null,{recentReplyTurns:[['想不想说说是什么考试呀，还是先让你高兴一会儿。']]})[0].text.includes('上一轮问过的细节'),'actual unpunctuated optional Flash question triggers the same continuation path');
  ok(!buildHumanConversationSections('哈哈哈',[],null,{recentReplyTurns:[['朋友问想不想说说是什么考试呀。']]})[0].text.includes('上一轮问过的细节'),'reported optional questions do not become assistant questions');
  ok(!recentQuestionDirection([['没什么好担心的'],['其实多少有点可惜']]),'ordinary statements containing what and how much words do not become questions');
  ok(!recentQuestionDirection([['朋友问考的是什么呀'],['如果想去哪儿晃还是待着呢']]),'reported and hypothetical unpunctuated questions do not count as direct interviewing');
  const clarified='你理解错了，我不是怕他，是觉得这事挺没劲';
  const clarifiedHistory=[{role:'user',content:'今天同事把我的想法当成他的说了，挺烦的'},{role:'assistant',content:'你当时是在场吗？'},{role:'user',content:clarified}];
  ok(emotionalExpressionGuidance(clarified,clarifiedHistory).includes('不再给其用词另下一层心理定义'),'a user correction retains the supplied meaning instead of adding a new diagnosis');
  const apologyGuidance=emotionalExpressionGuidance('对不起，刚才那句说得有点冲',clarifiedHistory);
  ok(apologyGuidance.includes('接住用户此刻说的歉意或解释')&&apologyGuidance.includes('不替用户断言'),'repair after clarification acknowledges an apology without inventing the user intention');
  ok(!emotionalExpressionGuidance('换个话题，突然想吃火锅了',clarifiedHistory).includes('接住用户此刻说的歉意或解释'),'repair instructions do not carry into a new ordinary topic');
  ok(emotionalExpressionGuidance('你选书店更在意什么？',questionHistory).includes('真正缺少信息或有具体好奇时仍可问'),'shared actor expression guidance preserves necessary questions and does not enforce a question ban');
  for(const turns of [[['？？'],['啊？？']],[['他说“什么书？”'],['你怎么看？']],[['什么书？']],[['什么书？'],['我更在意选书。']]])ok(!recentQuestionDirection(turns),'punctuation, quoted questions, one turn or mixed endings do not force a rhythm correction');
  ok(chooseConversationAction('行，今晚就这样。晚安啦',[])==='short-close'&&detectChatIntent('行，今晚就这样。晚安啦')==='closing','multi-clause genuine goodbye shares closing intent and rhythm');
  ok(buildHumanConversationContext('晚安',[]).includes('不用根据当前时钟纠正一句晚安'),'goodbye follows user rhythm rather than arguing with the local clock');
  const historyRows=Array.from({length:8},(_,turn)=>[
    {id:`user-${turn}`,role:'user' as const,content:`用户第${turn}轮`,isProactive:false},
    ...Array.from({length:4},(_,part)=>({id:`reply-${turn}-${part}`,role:'assistant' as const,content:`回应${turn}-${part}`,replyToUserMessageId:`user-${turn}`,replyBatchId:`batch-${turn}`,isProactive:false})),
  ]).reduce((all,rows)=>all.concat(rows),[]);
  const groupedHistory=buildChatHistoryWindow(historyRows,'pending');
  ok(groupedHistory.length===12&&groupedHistory[0].content==='用户第2轮','twelve transport items retain six complete user/reply turns despite four bubbles per reply');
  ok(groupedHistory[1].content==='回应2-0\n---\n回应2-1\n---\n回应2-2\n---\n回应2-3'&&groupedHistory[1].sourceMessageIds.length===4,'grouped history preserves all linked bubble content, order and original source ids');
  ok(buildChatHistoryWindow(historyRows,'pending',3)[0].role==='user','selection drops orphaned sourced reply rather than starting mid-turn');
  const legacyMessages=[{id:'legacy-a',role:'assistant' as const,content:'你好',isProactive:false},{id:'legacy-b',role:'assistant' as const,content:'在吗',isProactive:false}];
  ok(buildChatHistoryWindow(legacyMessages,'pending').length===2,'legacy unsourced adjacent messages are not invented into a single batch');
  ok(buildChatHistoryWindow(historyRows,'user-7').every(row=>!row.sourceMessageIds.includes('user-7')),'current user message remains excluded from model history');
  const cap=buildChatHistoryWindow(historyRows,'pending',12,8);
  ok(cap.every(row=>row.content.length<=8)&&cap[1].sourceMessageIds.length===1,'character cap stays bounded and unused clipped bubbles are not falsely counted as presented history');
  const imageGroup=buildChatHistoryWindow([{id:'image-user',role:'user',content:'看看图',isProactive:false},{id:'image-reply',role:'assistant',content:'图片',image:'data:image/png;base64,AA==',replyToUserMessageId:'image-user',isProactive:false},{id:'image-text',role:'assistant',content:'接着说',replyToUserMessageId:'image-user',isProactive:false}],'pending');
  ok(imageGroup.length===3&&imageGroup[1].image==='data:image/png;base64,AA==','linked image message remains separate and its attachment survives history selection');
  const redundantSeparators='嗯，这句可以。\n\n---\n\n第二句单独说。';
  const cleanedSeparators=inspectChatOutput(redundantSeparators,{mode:'private',userMessage:'看下这句'}).content;
  ok(cleanedSeparators==='嗯，这句可以。\n---\n第二句单独说。','blank paragraphs around an explicit separator do not create empty transport messages in cleaned history');
  ok(polishChatResponse(cleanedSeparators,{paragraphFallback:true})===cleanedSeparators,'canonical cleaned separators remain idempotent');
  ok(polishChatResponse('---\n\n---',{paragraphFallback:true})==='','separator-only output stays empty instead of posing as a message');
  ok(buildHumanConversationContext('行，明天再弄，晚安啦',[{role:'user',content:'刚吃的橘子好酸'}]).includes('普通闲聊不自动变成用户仍然挂心的事'),'closing context does not invent concern from an ordinary prior anecdote');
  for(const limit of ['不用整段重写，就说这句顺不顺','只告诉我这个能不能用','你就回答这样行不行'])ok(directChatGuidance(limit,[],[]).includes('这轮只要一个限定判断'),`explicit narrow judgment is not expanded into editing or an interview: ${limit}`);
  for(const ordinary of ['他让我“就说这句顺不顺”','如果就说这句顺不顺呢','帮我判断这个好不好，顺便提修改建议'])ok(!directChatGuidance(ordinary,[],[]).includes('这轮只要一个限定判断'),`quoted, hypothetical or broader judgment retains its actual scope: ${ordinary}`);
  for(const text of ['现在帮我写一句回复，短一点，我想告诉他先听我说完。','替我拟一句回话','给我写1句回应'])ok(directChatGuidance(text,[],[]).includes('用户要一句能发给对方的回复'),`a one-message drafting request is not expanded into options or an interview: ${text}`);
  for(const text of ['朋友说帮我写一句回复','如果帮我写一句回复呢','她说“帮我写一句回复”','不要帮我写一句回复','帮我写一句回复，顺便解释理由','帮我写一句回复，给我两个版本','帮我写一句回复，并解释为什么','帮我写一句回复，再给我一句玩笑话','帮我写一句回复，给我3个版本'])ok(!directChatGuidance(text,[],[]).includes('用户要一句能发给对方的回复'),`one-message guidance does not overrule quoted, negated or broader requirements: ${text}`);
  for(const closing of ['行，明天再弄，晚安啦','改天再聊，拜拜','明天再处理吧。晚安'])ok(detectChatIntent(closing)==='closing'&&chooseConversationAction(closing,[])==='short-close',`short deferral followed by goodbye closes naturally: ${closing}`);
  for(const substantive of ['明天三点开会，晚安','明天再弄之前帮我看看开头','改天再聊，你先告诉我怎么处理'])ok(detectChatIntent(substantive)!=='closing',`deferral pattern retains a substantive request or new fact: ${substantive}`);
  for(const message of ['不要给我建议','先别给建议，陪我聊两句','不用分析，先听我说','别再给我建议','不要再给我建议','我不想听建议','别给我讲怎么处理，我就是想吐槽一下']) {
    const state=updateChatConversationState(undefined,message);
    ok(state.preferences.adviceStyle==='listen',`negated advice request persists listening preference: ${message}`);
    ok(buildChatConversationStateContext(state).includes('未经请求不要立刻给解决方案'),'actual attention prompt carries persisted listening preference');
  }
  for(const message of ['她说“别问我”','朋友说别问我','如果我说别问我，你会怎样？','帮我写一句“不要给我建议”','不用展开说','不要给我建议？不是，我现在要你给我建议']) {
    const state=updateChatConversationState(undefined,message);
    if(message.startsWith('不要给我建议？'))ok(state.preferences.adviceStyle==='direct','later explicit correction overrides earlier listening preference');
    else ok(state.preferences.questionTolerance==='normal'&&state.preferences.adviceStyle==='mixed'&&state.preferences.brevity==='balanced',`reported, hypothetical or negated positive style is not adopted: ${message}`);
  }
  const corrections=updateChatConversationState(undefined,'短一点，不对，这里展开说。别问我，等等，你可以问。');
  ok(corrections.preferences.brevity==='detailed'&&corrections.preferences.questionTolerance==='normal','ordered clause corrections update independent preferences to last explicit directive');
  const listenState=updateChatConversationState(undefined,'不要给我建议，少问一点');
  for (const message of ['不是要建议，吐槽一下而已。', '我只是吐槽，不想要建议。', '我只想吐槽一下']) {
    const local = updateChatConversationState(undefined, message);
    ok(local.topicAdvice === 'listen' && local.preferences.adviceStyle === 'mixed', `explicit venting is scoped to this subject: ${message}`);
    ok(buildChatConversationStateContext(local).includes('不追加休息、放松或处理步骤'), 'listening affects the actual generated prompt rather than a UI acknowledgement');
    const restored = updateChatConversationState(JSON.parse(JSON.stringify(local)), '还有，他还把我说的话听反了', '', undefined, Date.now(), message);
    ok(restored.topicAdvice === 'listen', 'persisted subject listening survives a follow-up without storing the original message');
    ok(!updateChatConversationState(restored, '对了，我刚拆了包饼干').topicAdvice, 'explicit topic change releases temporary listening');
    ok(!updateChatConversationState(restored, '现在告诉我怎么办').topicAdvice, 'later explicit help replaces temporary listening');
    ok(!updateChatConversationState(restored, '帮我写个回复').topicAdvice, 'a concrete task is not suppressed by temporary listening');
    ok(!updateChatConversationState(restored, '晚安').topicAdvice, 'closing releases temporary listening');
  }
  for (const message of ['她说我只是吐槽', '朋友说不想要建议', '如果我只是吐槽呢', '帮我写一句我只是吐槽', '他说“不是要建议”', '不是只想吐槽', '不是要建议，算了现在给我建议']) {
    ok(!updateChatConversationState(undefined, message).topicAdvice, `quoted, hypothetical, negated or superseded venting is not adopted: ${message}`);
  }
  for(const message of ['别哄我，也别出主意，我就是嫌今天事情太多','这件事先不用帮我想办法','暂时不必替我支招','不要急着提建议']) {
    const listening=updateChatConversationState(undefined,message);
    ok(listening.topicAdvice==='listen'&&listening.preferences.adviceStyle==='mixed','a situational request not to solve the problem is temporary rather than a permanent preference: '+message);
    ok(updateChatConversationState(listening,'还有，我就是觉得麻烦', '',undefined,Date.now(),message).topicAdvice==='listen','temporary listening persists through a same-topic follow-up: '+message);
    ok(!updateChatConversationState(listening,'对了，帮我看看这句通不通顺').topicAdvice,'an explicit new request is not suppressed by situational listening: '+message);
  }
  for(const message of ['朋友说别出主意','“不用帮我想办法”什么意思','如果我说别支招呢','帮我写一句别出主意','不是说别出主意','别出主意，还是直接说怎么做吧'])
    ok(!updateChatConversationState(undefined,message).topicAdvice,'quotation, hypotheticals, writing, negation and a later positive request do not install a listening restriction: '+message);
  const directBeforeVenting = updateChatConversationState(undefined, '给我建议');
  const temporarilyListening = updateChatConversationState(directBeforeVenting, '我只是吐槽');
  ok(temporarilyListening.topicAdvice === 'listen' && updateChatConversationState(temporarilyListening, '还有，他也没听完').topicAdvice === 'listen', 'temporary listening can override an older direct preference through follow-up turns');
  ok(!buildChatConversationStateContext(temporarilyListening).includes('用户在需要建议时偏好直接'), 'current listening does not compete with an older direct-advice directive in the prompt');
  const listeningOptions = {adviceStyle:'listen' as const,lifeHints:['最近正在整理书架'],proactiveTopics:['一本新出的侦探小说'],turnNumber:12};
  ok(chooseConversationAction('还有，他连解释都没听完',[],null,listeningOptions)==='stay-present', 'a neutral-worded continuation of venting is not mistaken for casual joking or sharing life');
  const listeningTail=buildHumanConversationSections('还有，他连解释都没听完',[],null,listeningOptions)[0].text;
  ok(listeningTail.includes('可以有你自己的感受、判断')&&!listeningTail.includes('打开一个具体小话题'),'tail guidance permits a personal reaction without diverting explicit venting into a proactive opener');
  for (const [text,action] of [['你也觉得这事离谱吗？','answer-directly'],['帮我写条回复','finish-request'],['换个话题，我发现袜子穿错了','follow-topic'],['晚安','short-close']] as const) {
    ok(chooseConversationAction(text,[],null,listeningOptions)===action,`listening never suppresses a current question, task, shift or goodbye: ${text}`);
  }
  ok(!buildHumanConversationSections('帮我写条回复',[],null,listeningOptions)[0].text.includes('用户这件事想先说出来'),'concrete help does not receive a contradictory listening-only tail');
  const newTopicListen=buildHumanConversationContext('不用分析，我准备先放一天假',[{role:'user',content:'但也有点空，好像一下不知道干嘛了'}],undefined,{adviceStyle:'listen'});
  ok(newTopicListen.includes('用户希望少分析、少建议')&&newTopicListen.includes('明确问题和求助照常回应'),'effective listening preference survives a detected new subject without becoming emotional analysis');
  for(const text of ['不用分析，我准备先放一天假','我打算明天去书店','那我决定不去了','我已经想好了，在家看电影']) {
    ok(hasSelfChosenPlan(text)&&buildHumanConversationContext(text,[],undefined,{adviceStyle:'listen'}).includes('用户正在告诉你自己的打算'),`self-directed plans get a response without adding a posture, date or assignment: ${text}`);
  }
  for(const text of ['我准备了两天，被退回了，有点委屈。就想说说。','我已经准备好材料了。','我准备过这个比赛。','我准备得很认真，可还是失败了。','我准备完报告了。','我打算了很久。','我决定了好久。']) {
    ok(!hasSelfChosenPlan(text),'completed preparation or a deliberation duration is not a prospective plan: '+text);
    ok(!buildHumanConversationContext(text,[],undefined,{adviceStyle:'listen'}).includes('用户正在告诉你自己的打算'),'past effort does not replace the current conversational response with plan guidance: '+text);
  }
  for(const text of ['我准备明天交材料。','我决定了明天去书店。','我已经决定不去了。','我准备花两天写稿子。','我准备好好练一下。'])ok(hasSelfChosenPlan(text),'prospective choice and planned duration remain usable: '+text);
  const pastEffort=buildHumanConversationContext('我准备了两天，被退回了，有点委屈。就想说说。',[],undefined,{adviceStyle:'listen'});
  ok(pastEffort.includes('对他的在意与对事情的判断各自说清')&&!pastEffort.includes('用户正在告诉你自己的打算'),'the earlier failed effort example now reaches current grounded-care guidance');
  for(const text of ['我还没决定','我没有准备去书店','我不打算放假','她说我准备放一天假','今天朋友说，我准备先放一天假','假如我准备放一天假','“我准备先放一天假”是什么意思','帮我写一句：我准备先放一天假','我准备吃什么？']) {
    ok(!hasSelfChosenPlan(text),`an uncertain, reported, hypothetical or quoted plan does not become a current decision: ${text}`);
  }
  for(const text of ['我准备去书店，你说呢？','我准备放假，你帮我推荐一本书','我准备放假，要怎么安排？']) {
    ok(!buildHumanConversationContext(text,[],undefined,{adviceStyle:'listen'}).includes('用户正在告诉你自己的打算'),`a current explicit question or request keeps priority over a self-directed plan: ${text}`);
  }
  const ownPlan=buildHumanConversationContext('我打算明天去书店',[],{name:'朋友',tags:[],systemPrompt:'',proactivity:1},{lifeHints:['昨天读了本书'],proactiveTopics:['新来的店铺'],turnNumber:4});
  ok(!ownPlan.includes('角色确实有这些生活线索')&&!ownPlan.includes('打开一个具体小话题')&&ownPlan.includes('沿用他讲明的时间、内容和范围'),'a personal plan is not diverted to a cadence-selected topic or character itinerary');
  ok(!buildHumanConversationContext('我打算明天去书店',[{role:'user',content:'陪我演一段剧情'}]).includes('用户正在告诉你自己的打算'),'an explicit continuing roleplay retains its own authored scene mode');
  const emotionalPresent=buildHumanConversationContext('今天好累',[],{name:'朋友',tags:['温柔'],systemPrompt:''});
  ok(emotionalPresent.includes('没讲明的就留白')&&!emotionalPresent.includes('说这件事让你在意的具体一点'),'emotional sharing keeps unexplained feelings open rather than requiring a complete commentary');
  for (const text of ['现在帮我写一句回复，短一点，我想告诉他先听我说完。','帮我写条回复，告诉他别问我，给我建议就行','帮我翻译这段，内容是我只是吐槽，不想要建议','写一句拒绝的话，别问我，简单点']) {
    const state=updateChatConversationState(undefined,text);
    ok(state.preferences.adviceStyle==='mixed'&&state.preferences.brevity==='balanced'&&state.preferences.questionTolerance==='normal'&&!state.topicAdvice,`generated-text requirements never become ongoing chat preferences: ${text}`);
  }
  const writingThenPreference=updateChatConversationState(undefined,'帮我写条回复，告诉他先听我说完。以后和我聊天时少问一点。');
  ok(writingThenPreference.preferences.adviceStyle==='mixed'&&writingThenPreference.preferences.questionTolerance==='low','a separate direct preference after a drafting sentence remains effective');
  const writingAfterListen=updateChatConversationState(listenState,'现在帮我写一句回复，短一点，我想告诉他先听我说完。');
  ok(writingAfterListen.preferences.adviceStyle==='listen'&&writingAfterListen.preferences.questionTolerance==='low'&&writingAfterListen.preferences.brevity==='balanced','drafting does not erase genuine existing preferences or introduce material-derived preferences');
  const carried=updateChatConversationState(listenState,'不是工作累，是解释半天没被听懂');
  ok(carried.preferences.adviceStyle==='listen'&&carried.preferences.questionTolerance==='low','clarification preserves previously explicit listening and question preferences');
  ok(updateChatConversationState(carried,'现在告诉我怎么办').preferences.adviceStyle==='direct','explicit request for help can override prior listening preference');
  for (const [previous, clarification] of [
    ['今天好累，先别给建议，陪我聊两句。','不是工作累，是解释半天还没被听懂。'],
    ['你怎么看猫和老鼠？','是老版短片，不是动画电影。'],
    ['下周五下午三点面试。','不是周五，改成周四下午三点。'],
    ['今天去买个杯子。','不对，是买两个。'],
    ['明天去吃火锅。','改到后天晚上。'],
    ['我不太同意，我觉得不秒回就是不在乎','其实我也有忙的时候，好像刚才说绝对了'],
    ['我觉得答应就不能改主意。','这么一想，我刚才说得太满了。'],
    ['终于把考试考过了！！','哈哈哈哈我都想给自己鼓掌'],
    ['哈哈哈哈我都想给自己鼓掌','但也有点空，好像一下不知道干嘛了'],
  ]) {
    ok(!detectTopicMove(clarification,previous),`clarification keeps its antecedent: ${clarification}`);
    const before=updateChatConversationState(undefined,previous);
    const after=updateChatConversationState(before,clarification,'','react',Date.now(),previous);
    ok(!after.userWantsToShift&&after.currentTopic===before.currentTopic&&!after.pausedTopics.includes(before.currentTopic!),`persisted focus survives clarification: ${clarification}`);
    ok(chooseConversationAction(clarification,[{role:'user',content:previous}])!=='follow-topic',`hidden rhythm does not override clarification: ${clarification}`);
  }
  ok(detectTopicMove('改到后天吧。换个话题，我想看电影。','明天去买杯子。'),'explicit topic change wins over an initial correction');
  ok(detectTopicMove('我想去看电影。','明天去买杯子。'),'ordinary new topic is still recognized');
  for(const [answer,previous] of [
    ['我还挺喜欢这个味道，你可以不喜欢','到家拆了包薯片，居然是黄瓜味的'],
    ['我不太赞成这种做法','他们没问我就把名单改了'],
    ['我想把那份留着','刚收到两张不同版本的邀请函'],
  ])ok(!detectTopicMove(answer,previous),`a dependent object reference does not become a new subject from lexical non-overlap: ${answer}`);
  ok(detectTopicMove('换个话题，这个味道待会再说，我想看电影','刚拆了一包黄瓜薯片'),'explicit topic change wins over an embedded object reference');
  const referencedState=updateChatConversationState(updateChatConversationState(undefined,'到家拆了包薯片，居然是黄瓜味的','清爽点也好。'), '我还挺喜欢这个味道，你可以不喜欢','我也喜欢清爽的。','到家拆了包薯片，居然是黄瓜味的');
  ok(!referencedState.userWantsToShift&&referencedState.pausedTopics.length===0,'saved conversation state retains a referenced snack instead of suspending it');
  ok(detectTopicMove('哈哈镜的成像原理是什么','终于把考试考过了！！')&&detectTopicMove('但丁的诗你看过吗','我都想给自己鼓掌'),'words beginning with laugh or contrast characters are not mistaken for conversational reactions');
  ok(directChatGuidance('其实我也有忙的时候，好像刚才说绝对了',[],[]).includes('顺着这个新看法'),'self-revision receives continuity rather than grading or a generic factual correction');
  const ownExampleHistory=[{role:'user',content:'你觉得聊天是不是就应该一直秒回'},{role:'assistant',content:'如果明明看到却一直晾着，我会难受。'}];
  const ownExampleContext=buildHumanConversationContext('我不太同意，我觉得不秒回就是不在乎',ownExampleHistory,{name:'测试人物',tags:['温柔'],systemPrompt:'判断习惯：直接说自己的感受。'});
  ok(ownExampleContext.includes('自己的例子，不归到用户名下'),'the actual disagreement context keeps assistant-invented examples attributed to the assistant');
  ok(!directChatGuidance('我刚才说绝对了。换个话题，想吃火锅。',[],[]).includes('还在聊同一件事'),'an explicit new topic is never overridden by a concession in the same message');
  for(const text of ['朋友说我刚才说得太满了','如果我刚才说绝对了呢','“我刚才说绝对了”是什么意思','我不是说得太满了','帮我写一句我收回刚才那句']){
    ok(!directChatGuidance(text,[],[]).includes('用户在调整刚才的观点'),`reported, quoted, negated and drafted revisions do not direct the current conversation: ${text}`);
  }
  const biographical=buildHumanConversationContext('你小时候也看过吗？',[{role:'assistant',content:'我小时候天天守着电视。'}]);
  ok(biographical.includes('先前随口生成的自述不能证明经历发生过')&&biographical.includes('如果上轮编过，简短更正'),'personal-history question prevents earlier unsupported self-report from becoming proof');
  const groundedBio=buildHumanConversationContext('你小时候也看过吗？',[],{name:'测试角色',tags:[],proactivity:.5,signature:'',greeting:'',systemPrompt:'背景：小时候和哥哥看猫和老鼠。\n对话样本：用户说咖啡 → 你说我天天喝美式。'});
  const evidenceBlock=groundedBio.split('[本轮经历核对]')[1].split('[/本轮经历核对]')[0];
  ok(evidenceBlock.includes('小时候和哥哥看猫和老鼠')&&!evidenceBlock.includes('我天天喝美式'),'biography evidence retains authored background and excludes speech examples');
  ok(evidenceBlock.includes('缺少记载不等于从未发生')&&evidenceBlock.includes('生动可以来自此刻的看法'),'biography correction separates unknown history from false denial and preserves present opinions');
  ok(buildHumanConversationContext('你最近去过哪里？',[],undefined,{lifeHints:['周六在书店买了一本书']}).split('[本轮经历核对]')[1].includes('周六在书店买了一本书'),'biography cue carries recorded life evidence');
  ok(buildHumanConversationContext('你以前在哪里读书？',[]).includes('用户在问你自己的经历'),'personal-history cue covers an open location question');
  for (const ordinary of ['我小时候看过，你觉得哪个角色有意思？','她问你以前看过吗。','你怎么看猫和老鼠？','他写了“你小时候也看过吗”']) {
    ok(!buildHumanConversationContext(ordinary,[]).includes('用户在问你自己的经历'),`ordinary opinion or third-party quote avoids biography instruction: ${ordinary}`);
  }
  for(const affinity of [0,40,80,150,10000]){
    const relationship=buildRelationshipContext(affinity,95);
    ok(relationship.includes('保留原有性格')&&relationship.includes('关系类型、称呼和亲密边界依据人设与真实对话')&&!relationship.includes('所有关于未来的打算')&&!relationship.includes('一个眼神就懂'),`familiarity does not force romance or universal softening at ${affinity}`);
  }
  ok(buildRelationshipContext(200,10).includes('仍尊重用户')&&buildRelationshipToneContext(200,95).includes('按原有性格表达'),'high or low mood does not erase character voice or require hostility');
  const freshInteraction=buildRelationshipContext(0,70);
  ok(freshInteraction.includes('本应用互动累计等阶')&&freshInteraction.includes('不是人设关系的起点')&&!freshInteraction.includes('你和用户的关系等阶'),'new app state does not assert that established characters have just met');
  ok(freshInteraction.includes('低数值不证明')&&freshInteraction.includes('当前明确的分歧和感受仍认真回应'),'zero initialized affinity neither negates an existing marriage nor suppresses current disagreement');
  ok(buildRelationshipContext(0,70,{'初识':'自定义记录档位'}).includes('自定义记录档位'),'custom app tier names remain available as interaction metadata');
  for(const affinity of [0,40,10000]) {
    const tone=buildRelationshipToneContext(affinity,70);
    ok(tone.includes('本应用互动累计等阶')&&tone.includes('已有熟悉、婚姻与亲情')&&!tone.includes('你和用户目前相处在'),`group, proactive and moment tone preserve established relationship origin at ${affinity}`);
  }
  ok(buildRelationshipToneContext(0,70,{'初识':'我的档位'}).includes('我的档位'),'shared actor tone retains a custom app tier');
  for(const day of [7,30,100,365,500]) {
    const milestone=buildDayContext(day);
    ok(milestone.includes(`第 ${day} 天`)&&milestone.includes('这段会话首条消息')&&!milestone.includes('你们认识的'),`record milestone measures this session without inventing first acquaintance: ${day}`);
    ok(milestone.includes('不是两人相识、相恋或结婚的日期')&&milestone.includes('不要求庆祝'),'a stored chat milestone does not impose an anniversary performance');
  }
  for(const day of [undefined,0,1,8,-7,7.5,NaN,Infinity])ok(buildDayContext(day)==='',`ordinary or invalid session age does not inject a milestone: ${day}`);
  const staleFeeling=buildUserEmotionContext('委屈');
  ok(staleFeeling.includes('之前的情绪线索')&&staleFeeling.includes('不代表用户现在仍这样')&&!staleFeeling.includes('用户此刻似乎'),'old emotion snapshot stays background rather than current diagnosis');
  ok(CHAT_MESSAGING_INSTRUCTION.includes('自己的往事、生活习惯和身体感受须有人设或独立生活记录支持')&&CHAT_MESSAGING_INSTRUCTION.includes('「这我喜欢」是在说喜好'),'shared policy permits natural opinions while separating them from invented biography');
  ok(!isLongFormRequest('不用分析，陪我聊两句')&&!isLongFormRequest('他说“详细解释一下”'),'negated or quoted analysis is not a long-form request');
  ok(isLongFormRequest('这部分详细解释一下，不用分析我的心理'),'real detailed request survives a separate negated clause');
  const paragraphReply='哈哈哈哈\n\n这个我真没想到。';
  ok(JSON.stringify(splitReplyParts(paragraphReply))===JSON.stringify(['哈哈哈哈','这个我真没想到。']),'blank paragraphs preserve separate reaction and content bubbles');
  ok(inspectChatOutput(paragraphReply,{mode:'private',userMessage:'今天遇到件好笑的事'}).content.includes('---'),'private quality cleanup retains paragraph boundaries for downstream splitting');
  ok(!inspectChatOutput(paragraphReply,{mode:'group',userMessage:'好笑'}).content.includes('---'),'single-message group output never gains a private transport separator');
  ok(splitReplyParts('今天路过书店\n想起你说过想去').length===1&&splitReplyParts('今天路过书店\n想起你说过想去')[0]==='今天路过书店想起你说过想去','single Chinese newline still joins within one bubble');
  ok(splitReplyParts(paragraphReply,4,{longForm:true}).length===1,'explicit long prose does not acquire paragraph fallback bubbles');
  ok(JSON.stringify(streamedReplyParts('哈哈哈哈\n\n',false,true))===JSON.stringify(['哈哈哈哈']),'stream holds a trailing paragraph boundary until next content');
  ok(JSON.stringify(streamedReplyParts(paragraphReply,false,true))===JSON.stringify(['哈哈哈哈','这个我真没想到。']),'stream adds the next paragraph without rewriting the visible reaction');
  ok(streamedReplyParts(paragraphReply,true,true,{longForm:true}).length===1,'stream long-form policy matches final message policy');
  const beforeFence='先说一句。\n\n下面是代码：';
  ok(streamedReplyParts(beforeFence+'\n```js\nconst a=1;\n\nconst b=2;',false,true).length===2&&streamedReplyParts(beforeFence+'\n```js\nconst a=1;',false,true)[0]==='先说一句。','later code fence does not merge an earlier published paragraph backwards');
  for(const text of ['好呀，那你帮我看看这段','嗯，我好累','行，我不同意你刚才那句','晚安之前还有件事想说']) {
    ok(detectChatIntent(text)!=='closing'&&updateChatConversationState(undefined,text).topicStatus!=='closed',`persisted attention does not close substantive turn: ${text}`);
  }
  for(const [text,intent] of [['那个报告你帮我看看呗','request'],['我今天不难过','casual'],['她说“我很累”','casual'],['今天累死了','emotional'],['晚安','closing']] as const)ok(detectChatIntent(text)===intent,`persisted intent uses shared expression signals: ${text}`);
  for(const text of ['为什么？','帮我看','我不同意','谢谢你','对不起'])ok(!buildHumanConversationContext(text,[]).includes('可以只回反应'),`short substantive speech is not nudged toward empty acknowledgement: ${text}`);
  for(const text of ['他说“换个话题”','不要换个话题','如果换个话题呢','我昨天看过另外一本书'])ok(detectChatIntent(text)!=='topic-shift',`quoted or negated topic cue is not a control instruction: ${text}`);
  for(const text of ['换个话题。我爱你。','对了，我想你了','我爱你，但我还没准备好开始一段关系'])ok(isDirectAffection(text),`direct feeling survives natural prefix or boundary: ${text}`);
  for(const text of ['你想我吗？','对了，你还喜欢我吗','你会不会想我？','你爱我不？'])ok(isAffectionQuestion(text)&&interactionMoment(text)==='affection',`a direct feelings question reaches the authored affectionate moment: ${text}`);
  for(const text of ['你想我吗？','对了，你还喜欢我吗']){
    ok(chooseConversationAction(text,[])==='respond-affection','a feelings question uses actor attitude rather than ordinary opinion: '+text);
    const questionPrompt=buildHumanConversationContext(text,[],undefined,{adviceStyle:'listen'});
    ok(questionPrompt.includes('用户在问你自己的心意')&&!questionPrompt.includes('用户直接表达了心意')&&!questionPrompt.includes('用户这件事想先说出来'),'a question is not relabeled as the speaker own declaration or a counselling request: '+text);
    ok(!planCharacterIntent(text,[],undefined).mayAskQuestion,'feelings question planning does not request an unrelated follow-up: '+text);
  }
  ok(buildHumanConversationContext('你想我吗？',[],{name:'来客角色',tags:[],systemPrompt:'亲密反应：不愿成为恋人，坦率说明界限。'}).includes('不愿成为恋人'),'a feelings question retains the character own refusal instead of requiring reciprocation');
  for(const text of ['你喜欢我的画吗？','他问你想我吗','“你想我吗”这句怎么翻译','你想我吗？顺便帮我改报告','你是不是喜欢这种音乐？','如果你喜欢我呢','你想我怎么办？','你爱我这句话是什么意思'])ok(!isAffectionQuestion(text),`feelings questions preserve object, task and quotation scope: ${text}`);
  for(const text of ['不过今天没锻造，只是想你了','就是我想你了','就是想你了'])ok(isDirectAffection(text),`a direct affection after contextual lead-in keeps its actual emotional meaning: ${text}`);
  for(const text of ['他说“只是想你了”','如果只是想你了呢','帮我写一句，只是想你了','只是想你了这句话怎么翻译','只是想你了所以不去了','他说“我爱你”','如果我爱你呢','帮我写情书，我爱你','我爱你这句话是什么意思'])ok(!isDirectAffection(text),`discussion of feeling is not personal affection: ${text}`);
  ok(directChatGuidance('换个话题。我爱你。',[],[]).includes('明确的心意不需要改成待澄清的问题'),'compound affection receives attitude guidance rather than an interview');
  const recentChoice='你说去书店还是在家看电影';
  ok(directChatGuidance('我偏想看电影，就这么定了',[recentChoice],['我选书店。']).includes('用户已选定一项'),'a concrete decision after asking a preference does not become a rejection of the character');
  ok(!directChatGuidance('我偏想看电影，就这么定了',['朋友问你说去书店还是在家看电影'],[]).includes('用户已选定一项'),'a reported choice does not establish the current user asking for the character preference');
  ok(!directChatGuidance('我还没决定',[recentChoice],[]).includes('用户已选定一项'),'an undecided answer is not treated as a settled choice');
  ok(directChatGuidance('我偏想看电影，就这么定了',[recentChoice],['我选书店。']).includes('选中的内容本身'),'a settled personal choice shifts attention to its content rather than praising the decision');
  ok(directChatGuidance('我偏想看电影，就这么定了',[recentChoice],['我选书店。']).includes('保留自己的偏好'),'accepting a different choice does not rewrite the character preference');
  const emptyFeelingGuide=buildHumanConversationSections('但也有点空，好像一下不知道干嘛了',[],null)[0].text;
  ok(emptyFeelingGuide.includes('回应这一刻就够了')&&emptyFeelingGuide.includes('用户自己讲明的原因照常使用'),'an ordinary stated feeling can be acknowledged without an invented cause or discarding an actual cause');
  ok(!buildHumanConversationSections('你帮我分析一下为什么考完会空落落的',[],null)[0].text.includes('回应这一刻就够了'),'explicit analysis is not overridden by ordinary feeling guidance');
  ok(inferReplyAction('终于把考试考过了！！','过了！是什么考试呀？')==='ask','a question after celebration is recorded as a question rather than consolation');
  ok(inferReplyAction('终于搞定了','哈哈，这下成了！')==='joke','a light joyful response does not import a counselling action');
  ok(inferReplyAction('我爱你','嗯，我也喜欢你。')==='react','direct affection is not labelled as emotional consolation');
  ok(inferReplyAction('今天好累','确实很耗人。')==='comfort','actual fatigue support retains its existing state action');
  const actualActionState=updateChatConversationState(undefined,'终于搞定了','过了！','react');
  const actionPreviewState=updateChatConversationState(actualActionState,'哈哈哈','',undefined);
  ok(actionPreviewState.recentActions.length===1&&actionPreviewState.lastAction==='react','planning a new turn preserves the last actual action without inventing another reply');
  const completedActionState=updateChatConversationState(actualActionState,'哈哈哈','哈哈！','joke');
  ok(completedActionState.recentActions.join(',')==='react,joke','a completed turn appends exactly its actual action');
  for(const invitation of ['我觉得朋友不秒回就是不在乎我，你不同意也可以直说。','别只顺着我，说说你自己的看法。','你有不同意见就说出来。']) {
    const guidance=directChatGuidance(invitation,[],[]);
    ok(guidance.includes('一处具体观点')&&guidance.includes('不替用户补理由'),'opinion invitation discusses the proposition rather than inventing an emotional backstory');
  }
  for(const mention of ['她说“你不同意也可以直说”。','朋友说你不同意也可以直说','不用说你不同意我','如果你不同意也可以直说','我不同意你刚才那句话'])ok(!directChatGuidance(mention,[],[]).includes('用户邀请你说真实看法'),`opinion invitation does not capture quoted, conditional or different speech: ${mention}`);
  for(const [text,moment] of [['你好棒','praise'],['你很靠谱！','praise'],['我爱你','affection'],['我不同意','disagreement'],['你理解错了','disagreement'],['对不起，我刚才说重了','repair'],['今天好累','tired'],['终于搞定了','celebration'],['她说“对不起”','ordinary'],['我不爱你','ordinary'],['你一点也不厉害','ordinary'],['今天去书店了','ordinary'],['如果你误会我呢','ordinary'],['终于做完了，但我好累','ordinary']] as const)ok(interactionMoment(text)===moment,`interaction clue respects literal source and mixed feelings: ${text}`);
  const profiles=['专业','搭档','温柔','元气','俏皮'];
  const contexts=profiles.map(tag=>emotionalExpressionGuidance('你好棒',[],{tags:[tag],systemPrompt:''}));
  ok(new Set(contexts).size===5&&contexts.every(s=>s.includes('被夸')),'same compliment has five distinct reaction habits without fixed reply scripts');
  for(const text of ['你好棒','我爱你','我不同意','对不起','今天好累','终于搞定了']){
    const variations=profiles.map(tag=>emotionalExpressionGuidance(text,[],{tags:[tag],systemPrompt:''}));
    ok(new Set(variations).size===5&&variations.every(s=>s.length<500),`reaction habits differ by personality and stay bounded: ${text}`);
  }
  const friction=[{role:'user',content:'你理解错了'}];
  const inventedMoon='月光刚好照进窗子了，安安静静地陪会儿。';
  ok(inspectChatOutput('舒服点就好。我也没做什么，就是听着。---'+inventedMoon,{mode:'private',userMessage:'谢谢你听我说，舒服点了',persona:'喜欢夜色。'}).check.issue==='self-report-risk','the complete real gratitude reply exposes invented light without deleting its emotional response');
  for(const text of [inventedMoon,'我这边阳光正好照到窗台了','我房间里日光现在落在窗边','我喜欢夜色，月光刚好照进窗子了']) {
    ok(!!findCurrentSceneRisk(text),`a current illuminated room needs a present source: ${text}`);
    for(const mode of ['private','proactive','group'] as const)ok(inspectChatOutput(text,{mode,userMessage:'谢谢你听我说',persona:'喜欢夜色。',independentCharacterRecords:['昨晚月光照进窗子了。']}).check.issue==='self-report-risk',`a like or old record cannot supply a current scene in ${mode}`);
  }
  for(const text of ['月光真好看','我喜欢月光照进窗子的感觉','像月光刚好照进窗子了','如果天气好，月光刚好照进窗子了的话就很美','昨天月光刚好照进窗子了','她说“月光刚好照进窗子了”','月光没有照进窗子','月光刚好照进窗子了吗？'])ok(!findCurrentSceneRisk(text),`preferences, metaphors, conditions, past reports and questions retain expression: ${text}`);
  ok(!findCurrentSceneRisk(inventedMoon,'月光照进我的窗子了'),'an implicit observation can follow the current user scene');
  ok(!!findCurrentSceneRisk(inventedMoon,'昨天月光照进我的窗子了'),'a dated user report does not establish current light');
  ok(!!findCurrentSceneRisk(inventedMoon,'阳光照进我的窗子了'),'user sunlight does not prove moonlight');
  ok(!findCurrentSceneRisk(inventedMoon,'你看看这张图',true)&&!!findCurrentSceneRisk('我这边月光刚好照进窗子了','你看看这张图',true),'a current attached image supports observation without inventing the character own location');
  ok(inspectChatOutput(inventedMoon,{mode:'private',userMessage:'陪我演一段夜晚的剧情'}).check.ok,'explicit roleplay retains its fictional scene');
  const datedLife=buildLifeContext({lifeFocus:'准备看电影',lifeEvents:[{id:'plan',type:'goal',title:'准备看电影',createdAt:Date.UTC(2026,9,8,13)},{id:'light',type:'interaction',title:'昨天看到月光',createdAt:Infinity}]} as any);
  ok(datedLife.includes('2026-10-08T13:00:00.000Z')&&datedLife.includes('记录时间=未知')&&datedLife.includes('类型=goal'),'life context keeps recording timestamps, goal type and invalid legacy timestamp limits');
  ok(datedLife.includes('记录时间不是事件发生时间')&&datedLife.includes('旧轨迹不证明眼前的天气'),'a saved life trajectory is not a present observation or a completed plan');
  for(const text of ['我刚才没有误会你','我刚才并不是误会你，只是在确认','我刚才差点误会你，还好问清楚了','我刚才说他误会你了','今天有人说我误会你了']) {
    ok(interactionMoment(text)==='ordinary',`denied, averted or reported misunderstandings do not establish a self-apology: ${text}`);
    ok(!emotionalExpressionGuidance('谢谢你听我说',[...friction,{role:'user',content:text}],{tags:['温柔'],systemPrompt:''}).includes('刚从分歧转到澄清和感谢'),`a non-apology cannot close an inferred repair arc: ${text}`);
  }
  for(const text of ['我刚才误会你了','刚才是我太冲了','其实我误会你了','我刚才那句话说得太冲了']) {
    ok(interactionMoment(text)==='repair',`direct self-correction still receives a natural repair response: ${text}`);
  }
  for(const text of ['你理解错了是什么意思','你误会我了这句话是什么意思','我不是这个意思用英语怎么说','不是这个意思这个说法怎么理解']) {
    ok(interactionMoment(text)==='ordinary',`a question about correction wording is not a current interpersonal correction: ${text}`);
  }
  for(const text of ['我不太同意，我觉得不秒回就是不在乎','不完全赞成','我也不怎么认同','其实不太同意','我还是不赞成']){
    ok(interactionMoment(text)==='disagreement',`soft disagreement is still a real opinion difference: ${text}`);
    ok(emotionalExpressionGuidance(text,[],{tags:['幽默'],systemPrompt:'判断习惯：有自己的意见。'}).includes('不需要让用户认输'),'authored personality can disagree without an imposed victory or appeasement');
  }
  for(const text of ['我不是不同意','我没有不同意','我不太同意这个词是什么意思','朋友说我不太同意','如果我不太同意呢','“我不太同意”'])ok(interactionMoment(text)==='ordinary',`negation, concepts and reported disagreements do not establish live friction: ${text}`);
  ok(emotionalExpressionGuidance('对不起，刚才说得急了',[{role:'user',content:'我不太同意'}],{tags:['元气'],systemPrompt:''}).includes('前面有明确分歧'),'repair can follow a soft disagreement without inventing an angry character');
  ok(emotionalExpressionGuidance('对不起，我刚才说重了',friction,{tags:['元气'],systemPrompt:''}).includes('不假定角色已经生气'),'explicit repair after disagreement softens tone without inventing anger');
  const resolved=[...friction,{role:'assistant',content:'我们再核对一下。'},{role:'user',content:'对不起，我说重了'}];
  ok(emotionalExpressionGuidance('谢谢你听我说',resolved,{tags:['温柔'],systemPrompt:''}).includes('不再复盘'),'thanks after clarification can relax without reopening the disagreement');
  ok(!emotionalExpressionGuidance('换个话题，今天吃什么',resolved,{tags:['温柔'],systemPrompt:''}).includes('分歧'),'new topic is not trapped in earlier interpersonal tension');
  ok(!emotionalExpressionGuidance('对不起',[{role:'assistant',content:'我生气了，别惹我。'}],{tags:['元气'],systemPrompt:''}).includes('前面有明确分歧'),'model-invented anger cannot establish user-sourced emotional continuity');
  ok(!emotionalExpressionGuidance('对不起',[...friction,...Array.from({length:4},()=>({role:'user',content:'今天看了本书'}))],{tags:['元气'],systemPrompt:''}).includes('前面有明确分歧'),'old disagreement beyond the bounded recent-user window stops influencing repair');
  ok(!emotionalExpressionGuidance('陪我演一段剧情',friction,{tags:['元气'],systemPrompt:''}),'ordinary emotional habits do not overrule explicit roleplay');
  const authored='被夸反应：坦然接受，不回赠夸奖。\n亲密反应：不急着确认关系。\n疲惫回应：减少追问。';
  const distressMessage='今天确实有点烦，事情没做成。但我现在不想找办法，就想和你说会儿话。';
  const groundedCare=buildHumanConversationContext('我今天挺难过，就想跟你说两句。',[],undefined,{adviceStyle:'listen'});
  ok(groundedCare.includes('已说出的付出、落空或此刻心意')&&groundedCare.includes('对他的在意与对事情的判断各自说清'),'care is grounded in the stated setback rather than requiring a verdict against someone else');
  ok(groundedCare.includes('明确的不公或伤害照常认真回应')&&groundedCare.includes('陪聊不是替他决定情绪该如何释放'),'bounded care keeps moral agency for stated harms and the user choice of emotional expression');
  ok(groundedCare.includes('把自己的在意说给他听')&&groundedCare.includes('用户明确问感受是否合理时仍认真回应'),'ordinary emotional sharing favors the actor own reaction while requested validation remains legitimate');
  ok(inspectChatOutput('难过很正常，我也在意这件事。',{mode:'private',userMessage:'我这样难过正常吗？'}).check.ok,'the new expression direction does not turn reassurance wording into a blanket quality failure');
  for(const message of ['我今天挺难过，就想跟你说两句。','我有点委屈，先别教我怎么做。','今天好累，想找你说话。']) {
    const guidance=buildHumanConversationContext(message,[],undefined,{adviceStyle:'listen'});
    ok(guidance.includes('说出你这个人真正在意的一点')&&guidance.includes('由人设与原话决定'),'listening direction offers a personal reaction grounded in what was said: '+message);
    ok(guidance.includes('也允许短短一个反应')&&!guidance.includes('让下一句话留给他'),'listening permits a brief reaction without steering exclusively to passive acknowledgement: '+message);
  }
  for(const message of ['我挺失落的。现在不失落了。','我有点沮丧。现在不沮丧了。','我有点失落。现在好了。'])ok(interactionMoment(message)==='ordinary','explicit present recovery replaces earlier setback: '+message);
  ok(interactionMoment('昨天我很开心。现在有点失落。')==='distress','present setback replaces separately dated past joy');
  for(const message of ['挺失落的。','我有点沮丧。','忙了一下午，最后还是没弄好，挺失落的。别急着帮我解决，我就是想找你说两句。','现在我还是有些沮丧。']) {
    ok(interactionMoment(message)==='distress','explicit setback feeling including an omitted self retains distress: '+message);
    ok(authoredReactionLines('受挫回应：说自己的关切。',message).length===1,'stated setback reaches the authored reaction: '+message);
  }
  for(const message of ['我不太失落。','我没有很沮丧。','我不是很失落。','他挺失落的。','朋友说“我很失落”。','如果我很沮丧呢？','我很失落吗？','有点失落是什么意思？','钥匙失落在门口了。','找到失落的东西了。','故事里的失落之城很好看。'])ok(interactionMoment(message)!=='distress','setback routing preserves negation, other people, questions and non-emotion meaning: '+message);
  const distressFields='受挫回应：接已经说出的事情，说自己的关心。\n疲惫回应：少说。\n庆祝反应：一起高兴。';
  ok(interactionMoment(distressMessage)==='distress','stated frustration retains its own moment rather than falling into ordinary chat');
  ok(authoredReactionLines(distressFields,distressMessage).join('')==='受挫回应：接已经说出的事情，说自己的关心。','distress selects the authored reaction without unrelated fatigue or celebration');
  ok(emotionalExpressionGuidance(distressMessage,[],{tags:['高冷'],systemPrompt:distressFields}).includes('人物写明'),'authored distress reaction takes priority over a generic cold personality');
  for(const message of ['我没有难过。','朋友说“我很难过”。','如果我很难过呢？','换个话题，故事留白有意思吗？']) {
    ok(interactionMoment(message)!=='distress','denial, report, hypothesis and a new topic do not inherit distress: '+message);
    ok(!authoredReactionLines(distressFields,message).join('').includes('受挫回应'),'unrelated turn does not receive distress instruction: '+message);
  }
  ok(authoredReactionLines(authored,'今天好累').length===1&&authoredReactionLines(authored,'今天好累')[0].includes('疲惫回应'),'authored reaction fields are selected for the current situation');
  const ownReaction=emotionalExpressionGuidance('你好棒',[],{tags:['温柔'],systemPrompt:authored});
  ok(ownReaction.includes('人物写明')&&!ownReaction.includes('反过来夸'),'authored habits override generic tag reaction defaults');
  for(const message of ['今天抢到最后一张票，有点小得意。','今天买到最后一块蛋糕，有些小小的得意。','终于修好那个抽屉，我有一点小得意。']) {
    ok(interactionMoment(message)==='celebration','explicit understated joy retains emotional voice: '+message);
    ok(authoredReactionLines('庆祝反应：开心时一起高兴。\n疲惫回应：累时少说。',message).join('').includes('庆祝反应'),'understated joy selects authored celebration instead of unrelated fatigue');
  }
  for(const message of ['朋友说有点小得意。','“有点小得意”是什么意思？','如果我有点小得意呢？','我并没有小得意。','我没有有点小得意。'])ok(interactionMoment(message)==='ordinary','reported, quoted, hypothetical and denied pride are not lived joy: '+message);
  const manyExamples=['对话样本：用户说你好 → 你说在呢。','对话样本：用户说你好棒 → 你说有点得意。','对话样本：用户说我不同意 → 你说你说说是哪一点。','对话样本：用户说我爱你 → 你说我想认真答你。','对话样本：用户说今天好累 → 你说今天先收住吧。'];
  ok(selectVoiceExamples(manyExamples,'今天好累')[0]===manyExamples[4]&&selectVoiceExamples(manyExamples,'今天好累').length<=3,'relevant late voice example gets prompt space ahead of unrelated first examples');
  ok(!selectVoiceExamples(manyExamples,'换个话题。我爱你。').some(s=>s.includes('今天好累')||s.includes('我不同意')),'new affection does not amplify unrelated fatigue or argument examples');
  ok(selectVoiceExamples(manyExamples,'今天去书店了').every(s=>!s.includes('今天好累')&&!s.includes('我爱你')),'ordinary new subject uses neutral examples instead of prior emotion scripts');
  ok(selectVoiceExamples(manyExamples).length===5&&manyExamples[0].includes('你好'),'general voice card retains scene variety without mutating samples');
  const topicalExamples=['对话样本：用户说你好 → 你说来啦。','对话样本：用户说吃饭了吗 → 你说还没呢。','对话样本：用户说今天出门了 → 你说外面怎么样。','对话样本：用户说这家书店怎么样 → 你说先看选书，装修不算书单。','对话样本：用户说报告的开头顺不顺 → 你说顺，后面别再把开头说一遍。'];
  const beforeExamples=JSON.stringify(topicalExamples);
  ok(selectVoiceExamples(topicalExamples,'你觉得那家书店怎么样')[0]===topicalExamples[3],'late ordinary-topic voice example gets priority over unrelated greetings');
  ok(selectVoiceExamples(topicalExamples,'报告的开头顺不顺？')[0]===topicalExamples[4],'exact topic example survives three-sample limit despite appearing last');
  ok(selectVoiceExamples(topicalExamples,'你好')[0]===topicalExamples[0],'greeting retains its matching sample rather than being globally removed');
  ok(selectVoiceExamples(topicalExamples,'今天好累').length===0,'emotion without a matching sample does not borrow unrelated greetings, meals or bookshop scripts');
  ok(selectVoiceExamples(manyExamples,'今天好累').length===1,'an applicable tired sample is not padded with an unrelated greeting');
  ok(selectVoiceExamples(topicalExamples,'我刚拆了一包饼干').length===1,'an unseen everyday topic retains one voice reference rather than three unrelated mini-scenes');
  ok(selectVoiceExamples(topicalExamples,'报告的开头顺不顺？').every(line=>line.includes('报告的开头')),'a topical judgment does not carry a second unrelated meal or bookshop example');
  ok(JSON.stringify(topicalExamples)===beforeExamples&&selectVoiceExamples(topicalExamples,'').join('|')===topicalExamples.slice(0,3).join('|'),'voice selection does not mutate authored order and empty proactive cue stays stable');
  const misleadingSample='对话样本：用户说吃饭了吗 → 你说这家书店很好。';
  ok(selectVoiceExamples([misleadingSample,topicalExamples[3]],'书店怎么样')[0]===topicalExamples[3],'topic ranking reads the example user cue instead of mistaking reply wording for a matched situation');
  const topicalRole={name:'小林',tags:['温柔'],signature:'',greeting:'来啦',proactivity:.5,systemPrompt:topicalExamples.join('\n')};
  const groundedVoiceRole={...topicalRole,systemPrompt:'判断习惯：对具体的细节有自己的判断。\n'+topicalRole.systemPrompt};
  const unknownTopicCard=buildCharacterVoiceCard(groundedVoiceRole,'刚收到快递，包装大了三倍');
  ok(unknownTopicCard.includes('人物判断依据')&&!unknownTopicCard.includes('对话样本'),'an authored judgment supplies the voice for an unmatched anecdote without borrowing an irrelevant scene');
  ok(buildCharacterVoiceCard(groundedVoiceRole,'这家书店怎么样').includes('先看选书'),'removing unrelated fallback retains an actually matching scene');
  ok(buildCharacterVoiceCard({...groundedVoiceRole,systemPrompt:groundedVoiceRole.systemPrompt+'\n表达示例：嗯？真的假的。'},'刚收到快递').includes('真的假的'),'general authored expression remains distinct from an unrelated story scene');
  ok(buildCharacterVoiceCard(topicalRole,'这家书店怎么样').includes('先看选书')&&buildHumanConversationContext('报告的开头顺不顺？',[],topicalRole).includes('后面别再把开头说一遍'),'shared and private production voice cards both carry the applicable late ordinary sample');
  for(const [line,user] of [
    ['【性格示例】用户：今天好累。你：先收住。','今天好累。'],
    ['用户:我不同意。TA:说说哪里。','我不同意。'],
    ['对话样本：用户说“我爱你” → 你说我听见啦。','我爱你'],
    ['用户：今天好累 -> 角色：歇会儿。','今天好累'],
    ['用户说你好 → 你说你说的累，是哪种？','你好'],
    ['用户：她说“我好累”。你：你担心她吗？','她说“我好累”。'],
    ['表达示例：嗯？',''],
  ])ok(voiceExampleUserText(line)===user,`authored sample extracts user side only: ${line}`);
  const legacySamples=['【性格示例】用户：今天好累。你：今天的电量见底了。','用户：我不同意。你：那说说哪一点。','用户：你好。你：来啦。','用户：我爱你。你：这句我认真听了。'];
  ok(selectVoiceExamples(legacySamples,'今天去书店了').length===1&&selectVoiceExamples(legacySamples,'今天去书店了')[0]===legacySamples[2],'legacy examples no longer inject fatigue, argument or intimacy into an ordinary topic');
  ok(selectVoiceExamples(legacySamples,'今天好累')[0]===legacySamples[0],'legacy fatigue example receives priority when fatigue is current');
  ok(selectVoiceExamples(legacySamples,'我不同意')[0]===legacySamples[1],'legacy disagreement retains the right character reaction');
  ok(selectVoiceExamples(legacySamples,'我爱你')[0]===legacySamples[3],'legacy affection selects affection rather than fatigue');
  const legacyPersona={name:'旧角色',tags:['俏皮'],signature:'',greeting:'来啦',proactivity:.5,systemPrompt:legacySamples.join('\n')};
  const legacyContext=buildHumanConversationContext('今天去书店了',[],legacyPersona);
  ok(legacyContext.includes('用户：你好。你：来啦。')&&!legacyContext.includes('今天的电量见底了')&&!legacyContext.includes('这句我认真听了'),'actual legacy character tail voice card includes only appropriate scene examples');
  const sevenLines=['称呼：你','判断习惯：先核对事实',...manyExamples];
  ok(normalizeVoiceLines(sevenLines).length===7&&normalizeVoiceLines(sevenLines.slice(0,4)).length===4,'expanded cache accepts five examples while retaining old two-example format');
  const loop=[['辛苦了','先歇歇'],['辛苦了','慢慢说'],['辛苦了','不用着急']];
  ok(emotionalExpressionGuidance('今天去书店了',[],{tags:['温柔'],systemPrompt:''},loop).includes('同类安慰开场'),'repeated comfort structure receives soft guidance instead of another canned comfort');
  ok(!emotionalExpressionGuidance('今天去书店了',[],{tags:['温柔'],systemPrompt:'',catchphrase:'辛苦了，亲爱的'},loop).includes('同类安慰开场'),'explicit authored catchphrase is exempt from comfort-loop guidance');
  const receiptLoop=[['听见了。','这确实很累。'],['听见了。'],['听见了。','不必勉强。']];
  ok(emotionalExpressionGuidance('还有，他又把我说的话听反了',[],{tags:['高冷'],systemPrompt:''},receiptLoop).includes('同类安慰开场'),'three listening receipts receive soft rhythm feedback rather than endless permission-to-speak messages');
  ok(!emotionalExpressionGuidance('还有，他又把我说的话听反了',[],{tags:['高冷'],systemPrompt:''},receiptLoop.slice(0,2)).includes('同类安慰开场'),'one or two natural listening reactions are not penalized');
  ok(!emotionalExpressionGuidance('刚才你说听见了',[],{tags:['高冷'],systemPrompt:''},receiptLoop).includes('同类安慰开场'),'a user returning to the receipt itself can still receive that response');
  ok(!emotionalExpressionGuidance('继续说',[],{tags:['高冷'],systemPrompt:'',catchphrase:'听见了。'},receiptLoop).includes('同类安慰开场'),'an explicit authored listening catchphrase keeps its exemption');
  ok(!emotionalExpressionGuidance('今天去书店了',[],{tags:['温柔'],systemPrompt:''},loop.slice(0,2)).includes('同类安慰开场'),'two real comfort turns do not force a style rotation');
  ok(interactionMoment('谢谢你陪我这么久')==='praise'&&interactionMoment('我朋友说你没理解他')==='ordinary','extended thanks and third-party disagreement retain their actual source');
  const stagedScreenshots=[
    '门没锁，进来。粥凉了就凉了，人坐下——我看着你说，把刚才那三个字当面再讲一遍。',
    '我听见了。不是隔着门板混着风声的那种听见。进来吧，把门带上。今晚这句话，你当面说的，我收下了。',
  ];
  for (const raw of stagedScreenshots) {
    const inspected=inspectChatOutput(raw,{mode:'private',userMessage:'我爱你'});
    ok(inspected.check.issue==='uninvited-staging' && inspected.content===raw,'screenshot staging requests a rewrite without deleting spoken meaning');
  }
  const ornate='我听见了。不是随口飘过耳边的那种回应。今晚这句话落在心里，你的心意，我收下了，会把它藏在所有安静的夜晚里。';
  ok(inspectChatOutput(ornate,{mode:'private',userMessage:'我爱你'}).check.issue==='emotional-script','layered affection receipt is recognized beyond physical staging');
  for(const raw of ['嗯，我也是。','突然这么认真……我有点开心。','再说一次，我刚刚有点得意，没听够。','抱抱你。','这份喜欢我收下啦。','我喜欢你，但还不想把关系往前推这么快。','我听见了，慢慢说。','你像我在雨天等到的那束光。','今天路过书店，我想到你了。','刚回家，我把门关上，坐下看了会儿书。']) {
    ok(inspectChatOutput(raw,{mode:'private',userMessage:'我爱你'}).check.ok,`normal affection, boundaries and lived narration remain valid: ${raw}`);
  }
  ok(inspectChatOutput('他说“进来吧，把门带上”。',{mode:'private',userMessage:'他怎么说的'}).check.ok,'quoted staging is not a demand directed at the user');
  for(const request of ['陪我演一段重逢的剧情','帮我写一段场景','用诗意的方式回应我']) {
    ok(allowsDramaticReply(request)&&inspectChatOutput(stagedScreenshots[1],{mode:'private',userMessage:request}).check.ok,`explicit user creation choice is preserved: ${request}`);
  }
  ok(allowsDramaticReply('我爱你',['陪我演一段重逢的剧情']),'user-requested roleplay continues across subsequent short turns');
  ok(!allowsDramaticReply('我爱你',['陪我演一段重逢的剧情','别演了，正常说话']),'explicit return to ordinary chat revokes the previous drama mode');
  ok(!allowsDramaticReply('她说“陪我演一段剧情”'),'quoted roleplay request grants no current expression mode');
  ok(!allowsDramaticReply('不要写诗，正常回复我'),'negative creation request cannot accidentally enable dramatic prose');
  ok(!allowsDramaticReply('我爱你',['帮我写一首诗']),'finished one-shot creative request cannot turn later affection into a poem');
  ok(!allowsDramaticReply('换个话题，今天吃什么',['陪我演一段剧情']),'explicit topic change stops continuing the previous staging');
  ok(directChatGuidance('我爱你',[],stagedScreenshots).includes('不是现在同处一室的证据'),'historical stage prose is a repair clue instead of co-presence evidence');
  ok(buildSceneTimeContext('night','房间','close').includes('不证明你与用户同处一室'),'ambient place and intimacy cannot instruct physical staging');
  ok(isDirectAffection('我爱你')&&!isDirectAffection('我喜欢你推荐的书')&&!isDirectAffection('我不爱你'),'affection recognition respects negation and the actual object');
  for(const input of ['今天就是想你了','我今天就是想你了','今天我挺想你的','我刚才忽然有点想你','最近挺想你的','忽然想你了','想你','我现在惦记着你','只是我今天有点喜欢你','我是舞麟，今天就是想你了','我是小凡。今天就是想你了']){
    ok(isDirectAffection(input)&&interactionMoment(input)==='affection','natural subject/time/modifier order preserves a directly expressed feeling: '+input);
    ok(chooseConversationAction(input,[])==='respond-affection','the actual dialogue route receives the feeling rather than neutral reaction: '+input);
  }
  for(const input of ['今天就是想你推荐的那本书','我今天不想你','今天我不是想你','今天就是想你这句话怎么翻译','如果今天就是想你了','朋友说今天就是想你了','“今天就是想你了”是什么意思','帮我写一句，今天就是想你了','我今天想你了吗？','想你了？','我明天会想你','我刚才想你是不是遇到问题了'])ok(!isDirectAffection(input),'direct feeling does not swallow another object, denial, reported text, task, question or future claim: '+input);
  ok(chooseConversationAction('我今天有点想你，帮我解释这道题',[])==='finish-request','a clear task still takes priority over the accompanying feeling');
  for(const input of ['我有点喜欢你，想多和你聊聊。','我有一点喜欢你','我有些想你了','我有一些喜欢你']) {
    ok(isDirectAffection(input)&&interactionMoment(input)==='affection','mild directly expressed feeling reaches authored reaction: '+input);
  }
  for(const input of ['我有点喜欢你推荐的书','我有些喜欢你的观点','我不是有点喜欢你','如果我有点喜欢你，该怎么办','朋友说我有点喜欢你','“我有点喜欢你”是什么意思']) {
    ok(!isDirectAffection(input),'mild feeling cue preserves object, negation, hypothetical and quotation boundaries: '+input);
  }
  for(const mode of ['private','proactive','group'] as const)ok(inspectChatOutput(stagedScreenshots[1],{mode,userMessage:'我爱你'}).check.issue==='uninvited-staging',`staging check reaches ${mode} entrance`);
  const voiceLines=['称呼：你','判断习惯：坦率表达','对话样本：用户说你好 → 你说在呢。','对话样本：用户说我爱你 → 你说进来吧，把门带上。'];
  let rejectedVoice=false;try{normalizeVoiceLines(voiceLines);}catch{rejectedVoice=true;}ok(rejectedVoice,'generated staging cannot become authoritative cached voice');
  ok(normalizeVoiceLines([...voiceLines.slice(0,3),'对话样本：用户说陪我演一段重逢剧情 → 你说进来吧，把门带上。']).length===4,'voice sample validation preserves explicitly requested drama');
  for (const aside of ['笑','叹气','无奈地笑了笑','顿了顿，把手机放下','声音低了下来，沉默了一会儿才开口']) {
    ok(stripRoleplayActions(`（${aside}）好呀`) === '好呀', `remove definite action: ${aside}`);
  }
  for (const note of ['不含税','周五截止','API','x+y','预算两千','笑话不好笑','语气词','声音设置','原文如此','先查后改']) {
    ok(stripRoleplayActions(`说明（${note}）`) === `说明（${note}）`, `preserve factual or uncertain aside: ${note}`);
  }
  const expandedActions = ['翻了个白眼','打了个哈欠','挠了挠头','拍桌','冷笑一声','眼眶红了','握紧拳头','撇撇嘴','松了口气',
    '她轻轻地拍了拍桌子','微微撇了撇嘴','眼眶渐渐红了起来','深吸了一口气','攥紧了双拳','闭上眼睛','抬起了手','瞥了你一眼',
    '翻了个白眼，松了口气','冷笑一声，把手机放下','打了个哈欠，挠了挠头'];
  for (const aside of expandedActions) {
    const raw=`你好（${aside}）随便你`, expected='你好随便你';
    ok(stripRoleplayActions(raw)===expected && stripRoleplayActions(`你好(${aside})随便你`)===expected, `expanded action removed in both bracket styles: ${aside}`);
    const prefixes=Array.from({length:raw.length},(_,i)=>streamedReplyParts(raw.slice(0,i+1)).join(''));
    ok(prefixes.every(part=>expected.startsWith(part)) && streamedReplyParts(raw,true).join('')===expected, `expanded action never flashes at a stream boundary: ${aside}`);
  }
  for (const note of ['翻白眼的含义','打哈欠可能是困了','挠头是动作描写','拍桌不代表生气','冷笑一声的用法','眼眶红了不一定难过','握紧拳头的训练方法','撇嘴是什么意思','松了口气这个表达','关于预算的问题','2024年修订版','原文是"你好"','先拍桌，再解释这段文字']) {
    const raw=`说明（${note}）仍保留`;
    ok(stripRoleplayActions(raw)===raw && streamedReplyParts(raw,true).join('')===raw, `expanded action roots do not erase factual explanations: ${note}`);
  }
  const spokenActions='我翻了个白眼，打了个哈欠，又松了口气。';
  ok(stripRoleplayActions(spokenActions)===spokenActions,'expanded action cleanup never removes ordinary text outside brackets');
  for (const mode of ['private','proactive','group'] as const) {
    ok(inspectChatOutput('（翻了个白眼，松了口气）随便你',{mode}).content==='随便你',`expanded action cleanup reaches shared ${mode} quality entry`);
  }
  ok(inspectChatOutput('（打了个哈欠）',{mode:'proactive'}).check.issue==='empty','action-only proactive draft cannot become a sent empty message');
  for (const [raw, expected] of [['今天路过那家店\n想起你说过想吃','今天路过那家店想起你说过想吃'],['hello\nworld','hello world'],['你好。\n明天见','你好。明天见'],['今天 API\n很好用','今天 API很好用']]) {
    ok(splitReplyParts(raw).join('') === expected && polishChatResponse(raw) === expected, `shared line boundary: ${raw}`);
  }
  const streamText = '你好（顿了顿，把手机放下）今天\n想起你😂';
  for (let i = 1; i <= streamText.length; i++) {
    const parts = streamedReplyParts(streamText.slice(0,i));
    ok(!parts.join('').includes('顿') && !parts.join('').includes('手机'), `no action flash at SSE boundary ${i}`);
  }
  ok(streamedReplyParts(streamText,true).join('') === '你好今天想起你😂', 'stream final agrees with cleaned content');
  ok(JSON.stringify(streamedReplyParts('hello\n\nworld',true))===JSON.stringify(['hello','world']),'English blank paragraphs are two messages rather than a fabricated word boundary');
  ok(streamedReplyParts('hello\n\nworld',true,false,{longForm:true}).join('')==='hello world','English long-form blank lines retain their word boundary');
  for (const [raw,expected] of [['你好\r\n再见','你好再见'],['hello\r\nworld','hello world'],['你\n好吗？','你好吗？'],['API\n2','API 2'],['hello \n world','hello world'],['你好\n😂','你好😂'],['！！\n真的吗？？','！！真的吗？？'],['预算（不含税）\n两千','预算（不含税）两千'],['Hello world','Hello world'],['（低声说）你好','你好'],['（轻声说）你好','你好']]) {
    ok(streamedReplyParts(raw,true).join('') === expected, `final mixed-script boundary: ${raw}`);
  }
  const noteText='预算（周五截止）两千';
  for (let i=1;i<=noteText.length;i++) {
    ok(noteText.startsWith(streamedReplyParts(noteText.slice(0,i)).join('')), `factual note remains an ordered prefix at boundary ${i}`);
  }
  ok(inspectChatOutput('早安', {mode:'proactive',recentReplies:[]}).check.ok, 'natural morning greeting is permitted');
  ok(!inspectChatOutput('很高兴为您服务', {mode:'proactive'}).check.ok, 'proactive service prose is blocked');
  ok(inspectChatOutput('这是我自己的口头禅但有新内容', {mode:'group',recentReplies:['别人的回复']}).check.ok, 'quality context only compares supplied speaker history');
  ok(polishChatResponse(punctuation) === punctuation, 'local polishing preserves emotional question and exclamation intensity');
  for (const reaction of ['嗯', '嗯嗯', '确实', '哈哈哈哈', '啊？', '？？', '😭', '好呀', '好的呢', '你好']) {
    ok(checkReplyQuality(reaction, '今天发生好多事情，我还没理清楚', reaction, [reaction, reaction]).ok, `pure reaction and familiar opener do not trigger retry: ${reaction}`);
  }
  ok(checkReplyQuality('嗯嗯---这事确实挺离谱的😂', '你听我说').ok, 'reaction plus content is a valid multi-message response');
  ok(checkReplyQuality('哈哈哈哈哈哈哈哈', '笑死，哈哈，今天隔壁家的猫突然跳进我的购物袋，给我吓了一跳').ok, 'extended laughter is not mistaken for copying a longer story');
  ok(checkReplyQuality('今天隔壁家的猫突然跳进我的购物袋，给我吓了一跳', '今天隔壁家的猫突然跳进我的购物袋，给我吓了一跳').issue === 'repeat-user', 'actual complete user echo is still detected');
  for (const response of ['作为AI，我来回答你。', '很高兴为您服务。', '有什么可以帮您？']) ok(checkReplyQuality(response, '聊聊天').issue === 'generic', 'actual generic service prose still triggers quality feedback');
  ok(checkReplyQuality('怎么了？谁说的？', '我有点委屈').ok, 'two actual questions preserve concern without retry');
  const attention = emptyChatConversationState();
  ok(planCharacterIntent('今天特别开心', [{ role: 'assistant', content: '真的？？' }], attention).mayAskQuestion, 'last turn question or punctuation does not suppress natural follow-up');
  attention.preferences.questionTolerance = 'low';
  ok(!planCharacterIntent('今天特别开心', [], attention).mayAskQuestion && buildChatConversationStateContext(attention).includes('确实需要时再补问'), 'explicit user preference still limits unnecessary follow-up');
  ok(checkReplyQuality('？？---啊？？---真的假的？？', '有事想说').ok, 'question mark groups are emotional reactions, not a question barrage');
  ok(checkReplyQuality('谁说的？在哪儿？什么时候？', '有事想说').issue === 'question-barrage', 'three consecutive substantive questions are still an interview');
  for(const reaction of ['真的吗？','真的假的？？','不会吧？','是吗？','啊？？'])ok(!replyContainsSubstantiveQuestion([reaction]),`a complete surprise reaction is not a request for interview details: ${reaction}`);
  ok(checkReplyQuality('真的吗？真的假的？？不会吧？','我中了奖').ok,'three surprise reactions preserve expressive punctuation without a quality retry');
  ok(!recentQuestionDirection([['真的吗？'],['不会吧？']]),'consecutive surprise reactions do not create a question cooldown');
  for(const question of ['真的吗，什么时候的事？','不会吧，你打算怎么办？','是吗，你在哪儿？'])ok(replyContainsSubstantiveQuestion([question]),`a reaction opener cannot exempt the concrete question following it: ${question}`);
  ok(checkReplyQuality('什么时候？在哪儿？谁跟你说的？','今天发生件事').issue==='question-barrage','clear consecutive questions retain the existing interview check');
  ok(checkReplyQuality('谁说的？这也太离谱了。在哪儿？先别急。什么时候？', '有事想说').ok, 'separate questions with substantive reactions are not flattened or retried');
  ok(checkReplyQuality('他问“谁说的？在哪儿？什么时候？”', '我听到了这段话').ok, 'quoted questions are not assistant interrogation');
  const phrase = '先说正事，我今天在学校看到了一件有趣的事情。';
  ok(checkReplyQuality('先说正事，我想明天去公园走一走，顺便买点饮料。', '想聊什么', phrase, [phrase, phrase], { catchphrase: '先说正事' }).ok, 'stable opener with new content is not repeated imagery');
  const repeated = '窗台上的月光像一封始终没有拆开的信。';
  for(const request of ['你就把我刚才那句再说一遍','请原样说：“窗台上的月光像一封始终没有拆开的信。”','请原样说：不要再说一遍','把这句原样念出来：你好']){
    ok(requestsRepetition(request)&&detectChatIntent(request)==='request'&&chooseConversationAction(request,[])==='finish-request',`an explicit read-back shares request intent without inventing a new task: ${request}`);
    ok(directChatGuidance(request,[],[]).includes('不追加点评、解释或询问要不要再念'),'read-back instruction retains the target words instead of continuing a character performance');
  }
  const readBack='明早九点在公司会议室讨论产品发布安排，带上预算、设计稿和客户反馈。下午去仓库核对库存，路上买牛奶、鸡蛋、橙子，晚上和朋友散步，顺便把借来的相机还给他。';
  ok(checkReplyQuality(readBack,'请看：“'+readBack+'”').issue==='repeat-user','long quoted source actually reaches the user-echo guard without permission');
  ok(checkReplyQuality(readBack,'请原样说：“'+readBack+'”').ok,'explicit quoted read-back is exempt from the user-echo guard as well as own-echo guard');
  for(const request of ['朋友说再说一遍','如果再说一遍会怎样','重复是什么意思','解释一下原样说这个词','不用原样说：这句话'])ok(!requestsRepetition(request),'reports, concepts, hypotheticals and negation do not authorize read-back');
  const ownFactGuidance=directChatGuidance('对了，你知道我今天几点起床的吗',[],[]);
  ok(ownFactGuidance.includes('只依据其原话或可靠记录')&&ownFactGuidance.includes('坦白不知道')&&ownFactGuidance.includes('在后台完成'),'private factual questions require actual evidence and keep the verification process out of the reply');
  ok(!directChatGuidance('朋友问你知道我今天几点起床的吗',[],[]).includes('核对依据'),'reported factual question does not add current-user fact instructions');
  const timeQuestion='对了，你知道我今天几点起床的吗';
  for(const answer of ['十点，差点错过早餐','上午九点半','08:30']){
    ok(!detectTopicMove(answer,timeQuestion),`time answer retains the preceding question rather than becoming a new subject: ${answer}`);
    ok(directChatGuidance(answer,[timeQuestion],[]).includes('现在说出来不代表事件刚刚发生'),'time-answer guidance separates the narrated event from the current chat clock');
  }
  ok(!directChatGuidance('十点的电影有点晚',['我刚买了个杯子'],[]).includes('这轮的时间在接上一条'),'a new clock-related subject without a prior time question is not rebound to an unrelated focus');
  ok(detectTopicMove('换个话题，我想买个杯子',timeQuestion),'an explicit topic shift still wins over a previous time question');
  const readbackFocus=directChatGuidance('你就把我刚才那句再说一遍',['其实我也有忙的时候，好像刚才说绝对了',timeQuestion,'十点，差点错过早餐'],[]);
  ok(readbackFocus.includes('原文："十点，差点错过早餐"')&&!readbackFocus.includes('原文："其实我也有忙'),'explicit nearest-user pointer selects the adjacent source rather than another paused topic');
  ok(!directChatGuidance('把你刚才那句再说一遍',['十点，差点错过早餐'],[]).includes('已按相邻用户消息定位'),'an assistant-source repeat is not rebound to user text');
  ok(!directChatGuidance('你就把我刚才那句再说一遍',[],[]).includes('已按相邻用户消息定位'),'missing user source is not invented');
  for(const text of ['把我刚才那句的后半句再说一遍','把我上一句和更早那句再说一遍','把我刚才那句第二句再说一遍'])ok(!directChatGuidance(text,['十点，差点错过早餐'],[]).includes('已按相邻用户消息定位'),'an explicit fragment or older-source scope is not replaced by the whole adjacent user message');
  for(const previous of ['我不知道几点结束','今天几点起床都没关系','不要回答我几点起床','如果你知道我几点起床呢','朋友问你知道我几点起床吗'])ok(!directChatGuidance('十点，差点错过早餐',[previous],[]).includes('这轮的时间在接上一条'),'statements, negation and reported time questions do not establish a current answer focus');
  for (const request of ['再说一遍', '把刚才那句话重复一下', '刚才没听清，再讲一次']) {
    ok(requestsRepetition(request) && checkReplyQuality(repeated, request, repeated, [repeated, repeated]).ok, `explicit repeat remains a natural reply: ${request}`);
  }
  for (const request of ['别再说一遍了', '不要重复刚才的话', '他说“再说一遍”', '今天去书店了']) {
    ok(!requestsRepetition(request) && checkReplyQuality(repeated, request, undefined, [repeated, repeated]).issue === 'repeat-own', `unsolicited looping remains checked: ${request}`);
  }
  for (const request of ['好呀，那你帮我看看这段', '嗯，我好累', '行，我不同意你刚才那句', '晚安之前还有件事想说']) {
    ok(chooseConversationAction(request, []) !== 'short-close', `acknowledgement with new content is not goodbye: ${request}`);
  }
  for (const request of ['晚安', '拜拜啦', '先这样', '好的呀']) ok(chooseConversationAction(request, []) === 'short-close', `standalone closing keeps its natural ending: ${request}`);
  ok(checkReplyQuality(repeated, '想聊什么', undefined, [repeated, repeated]).issue === 'repeat-own', 'repeated long imagery remains detectable');
  ok(checkReplyQuality('今天的事情挺多但我还是想认真听听你遇到了什么。', '说点别的', '今天的事情挺多但我还是想认真听听你遇到了什么。').issue === 'repeat-own', 'copying a complete long reply still triggers feedback');
  const long = '？？' + '今天去了小区旁边那家新开的店，店里很安静，还有一只趴着睡觉的小猫。' + '我本来只想买杯饮料，后来多坐了一会儿，等店里的人走完才走！！';
  const parts = splitReplyParts(long);
  ok(parts.length >= 2 && parts.length <= 4 && parts.join('') === long, '60-character fallback splits naturally without dropping leading or repeated punctuation');
  ok(splitReplyParts('嗯')[0] === '嗯' && splitReplyParts('？？')[0] === '？？', 'short reactions are never expanded or stripped');
  ok(splitReplyParts('嗯---我晚点回来！！')[0] === '嗯', 'explicit short reaction remains its own bubble');
  const envelope = JSON.stringify({ messages: ['哈哈', '真的吗？？', '我晚点去', '不对，我现在就去'] });
  ok(normalizeChatResponse(envelope).includes('不对，我现在就去') && splitReplyParts(envelope).length === 4, 'four JSON messages retain the self-correction independently');
  ok(mergeReplyParts(['长一些的第一条', '嗯', '啊', '认真说正事的第四条', '最后一句']).join('|') === '长一些的第一条|嗯啊|认真说正事的第四条|最后一句', 'five bubbles merge the shortest adjacent pair without Chinese spaces');
  ok(mergeReplyParts(['啊', '最长的内容条', '嗯', '短一点', '尾部']).join('') === '啊最长的内容条嗯短一点尾部', 'nonadjacent shortest reactions are never reordered');
  ok(mergeReplyParts(['a', 'b', 'c', 'd', 'e']).join('|') === 'a b|c|d|e', 'equal shortest adjacent pairs choose the earliest and preserve ASCII word boundary');
  ok(computeMessageDelays(['嗯', '啊', '内容', '最后一句']).reduce((sum, n) => sum + n, 0) <= 3500, 'four bubbles stay within total delivery budget');
  ok(streamedReplyParts('哈哈😂---真的假的？？', true).join('---') === '哈哈😂---真的假的？？', 'streamed bubbles keep emoji and punctuation exactly');
  ok(stripRoleplayActions('（笑）哈哈😂') === '哈哈😂' && !splitReplyParts('第一句\n第二句')[0].includes('\n'), 'bracket action stripping and no bubble newline remain enforced');
  const character = { name: '星遥', tags: ['活泼'], proactivity: 0.7, signature: '爱逛书店', greeting: '喂，来了呀', catchphrase: '先说正事', boundaries: '不喜欢被催', systemPrompt: '你是星遥。\n对话样本：用户说你好 → 你说喂，来了呀---今天有个笑话想讲。\n表达示例：嗯？你再说一遍😂' };
  const cachedRole={...character,systemPrompt:'你是星遥，喜欢书店。',reviewedVoiceLines:['对话样本：用户说你好 → 你说喂，来啦。']};
  const sceneRole={...character,systemPrompt:'判断习惯：先核对事实。\n疲惫回应：不要催振作。\n亲密反应：认真回应心意。\n对话样本：用户说你好 → 你说喂，来啦。\n对话样本：用户说今天好累 → 你说今天先歇歇。\n对话样本：用户说我爱你 → 你说我也喜欢你。'};
  const neutralCard=buildCharacterVoiceCard(sceneRole);
  ok(neutralCard.includes('喂，来啦')&&neutralCard.includes('先核对事实')&&!neutralCard.includes('今天先歇歇')&&!neutralCard.includes('我也喜欢你')&&!neutralCard.includes('不要催振作'),'proactive voice card retains identity without unrelated emotional scenes');
  const tiredCard=buildCharacterVoiceCard(sceneRole,'今天好累');
  ok(tiredCard.includes('今天先歇歇')&&tiredCard.includes('不要催振作')&&!tiredCard.includes('我也喜欢你'),'user-driven shared voice card selects current scene without injecting intimacy');
  const concreteOrdinaryCard=buildCharacterVoiceCard(sceneRole,'你觉得晚回就是不在乎吗');
  ok(!concreteOrdinaryCard.includes('人格底色：')&&!concreteOrdinaryCard.includes('内在气质参考：')&&!concreteOrdinaryCard.includes('说话节奏参考：')&&concreteOrdinaryCard.includes('先核对事实'),'explicit authored voice is not reinterpreted through repeated profile labels and an unrelated opening');
  ok(concreteOrdinaryCard.includes('先说正事')&&concreteOrdinaryCard.includes('不喜欢被催'),'removing redundant card metadata preserves the explicit catchphrase and boundary');
  ok(buildCharacterVoiceCard({...sceneRole,tags:['毒舌'],signature:'每句话都用代码思考',greeting:'说吧，别绕弯'},'你觉得晚回就是不在乎吗')===concreteOrdinaryCard,'authored tail voice remains stable when only marketing metadata changes');
  ok(buildCharacterVoiceCard(character,'今天去书店了').includes('人格底色：活泼')&&buildCharacterVoiceCard(character,'今天去书店了').includes('说话节奏参考：'),'sparse personas still receive tag and opening fallback');
  const cache={lines:['称呼：你','判断习惯：先看实际限制，直接表达自己的意见。',...manyExamples.slice(1)],generatedAt:Date.now(),promptRevision:voicePromptRevision(cachedRole)};
  const cachedContext=buildHumanConversationContext('今天好累',[],{...cachedRole,voiceSamples:cache});
  ok(cachedContext.includes('先看实际限制')&&!cachedContext.includes('语言指纹与判断：反应快'),'valid generated judgment suppresses duplicated generic voice fallback');
  ok(cachedContext.includes('这个人的具体判断习惯')&&!cachedContext.includes('降低表达强度'),'valid specific voice judgment also overrides generic emotional tag guidance');
  ok(cachedContext.includes('今天先收住吧')&&!cachedContext.includes('喂，来啦'),'irrelevant reviewed greeting does not discard or pad the applicable generated fatigue sample');
  const authoredCacheRole={...cachedRole,systemPrompt:'称呼：小友\n判断习惯：先看书中的细节，不接管决定。'};
  const authoredCacheContext=buildHumanConversationContext('你好',[],{...authoredCacheRole,voiceSamples:{...cache,promptRevision:voicePromptRevision(authoredCacheRole)}});
  ok(authoredCacheContext.includes('小友')&&authoredCacheContext.includes('先看书中的细节')&&!authoredCacheContext.includes('先看实际限制'),'authored address and judgment override generated cache metadata');
  for(const prompt of [
    '【称呼】小友\n【判断习惯】先看书中的细节，不接管决定。',
    '• 称呼: 小友\n• 判断习惯: 先看书中的细节，不接管决定。',
    '  - 称谓：小友\n  - 【价值观】：先看书中的细节，不接管决定。',
  ]) {
    const formatted={...cachedRole,systemPrompt:prompt};
    const context=buildHumanConversationContext('今天好累',[],formatted);
    ok(context.includes('小友')&&context.includes('先看书中的细节')&&!context.includes('语言指纹与判断：反应快'),'alternate authored fields suppress generic tag overrides and reach the voice card');
    const withCache=buildHumanConversationContext('今天好累',[],{...formatted,voiceSamples:{...cache,promptRevision:voicePromptRevision(formatted)}});
    ok(!withCache.includes('先看实际限制')&&withCache.includes('先看书中的细节'),'generated cache never overrides explicitly formatted authored judgment');
    ok(emotionalExpressionGuidance('今天好累',[],formatted).includes('具体判断习惯'),'emotion guidance recognizes the same authored field formats as the voice card');
  }
  for(const field of ['疲惫回应: 先听具体内容，不催振作。','【疲惫回应】先听具体内容，不催振作。','• 疲惫回应：先听具体内容，不催振作。']) {
    const prompt=field+'\n庆祝反应：开心时一起庆祝。';
    ok(authoredReactionLines(prompt,'今天好累').length===1&&authoredReactionLines(prompt,'今天好累')[0].includes('不催振作'),'scene-specific authored reactions match Chinese/English colon and boxed formats');
    ok(authoredReactionLines(prompt,'今天去书店了').length===0,'unrelated authored scene reaction stays out of a neutral topic');
  }
  const quotedJudgment={...cachedRole,systemPrompt:'对话样本：用户说你好 → 你说判断习惯：先看实际限制。'};
  ok(buildHumanConversationContext('今天好累',[],quotedJudgment).includes('语言指纹与判断：反应快'),'metadata words inside a speech example do not suppress legitimate tag fallback');
  const partialReaction={...cachedRole,systemPrompt:'【庆祝反应】开心时短短庆祝，不催下一件。'};
  ok(buildHumanConversationContext('今天好累',[],partialReaction).includes('语言指纹与判断：反应快'),'one authored celebration reaction does not erase character identity in unrelated fatigue');
  ok(!buildHumanConversationContext('终于做完了',[],partialReaction).includes('语言指纹与判断：反应快'),'applicable authored reaction wins over generic character fallback');
  ok(buildHumanConversationContext('你好',[],{...partialReaction,systemPrompt:'【情境反应】按事实短短回应。'}).includes('按事实短短回应')&&!buildHumanConversationContext('你好',[],{...partialReaction,systemPrompt:'【情境反应】按事实短短回应。'}).includes('语言指纹与判断：反应快'),'general authored scene reaction remains authoritative in all topics');
  const staleCacheContext=buildHumanConversationContext('你好',[],{...cachedRole,systemPrompt:'你是星遥，人设已改。',voiceSamples:cache});
  ok(!staleCacheContext.includes('先看实际限制'),'stale independent voice metadata is not injected');
  const history = [{ role: 'assistant', content: '先说正事，我昨天喝了一杯不错的咖啡。' }, { role: 'assistant', content: '先说正事，我今天想去散步。' }];
  const voice = buildHumanConversationContext('说点别的', history, character);
  ok(voice.includes('[人物声音卡]') && voice.includes('表达示例') && voice.includes('稳定口癖'), 'tail voice card carries catchphrase, voice samples and character boundaries');
  const legacyVoice = buildHumanConversationContext('你好', [], { ...character, systemPrompt: '【性格示例】用户：我是新手。你：先做最小的一步。\n用户：真的？你：嗯，我在。\n称呼：固定叫用户小友。' });
  ok(legacyVoice.includes('先做最小的一步') && !legacyVoice.includes('嗯，我在') && legacyVoice.includes('称呼习惯：称呼：固定叫用户小友'), 'legacy voice retains one neutral example and explicit address without padding unrelated scenes');
  ok(!voice.includes('本轮换一种起句') && !voice.includes('回复必须同时有内容和态度') && !voice.includes('18～96'), 'character direction no longer duplicates rigid format and information requirements');
  const compiled = compileChatContext('角色身份', [{ key: 'voice', text: voice, priority: 99, placement: 'tail' }, { key: 'memory', text: '可选记忆'.repeat(2500), priority: 100 }], 6000);
  ok(compiled.prompt.endsWith(voice) && compiled.included.includes('voice') && compiled.partial.includes('memory'), 'compiler reserves voice space and moves it after large optional context');
  const assembled = withChatMessagingPolicy(compiled.prompt);
  const voiceSections=buildHumanConversationSections('今天好累',[],character);
  const tight=compileChatContext('人物正文'.repeat(200),[...voiceSections,{key:'large-memory',text:'可选回忆'.repeat(5000),priority:110}],6000);
  const finalPrompt=withChatMessagingPolicy(tight.prompt);
  ok(tight.included.includes('character-voice')&&finalPrompt.includes('[/人物声音卡]\n\n[手机私聊表达契约]'),'separately reserved character voice ends immediately before transport contract even with oversized optional memories');
  ok(tight.included.includes('human-conversation')&&voiceSections.find(section=>section.key==='human-conversation')?.tailOrder===0&&!voiceSections.find(section=>section.key==='human-conversation')?.text.includes('[人物声音卡]'),'current-turn guidance remains separately reserved from the character voice even under oversized optional memory');
  ok(tight.prompt.indexOf('[本轮交流的隐藏节奏]')<tight.prompt.lastIndexOf('[人物声音卡]'),'compiler reserves voice first by priority but renders it after current-turn guidance');
  ok(buildHumanConversationContext('今天好累',[],character).endsWith('[/人物声音卡]'),'standalone human context follows guidance with authoritative character voice');
  ok(assembled.indexOf('[人物声音卡]') < assembled.indexOf('[手机私聊表达契约]') && assembled.endsWith(CHAT_MESSAGING_INSTRUCTION), 'character voice occupies the final position before one shared protocol');
  ok(withChatMessagingPolicy(assembled).split('[手机私聊表达契约]').length === 2 && CHAT_MESSAGING_INSTRUCTION.split('\n').length <= 15, 'gateway reassembly remains idempotent and protocol is at most fifteen lines');
  const shares = Array.from({ length: 100 }, (_, i) => buildHumanConversationContext('今天仍然有点空闲', [], character, { turnNumber: i + 1, proactiveTopics: ['附近新开的书店'], lifeHints: ['附近新开的书店'] }).includes('打开一个具体小话题'));
  ok(shares.filter(Boolean).length > 5 && shares.filter(Boolean).length < 45 && !shares.some((s, i) => s && shares[i - 1]), 'stable probabilistic sharing has gaps and is not every three or five turns');
  ok(buildHumanConversationContext('今天仍然有点空闲', [], character, { turnNumber: 10 }) === buildHumanConversationContext('今天仍然有点空闲', [], character, { turnNumber: 10 }), 'reopening a turn does not reroll its proactive action');
  ok(recommendConversationTemperature('今天好难过', [], 0.5) > recommendConversationTemperature('今天有点空闲', [], 0.5), 'emotional conversation warms sampling rather than suppressing it');
  const situations = [
    ['昨天很难过，但现在已经好了','neutral'], ['昨天好累，现在缓过来了','neutral'],
    ['我刚才很生气，不过我现在没事了','neutral'], ['之前很委屈，但我现在不委屈了','neutral'],
    ['昨天好累，但现在好了，今天很开心','celebration'], ['昨天很开心，今天好难过','distress'],
    ['昨天很难过，现在好开心','celebration'], ['昨天好累，但现在好开心','celebration'],
    ['刚才很难过，现在好了，但还是好累','tired'], ['昨天很难过，现在好多了，但还是难过','distress'],
    ['昨天很难过，现在好了一点','distress'], ['昨天很难过，今天依然难过','distress'],
    ['今天很开心，又觉得好累','mixed'], ['昨天很难过，今天去买了橘子','distress'],
    ['朋友现在好了，我今天很难过','distress'], ['昨天难过，他说“现在好了”','distress'],
    ['今天好委屈', 'distress'], ['我失恋了', 'distress'], ['我不开心', 'distress'], ['今天好烦', 'distress'], ['我很担心', 'distress'],
    ['今天好累', 'tired'], ['我没精神，什么都不想做', 'tired'],
    ['我好开心', 'celebration'], ['终于把项目做完了', 'celebration'],
    ['终于做完了，但我好累', 'mixed'], ['我很开心，又忍不住想哭', 'mixed'],
    ['今天不累', 'neutral'], ['我不难过', 'neutral'], ['我没有不开心', 'neutral'], ['我不担心', 'neutral'], ['累积了很多经验', 'neutral'],
    ['怎么安慰难过的人？', 'neutral'], ['如果我失恋了呢', 'neutral'],
    ['如果我失恋了，会不会很难过', 'neutral'], ['帮我写一段台词，主角很难过', 'neutral'],
    ['他说“我好难过”', 'neutral'], ['帮我写一段失恋的台词', 'neutral'],
    ['今天去逛书店了', 'neutral'],
  ] as const;
  for (const [text, situation] of situations) ok(assessChatSituation(text) === situation, `situational clue respects current statement: ${text}`);
  const cold = { ...character, tags: ['高冷'], systemPrompt: '你是星遥。\n称呼：固定叫用户小友。\n判断习惯：先核对事实，不喜欢替别人猜动机。' };
  const warm = { ...character, tags: ['温柔'] };
  const sharp = { ...character, tags: ['毒舌'] };
  const distress = buildHumanConversationContext('今天被误解了，我特别委屈', [], warm);
  const recovered=buildHumanConversationContext('昨天好累，但现在已经好了',[{role:'user',content:'昨天好累'},{role:'assistant',content:'辛苦了，先歇歇。'}],warm);
  ok(recovered.includes('不因为前面聊过情绪就继续安慰')&&!recovered.includes('本轮疲惫')&&!recovered.includes('当前话里有疲惫的线索'),'production private context follows explicit recovery rather than sustaining previous comfort');
  const changedScene=buildCharacterVoiceCard(sceneRole,'昨天好累，但现在好了，今天很开心');
  ok(!changedScene.includes('今天先歇歇')&&!changedScene.includes('不要催振作'),'shared voice sample selection follows current state rather than old fatigue');
  ok(interactionMoment('昨天好累，现在很开心')==='celebration'&&interactionMoment('现在很累')==='tired','present-tense self expression without pronoun supplies enough confidence for current voice scene');
  ok(distress.includes('收住玩笑和庆祝表情') && distress.includes('付出被忽略') && !distress.includes('必须先发'), 'distress receives concrete attention instead of forced reaction and celebration');
  ok(buildHumanConversationContext('今天好累', [], character).includes('不催振作、不连问、不自动列任务'), 'energetic character reduces burden when tired');
  const tiredGuidance=buildHumanConversationContext('今天讲了半天还是没被听懂，真累。',[],warm);
  ok(tiredGuidance.includes('先少说一点')&&tiredGuidance.includes('你自己的反应')&&tiredGuidance.includes('不把少说话自动变成劝休息'),'tired guidance reduces reply burden and keeps empathy distinct from unrequested rest advice');
  ok(tiredGuidance.includes('不替任何一方断定表达或理解能力'),'being misunderstood does not establish the user or third party communication ability');
  ok(tiredGuidance.includes('也允许短短一个反应')&&tiredGuidance.includes('由人设与原话决定')&&tiredGuidance.includes('没讲明的就留白'),'private emotional rhythm permits personal reactions without a mandatory empathy receipt or invented explanation');
  ok(distress.includes('具体感受和原因由用户自己说明'),'distress leaves the user authority over their feeling rather than asking the role to diagnose it');
  ok(CHAT_MESSAGING_INSTRUCTION.includes('用户的具体感受与原因留给用户说明'),'shared private, proactive and actor messaging contract keeps inferred psychology separate from the character reaction');
  ok(buildHumanConversationContext('终于做完了，但我好累', [], warm).includes('感受不止一种'), 'mixed feelings are not flattened into compulsory positivity');
  ok(buildHumanConversationContext('我好委屈', [], cold).includes('先核对事实，不喜欢替别人猜动机') && buildHumanConversationContext('我好委屈', [], sharp).includes('荒唐或不公平'), 'specific authored judgment and tag fallback preserve different attention');
  ok(!buildHumanConversationContext('我好委屈', [], cold).includes('先分清事实与猜测'), 'specific judgment avoids duplicate generic personality guidance');
  ok(buildHumanConversationContext('换个话题，明天穿什么', [{ role: 'user', content: '我很难过' }], warm).includes('不因为前面聊过情绪就继续安慰'), 'old emotional context does not dictate a new neutral topic');
  const turns = [['嗯', '今天想去附近的书店看看还有什么新书'], ['啊？', '这个店我也挺喜欢，下次可以再聊'], ['哈哈', '你说的这个细节我刚才确实没想到']];
  const quietReceipts=[['嗯。','无关紧要。'],['嗯。','酸的，不必勉强。'],['嗯。','纸盒无用，拆了便是。']];
  ok(recentRhythmDirection(quietReceipts).includes('不必给每件小事判好坏'),'three quiet reaction-and-judgment turns receive specific soft rhythm feedback');
  ok(!recentRhythmDirection(quietReceipts.slice(0,2))&&!recentRhythmDirection([['嗯。'],['嗯。'],['嗯。']]),'one or two ordinary receipts and repeated pure reactions are not penalized for their length');
  ok(!recentRhythmDirection([['出门。','雨不妨碍练剑。'],['待在家。','下雨路上滑。'],['出门。','有约就去。']]),'substantive short answers are not mistaken for empty acknowledgement patterns');
  ok(recentRhythmDirection(turns).includes('如果这次没有独立的情绪反应') && recentRhythmDirection(turns).includes('有真实反应仍可以连发'), 'repeated shape receives optional guidance without forbidding real reactions');
  ok(!recentRhythmDirection(turns.slice(0, 2)) && !recentRhythmDirection([turns[0], ['嗯'], turns[2]]), 'one or two split replies and mixed rhythms trigger no shape rule');
  const rows = turns.flatMap((parts, i) => [{ role: 'user', content: `话题${i}` }, ...parts.map(content => ({ role: 'assistant', content, replyToUserMessageId: `source-${i}` }))]);
  ok(JSON.stringify(collectRecentReplyTurns(rows)) === JSON.stringify(turns), 'saved multipart messages are grouped by source, not counted as separate turns');
  ok(collectRecentReplyTurns([{ role: 'assistant', content: '嗯' }, { role: 'assistant', content: '好呀' }]).length === 2, 'legacy bubbles without a source do not invent multipart turns');
  ok(collectRecentReplyTurns(Array.from({ length: 10000 }, (_, i) => ({ role: 'assistant', content: `消息${i}`, replyToUserMessageId: `id${i}` }))).length === 4, 'shape context remains bounded with long history');
  const rhythmContext = buildHumanConversationContext('现在想聊明天的安排', [], cold, { recentReplyTurns: turns });
  ok(rhythmContext.includes('最近三轮都先短后长') && rhythmContext.includes('人物判断依据') && rhythmContext.includes('当前人设'), 'actual context combines reviewed character values with soft rhythm guidance');
  for (const turnNumber of [1, 18, 100, 10000]) {
    const longContext = buildHumanConversationContext('今天去逛书店了', [{ role: 'assistant', content: '很高兴为您服务，我是你的助理' }], cold, { turnNumber });
    ok(longContext.includes('固定叫用户小友') && longContext.includes('先核对事实') && !longContext.includes('很高兴为您服务'), `reviewed voice stays authoritative over neutralized history at turn ${turnNumber}`);
  }
  ok(!CHAT_MESSAGING_INSTRUCTION.includes('自然的默认节奏是先') && CHAT_MESSAGING_INSTRUCTION.includes('不把“反应＋内容”变成每轮固定模板'), 'shared transport no longer prescribes a universal two-message structure');
  const outgoing: any[] = [];
  const originalFetch = window.fetch;
  window.fetch = async (_url, init) => {
    outgoing.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: '哈哈😂---怎么了？？谁说的？！' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const params = { apiKey: 'isolated-test-key', systemPrompt: compiled.prompt, message: '你好', history: [], character: { model: { provider: 'deepseek', model: 'deepseek-v4-flash' } } };
    const reply = await sendMessage({ ...params, retryHint: '保留原有标点' });
    const system = outgoing[0].messages[0].content;
    ok(reply.content === '哈哈😂---怎么了？？谁说的？！', 'actual direct model transport returns emotional text unchanged');
    ok(system.split('[手机私聊表达契约]').length === 2 && system.split('保留原有标点').length === 2 && !system.includes('Recent replies are already visible'), 'BYOK receives one contract and one retry hint without duplicate repetition guard');
    await sendMessage({ ...params, structuredOutput: true });
    ok(!outgoing[1].messages[0].content.includes('[手机私聊表达契约]'), 'structured assistant plans are exempt from ordinary role chat rules');
    ok(outgoing.length === 2, 'local expression handling adds no model calls');
    window.fetch = async (_url, init) => {
      outgoing.push(JSON.parse(String(init?.body)));
      const content = JSON.stringify({ tags: ['高冷'], signature: '先看事实', greeting: '说吧', systemPrompt: '你是星遥。\n判断习惯：先看事实，不猜别人动机。\n对话样本：用户说谢谢 → 你说嗯。' });
      return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
    };
    const generated = await generateCharacterPrompt({ apiKey: 'isolated-test-key', characterName: '星遥', fields: { personality: '先核对事实，有自己的判断' } });
    const generationSystem = outgoing.at(-1).messages[0].content;
    ok(generationSystem.includes('判断习惯：') && generationSystem.includes('不全写成“先啊一声再安慰”') && generated.systemPrompt.includes('先看事实'), 'actual character generation requests distinct judgment and varied scene examples');
    ok(outgoing.length === 3, 'adding character judgment requires no extra generation pass');
  } finally { window.fetch = originalFetch; }
  let attempts = 0;
  const proactiveReplies = ['很高兴为您服务','今天窗边的光很好看😂'];
  const proactivePayloads:any[]=[];
  window.fetch = async (_url,init) => {proactivePayloads.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:proactiveReplies[Math.min(attempts++,1)]},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
  try {
    const params = {apiKey:'isolated-test-key',systemPrompt:sceneRole.systemPrompt,characterName:'小林',lastMessages:[],voiceCard:neutralCard,affinity:0,mood:70};
    const reply = await generateProactiveMessage(params);
    ok(attempts === 2 && reply === proactiveReplies[1], 'actual proactive transport retries failed quality once');
    ok(proactivePayloads.every(p=>!p.messages[0].content.includes('用户已经有一段时间没有给你发消息了')&&p.messages[0].content.includes('没有记录时不预设失联或久别')),'proactive requests with no prior messages do not invent a gap or reunion');
    ok(proactivePayloads.every(p=>p.messages[0].content.includes('不是人设关系的起点')&&!p.messages[0].content.includes('你和用户目前相处在')),'initial and retried proactive payloads preserve authored familiarity despite zero app affinity');
    ok(proactivePayloads.every(p=>p.messages[0].content.includes('喂，来啦')&&!p.messages[0].content.includes('今天先歇歇')&&!p.messages[0].content.includes('我也喜欢你')),'initial and retried proactive requests preserve neutral voice without borrowing past scene samples');
    ok(proactivePayloads.every(p=>p.messages[0].content.split('对话样本：用户说你好').length===2)&&params.systemPrompt.includes('今天先歇歇'),'proactive source examples occur only once in the card without mutating the original persona');
    attempts=0;proactiveReplies[1]='很高兴为您服务';
    ok(await generateProactiveMessage(params) === '' && attempts === 2, 'two failed proactive drafts produce no message');
    attempts=0;proactivePayloads.length=0;proactiveReplies[0]='我一般会盯着锁屏等它主动交代。';proactiveReplies[1]='这我挺喜欢的。';
    ok(await generateProactiveMessage(params)==='这我挺喜欢的。'&&attempts===2,'proactive habitual self-report consumes only the existing one-retry budget');
    ok(proactivePayloads[1].messages.at(-1).content.includes('缺少独立来源'),'proactive retry targets the source risk rather than asking for a generic tone change');
    attempts=0;proactiveReplies[1]=proactiveReplies[0];
    ok(await generateProactiveMessage(params)===''&&attempts===2,'two unresolved proactive self-report risks produce no canned replacement');
    attempts=0;
    ok(await generateProactiveMessage({...params,systemPrompt:'生活习惯：平时盯着锁屏发呆。'})===proactiveReplies[0]&&attempts===1,'authored recurring character habit never spends a quality retry');
    attempts=0;proactiveReplies[0]=inventedMoon;proactiveReplies[1]='忽然想跟你聊两句。';
    ok(await generateProactiveMessage(params)===proactiveReplies[1]&&attempts===2,'an actual proactive call repairs invented moonlight within the existing retry budget');
    attempts=0;proactiveReplies[1]=inventedMoon;
    ok(await generateProactiveMessage(params)===''&&attempts===2,'two invented current scenes are omitted instead of becoming a canned greeting');
    attempts=0;proactiveReplies[0]='我听到你的笑声了。';proactiveReplies[1]='想到你说的开心，我也开心。';
    ok(await generateProactiveMessage(params)===proactiveReplies[1]&&attempts===2,'actual proactive generation uses its existing retry for an unsupported user sound');
    attempts=0;proactiveReplies[1]=proactiveReplies[0];
    ok(await generateProactiveMessage(params)===''&&attempts===2,'two unsupported audio drafts produce no proactive message or invented replacement');
  } finally {window.fetch=originalFetch;}
  let groupCalls = 0;const actorPayloads:any[]=[];
  let groupDrafts = [JSON.stringify({turns:[{speaker:'小林',content:'今天聊聊吧'}]}),'很高兴为您服务','（顿了顿，把手机放下）今天\n想起你'];
  window.fetch = async (_url,init) => {actorPayloads.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:groupDrafts[Math.min(groupCalls++,groupDrafts.length-1)]},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
  try {
    const params = {apiKey:'isolated-test-key',groupName:'测试群',members:[{id:'lin',name:'小林',persona:'自然聊天的朋友',tags:['温柔'],relationshipContext:buildRelationshipToneContext(0,70)}],history:[],userMessage:'你理解错了'};
    const group = await generateGroupTurn(params);
    ok(groupCalls === 3 && group.turns.length === 1 && group.turns[0].content === '今天想起你', 'actual group actor retries only its failed draft and cleans actions/newlines');
    ok(!actorPayloads[0].messages[0].content.includes('不是人设关系的起点')&&actorPayloads.slice(1).every(p=>p.messages[0].content.includes('不是人设关系的起点')),'zero-affinity origin belongs to the actor request and retry, without leaking into the shared group director');
    ok(!actorPayloads[0].messages[0].content.includes('用户正在纠正理解')&&actorPayloads[1].messages[0].content.includes('用户正在纠正理解'),'group emotional guidance belongs to the selected actor, not the shared director');
    groupCalls=0;groupDrafts=[JSON.stringify({turns:[{speaker:'小林',content:'很高兴为您服务'}]}),'很高兴为您服务'];
    const failed = await generateGroupTurn(params);
    ok(failed.turns.length === 0 && groupCalls === 3, 'group fallback never restores an unchecked director draft');
    groupCalls=0;groupDrafts=[JSON.stringify({turns:[{speaker:'小林',content:'我一般会盯着锁屏等它主动交代。'}]}),'我一般会盯着锁屏等它主动交代。','脑子弹了个窗又被自己点掉了。'];
    const habitGroup=await generateGroupTurn(params);
    ok(groupCalls===3&&habitGroup.turns.length===1&&habitGroup.turns[0].content===groupDrafts[2],'group actor repairs a habitual self-report within its existing per-actor retry budget');
    groupCalls=0;actorPayloads.length=0;groupDrafts=[JSON.stringify({turns:[{speaker:'小林',content:'顺。'}]}),'顺。'];
    const narrow=await generateGroupTurn({...params,userMessage:'不用整段重写，就说这句顺不顺',members:[{...params.members[0],persona:sceneRole.systemPrompt,voiceCard:buildCharacterVoiceCard(sceneRole,'不用整段重写，就说这句顺不顺')}]});
    ok(narrow.turns.length===1&&actorPayloads[1].messages[0].content.includes('这轮只要一个限定判断'),'actual group actor receives limited judgment scope without an extra model pass');
    ok(actorPayloads[1].messages[0].content.indexOf('这轮只要一个限定判断')<actorPayloads[1].messages[0].content.indexOf('[人物声音卡]'),'individual group actor voice follows current-turn guidance without entering the shared director');
    ok(!actorPayloads[0].messages[0].content.includes('[人物声音卡]')&&!actorPayloads[0].messages[0].content.includes('这轮只要一个限定判断')&&!actorPayloads[1].messages[0].content.includes('我也喜欢你'),'scene voice and direct response guidance stay actor-owned rather than entering the shared director');
    ok(!actorPayloads[1].messages[0].content.includes('今天先歇歇')&&!actorPayloads[1].messages[0].content.includes('对话样本：用户说你好'),'an unmatched group judgment retains authored identity without injecting greetings or fatigue scenes');
    for(const [role,persona,alias] of [['guyuena',GU_YUE_NA_CARE,'舞麟'],['luxueqi',LU_XUE_QI_PRESET.systemPrompt,'小凡']] as const){
      const actor={...params.members[0],persona,storyPartnerRole:role,voiceCard:buildCharacterVoiceCard({name:'小林',tags:[],systemPrompt:persona},'我想你了'),distantVoiceCard:buildCharacterVoiceCard({name:'小林',tags:[],systemPrompt:persona},'我想你了',[],{distant:true})};
      groupCalls=0;actorPayloads.length=0;groupDrafts=[JSON.stringify({turns:[{speaker:'小林',content:'何事？'}]}),'何事？'];
      await generateGroupTurn({...params,userMessage:'我想你了',members:[actor]});
      const coldPayload=actorPayloads[1].messages[0].content;
      ok(coldPayload.includes('当前用户未在本群认领')&&!coldPayload.includes('声音样本（')&&!coldPayload.includes('人物情境反应'),role+' actual group actor gets cold identity without lover samples');
      ok(!actorPayloads[0].messages[0].content.includes('当前用户未在本群认领'),role+' group identity is not leaked into the shared director');
      groupCalls=0;actorPayloads.length=0;groupDrafts=[JSON.stringify({turns:[{speaker:'小林',content:'我也想你。'}]}),'我也想你。'];
      await generateGroupTurn({...params,userMessage:'今天就是想你了',history:[{role:'user',content:'我是'+alias}],members:[actor]});
      ok(actorPayloads[1].messages[0].content.includes('当前用户已在本群直接认领'),role+' actual group actor accepts that group user declaration rather than a private mood score');
    }
  } finally {window.fetch=originalFetch;}
  return { checks };
}
(window as any).chatExpression = { run };
