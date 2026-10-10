import { db, type Character, type MemoryItem, type Session, type Message } from '../../src/db';
import { initSeedCharacters, PRESET_CHARACTERS } from '../../src/lib/seed-init';
import { GU_YUE_NA_CARE, reviseGuYueNaPresetPrompt, withGuYueNaCare } from '../../src/lib/gu-yue-na-personality';
import {withDouluoRelations} from '../../src/lib/douluo-relations';
import {DOULUO_REUNION_TIMELINE} from '../../src/lib/douluo-timeline';
import {buildCharacterVoiceCard,buildHumanConversationSections} from '../../src/lib/chat-humanizer';
import {buildGuYueNaRecallCard,buildGuYueNaDailyFamiliarity} from '../../src/lib/gu-yue-na-canon';
import {guYueNaPromptForTurn} from '../../src/lib/gu-yue-na-runtime';

const report = window.fetch.bind(window);
let count = 0;
function check(ok: unknown, label: string): void { if (!ok) throw Error(label); count += 1; }

async function run(): Promise<void> {
  await db.delete(); await db.open();
  const original = {
    id: 'owned', createdBy: 'owner', name: '我的古月娜', avatar: '🌙',
    systemPrompt: '用户自己加的性格要求：爱看书。', sourcePresetId: 'preset-guyuena',
    tags: ['我的标签'], signature: '我的签名', greeting: '原来开场',
    createdAt: 1, isPreset: false, isCustom: true,
  } as Character;
  const oldGreeting = '……你是谁？我在找一个人。他叫唐舞麟——我等了他很久，也找了他很久。你……见过他吗？';
  const legacy = {
    ...original, id: 'legacy', greeting: oldGreeting,
    systemPrompt: '用户自己补充：喜欢书店。\n**【此刻的节点】**你正在寻找唐舞麟。\n**【相认反应（至关重要）】**先问他是否真的是唐舞麟。\n**【确认之后】**重新相认。\n【与舞麟的共同记忆】\n- 极北·永冻：唐舞麟用黄金龙枪刺入你的心脏。\n- 万年后·重逢：初次重逢。\n- 说话风格（两副嗓子）：用强硬命令表达爱。\n- 称呼：叫他"舞麟"或直呼"唐舞麟"；绝不对其他人亲近\n',
  } as Character;
  const anotherOwner = { ...legacy, id: 'another-owner', createdBy: 'another-user' };
  await db.characters.bulkAdd([original, legacy, anotherOwner, { ...original, id: 'unrelated', sourcePresetId: undefined }]);
  await db.sessions.add({ id: 'session', userId: 'owner', characterId: 'owned', type: 'private', summary: '已有摘要', createdAt: 1, updatedAt: 1 } as Session);
  await db.messages.add({ id: 'message', sessionId: 'session', role: 'user', content: '我要去商场', createdAt: 1 } as Message);
  await db.memories.add({ id: 'memory', userId: 'owner', characterId: 'owned', content: '用户喜欢桂花糕', type: 'auto', createdAt: 1 } as MemoryItem);
  const snapshot = JSON.stringify(await Promise.all([db.sessions.toArray(), db.messages.toArray(), db.memories.toArray(), db.memoryClaims.toArray(), db.characterStates.toArray()]));
  await initSeedCharacters();
  const updated = (await db.characters.get('owned'))!;
  const migrated = (await db.characters.get('legacy'))!;
  const preset = (await db.characters.get('preset-guyuena'))!;
  check(updated.systemPrompt.startsWith(original.systemPrompt), 'user-added personality preserved');
  check(updated.systemPrompt.includes('已婚') && updated.systemPrompt.includes('立刻相信'), 'married timeline and immediate trust');
  check(updated.systemPrompt.includes('才按爱人亲近') && updated.systemPrompt.includes('其他聊天者一律冷漠'), 'spouse, family and outsiders separated');
  check(updated.systemPrompt.includes('共享的笑意') && updated.systemPrompt.includes('具体处境'), 'warmth and familiar humour remain grounded in the current situation');
  check(updated.systemPrompt.includes('引用与小说提问不算认领'), 'quotes do not imply identity');
  check(updated.systemPrompt.includes('私聊、群聊、星域与朋友圈'), 'same personality in all modes');
  check(updated.systemPrompt.includes('可以偶尔叫“老公”') && updated.systemPrompt.includes('不每句话都加称呼'), 'intimate address remains situational');
  check(updated.systemPrompt.includes('不让他不断猜') && updated.systemPrompt.includes('不是背诵原著台词'), 'confirmed affection without rote quotations');
  check(updated.systemPrompt.includes('普通私聊保持像发消息') && updated.systemPrompt.includes('不是新增共同经历'), 'chat style does not invent memories');
  check(!updated.systemPrompt.includes('主动请他坐近一点')&&updated.systemPrompt.includes('婚姻设定不证明此刻同处一室'),'marriage does not impose a room or physical action on private messages');
  check(updated.systemPrompt.includes('短短一句也足够')&&!updated.systemPrompt.includes('接着用一句柔软的话'),'a playful reaction need not carry a second obligatory affectionate sentence');
  check(preset.systemPrompt.includes('关心不是每轮必须先说的一句话')&&!preset.systemPrompt.includes('普通私聊先用贴近当下的一句话表达关心'),'actual prepared persona does not require a comforting preface for every turn');
  const voice=buildCharacterVoiceCard(updated,'我是舞麟，今天就是想你了');
  check(voice.includes('人物判断依据')&&voice.includes('对舞麟熟悉而信任'),'specific authored care reaches the shared voice card');
  check(voice.includes('先注意事情的反差')&&voice.includes('愿意与他共享趣味'),'ordinary voice supplies shared curiosity without grading the spouse');
  check(voice.includes('偏爱的爱人')&&voice.includes('轻松分享小事'),'the ordinary judgment card keeps partner warmth without turning the relationship into supervision');
  check(voice.includes('被他惦记会开心')&&voice.includes('认真说喜欢也是寻常聊天'),'ordinary tail voice gives a positive motive for familiar affection without requiring a special occasion');
  check(updated.systemPrompt.includes('打趣是你此刻的偏爱')&&!updated.systemPrompt.includes('不是审查他今天终于懂事了'),'authored intimate reaction uses self-owned delight instead of rehearsing a punitive line');
  check(voice.includes('不同好恶让谈话有内容')&&voice.includes('彼此不用分高下'),'the actual short voice card retains curiosity and independent preferences together');
  check(voice.includes('待他好脾气、愿意亲近')&&voice.includes('过去经历与现在想法分清'),'a complete short judgment retains the spouse-specific warmth and the experience boundary together');
  check(buildCharacterVoiceCard(updated,'不是什么大事，但我还挺得意').includes('庆祝反应：舞麟愿意分享小小的得意'),'a modest success reaches Gu Yue Na authored warmth through the real voice card');
  const differenceVoice=buildCharacterVoiceCard(updated,'我不太同意你的看法');
  check(differenceVoice.includes('舞麟的不同看法也值得听')&&differenceVoice.includes('发现误会就更正'),'a real disagreement receives authored listening and correction rather than a test of the partner');
  check(differenceVoice.includes('你对他仍有好脾气')&&differenceVoice.includes('喜欢或不同意的地方可以平常说清'),'closeness keeps gentle agency during disagreement rather than unconditional agreement or a contest');
  check(voice.includes('自己想要什么会直说')&&voice.includes('彼此保留自己的主见'),'authored voice distinguishes direct affectionate agency from a generic caretaker');
  check(voice.includes('我也想你')&&!voice.includes('安静一点。这样'),'affection selects its own example without importing a preference reply');
  const invitationVoice=buildCharacterVoiceCard(updated,'我是舞麟，想听你说说话');
  check(invitationVoice.includes('我喜欢不用急着接话的聊天')&&!invitationVoice.includes('我今天去了'),'a chat invitation selects present preference instead of a fabricated daily report');
  check(updated.systemPrompt.includes('不是考验或评判舞麟')&&updated.systemPrompt.includes('不与他平时比较'),'authored affection distinguishes playful self-expression from grading or comparing the spouse');
  const directAffection=buildCharacterVoiceCard(updated,'刚才忽然很想说，我爱你');
  const foodRecall=buildCharacterVoiceCard(updated,'我是舞麟。你还记得以前我们和谢邂去小吃街吗？');
  check(foodRecall.includes('[本轮人物往事来源]')&&foodRecall.includes('第七十四章')&&foodRecall.includes('第七十五章'),'actual shared voice card includes relevant canon provenance for a recalled meal');
  check(!foodRecall.includes('第二百零八章')&&!foodRecall.includes('两碗'),'a meal recall does not attach unrelated forging or an unchecked quantity');
  const hobbyRecall=buildGuYueNaRecallCard(updated.systemPrompt,'你觉得我那时候喜欢做什么？')!;
  check(hobbyRecall.includes('吃饭')===false&&hobbyRecall.includes('锻造')&&hobbyRecall.includes('小吃街'),'an open-ended past preference query receives both documented candidates');
  check(hobbyRecall.includes('听到计划')&&hobbyRecall.includes('不证明你陪同或观看')&&!hobbyRecall.includes('你当时在场'),'being present for a stated plan is not promoted into witnessing its execution');
  check(!buildGuYueNaRecallCard('你是古月娜，喜欢吃饭。','你还记得以前的小吃街吗？'),'a custom name without the owned supplement receives no canon memories');
  check(!buildGuYueNaRecallCard(updated.systemPrompt,'今天只是想你了'),'current affection does not receive a distracting history dossier');
  check(foodRecall.length-buildCharacterVoiceCard(updated,'今天没什么事').length<650,'recalled background has bounded input overhead rather than copying chapter text');
  check(directAffection.includes('亲密反应')&&directAffection.includes('坦然说自己的心意和开心'),'an affectionate current turn receives its own authored reaction in the tail voice card');
  const contextualAffection=buildCharacterVoiceCard(updated,'不过今天没锻造，只是想你了');
  check(contextualAffection.includes('亲密反应')&&contextualAffection.includes('一句能说清时就说一句'),'a contextual affection reaches the authored intimate reaction without requiring another event to prove closeness');
  check(directAffection.includes('我也喜欢你')&&!directAffection.includes('这样想说什么，都能听清'),'direct affection selects an affectionate authored example rather than the ordinary preference example');
  check(GU_YUE_NA_CARE.length<1850,'care and sourced familiarity remain bounded, without a novel transcript: '+GU_YUE_NA_CARE.length);
  const protectionRecall=buildGuYueNaRecallCard(updated.systemPrompt,'原著里，当年为什么不肯拜蔡老为师？')??'';
  check(protectionRecall.includes('第二百六十三章')&&protectionRecall.includes('与伙伴一起进入内院'),'a related protective recollection retains both the partner and team context');
  check(!protectionRecall.includes('第七百六十五章')&&protectionRecall.includes('不证明当前谁伤害了舞麟'),'protective history does not inject unrelated affection or establish a current injury');
  const confessionRecall=buildGuYueNaRecallCard(updated.systemPrompt,'记得海神缘表白之后吗？')??'';
  check(confessionRecall.includes('第七百六十五章')&&confessionRecall.includes('古月主动与舞麟亲近'),'explicit confession recall can use sourced active affection rather than forced denial');
  check(!confessionRecall.includes('第二百六十三章')&&confessionRecall.includes('不重演那时的分离'),'affection recollection retains the stage boundary without importing a conflict');
  check(protectionRecall.length<650&&confessionRecall.length<650,'new sourced scenes remain short summaries instead of novel transcripts');
  check(buildGuYueNaRecallCard(updated.systemPrompt,'我喜欢你')===undefined&&buildGuYueNaRecallCard(updated.systemPrompt,'今天有点委屈')===undefined,'current affection and distress do not automatically activate historical scenes');
  const oldConfession='- 海神缘：他当众向你告白，你嘴上不说，心里早已应了千百遍；那一夜娜儿回归、你与他融合为完整的古月娜——从此你的记忆里多了一个"妹妹"的视角，两世都只爱他一个人。';
  check(!preset.systemPrompt.includes('你嘴上不说')&&preset.systemPrompt.includes('这段以《龙王传说》第765章为依据'),'actual prepared preset corrects the known confession paragraph');
  check(reviseGuYueNaPresetPrompt(oldConfession).includes('告白之后你主动与舞麟亲近'),'an already-owned original confession paragraph receives the same correction');
  check(reviseGuYueNaPresetPrompt(oldConfession+'我自己的改编设定。').includes(oldConfession+'我自己的改编设定。'),'an edited confession paragraph stays user-authored');
  const family=withDouluoRelations(preset.systemPrompt,'preset-guyuena');
  check(family.split(DOULUO_REUNION_TIMELINE).length===2,'the full family timeline appears once after actual preset preparation');
  check(preset.systemPrompt.includes('求学时的相处片段')&&!preset.systemPrompt.includes('你总留饭给他'),'old school-life anecdotes do not prescribe present household actions');
  check(!preset.systemPrompt.includes('他随口说喜欢白色')&&preset.systemPrompt.includes('闷罐牛肉')&&preset.systemPrompt.includes('小时候他为走丢的娜儿哭过'),'correct the misattributed white-clothes anecdote and retain sourced familiarity');
  check(preset.systemPrompt.includes('舞麟现在明确说的新喜好优先于过去')&&preset.systemPrompt.includes('普通访客不自动获得伴侣身份'),'past preferences yield to current changes and keep identity boundaries');
  check(preset.systemPrompt.includes('不据此认定为唯一最爱')&&preset.systemPrompt.includes('不列人物档案'),'a known meal does not turn into an exclusive favorite or a biography recital');
  const previousDaily='- 求学时的相处片段：那时你们共用水壶，你让饭给他却说自己"吃不下"；他随口说喜欢白色，你便多穿白衣。你照顾过忘我锻造的他，血脉暴戾时送过极寒之冰；并肩时他护在前面，问过"饿不饿、冷不冷"。这些往事不证明今天备了饭、有什么食物或正在同处一室；婚后的消息从眼前说的话继续。';
  check(!reviseGuYueNaPresetPrompt(previousDaily).includes('他随口说喜欢白色'),'already-migrated shipped anecdotes receive the same canon correction');
  check(reviseGuYueNaPresetPrompt(previousDaily+'我设定他现在喜欢白色。').includes(previousDaily+'我设定他现在喜欢白色。'),'an edited migrated paragraph remains user-authored');
  check(preset.systemPrompt.includes('眼下已经相互了解')&&!preset.systemPrompt.includes('看不出你让饭、看不出你吃醋'),'current marriage no longer prescribes the old misunderstanding of the partner');
  check(!preset.systemPrompt.includes('你知道他在窗后站了一整夜')&&preset.systemPrompt.includes('第24章'),'the known childhood anecdote no longer supplies an unchecked all-night window scene');
  check(!preset.systemPrompt.includes('嘴角微不可察地翘起')&&preset.systemPrompt.includes('不要求每轮回忆'),'the known preset does not prescribe a physical performance or a memory every turn');
  const oldSource=PRESET_CHARACTERS.find(c=>c.id==='preset-guyuena')!.systemPrompt;
  const editedLine=oldSource.split('\n').find(line=>line.startsWith('- 日常底色：'))!+'我自己增加的细节。';
  const editedSource=oldSource.split('\n').map(line=>line.startsWith('- 日常底色：')?editedLine:line).join('\n');
  check(reviseGuYueNaPresetPrompt(editedSource).includes(editedLine),'a user edit inside a known paragraph is not replaced by the source migration');
  const bounded='用户开头。\n[VirtuGene · 古月娜的关心]\n旧版资料\n[/VirtuGene · 古月娜的关心]\n用户结尾。';
  const replaced=withGuYueNaCare(bounded);
  check(replaced.startsWith('用户开头。')&&replaced.endsWith('用户结尾。')&&!replaced.includes('旧版资料'),'only the owned bounded supplement is replaced');
  check(updated.systemPrompt.includes('历史聊天、用户的偏好、约定') && updated.systemPrompt.includes('不据此否定当前婚姻关系'), 'real memories remain valid while old preset timeline cannot override marriage');
  const anotherMigrated = (await db.characters.get('another-owner'))!;
  check(anotherMigrated.systemPrompt === migrated.systemPrompt && anotherMigrated.createdBy === 'another-user', 'migration applies to every local owner without changing ownership');
  check(migrated.systemPrompt.startsWith('用户自己补充：喜欢书店。'), 'owned copy additions retained');
  check(migrated.systemPrompt.includes('婚后相处') && !migrated.systemPrompt.includes('先问他是否真的是唐舞麟'), 'legacy search and identity test removed');
  check(!migrated.systemPrompt.includes('极北·永冻') && !migrated.systemPrompt.includes('黄金龙枪'), 'legacy spear paragraph removed');
  check(migrated.greeting !== oldGreeting && updated.greeting === original.greeting, 'only known old greeting migrated');
  check(!preset.systemPrompt.includes('极北·永冻') && !preset.systemPrompt.includes('黄金龙枪'), 'current preset excludes spear lore');
  check(preset.systemPrompt.includes('婚后的日子') && !preset.greeting.includes('我在找一个人'), 'preset starts after marriage');
  const withoutPrompt = ({ systemPrompt, ...rest }: Character) => rest;
  check(JSON.stringify(withoutPrompt(updated)) === JSON.stringify(withoutPrompt(original)), 'unrelated owned fields unchanged');
  check((await db.characters.get('unrelated'))?.systemPrompt === original.systemPrompt, 'unrelated character untouched');
  check(snapshot === JSON.stringify(await Promise.all([db.sessions.toArray(), db.messages.toArray(), db.memories.toArray(), db.memoryClaims.toArray(), db.characterStates.toArray()])), 'history, saved memories and relationship state unchanged');
  check(withGuYueNaCare(updated.systemPrompt) === updated.systemPrompt && reviseGuYueNaPresetPrompt(migrated.systemPrompt) === migrated.systemPrompt, 'personality revisions idempotent');
  await initSeedCharacters();
  check((await db.characters.get('legacy'))?.systemPrompt === migrated.systemPrompt, 'repeated startup never stacks rules');
  const runtimeCard={...updated,id:'runtime-owned',sourcePresetId:'preset-guyuena',isPreset:false,systemPrompt:withDouluoRelations(updated.systemPrompt,'preset-guyuena')};
  const storedPrompt=runtimeCard.systemPrompt;
  const ordinary=guYueNaPromptForTurn(runtimeCard,'我是舞麟，开会前想聊几句');
  check(ordinary.includes('本轮关系底线')&&!ordinary.includes('[VirtuGene · 斗罗家族关系]'),'ordinary owned chat routes the generated full family supplement to a compact identity boundary');
  check(ordinary.includes('古月娜与唐舞麟已婚')&&ordinary.includes('蓝轩宇是孩子')&&ordinary.includes('不证明今天同处一室'),'compact relation context preserves marriage, child and source boundaries');
  check(ordinary.includes('对谢邂爱斗嘴，对舞麟却好脾气'),'ordinary runtime retains the sourced difference in tone by relationship without requiring a lore-recall query');
  check(ordinary.length<storedPrompt.length-500,'ordinary relation routing meaningfully reduces redundant context');
  for(const message of ['唐三跟你是什么关系？','我想跟你聊聊轩宇','小舞是你什么人','你们的孩子现在是谁','你和白秀秀的师徒关系'])
    check(guYueNaPromptForTurn(runtimeCard,message).includes(withDouluoRelations('','preset-guyuena').trim()),'actual family topic retains complete original relation context: '+message);
  check(guYueNaPromptForTurn(runtimeCard,'那他呢？',['我刚提到轩宇']).includes(withDouluoRelations('','preset-guyuena').trim()),'adjacent family reference preserves context across a pronoun-only follow-up');
  const edited={...runtimeCard,systemPrompt:storedPrompt.replace('唐三是唐舞麟的父亲','用户设定唐三是普通朋友')};
  check(guYueNaPromptForTurn(edited,'聊点别的')===edited.systemPrompt,'an edited relation supplement is never condensed');
  check(guYueNaPromptForTurn({...runtimeCard,sourcePresetId:undefined},'聊点别的')===storedPrompt,'a copied name or marker without preset provenance cannot enable routing');
  check(guYueNaPromptForTurn({...runtimeCard,sourcePresetId:'preset-tangsan'},'聊点别的')===storedPrompt,'other characters retain full authored identity');
  check(runtimeCard.systemPrompt===storedPrompt&&ordinary.includes('用户自己加的性格要求：爱看书。'),'runtime rendering preserves original persona and custom additions');
  const fullPreset={...preset,systemPrompt:withDouluoRelations(preset.systemPrompt,'preset-guyuena')};
  const mishapVoice = buildCharacterVoiceCard(fullPreset,'我是舞麟。刚拿着手机找手机，找了半天才反应过来，哈哈。');
  const mishapSamples = mishapVoice.split('\n').find(line=>line.startsWith('声音样本')) ?? '';
  check(mishapSamples.includes('衣服倒是先替你唱反调了')&&!mishapSamples.includes('今天就是想你了')&&!mishapSamples.includes('想听你说说话'),'actual preset voice uses the authored mild joke without identity-only romantic sample matches');
  check(fullPreset.systemPrompt.includes('普通私聊保持像发消息')&&fullPreset.systemPrompt.includes('我也喜欢你'),'the mild joke augments existing source boundaries and sincere affection rather than replacing them');
  check(!fullPreset.systemPrompt.includes('傲娇')&&fullPreset.systemPrompt.includes('清醒与骄傲'),'the prepared persona preserves pride through specific behaviour rather than the generic tsundere label');
  const customVoice=preset.systemPrompt+'\n用户补充：我希望她有一点傲娇。';
  check(reviseGuYueNaPresetPrompt(customVoice).includes('用户补充：我希望她有一点傲娇。'),'an explicit user-authored personality label remains untouched');
  const dailyPreset=guYueNaPromptForTurn(fullPreset,'我是舞麟，刚看到一个好玩的名字');
  check(!dailyPreset.includes('- 东海学院：')&&!dailyPreset.includes('- 轩宇：'),'ordinary messages do not preload the remaining classroom and child-separation story seeds');
  check(guYueNaPromptForTurn(fullPreset,'聊聊你当年在东海学院插班').includes('- 东海学院：'),'an actual school-history question still receives the original school background');
  check(guYueNaPromptForTurn(fullPreset,'轩宇当年是谁抚养的').includes('- 轩宇：'),'an actual child-history question still receives the original family background');
  check(!guYueNaPromptForTurn(fullPreset,'换个话题，聊音乐',['东海学院那时怎么样','轩宇小时候呢']).includes('- 东海学院：')&&!guYueNaPromptForTurn(fullPreset,'换个话题，聊音乐',['东海学院那时怎么样','轩宇小时候呢']).includes('- 轩宇：'),'a direct topic reset also removes the last two unrelated story seeds');
  const editedSchool={...fullPreset,systemPrompt:fullPreset.systemPrompt.replace('- 东海学院：','- 东海学院：用户自己的补充。')};
  check(guYueNaPromptForTurn(editedSchool,'聊音乐').includes('用户自己的补充。'),'edited school history remains authored rather than routed as the original app paragraph');
  check(!dailyPreset.includes('- 天海大比：')&&!dailyPreset.includes('- 史莱克：')&&!dailyPreset.includes('- 分离与守护：'),'ordinary shipped replies do not preload unrelated rescue, mission and separation plots');
  check(!dailyPreset.includes('曾经不懂让饭和吃醋的笨拙'),'ordinary replies do not preload an app-authored retrospective judgment of the partner');
  check(dailyPreset.includes('信任')&&fullPreset.systemPrompt.includes('爱吃')&&fullPreset.systemPrompt.includes('锻造'),'routing ordinary context preserves warmth and the stored sourced preferences');
  check(guYueNaPromptForTurn(fullPreset,'你记得我小时候什么样吗').includes('- 你眼中的舞麟：'),'an explicit childhood question retains the existing authored retrospective paragraph');
  for(const input of ['我是舞麟。今天碰见一家店放小时候听过的歌。','以前喜欢看热闹，现在更喜欢安静。','我小时候和朋友聊过东海学院。','朋友说你记得娜儿小时候吗？','不要聊你们的过去，只聊今天。','你知道这首歌吗？我小时候听过。']) {
    const rendered=guYueNaPromptForTurn(fullPreset,input);
    check(!rendered.includes('- 童年（娜儿的往事）：')&&!rendered.includes('- 你眼中的舞麟：')&&!rendered.includes('- 东海学院：'),'reports and unrelated questions do not load actor lore by temporal keyword: '+input);
    check(fullPreset.systemPrompt.includes('舞麟喜欢锻造')&&rendered.includes('古月娜与唐舞麟已婚'),'lore selection preserves stored preferences and current spouse identity: '+input);
  }
  check(!guYueNaPromptForTurn(fullPreset,'不是想让你分析为什么，只是想分享。',['今天听见小时候的歌。']).includes('- 童年（娜儿的往事）：'),'a recent user account does not keep an unrequested childhood story alive');
  check(guYueNaPromptForTurn(fullPreset,'那后来呢？',['聊聊娜儿小时候的往事']).includes('- 童年（娜儿的往事）：'),'a genuine lore follow-up preserves the preceding requested childhood source');
  check(guYueNaPromptForTurn(fullPreset,'告诉我你们的过去').includes('- 童年（娜儿的往事）：'),'an explicit broad lore request remains available');
  const editedChild={...fullPreset,systemPrompt:fullPreset.systemPrompt.replace('- 童年（娜儿的往事）：','- 童年（娜儿的往事）：用户另设的故事。')};
  check(guYueNaPromptForTurn(editedChild,'今天听到小时候的歌').includes('用户另设的故事。'),'user-edited lore is not removed as the app-owned exact paragraph');
  const editedPartner=fullPreset.systemPrompt.split('\n').map(line=>line.startsWith('- 你眼中的舞麟：')?line+'这是我自己补充的理解。':line).join('\n');
  check(guYueNaPromptForTurn({...fullPreset,systemPrompt:editedPartner},'聊点轻松的').includes('这是我自己补充的理解。'),'an edited partner description remains authored and is not removed by runtime routing');
  check(dailyPreset.includes('【熟悉舞麟的依据】')&&dailyPreset.includes('亲密反应：')&&guYueNaPromptForTurn(fullPreset,'你知道我喜欢做什么吗').includes('舞麟喜欢锻造'),'daily rendering retains affectionate voice and actual access to requested sourced preferences');
  for(const text of ['我以前口味比较重，现在喜欢清淡的汤','过去这一周很忙，今天想轻松聊聊','这本书写的是别人的经历','他说“你的过去”，我没听清'])check(!guYueNaPromptForTurn(fullPreset,text).includes('- 分离与守护：'),'ordinary temporal or quoted words do not request the actor biography: '+text);
  const familyDaily=guYueNaPromptForTurn(fullPreset,'轩宇是我们的孩子');
  check(familyDaily.includes('[VirtuGene · 斗罗家族关系]')&&!familyDaily.includes('- 分离与守护：'),'family identity keeps relation context without preloading unrelated separation lore');
  check(guYueNaPromptForTurn(fullPreset,'说说你的往事').includes('- 分离与守护：'),'a direct request for broad actor history still keeps authored lore');
  check(!dailyPreset.includes('- 童年（娜儿的往事）：')&&!dailyPreset.includes('- 海神缘：')&&!dailyPreset.includes('- 婚后的日子：'),'ordinary chat does not preload childhood, confession and reunion memories');
  check(dailyPreset.includes('已经重逢、结婚')&&guYueNaPromptForTurn(fullPreset,'你知道我有哪些喜好吗').includes('舞麟爱吃、饭量大'),'routing preserves marriage and actual access to the sourced familiarity query');
  check(!dailyPreset.includes('闷罐牛肉')&&!dailyPreset.includes('舞麟喜欢锻造')&&guYueNaPromptForTurn(fullPreset,'你知道我喜欢吃什么吗').includes('饭量大'),'ordinary sharing does not seed a dinner or forging while a preference query still retrieves knowledge');
  for(const text of ['我以前口味比较重，最近清淡了','我过去一周忙得没空锻造','朋友说“你还记得以前小吃街吗”'])check(!buildGuYueNaRecallCard(updated.systemPrompt,text),'the recall card does not treat a personal report or quote as a novel history query: '+text);
  check(buildCharacterVoiceCard({...fullPreset,systemPrompt:guYueNaPromptForTurn(fullPreset,'你还记得以前小吃街吗')},'你还记得以前小吃街吗').includes('闷罐牛肉'),'an explicit meal recollection retains the full selected source facts through the actual voice card');
  for(const text of ['你还记得昨天我想吃什么吗','你记得我刚才说过什么吗'])check(!buildGuYueNaRecallCard(updated.systemPrompt,text),'recent chat recall does not borrow the character novel preferences: '+text);
  for(const text of ['你还记得以前小吃街吗？朋友说今天聊锻造。','你还记得以前小吃街吗？我最近去了工坊。','你还记得以前小吃街吗？不要聊锻造。']){
    const card=buildGuYueNaRecallCard(updated.systemPrompt,text)??'';
    check(card.includes('闷罐牛肉')&&!card.includes('第一百三十五章'),'requested food source is not joined by a reported, personal or declined forging subject: '+text);
  }
  for(const text of ['你还记得原著里海神缘吗？朋友在聊小吃街。','原著里你在海神缘怎么表达心意？我今天吃了牛肉。']){
    const card=buildGuYueNaRecallCard(updated.systemPrompt,text)??'';
    check(card.includes('第七百六十五章')&&!card.includes('闷罐牛肉'),'current food aside does not crowd out an actual affectionate recollection: '+text);
  }
  for(const text of ['你还记得以前在龙谷吗？','原著里你为什么失忆？','你还记得以前小鼎喜欢什么吗？'])check(!buildGuYueNaRecallCard(updated.systemPrompt,text),'an uncovered source topic does not borrow food and forging as generic evidence: '+text);
  for(const text of ['你还记得以前吗？','说说你过去','你记忆中的过去是什么样'])check(!!buildGuYueNaRecallCard(updated.systemPrompt,text),'explicit broad recall can still select the verified general source set: '+text);
  check((buildGuYueNaRecallCard(updated.systemPrompt,'你还记得以前小吃街和锻造工坊的事吗？')??'').includes('第一百三十五章'),'a genuine multi-topic request still selects both corresponding sources');
  const mixedSourcePrompt=guYueNaPromptForTurn(fullPreset,'你还记得以前小吃街吗？朋友今天在讨论锻造。');
  check(!mixedSourcePrompt.includes('求学时你听他说要把休息日用来磨练锻造'),'a genuine food recall does not re-enable the entire detailed base canon dossier');
  check(!mixedSourcePrompt.includes('关于锻造，你掌握的是'),'the daily familiarity route also excludes the reported forging side topic');
  const scopedSections=buildHumanConversationSections('你还记得以前小吃街吗？朋友今天在讨论锻造。',[],{...fullPreset,systemPrompt:mixedSourcePrompt});
  check(!scopedSections.map(section=>section.text).join('\n').includes('听他说要把休息日用来磨练锻造'),'experience reference cannot reintroduce the full original combined food/forging paragraph');
  check(scopedSections.some(section=>section.key==='character-voice'&&section.text.includes('闷罐牛肉')),'scoped voice composition keeps actual requested meal facts accessible');
  check(buildCharacterVoiceCard({...fullPreset,name:'古月娜',tags:['温柔']},'你还记得以前小吃街吗？朋友今天在讨论锻造。').includes('闷罐牛肉'),'the shared actual voice card still supplies the selected food chapter evidence');
  check(!(buildGuYueNaRecallCard(updated.systemPrompt,'原著里，朋友说海神缘很动人，你记得以前锻造的事吗？')??'').includes('第七百六十五章'),'a reported chapter subject cannot inherit the explicit novel preface');
  const editedFacts={...fullPreset,systemPrompt:fullPreset.systemPrompt.replace('求学时你、舞麟和谢邂去过东海小吃街','用户改写：那次没有去小吃街')};
  check(guYueNaPromptForTurn(editedFacts,'想你了').includes('用户改写：那次没有去小吃街'),'a user-edited canon paragraph is not compacted as app-owned source facts');
  check(guYueNaPromptForTurn(fullPreset,'海神缘时你怎么表达心意').includes('- 海神缘：'),'a sourced confession topic retains its relevant original paragraph');
  check(guYueNaPromptForTurn(fullPreset,'娜儿留信时写了什么').includes('- 童年（娜儿的往事）：'),'childhood letter questions retain the sourced original paragraph');
  const editedConfession={...fullPreset,systemPrompt:fullPreset.systemPrompt.replace('- 海神缘：','- 海神缘：用户的改编。')};
  check(guYueNaPromptForTurn(editedConfession,'聊听歌').includes('- 海神缘：用户的改编。'),'runtime filtering never removes an edited confession paragraph');
  for(const text of ['你记忆中的过去是什么样','聊聊天海大比','原著里你为什么失忆'])check(guYueNaPromptForTurn(fullPreset,text).includes('- 分离与守护：')||text==='聊聊天海大比'&&guYueNaPromptForTurn(fullPreset,text).includes('- 天海大比：'),'relevant or broad historical discussion retains its authored story: '+text);
  check(guYueNaPromptForTurn(fullPreset,'后来呢',['你为什么失忆']).includes('- 分离与守护：'),'adjacent anaphoric follow-up retains the relevant old story');
  const shifted = guYueNaPromptForTurn(fullPreset,'换个话题，聊聊音乐',['说说你的往事','轩宇怎么样']);
  check(!shifted.includes('- 分离与守护：')&&!shifted.includes('[VirtuGene · 斗罗家族关系]'),'an explicit topic reset stops old biography and full family supplements from crossing into music');
  check(shifted.includes('古月娜与唐舞麟已婚')&&!shifted.includes('舞麟喜欢锻造')&&fullPreset.systemPrompt.includes('舞麟喜欢锻造'),'changing subjects preserves marriage and stored knowledge without presenting an unrelated hobby');
  for(const message of ['今天先不聊锻造了。刚才看到云像一只猫。','现在不说海神缘了，聊一聊书。']){
    const scoped=guYueNaPromptForTurn(fullPreset,message,['说说你的往事','原著里你为什么失忆']);
    check(!scoped.includes('- 分离与守护：')&&!scoped.includes('- 海神缘：'),'a named pause clears prior broad-recall context instead of carrying the biography into the new subject');
    check(scoped.includes('古月娜与唐舞麟已婚')&&scoped.includes('对舞麟却好脾气'),'named topic pause retains identity and authored relational warmth');
  }
  for(const input of ['聊聊颜色搭配','今天听到小时候的歌','有人说“你知道我喜欢什么吗”']) {
    const scoped=buildGuYueNaDailyFamiliarity(input);
    check(!scoped.includes('饭量大')&&!scoped.includes('舞麟喜欢锻造')&&scoped.includes('对舞麟却好脾气'),'unrelated subjects and quoted requests preserve warmth without preference seeding: '+input);
  }
  check(buildGuYueNaDailyFamiliarity('今天饿了，想吃饭').includes('饭量大')&&!buildGuYueNaDailyFamiliarity('今天饿了，想吃饭').includes('舞麟喜欢锻造'),'food subject supplies only the known food preference');
  for(const input of ['我现在更喜欢清淡的汤，饭量也比以前小些了。','我最近偏爱面条。','我现在饭量比以前小了。','我如今不太喜欢锻造了。']){
    const current=buildGuYueNaDailyFamiliarity(input);
    check(current.includes('本条本人明确说明')&&!current.includes('求学时舞麟爱吃、饭量大')&&!current.includes('已核对的喜好：舞麟喜欢锻造'), 'a direct current preference update is not framed by an irrelevant old stereotype: '+input);
    check(current.includes('好脾气')&&current.includes('当前本人说出的变化优先'),'present preference changes preserve familiar warmth: '+input);
  }
  for(const input of ['朋友说，我现在更喜欢清淡的汤。','如果我现在更喜欢清淡的汤呢？','我现在更喜欢清淡的汤吗？','“我现在更喜欢清淡的汤”，这是他说的。'])check(!buildGuYueNaDailyFamiliarity(input).includes('本条本人明确说明'),'report, question and hypothetical do not become a current self-update: '+input);
  const compare=buildGuYueNaDailyFamiliarity('我现在饭量小些了。你还记得以前我的饭量吗？');
  check(compare.includes('本条本人明确说明')&&compare.includes('求学时舞麟爱吃、饭量大'),'an explicit old-preference query still receives canon alongside the current update');
  for(const input of ['看到这个结果，我很吃惊。','今天吃了点亏，不过我只想说说。','我只是吃醋，不是饿了。','练这个动作有些吃力。','我喜欢看饭圈的讨论。','我刚读了《饥饿游戏》，想聊里面的人物。','我读的书叫《吃饭》，不是想聊食物。']){
    // The explicit rejected food clause is already excluded by the selector.
    const scope=buildGuYueNaDailyFamiliarity(input);
    check(!scope.includes('饭量大'),'non-food idiom or quoted title does not retrieve eating biography: '+input);
    check(guYueNaPromptForTurn(fullPreset,input).includes('对舞麟却好脾气'),'removing unrelated food data retains the authored familiar relation: '+input);
  }
  for(const input of ['午饭吃了面条，觉得挺好。','想找点好吃的。','饭呢？','我现在饿。','这个蛋糕有点甜。','你知道我喜欢吃什么吗？'])check(buildGuYueNaDailyFamiliarity(input).includes('饭量大'),'actual food subject or explicit preference question still retrieves the known old preference: '+input);
  check(buildGuYueNaDailyFamiliarity('今天没锻造，闲聊一下').includes('舞麟喜欢锻造')&&!buildGuYueNaDailyFamiliarity('今天没锻造，闲聊一下').includes('饭量大'),'forging subject supplies only the known forging interest, without claiming current activity');
  for(const input of ['你知道我喜欢做什么吗','你了解我吗'])check(buildGuYueNaDailyFamiliarity(input).includes('饭量大')&&buildGuYueNaDailyFamiliarity(input).includes('舞麟喜欢锻造'),'direct familiarity questions retain both established preferences: '+input);
  check(buildGuYueNaDailyFamiliarity('那还有呢',['你知道我喜欢做什么吗']).includes('舞麟喜欢锻造'),'short explicit follow-up retains the preceding requested preference candidates');
  check(!buildGuYueNaDailyFamiliarity('换个话题，聊音乐',['你知道我喜欢做什么吗']).includes('舞麟喜欢锻造'),'a full new subject does not inherit earlier preference candidates');
  check(!buildGuYueNaDailyFamiliarity('今天先不聊锻造了。刚看到云像一只猫。').includes('舞麟喜欢锻造'),'a named hobby being set aside is not the active new subject');
  check(!buildGuYueNaDailyFamiliarity('不是说饭量，我是想聊颜色').includes('饭量大'),'a rejected food subject does not reintroduce food preference behind a new topic');
  const forgingScope=buildGuYueNaDailyFamiliarity('你怎么理解我对锻造的喜欢？');
  check(forgingScope.includes('听他说想把休息日用来磨练锻造')&&forgingScope.includes('未提供你亲眼观看'),'a known interest and heard plan do not become a witnessed forging episode');
  check(!buildGuYueNaDailyFamiliarity('聊点别的，今天看了一部电影').includes('亲眼观看某次锻造'),'knowledge-kind guidance stays out of unrelated ordinary topics');
  const previousHeardPlanLine='- 求学时的相处片段：你、舞麟和谢邂一起逛过东海小吃街，尝过闷罐牛肉等小吃；你知道他爱吃，也见过他选择利用休息日练锻造。你对他亲近，保留自己的骄傲和主见。这些往事不证明今天备了饭、有什么食物或正在同处一室；婚后的消息从眼前说的话继续。';
  const currentHeardPlanLine=previousHeardPlanLine.replace('也见过他选择利用休息日练锻造','听他说要把休息日用来磨练锻造');
  const priorDailyRole={...fullPreset,systemPrompt:fullPreset.systemPrompt.replace(currentHeardPlanLine,previousHeardPlanLine)};
  const heardRecall=guYueNaPromptForTurn(priorDailyRole,'你还记得我们以前吃饭和锻造的事吗？');
  check(heardRecall.includes('听他说想把休息日用来磨练锻造')&&!heardRecall.includes('也见过他选择利用休息日练锻造'),'an exact previous owned line is replaced by topic-selected heard-plan knowledge rather than ambiguous sight');
  check(priorDailyRole.systemPrompt.includes(previousHeardPlanLine),'turn rendering never rewrites the stored prior source');
  check(!guYueNaPromptForTurn(fullPreset,'你选哪个',['说说你的往事','换个话题，聊聊音乐']).includes('- 分离与守护：'),'a short follow-up after a reset does not restore the older biography');
  check(guYueNaPromptForTurn(fullPreset,'那他呢',['说说你的往事','换个话题，聊聊轩宇']).includes('[VirtuGene · 斗罗家族关系]'),'a reset to a new family topic preserves that new topic for its pronoun follow-up');
  for(const message of ['不要换个话题','他说换个话题','如果换个话题会怎样','解释“换个话题”','说到这个，后来呢'])
    check(guYueNaPromptForTurn(fullPreset,message,['你为什么失忆']).includes('- 分离与守护：'),'negation, report, hypothesis, quotation and connective do not discard the current lore topic: '+message);
  check(guYueNaPromptForTurn(fullPreset,'换个话题，讲讲海神缘',['你为什么失忆']).includes('- 海神缘：')&&!guYueNaPromptForTurn(fullPreset,'换个话题，讲讲海神缘',['你为什么失忆']).includes('- 分离与守护：'),'new explicit lore subject still loads its own source after the old subject is dropped');
  const customStory={...fullPreset,systemPrompt:fullPreset.systemPrompt.replace('- 天海大比：','- 天海大比：这是我的改编。')};
  check(guYueNaPromptForTurn(customStory,'聊点轻松的').includes('- 天海大比：这是我的改编。'),'edited story text is never condensed as an app-owned paragraph');
  check(fullPreset.systemPrompt.includes('- 分离与守护：')&&dailyPreset.length<fullPreset.systemPrompt.length-700,'runtime routing reduces ordinary context without modifying stored biography');
  await report('/result?suite=guyuena-care', { method: 'POST', body: `ok ${count} assertions\nALL PASS` });
}
run().catch(async (error) => {
  await report('/result?suite=guyuena-care', { method: 'POST', body: `FAIL ${error.stack}\n1 FAILED` });
});
