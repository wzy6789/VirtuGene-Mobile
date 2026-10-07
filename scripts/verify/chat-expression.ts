import { polishChatResponse, checkReplyQuality } from '../../src/lib/reply-quality';
import { splitReplyParts, normalizeChatResponse, mergeReplyParts, computeMessageDelays } from '../../src/lib/chat-pacing';
import { streamedReplyParts } from '../../src/lib/chat-stream';
import { stripRoleplayActions } from '../../src/lib/ai/text';
import { buildHumanConversationContext, recommendConversationTemperature } from '../../src/lib/chat-humanizer';
import { compileChatContext } from '../../src/lib/chat-context-compiler';
import { planCharacterIntent } from '../../src/lib/character-intent';
import { buildChatConversationStateContext, emptyChatConversationState } from '../../src/lib/chat-conversation-state';
import { assessChatSituation, collectRecentReplyTurns, recentRhythmDirection } from '../../src/lib/chat-expression-guidance';
import { sendMessage } from '../../src/lib/ai/deepseek';
import { generateCharacterPrompt } from '../../src/lib/ai/character-generator';
import { CHAT_MESSAGING_INSTRUCTION, withChatMessagingPolicy } from '../../server/chat-messaging-policy.mjs';
import { inspectChatOutput } from '../../src/lib/chat-output-quality';
import { generateProactiveMessage } from '../../src/lib/ai/proactive-chat';
import { generateGroupTurn } from '../../src/lib/ai/group-chat';
import { allowsDramaticReply, isDirectAffection, directChatGuidance } from '../../src/lib/chat-expression-boundary';
import { buildSceneTimeContext } from '../../src/lib/chat-context';
import { normalizeVoiceLines } from '../../src/lib/character-voice';
import { interactionMoment, emotionalExpressionGuidance, selectVoiceExamples, authoredReactionLines } from '../../src/lib/chat-emotional-expression';

