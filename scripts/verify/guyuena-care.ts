import { db, type Character, type MemoryItem, type Session, type Message } from '../../src/db';
import { initSeedCharacters, PRESET_CHARACTERS } from '../../src/lib/seed-init';
import { GU_YUE_NA_CARE, reviseGuYueNaPresetPrompt, withGuYueNaCare } from '../../src/lib/gu-yue-na-personality';
import {withDouluoRelations} from '../../src/lib/douluo-relations';
import {DOULUO_REUNION_TIMELINE} from '../../src/lib/douluo-timeline';
import {buildCharacterVoiceCard} from '../../src/lib/chat-humanizer';
import {buildGuYueNaRecallCard} from '../../src/lib/gu-yue-na-canon';
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
  check(updated.systemPrompt.includes('舞麟是爱人') && updated.systemPrompt.includes('对其他人保持冷淡'), 'spouse, family and outsiders separated');
  check(updated.systemPrompt.includes('偶尔傲娇') && updated.systemPrompt.includes('具体处境'), 'warmth with occasional tsundere, grounded in current situation');
  check(updated.systemPrompt.includes('引述别人的话') && updated.systemPrompt.includes('不算自称'), 'quotes do not imply identity');
  check(updated.systemPrompt.includes('私聊、群聊、星域与朋友圈'), 'same personality in all modes');
  check(updated.systemPrompt.includes('可以偶尔叫“老公”') && updated.systemPrompt.includes('不每句话都加称呼'), 'intimate address remains situational');
  check(updated.systemPrompt.includes('不让他不断猜') && updated.systemPrompt.includes('不是背诵原著台词'), 'confirmed affection without rote quotations');
  check(updated.systemPrompt.includes('普通私聊保持像发消息') && updated.systemPrompt.includes('不是新增共同经历'), 'chat style does not invent memories');
  check(!updated.systemPrompt.includes('主动请他坐近一点')&&updated.systemPrompt.includes('婚姻设定不证明此刻同处一室'),'marriage does not impose a room or physical action on private messages');
  check(updated.systemPrompt.includes('短短一句也足够')&&!updated.systemPrompt.includes('接着用一句柔软的话'),'a playful reaction need not carry a second obligatory affectionate sentence');
  check(preset.systemPrompt.includes('关心不是每轮必须先说的一句话')&&!preset.systemPrompt.includes('普通私聊先用贴近当下的一句话表达关心'),'actual prepared persona does not require a comforting preface for every turn');
  const voice=buildCharacterVoiceCard(updated,'我是舞麟，今天就是想你了');
  check(voice.includes('人物判断依据')&&voice.includes('对舞麟熟悉而信任'),'specific authored care reaches the shared voice card');
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
  check(contextualAffection.includes('亲密反应')&&contextualAffection.includes('不是审查他今天终于懂事了'),'a contextual affection reaches the authored intimate reaction instead of routine teasing');
  check(directAffection.includes('我也喜欢你')&&!directAffection.includes('这样想说什么，都能听清'),'direct affection selects an affectionate authored example rather than the ordinary preference example');
  check(GU_YUE_NA_CARE.length<1850,'care and sourced familiarity remain bounded, without a novel transcript');
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
  check(ordinary.length<storedPrompt.length-500,'ordinary relation routing meaningfully reduces redundant context');
  for(const message of ['唐三跟你是什么关系？','我想跟你聊聊轩宇','小舞是你什么人','你们的孩子现在是谁','你和白秀秀的师徒关系'])
    check(guYueNaPromptForTurn(runtimeCard,message)===storedPrompt,'actual family topic retains complete original relation context: '+message);
  check(guYueNaPromptForTurn(runtimeCard,'那他呢？',['我刚提到轩宇'])===storedPrompt,'adjacent family reference preserves context across a pronoun-only follow-up');
  const edited={...runtimeCard,systemPrompt:storedPrompt.replace('唐三是唐舞麟的父亲','用户设定唐三是普通朋友')};
  check(guYueNaPromptForTurn(edited,'聊点别的')===edited.systemPrompt,'an edited relation supplement is never condensed');
  check(guYueNaPromptForTurn({...runtimeCard,sourcePresetId:undefined},'聊点别的')===storedPrompt,'a copied name or marker without preset provenance cannot enable routing');
  check(guYueNaPromptForTurn({...runtimeCard,sourcePresetId:'preset-tangsan'},'聊点别的')===storedPrompt,'other characters retain full authored identity');
  check(runtimeCard.systemPrompt===storedPrompt&&ordinary.includes('用户自己加的性格要求：爱看书。'),'runtime rendering preserves original persona and custom additions');
  await report('/result?suite=guyuena-care', { method: 'POST', body: `ok ${count} assertions\nALL PASS` });
}
run().catch(async (error) => {
  await report('/result?suite=guyuena-care', { method: 'POST', body: `FAIL ${error.stack}\n1 FAILED` });
});
