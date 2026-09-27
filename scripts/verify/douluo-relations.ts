import { db, type Character } from '../../src/db';
import { syncDouluoRelations, withDouluoRelations } from '../../src/lib/douluo-relations';
import { stateRepo } from '../../src/db/state-repo';
import { buildStoryRelationContext } from '../../src/lib/chat-context';
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
  await report('/result?suite=douluo-relations', { method: 'POST', body: `ok ${count} assertions\nALL PASS` });
}
run().catch(async e => { await report('/result?suite=douluo-relations', { method: 'POST', body: `FAIL ${e.stack}\n1 FAILED` }); });
