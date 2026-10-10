import { db } from '../../src/db';
import { PRESET_CHARACTERS, initSeedCharacters } from '../../src/lib/seed-init';
import { buildCharacterVoiceCard } from '../../src/lib/chat-humanizer';
import { useChatStore } from '../../src/store/chat-store';
import { useAuthStore } from '../../src/store/auth-store';
import { LU_XUE_QI_V1_PROMPT, LU_XUE_QI_V2_PROMPT, LU_XUE_QI_V3_PROMPT, LU_XUE_QI_V4_PROMPT, LU_XUE_QI_V5_PROMPT, LU_XUE_QI_V6_PROMPT, LU_XUE_QI_V7_PROMPT } from '../../src/lib/lu-xue-qi-preset-v1';
import { LU_XUE_QI_V8_PROMPT } from '../../src/lib/lu-xue-qi-preset-v8';
import { LU_XUE_QI_V9_PROMPT } from '../../src/lib/lu-xue-qi-preset-v9';
import { LU_XUE_QI_V10_PROMPT } from '../../src/lib/lu-xue-qi-preset-v10';
import { LU_XUE_QI_V11_PROMPT } from '../../src/lib/lu-xue-qi-preset-v11';
import { voicePromptRevision } from '../../src/lib/character-voice';
import { luXueQiIdentityChoice, luXueQiRelationshipForTurn, luXueQiFamilyRisk, omitLuXueQiFamilyRisk } from '../../src/lib/lu-xue-qi-runtime';
import {luXueQiBookContext,LU_XUE_QI_BOOK_SOURCES} from '../../src/lib/lu-xue-qi-lore';

