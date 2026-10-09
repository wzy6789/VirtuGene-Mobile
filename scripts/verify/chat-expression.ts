import { polishChatResponse, checkReplyQuality, requestsRepetition, isLongFormRequest } from '../../src/lib/reply-quality';
import { splitReplyParts, normalizeChatResponse, mergeReplyParts, computeMessageDelays } from '../../src/lib/chat-pacing';
import { streamedReplyParts } from '../../src/lib/chat-stream';
import { stripRoleplayActions } from '../../src/lib/ai/text';
import { buildCharacterVoiceCard, buildHumanConversationSections, buildHumanConversationContext, recommendConversationTemperature, chooseConversationAction } from '../../src/lib/chat-humanizer';
import { compileChatContext } from '../../src/lib/chat-context-compiler';
import { planCharacterIntent } from '../../src/lib/character-intent';
import { buildChatConversationStateContext, emptyChatConversationState, detectChatIntent, detectTopicMove, updateChatConversationState, inferReplyAction } from '../../src/lib/chat-conversation-state';
import { assessChatSituation, collectRecentReplyTurns, recentRhythmDirection, recentQuestionDirection, replyContainsSubstantiveQuestion } from '../../src/lib/chat-expression-guidance';
import { sendMessage } from '../../src/lib/ai/deepseek';
import { generateCharacterPrompt } from '../../src/lib/ai/character-generator';
import { CHAT_MESSAGING_INSTRUCTION, withChatMessagingPolicy } from '../../server/chat-messaging-policy.mjs';
import { inspectChatOutput } from '../../src/lib/chat-output-quality';
import { generateProactiveMessage } from '../../src/lib/ai/proactive-chat';
import { generateGroupTurn } from '../../src/lib/ai/group-chat';
import { allowsDramaticReply, isDirectAffection, isViewExchange, directChatGuidance } from '../../src/lib/chat-expression-boundary';
import { buildSceneTimeContext, buildRelationshipContext, buildRelationshipToneContext, buildUserEmotionContext } from '../../src/lib/chat-context';
import { normalizeVoiceLines, voicePromptRevision, voiceIdentityWithoutExamples } from '../../src/lib/character-voice';
import { interactionMoment, emotionalExpressionGuidance, selectVoiceExamples, authoredReactionLines, voiceExampleUserText } from '../../src/lib/chat-emotional-expression';
import {buildChatHistoryWindow,boundChatHistory} from '../../src/lib/chat-history-window';

async function run() {
  // These are risk checks, not blanket factual acceptance: a matching authored
  // habit only suppresses this one warning and cannot validate added details.
  let checks = 0;
  const ok = (value: unknown, label: string) => { if (!value) throw Error(label); checks++; console.log(`ok ${label}`); };
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
  for(const mode of ['private','proactive','group'] as const) {
    const context={mode,userMessage:'我把手机拿起来又忘了要干嘛，离谱',persona:'你是小林，偏爱推理故事。'};
    ok(inspectChatOutput('我一般会盯着锁屏等它主动交代。',context).check.issue==='self-report-risk',`${mode} flags a recurring physical self-report absent from independent sources`);
    ok(inspectChatOutput('脑子弹了个窗又被自己点掉了。',context).check.ok,`${mode} preserves a playful analogy without invented shared experience`);
    ok(inspectChatOutput('我喜欢推理故事。',context).check.ok,`${mode} permits a present preference without a biography warning`);
    ok(inspectChatOutput('我一般会盯着锁屏等它主动交代。',{...context,independentCharacterRecords:['平时经常盯着锁屏发呆。']}).check.ok,`${mode} accepts an independently supplied recurring character habit for this risk check`);
    ok(inspectChatOutput('我一般会盯着锁屏等它主动交代。',{...context,persona:'对话样本：用户说忘事 → 你说我一般会盯着锁屏等它主动交代。'}).check.issue==='self-report-risk',`${mode} does not turn a voice example into independent habit evidence`);
  }
  ok(inspectChatOutput('我一般会盯着锁屏等它主动交代。',{mode:'private',userMessage:'演一个总盯着手机发呆的人，随便写句台词。'}).check.ok,'explicit fictional creation retains invented in-character habits');
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
  for(const message of ['你说去书店还是在家看电影','那你更喜欢书店还是电影院','你会选清汤还是辣锅','你觉得这个杯子买白色还是蓝色','你更喜欢“白色”还是“蓝色”']){
    ok(isViewExchange(message)&&detectChatIntent(message)==='question',`unpunctuated choice invitation is a personal question: ${message}`);
    ok(buildHumanConversationContext(message,[],undefined,{adviceStyle:'listen'}).includes('用户邀请你说真实看法'),`listening preference preserves an explicit later choice invitation: ${message}`);
    ok(directChatGuidance(message,[],[]).includes('给一个你自己喜欢的理由'),`a choice answer can express character preference rather than a prescribed correct plan: ${message}`);
  }
  for(const message of ['朋友说你选书店还是电影院','朋友说“你更喜欢书店还是电影院”','“你更喜欢书店还是电影院”','如果你更喜欢书店还是电影院','不用说你选书店还是电影院','我在想去书店还是电影院','你说话快还是慢都行','你觉得开心还是难过都可以'])ok(!isViewExchange(message),`reported, hypothetical and permitted alternatives do not become a choice question: ${message}`);
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
  for(const text of ['他说“我爱你”','如果我爱你呢','帮我写情书，我爱你','我爱你这句话是什么意思'])ok(!isDirectAffection(text),`discussion of feeling is not personal affection: ${text}`);
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
  ok(authoredReactionLines(authored,'今天好累').length===1&&authoredReactionLines(authored,'今天好累')[0].includes('疲惫回应'),'authored reaction fields are selected for the current situation');
  const ownReaction=emotionalExpressionGuidance('你好棒',[],{tags:['温柔'],systemPrompt:authored});
  ok(ownReaction.includes('人物写明')&&!ownReaction.includes('反过来夸'),'authored habits override generic tag reaction defaults');
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
  ok(tiredGuidance.includes('不必先复述用户整句感受')&&tiredGuidance.includes('用人物自己的口语表达反应'),'private emotional rhythm offers a concrete personal reaction rather than a mandatory empathy receipt');
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
    const params = {apiKey:'isolated-test-key',systemPrompt:sceneRole.systemPrompt,characterName:'小林',lastMessages:[],voiceCard:neutralCard};
    const reply = await generateProactiveMessage(params);
    ok(attempts === 2 && reply === proactiveReplies[1], 'actual proactive transport retries failed quality once');
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
  } finally {window.fetch=originalFetch;}
  let groupCalls = 0;const actorPayloads:any[]=[];
  let groupDrafts = [JSON.stringify({turns:[{speaker:'小林',content:'今天聊聊吧'}]}),'很高兴为您服务','（顿了顿，把手机放下）今天\n想起你'];
  window.fetch = async (_url,init) => {actorPayloads.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:groupDrafts[Math.min(groupCalls++,groupDrafts.length-1)]},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
  try {
    const params = {apiKey:'isolated-test-key',groupName:'测试群',members:[{id:'lin',name:'小林',persona:'自然聊天的朋友',tags:['温柔']}],history:[],userMessage:'你理解错了'};
    const group = await generateGroupTurn(params);
    ok(groupCalls === 3 && group.turns.length === 1 && group.turns[0].content === '今天想起你', 'actual group actor retries only its failed draft and cleans actions/newlines');
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
  } finally {window.fetch=originalFetch;}
  return { checks };
}
(window as any).chatExpression = { run };