async function run() {
  let checks = 0;
  const ok = (value: unknown, label: string) => { if (!value) throw Error(label); checks++; console.log(`ok ${label}`); };
  const punctuation = '怎么了？？谁说的？！';
  for(const [text,moment] of [['你好棒','praise'],['你很靠谱！','praise'],['我爱你','affection'],['我不同意','disagreement'],['你理解错了','disagreement'],['对不起，我刚才说重了','repair'],['今天好累','tired'],['终于搞定了','celebration'],['她说“对不起”','ordinary'],['我不爱你','ordinary'],['你一点也不厉害','ordinary'],['今天去书店了','ordinary'],['如果你误会我呢','ordinary'],['终于做完了，但我好累','ordinary']] as const)ok(interactionMoment(text)===moment,`interaction clue respects literal source and mixed feelings: ${text}`);
  const profiles=['专业','搭档','温柔','元气','俏皮'];
  const contexts=profiles.map(tag=>emotionalExpressionGuidance('你好棒',[],{tags:[tag],systemPrompt:''}));
  ok(new Set(contexts).size===5&&contexts.every(s=>s.includes('被夸')),'same compliment has five distinct reaction habits without fixed reply scripts');
  for(const text of ['你好棒','我爱你','我不同意','对不起','今天好累','终于搞定了']){
    const variations=profiles.map(tag=>emotionalExpressionGuidance(text,[],{tags:[tag],systemPrompt:''}));
    ok(new Set(variations).size===5&&variations.every(s=>s.length<500),`reaction habits differ by personality and stay bounded: ${text}`);
  }
  const friction=[{role:'user',content:'你理解错了'}];
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
  ok(selectVoiceExamples(manyExamples,'今天好累')[0]===manyExamples[4]&&selectVoiceExamples(manyExamples,'今天好累').length===3,'relevant late voice example gets prompt space ahead of unrelated first examples');
  ok(selectVoiceExamples(manyExamples).length===5&&manyExamples[0].includes('你好'),'general voice card retains scene variety without mutating samples');
  const sevenLines=['称呼：你','判断习惯：先核对事实',...manyExamples];
  ok(normalizeVoiceLines(sevenLines).length===7&&normalizeVoiceLines(sevenLines.slice(0,4)).length===4,'expanded cache accepts five examples while retaining old two-example format');
  const loop=[['辛苦了','先歇歇'],['辛苦了','慢慢说'],['辛苦了','不用着急']];
  ok(emotionalExpressionGuidance('今天去书店了',[],{tags:['温柔'],systemPrompt:''},loop).includes('同类安慰开场'),'repeated comfort structure receives soft guidance instead of another canned comfort');
  ok(!emotionalExpressionGuidance('今天去书店了',[],{tags:['温柔'],systemPrompt:'',catchphrase:'辛苦了，亲爱的'},loop).includes('同类安慰开场'),'explicit authored catchphrase is exempt from comfort-loop guidance');
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
  for (const [raw,expected] of [['你好\r\n再见','你好再见'],['hello\r\nworld','hello world'],['hello\n\nworld','hello world'],['你\n好吗？','你好吗？'],['API\n2','API 2'],['hello \n world','hello world'],['你好\n😂','你好😂'],['！！\n真的吗？？','！！真的吗？？'],['预算（不含税）\n两千','预算（不含税）两千'],['Hello world','Hello world'],['（低声说）你好','你好'],['（轻声说）你好','你好']]) {
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
  const history = [{ role: 'assistant', content: '先说正事，我昨天喝了一杯不错的咖啡。' }, { role: 'assistant', content: '先说正事，我今天想去散步。' }];
  const voice = buildHumanConversationContext('说点别的', history, character);
  ok(voice.includes('[人物声音卡]') && voice.includes('表达示例') && voice.includes('稳定口癖'), 'tail voice card carries catchphrase, voice samples and character boundaries');
  const legacyVoice = buildHumanConversationContext('你好', [], { ...character, systemPrompt: '【性格示例】用户：我是新手。你：先做最小的一步。\n用户：真的？你：嗯，我在。\n称呼：固定叫用户小友。' });
  ok(legacyVoice.includes('先做最小的一步') && legacyVoice.includes('嗯，我在') && legacyVoice.includes('称呼习惯：称呼：固定叫用户小友'), 'voice card also reads existing preset dialogues and explicit address preferences');
  ok(!voice.includes('本轮换一种起句') && !voice.includes('回复必须同时有内容和态度') && !voice.includes('18～96'), 'character direction no longer duplicates rigid format and information requirements');
  const compiled = compileChatContext('角色身份', [{ key: 'voice', text: voice, priority: 99, placement: 'tail' }, { key: 'memory', text: '可选记忆'.repeat(2500), priority: 100 }], 6000);
  ok(compiled.prompt.endsWith(voice) && compiled.included.includes('voice') && compiled.partial.includes('memory'), 'compiler reserves voice space and moves it after large optional context');
  const assembled = withChatMessagingPolicy(compiled.prompt);
  ok(assembled.indexOf('[人物声音卡]') < assembled.indexOf('[手机私聊表达契约]') && assembled.endsWith(CHAT_MESSAGING_INSTRUCTION), 'character voice occupies the final position before one shared protocol');
  ok(withChatMessagingPolicy(assembled).split('[手机私聊表达契约]').length === 2 && CHAT_MESSAGING_INSTRUCTION.split('\n').length <= 15, 'gateway reassembly remains idempotent and protocol is at most fifteen lines');
  const shares = Array.from({ length: 100 }, (_, i) => buildHumanConversationContext('今天仍然有点空闲', [], character, { turnNumber: i + 1, proactiveTopics: ['附近新开的书店'], lifeHints: ['附近新开的书店'] }).includes('打开一个具体小话题'));
  ok(shares.filter(Boolean).length > 5 && shares.filter(Boolean).length < 45 && !shares.some((s, i) => s && shares[i - 1]), 'stable probabilistic sharing has gaps and is not every three or five turns');
  ok(buildHumanConversationContext('今天仍然有点空闲', [], character, { turnNumber: 10 }) === buildHumanConversationContext('今天仍然有点空闲', [], character, { turnNumber: 10 }), 'reopening a turn does not reroll its proactive action');
  ok(recommendConversationTemperature('今天好难过', [], 0.5) > recommendConversationTemperature('今天有点空闲', [], 0.5), 'emotional conversation warms sampling rather than suppressing it');
  const situations = [
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
  ok(distress.includes('收住玩笑和庆祝表情') && distress.includes('付出被忽略') && !distress.includes('必须先发'), 'distress receives concrete attention instead of forced reaction and celebration');
  ok(buildHumanConversationContext('今天好累', [], character).includes('不催振作、不连问、不自动列任务'), 'energetic character reduces burden when tired');
  ok(buildHumanConversationContext('终于做完了，但我好累', [], warm).includes('感受不止一种'), 'mixed feelings are not flattened into compulsory positivity');
  ok(buildHumanConversationContext('我好委屈', [], cold).includes('先分清事实与猜测') && buildHumanConversationContext('我好委屈', [], sharp).includes('荒唐或不公平'), 'different personalities attend to different aspects of the same event');
  ok(buildHumanConversationContext('换个话题，明天穿什么', [{ role: 'user', content: '我很难过' }], warm).includes('不因为前面聊过情绪就继续安慰'), 'old emotional context does not dictate a new neutral topic');
  const turns = [['嗯', '今天想去附近的书店看看还有什么新书'], ['啊？', '这个店我也挺喜欢，下次可以再聊'], ['哈哈', '你说的这个细节我刚才确实没想到']];
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
  window.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:proactiveReplies[Math.min(attempts++,1)]},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
  try {
    const params = {apiKey:'isolated-test-key',systemPrompt:'你是自然说话的朋友',characterName:'小林',lastMessages:[]};
    const reply = await generateProactiveMessage(params);
    ok(attempts === 2 && reply === proactiveReplies[1], 'actual proactive transport retries failed quality once');
    attempts=0;proactiveReplies[1]='很高兴为您服务';
    ok(await generateProactiveMessage(params) === '' && attempts === 2, 'two failed proactive drafts produce no message');
  } finally {window.fetch=originalFetch;}
  let groupCalls = 0;const actorPayloads:any[]=[];
  let groupDrafts = [JSON.stringify({turns:[{speaker:'小林',content:'今天聊聊吧'}]}),'很高兴为您服务','（顿了顿，把手机放下）今天\n想起你'];
  window.fetch = async (_url,init) => {actorPayloads.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:groupDrafts[Math.min(groupCalls++,groupDrafts.length-1)]},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});};
  try {
    const params = {apiKey:'isolated-test-key',groupName:'测试群',members:[{id:'lin',name:'小林',persona:'自然聊天的朋友',tags:['温柔']}],history:[],userMessage:'你理解错了'};
    const group = await generateGroupTurn(params);
    ok(groupCalls === 3 && group.turns.length === 1 && group.turns[0].content === '今天想起你', 'actual group actor retries only its failed draft and cleans actions/newlines');
    ok(!actorPayloads[0].messages[0].content.includes('本轮分歧')&&actorPayloads[1].messages[0].content.includes('本轮分歧'),'group emotional guidance belongs to the selected actor, not the shared director');
    groupCalls=0;groupDrafts=[JSON.stringify({turns:[{speaker:'小林',content:'很高兴为您服务'}]}),'很高兴为您服务'];
    const failed = await generateGroupTurn(params);
    ok(failed.turns.length === 0 && groupCalls === 3, 'group fallback never restores an unchecked director draft');
  } finally {window.fetch=originalFetch;}
  return { checks };
}
(window as any).chatExpression = { run };