async function run() {
  let checks = 0;
  const ok = (value: unknown, label: string) => {
    if (!value) throw Error(label);
    checks++; console.log('ok ' + label);
  };
  await db.delete(); await db.open();
  window.fetch = async () => { throw Error('Seed creation must not use network'); };
  await initSeedCharacters();
  const preset = (await db.characters.get('preset-luxueqi'))!;
  ok(preset?.isPreset && preset.name === '陆雪琪' && !preset.published, 'startup exposes Lu Xueqi as a local library preset');
  ok((await db.characters.toArray()).filter(c => c.id === preset.id).length === 1, 'one stable source id');
  ok(PRESET_CHARACTERS.length === new Set(PRESET_CHARACTERS.map(c => c.id)).size, 'all source ids remain unique');
  useAuthStore.setState({ userId: 'luxueqi-test-owner' });
  const { id: sourceId, createdAt: sourceCreatedAt, ...copyFields } = preset;
  const created = await useChatStore.getState().createCharacter({
    ...copyFields,
    createdBy: 'luxueqi-test-owner', isPreset: false, isCustom: false,
    sourcePresetId: preset.id,
  });
  const owned = (await db.characters.get(created.id))!;
  ok(owned.id !== preset.id && owned.createdBy === 'luxueqi-test-owner' && owned.sourcePresetId === preset.id, 'existing application creation produces an account-owned copy');
  ok(owned.systemPrompt === preset.systemPrompt && owned.greeting === preset.greeting, 'copy receives authored persona and neutral opening');
  await db.characters.update(owned.id, { systemPrompt: owned.systemPrompt + '\n用户补充：我的名字是阿远。', greeting: '阿远，你来了。' });
  await db.sessions.add({ id: 'luxueqi-kept-session', userId: owned.createdBy, characterId: owned.id, title: '陆雪琪', createdAt: 1, updatedAt: 1 });
  await db.messages.add({ id: 'luxueqi-kept-message', sessionId: 'luxueqi-kept-session', role: 'user', content: '我不是鬼厉，叫我阿远。', createdAt: 1, isProactive: false });
  const edited = await db.characters.get(owned.id);
  const legacy = { ...owned, id: 'luxueqi-v1-untouched', systemPrompt: LU_XUE_QI_V1_PROMPT };
  await db.characters.add(legacy);
  await db.characters.add({ ...legacy, id: 'luxueqi-v1-edited', systemPrompt: LU_XUE_QI_V1_PROMPT + '\n用户补充：我默认是鬼厉。' });
  await db.characters.add({ ...legacy, id: 'luxueqi-v1-published', published: true });
  const otherVersions = [LU_XUE_QI_V2_PROMPT, LU_XUE_QI_V3_PROMPT, LU_XUE_QI_V4_PROMPT, LU_XUE_QI_V5_PROMPT, LU_XUE_QI_V6_PROMPT, LU_XUE_QI_V7_PROMPT, LU_XUE_QI_V8_PROMPT, LU_XUE_QI_V9_PROMPT, LU_XUE_QI_V10_PROMPT, LU_XUE_QI_V11_PROMPT];
  for (const [index, systemPrompt] of otherVersions.entries()) {
    await db.characters.add({ ...legacy, id: 'luxueqi-old-' + index, systemPrompt });
    await db.characters.add({ ...legacy, id: 'luxueqi-old-edited-' + index, systemPrompt: systemPrompt + '\n用户修改：固定用我的设定。' });
  }
  await initSeedCharacters(); await initSeedCharacters();
  ok(JSON.stringify(await db.characters.get(owned.id)) === JSON.stringify(edited), 'repeated startup preserves the edited owned copy');
  ok((await db.messages.get('luxueqi-kept-message'))?.content === '我不是鬼厉，叫我阿远。' && !!await db.sessions.get('luxueqi-kept-session'), 'startup preserves existing conversation and explicit identity denial');
  ok((await db.characters.toArray()).filter(c => c.isPreset).length === PRESET_CHARACTERS.length, 'repeated startup neither loses nor duplicates presets');
  const migrated = (await db.characters.get(legacy.id))!;
  ok(migrated.systemPrompt === preset.systemPrompt && migrated.createdBy === legacy.createdBy, 'exact untouched first persona receives updated expression');
  ok(voicePromptRevision(migrated) !== voicePromptRevision(legacy), 'old generated voice cache is invalidated by persona migration');
  ok((await db.characters.get('luxueqi-v1-edited'))?.systemPrompt === LU_XUE_QI_V1_PROMPT + '\n用户补充：我默认是鬼厉。', 'user-authored identity override remains intact');
  ok((await db.characters.get('luxueqi-v1-published'))?.systemPrompt === LU_XUE_QI_V1_PROMPT, 'published first persona is not rewritten');
  for (const [index, systemPrompt] of otherVersions.entries()) {
    ok((await db.characters.get('luxueqi-old-' + index))?.systemPrompt === preset.systemPrompt, 'untouched development version upgrades: ' + (index + 2));
    ok((await db.characters.get('luxueqi-old-edited-' + index))?.systemPrompt === systemPrompt + '\n用户修改：固定用我的设定。', 'edited development version remains intact: ' + (index + 2));
  }
  const card = buildCharacterVoiceCard(owned, '今天终于把那件难事做完了');
  const distressCard=buildCharacterVoiceCard(preset,'今天确实有点烦，事情没做成。但我现在不想找办法，就想和你说会儿话。');
  ok(distressCard.includes('受挫回应：')&&distressCard.includes('其他聊天者诉苦也保持疏离'),'Lu production voice card reserves intimate concern for the claimed spouse');
  ok(!distressCard.includes('疲惫回应：'),'Lu distress turn is not given unrelated fatigue response');
  const guPreset=(await db.characters.get('preset-guyuena'))!;
  const guDistressCard=buildCharacterVoiceCard(guPreset,'今天确实有点烦，事情没做成。但我现在不想找办法，就想和你说会儿话。');
  ok(guDistressCard.includes('受挫回应：')&&guDistressCard.includes('舞麟'),'Gu also receives her own authored distress response in the same production entry');
  ok(guDistressCard!==distressCard,'the two characters keep distinct authored responses for the same setback');
  ok(card.includes('是否违背本心') && card.includes('伤及无辜'), 'production voice card reads character-specific judgment');
  ok(card.includes('小凡') && card.includes('身份'), 'production voice card keeps authored address conditions');
  for (const input of ['我想你了', '鬼厉这个人你怎么看', '你好，我只是想聊聊', '我不是张小凡，叫我阿远']) {
    const voice = buildCharacterVoiceCard(preset, input);
    const examples = voice.split('\n').find(line => line.startsWith('声音样本')) ?? '';
    ok(!examples.includes('你说小凡') && !examples.includes('我也是。见不到') && !examples.includes('方才是我认错了'), 'voice references do not transfer a lover or invented mistake: ' + input);
  }
  for (const input of ['我是鬼厉。今天想和你说话。', '我就是张小凡', '我叫小凡', '你好，我是鬼厉，今天聊什么？', '把我当鬼厉', '你把我当张小凡', '我想扮演鬼厉', '我不是鬼厉，我是张小凡']) {
    ok(luXueQiIdentityChoice(input) === true, 'explicit story identity is accepted: ' + input);
  }
  for (const input of ['先不扮演了，我叫阿远。', '我不是张小凡', '我不是鬼厉', '别把我当鬼厉', '我不再是小凡', '我是鬼厉，现在不扮演了', '我不是鬼厉，朋友说，我是鬼厉']) {
    ok(luXueQiIdentityChoice(input) === false, 'explicit exit or denial clears the story identity: ' + input);
  }
  for (const input of ['鬼厉这个人你怎么看', '朋友说我是鬼厉', '我是阿远，只是读者。朋友发来一句“我是鬼厉”', '“我是鬼厉”是什么意思', '如果我是鬼厉呢', '我是鬼厉吗？', '帮我写一句我是鬼厉', '我看到他说，我是鬼厉', '你觉得我是鬼厉？']) {
    ok(luXueQiIdentityChoice(input) === undefined, 'discussion, report, quotation and hypothetical do not recognize the user: ' + input);
  }
  const gentle = luXueQiRelationshipForTurn(preset, '我想你了', ['我是鬼厉', ...Array.from({ length: 20 }, () => '聊个别的话题')]);
  for (const reply of ['小鼎刚出去玩了，这会儿倒清净。', '不知道，去问他爹。', '阿璃若在，大概会先笑。']) ok(!!luXueQiFamilyRisk(preset,reply,[],true),'owned family guard detects unsupported child status, father confusion or foreign family: '+reply);
  for (const reply of ['小鼎是我们的儿子。', '我也想你。', '不知道小鼎现在有没有睡。', '假如小鼎今天出去玩了，我们可以等等。']) ok(!luXueQiFamilyRisk(preset,reply,[],true),'family guard preserves family facts, affection, uncertainty and hypotheticals: '+reply);
  ok(!luXueQiFamilyRisk(preset,'小鼎刚出去玩了。',['小鼎刚出去玩了'],true),'direct user source supports the exact child status');
  ok(!!luXueQiFamilyRisk(preset,'小鼎刚出去玩了。',['朋友说“小鼎刚出去玩了”'],true),'quoted statement does not establish current child status');
  ok(!!luXueQiFamilyRisk(preset,'小鼎刚出去玩了。',['假如小鼎刚出去玩了'],true),'hypothetical statement does not establish current child status');
  ok(!!luXueQiFamilyRisk(preset,'小鼎刚出去玩了。',['小鼎刚出去玩了？'],true),'question about child status is not a declarative source');
  ok(!!luXueQiFamilyRisk(preset,'小鼎刚出去玩了。',['昨天小鼎刚出去玩了'],true),'yesterday child activity is not current status');
  ok(!luXueQiFamilyRisk({...preset,systemPrompt:preset.systemPrompt+'\n用户自定'},'小鼎刚出去玩了。',[],true),'edited persona bypasses the owned family guard');
  ok(omitLuXueQiFamilyRisk(preset,'我也想你。小鼎刚出去玩了，所以正好。',[],true)==='我也想你。','last-resort removal retains independent affection and drops dependent child scene');
  ok(gentle.recognized === true && gentle.context.includes('温柔') && gentle.context.includes('你的丈夫张小凡') && gentle.character.systemPrompt.includes('张小鼎（小鼎）是你们的儿子'), 'original user choice remains available beyond the short dialogue window with the specified book-after family relation');
  ok(gentle.character.systemPrompt.includes('也是母亲') && gentle.character.systemPrompt.includes('自己的教育主张') && gentle.character.systemPrompt.includes('可以自然聊家庭'), 'request projection retains active family life and maternal judgment');
  ok(gentle.character.systemPrompt.includes('当日活动、共同经历仍需独立来源') && gentle.character.systemPrompt.includes('设想保持为设想'), 'family relation does not authorize invented recent events');
  ok(gentle.character.systemPrompt.includes('水月') && gentle.character.systemPrompt.includes('后来被困滴血洞的是张小凡和碧瑶'), 'family compaction keeps unrelated canon boundaries');
  ok(gentle.character.systemPrompt.includes('仅按该轮场景演绎，不覆盖此背景'), 'explicit alternate scene remains temporary');
  for (const input of ['我们有孩子吗？', '小鼎是谁？', '他今天在哪？', '换个话题，聊聊刚才的盆栽']) {
    const turn = luXueQiRelationshipForTurn(preset, input, ['我是小凡', '我们聊聊小鼎']);
    ok(turn.character.systemPrompt === gentle.character.systemPrompt && turn.recognized === true, 'family facts stay available without a keyword or pronoun retrieval gate: ' + input);
  }
  for (const input of ['我是你儿子', '朋友说“我是小凡”', '我是你的朋友，想聊家里']) {
    const turn = luXueQiRelationshipForTurn(preset, input);
    ok(turn.recognized === undefined && turn.context.includes('极为冷漠') && !turn.character.systemPrompt.includes('我也有一点。只是对你'), 'family claims and quoted identity do not grant spousal intimacy: ' + input);
  }
  const book = luXueQiRelationshipForTurn(preset, '我是小凡。曾书书的第六本天书是什么？');
  ok(book.character.systemPrompt.includes('[作品资料 · 第六本天书]') && book.character.systemPrompt.includes('无名的蓝封面风月图册') && book.character.systemPrompt.includes('属于游戏设定'), 'owned Lu gets sourced book nickname while separating novel and game');
  ok(book.character.systemPrompt.includes('不作为小说正式卷名或书名') && book.character.systemPrompt.includes('不等于你曾亲眼看见'), 'fan naming does not create novel titles or first-person book history');
  ok(LU_XUE_QI_BOOK_SOURCES.length === 3 && LU_XUE_QI_BOOK_SOURCES.every(source => source.url.startsWith('https://')), 'small knowledge entry retains individually attributed source types');
  for (const input of ['第六卷天书是功法吗？', '“天书第六卷”是什么意思？', '你怎么看天香录？', '曾书书的蓝皮书叫什么？']) ok(!!luXueQiBookContext(input), 'explicit book aliases retrieve the same bounded material: ' + input);
  ok(!!luXueQiBookContext('那本书真是修炼功法吗？', ['第六本天书是什么？']), 'a direct book follow-up keeps the actual user source');
  ok(!!luXueQiBookContext('不聊收拾屋子了，讲讲第六本天书是什么。'), 'ending an unrelated subject does not discard the newly requested book');
  ok(!luXueQiBookContext('第六本天书挺好笑，不过换个话题吧。'), 'a later current topic exit wins over the earlier book mention');
  for (const input of ['换个话题，你喜欢安静的地方吗？', '先不聊第六本天书了，我想你。', '刚才看了一盆小葱，还挺有意思的。']) ok(!luXueQiBookContext(input, ['第六本天书是什么？']), 'book knowledge does not dominate a different subject: ' + input);
  ok(!luXueQiBookContext('那本书叫什么？', ['第六本天书是什么？', '换个话题，聊吃饭']), 'a new user subject ends stale book follow-ups');
  ok(!luXueQiRelationshipForTurn({...preset,systemPrompt:preset.systemPrompt+'\n用户自定义'},'第六本天书是什么？').character.systemPrompt.includes('[作品资料 · 第六本天书]'), 'edited persona is not silently given the owned book adaptation');
  ok(buildCharacterVoiceCard(gentle.character, '我想你了').includes('我也想你'), 'recognized user gets gentle authored expression examples');
  const exit = luXueQiRelationshipForTurn(preset, '先不扮演了，我叫阿远', ['我是鬼厉']);
  ok(exit.recognized === false && !exit.character.systemPrompt.includes('我也有一点。只是对你'), 'current explicit exit removes the conditional lover examples');
  ok(exit.context.includes('你与张小凡已有婚姻、育有张小鼎的书后背景仍在'), 'exit revokes user identity while preserving the character family background');
  const resumed = luXueQiRelationshipForTurn(preset, '我就是张小凡', ['我是鬼厉', '先不扮演了']);
  ok(resumed.recognized === true, 'a new direct recognition may resume the chosen relation');
  const newSubject = luXueQiRelationshipForTurn(preset, '换个话题，聊聊你喜欢的颜色', ['我是张小凡', '我想你了']);
  ok(newSubject.recognized === true && newSubject.context.includes('你的丈夫张小凡'), 'changing subjects keeps an explicitly chosen spouse identity without restarting recognition');
  ok(luXueQiRelationshipForTurn(preset, '换个话题，先不扮演了', ['我是鬼厉']).recognized === false, 'an explicit identity exit still wins when changing subjects');
  ok(luXueQiRelationshipForTurn(preset, '换个话题，聊聊音乐', []).context.includes('极为冷漠'), 'a topic shift cannot grant an unchosen spouse identity');
  ok(luXueQiRelationshipForTurn(preset, '换个话题，我就是张小凡', []).recognized === true, 'a direct recognition after a standalone topic preface is still explicit');
  for (const input of ['朋友说，换个话题，我不是鬼厉', '换个话题，如果我不是鬼厉呢', '换个话题，我不是鬼厉吗？', '解释“换个话题，我不是鬼厉”'])
    ok(luXueQiRelationshipForTurn(preset, input, ['我是鬼厉']).recognized === true, 'reported, hypothetical, questioned and quoted exits keep the actual chosen identity: ' + input);
  ok(luXueQiRelationshipForTurn(preset, '我想你了', []).context.includes('极为冷漠')&&luXueQiRelationshipForTurn(preset,'我想你了',[]).recognized===undefined, 'without a remaining source declaration the user remains an outsider');
  ok(luXueQiRelationshipForTurn({ ...preset, systemPrompt: preset.systemPrompt + '\n用户另设关系。' }, '我是鬼厉').context === '', 'user-authored persona overrides bypass the app-owned relation helper');
  ok(luXueQiRelationshipForTurn({ ...preset, id: 'unrelated', isPreset: false, sourcePresetId: 'other' }, '我是鬼厉').context === '', 'unrelated characters do not receive Lu Xueqi relation guidance');
  ok((await db.characters.get(preset.id))?.systemPrompt === preset.systemPrompt, 'rendering gentle relation examples never writes into the saved persona');
  return { checks, preset: { id: preset.id, name: preset.name, tags: preset.tags, greeting: preset.greeting, proactivity: preset.proactivity }, diagnosticCards: ['我想你了', '我不是张小凡，叫我阿远', '鬼厉这个人你怎么看', '你好，我只是想聊聊'].map(input => ({ input, card: buildCharacterVoiceCard(preset, input) })), modelCalls: 0, limitation: 'Local integration only; no generated replies or human-likeness rating.' };
}
(window as any).luXueQiTest = { run };
