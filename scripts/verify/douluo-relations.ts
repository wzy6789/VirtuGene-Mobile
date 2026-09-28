import { db, type Character } from '../../src/db';
import { compactDouluoDirectorPersona, reviseDouluoPresetPrompt, syncDouluoRelations, withDouluoRelations } from '../../src/lib/douluo-relations';
import { stateRepo } from '../../src/db/state-repo';
import { buildStoryRelationContext } from '../../src/lib/chat-context';
import { initSeedCharacters } from '../../src/lib/seed-init';
const report = window.fetch.bind(window); let count = 0;
function check(value: unknown, label: string): void { if (!value) throw Error(label); count++; }
async function run() {
  await db.delete(); await db.open();
  const make = (id: string, source: string, user = 'u') => ({ id, sourcePresetId: 'preset-' + source, createdBy: user, isPreset: false, systemPrompt: '自定义性格', name: id } as Character);
  const chars = [make('father', 'tangsan'), make('mother', 'xiaowu'), make('daughter', 'tangwutong'), make('son-in-law', 'huoyuhao'), make('daughter-in-law', 'guyuena'), make('student', 'baixiuxiu'), make('other-owner', 'xiaowu', 'v')];
  await db.characters.bulkPut(chars);
  await stateRepo.getOrCreate('father', 'u');
  await db.characterStates.update(['father', 'u'], { affinity: 87, mood: 92, lifeFocus: '已有成长' });
  const history = JSON.stringify(await Promise.all([db.memories.toArray(), db.messages.toArray(), db.sessions.toArray()]));
  await syncDouluoRelations();
  const states = await stateRepo.getAllByUser('u');
  check(states.every((s) => s.storyRelations?.length === 5), 'six owned roles form fifteen bilateral pairs');
  const father = (await stateRepo.get('father', 'u'))!;
  check(father.affinity === 87 && father.mood === 92 && father.lifeFocus === '已有成长', 'existing state values retained');
  check(!states.some((s) => s.storyRelations?.some((r) => r.targetCharacterId === 'other-owner')), 'no cross-owner links');
  check(buildStoryRelationContext(father, chars).includes('父女'), 'live chat context reads seeded relations');
  const before = JSON.stringify(states);
  await syncDouluoRelations();
  check(before === JSON.stringify(await stateRepo.getAllByUser('u')), 'startup is idempotent');
  await stateRepo.replaceStoryRelations('father', 'u', [{ characterId: 'mother', label: '用户改的关系' }]);
  await syncDouluoRelations();
  const modified = (await stateRepo.get('father', 'u'))!;
  check(modified.storyRelations?.length === 1 && modified.storyRelations[0].label === '用户改的关系', 'edited and deleted pairs never restored');
  check(history === JSON.stringify(await Promise.all([db.memories.toArray(), db.messages.toArray(), db.sessions.toArray()])), 'no fabricated memories or chat changes');
  const prompt = withDouluoRelations('自写的人设', 'preset-guyuena');
  check(prompt.startsWith('自写的人设') && prompt.includes('师徒') === false && prompt.includes('娜娜老师'), 'custom text retained and family context provided');
  check(withDouluoRelations(prompt, 'preset-guyuena') === prompt, 'prompt supplement idempotent');
  check(withDouluoRelations('其他人设', 'preset-aili') === '其他人设', 'unrelated presets untouched');
  const kinship = [
    ['tangsan', '儿子'], ['xiaowu', '儿子'], ['huoyuhao', '内弟'],
    ['tangwutong', '弟弟'], ['baixiuxiu', '长辈'], ['guyuena', '丈夫'],
  ];
  for (const [id, relation] of kinship) {
    const revised = withDouluoRelations('自写的人设', `preset-${id}`);
    check(revised.includes(`【用户自称唐舞麟】`) && revised.includes(relation), `${id} recognizes the correct relation`);
    check(revised.includes('引述小说') && revised.includes('不擅自叫他舞麟'), `${id} does not infer identity from a quotation`);
    check(compactDouluoDirectorPersona(revised, `preset-${id}`).includes(relation), `${id} relation survives scene director budget`);
    check(revised.includes('当前时间线：全家团圆之后') && revised.includes('团圆不等于全家此刻都在同一个房间'), `${id} reunion timeline and presence boundaries are explicit`);
    check(compactDouluoDirectorPersona(revised, `preset-${id}`).includes('当前时间线：全家团圆之后'), `${id} scene director keeps the reunion timeline`);
  }
  const legacy = '**你现在与用户素不相识**：用户不是你原著里的小舞或旧友，旧身份判断。\n- 性格：冷静理智；小舞是刻骨铭心的旧爱\n用户自写：喜欢聊编程。';
  const migrated = reviseDouluoPresetPrompt(legacy, 'preset-tangsan');
  check(!migrated.includes('旧爱') && !migrated.includes('素不相识') && migrated.includes('喜欢聊编程'), 'only old authored contradictions are removed');
  check(reviseDouluoPresetPrompt(migrated, 'preset-tangsan') === migrated, 'preset migration is idempotent');
  await db.characters.put({ ...make('legacy-father', 'tangsan'), systemPrompt: legacy });
  const oldHistory = JSON.stringify(await Promise.all([db.messages.toArray(), db.sessions.toArray(), db.memories.toArray()]));
  await initSeedCharacters();
  const ownedPrompt = (await db.characters.get('legacy-father'))?.systemPrompt ?? '';
  check(ownedPrompt.includes('喜欢聊编程') && ownedPrompt.includes('对小舞始终专一'), 'startup migrates only authored preset wording in an owned character');
  check(!ownedPrompt.includes('素不相识') && !ownedPrompt.includes('旧爱'), 'owned prompt no longer contradicts current family timeline');
  check(oldHistory === JSON.stringify(await Promise.all([db.messages.toArray(), db.sessions.toArray(), db.memories.toArray()])), 'startup preserves user conversations and memories');
  for (const [id] of kinship) {
    check((await db.characters.get(`preset-${id}`))?.systemPrompt.includes('当前时间线：全家团圆之后'), `${id} actual seeded character receives reunion setting`);
  }
  check(ownedPrompt.includes('当前时间线：全家团圆之后'), 'existing owned copy receives reunion setting without re-adding the character');
  await report('/result?suite=douluo-relations', { method: 'POST', body: `ok ${count} assertions\nALL PASS` });
}
run().catch(async e => { await report('/result?suite=douluo-relations', { method: 'POST', body: `FAIL ${e.stack}\n1 FAILED` }); });
