import { db } from '../../src/db';
import { PRESET_CHARACTERS, initSeedCharacters } from '../../src/lib/seed-init';
import { buildCharacterVoiceCard } from '../../src/lib/chat-humanizer';
import { useChatStore } from '../../src/store/chat-store';
import { useAuthStore } from '../../src/store/auth-store';
import { LU_XUE_QI_V1_PROMPT, LU_XUE_QI_V2_PROMPT, LU_XUE_QI_V3_PROMPT, LU_XUE_QI_V4_PROMPT, LU_XUE_QI_V5_PROMPT } from '../../src/lib/lu-xue-qi-preset-v1';
import { voicePromptRevision } from '../../src/lib/character-voice';
import { luXueQiIdentityChoice, luXueQiRelationshipForTurn } from '../../src/lib/lu-xue-qi-runtime';

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
  const otherVersions = [LU_XUE_QI_V2_PROMPT, LU_XUE_QI_V3_PROMPT, LU_XUE_QI_V4_PROMPT, LU_XUE_QI_V5_PROMPT];
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
  ok(gentle.recognized === true && gentle.context.includes('温柔') && gentle.context.includes('不另添婚姻'), 'original user choice remains available beyond the short dialogue window without inventing marriage');
  ok(buildCharacterVoiceCard(gentle.character, '我想你了').includes('我也想你'), 'recognized user gets gentle authored expression examples');
  const exit = luXueQiRelationshipForTurn(preset, '先不扮演了，我叫阿远', ['我是鬼厉']);
  ok(exit.recognized === false && !exit.character.systemPrompt.includes('我也有一点。只是对你'), 'current explicit exit removes the conditional lover examples');
  const resumed = luXueQiRelationshipForTurn(preset, '我就是张小凡', ['我是鬼厉', '先不扮演了']);
  ok(resumed.recognized === true, 'a new direct recognition may resume the chosen relation');
  ok(luXueQiRelationshipForTurn(preset, '我想你了', []).context === '', 'without a remaining source declaration no cached lover identity is restored');
  ok(luXueQiRelationshipForTurn({ ...preset, systemPrompt: preset.systemPrompt + '\n用户另设关系。' }, '我是鬼厉').context === '', 'user-authored persona overrides bypass the app-owned relation helper');
  ok(luXueQiRelationshipForTurn({ ...preset, id: 'unrelated', isPreset: false, sourcePresetId: 'other' }, '我是鬼厉').context === '', 'unrelated characters do not receive Lu Xueqi relation guidance');
  ok((await db.characters.get(preset.id))?.systemPrompt === preset.systemPrompt, 'rendering gentle relation examples never writes into the saved persona');
  return { checks, preset: { id: preset.id, name: preset.name, tags: preset.tags, greeting: preset.greeting, proactivity: preset.proactivity }, diagnosticCards: ['我想你了', '我不是张小凡，叫我阿远', '鬼厉这个人你怎么看', '你好，我只是想聊聊'].map(input => ({ input, card: buildCharacterVoiceCard(preset, input) })), modelCalls: 0, limitation: 'Local integration only; no generated replies or human-likeness rating.' };
}
(window as any).luXueQiTest = { run };
