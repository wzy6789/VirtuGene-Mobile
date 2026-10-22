import Dexie from 'dexie';
import { db, type Character } from '../../src/db';
import { characterEditorDraft as drafts } from '../../src/db/character-editor-draft';
import { commitCharacterEditor } from '../../src/db/character-editor-save';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { collectSyncData } from '../../src/lib/sync';
import { readCharacterDraftData } from '../../src/lib/character-editor-draft-data';

Object.assign(window, { draftStorageChecks: async () => {
  const checks: string[] = [];
  const check = (ok: unknown, label: string) => { if (!ok) throw Error(label); checks.push(label); };
  const rejects = async (operation: () => Promise<unknown>, message: string) => {
    try { await operation(); return false; } catch (error) { return error instanceof Error && error.message === message; }
  };
  await db.delete();
  const legacy = new Dexie(db.name);
  legacy.version(41).stores(Object.fromEntries(db.tables.filter(table => table.name !== 'characterEditorDrafts')
    .map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(',')])));
  await legacy.open();
  const role: Character = { id: 'draft-role', createdBy: 'one', name: '旧名字', avatar: '星', systemPrompt: '独立设定', tags: [],
    signature: '', greeting: '', isPreset: false, isCustom: true, published: false, proactivity: 0, createdAt: 1 };
  const tombstone = { id: 'keep', userId: 'one', characterId: role.id, sourceType: 'message', sourceId: 'message', sourceRevision: 1,
    status: 'deleted', suppressedMessageIds: ['suppressed'], updatedAt: 1 };
  await legacy.table('characters').put(role);
  await legacy.table('memorySourceTombstones').put(tombstone);
  legacy.close(); await db.open();
  check(db.verno >= 42 && !!db.characterEditorDrafts, 'v41 upgrades retain the additive v42 draft table');
  check(JSON.stringify(await db.characters.get(role.id)) === JSON.stringify(role), 'upgrade retains established character row');
  check(JSON.stringify(await db.memorySourceTombstones.get('keep')) === JSON.stringify(tombstone), 'upgrade retains source revocation row');
  check((await db.memorySourceTombstones.where('[userId+characterId]').equals(['one', role.id]).count()) === 1
    && (await db.memorySourceTombstones.where('suppressedMessageIds').equals('suppressed').count()) === 1,
  'upgrade retains compound scope and suppressed-message indexes');
  await legacy.open();
  check((await legacy.table('characters').get(role.id))?.name === role.name, 'prior v41 Dexie client can reopen and read established records');
  legacy.close();
  check(db.characterEditorDrafts.schema.indexes.some(index => index.name === '[userId+characterId]'), 'prior client reopening does not remove additive draft schema');
  const first = await drafts.write('one', undefined, 'draft-content-only-one', null, () => true);
  await drafts.write('two', undefined, 'draft-content-only-two', null, () => true);
  check((await drafts.read('one'))?.payload === 'draft-content-only-one' && (await drafts.read('two'))?.payload === 'draft-content-only-two', 'new-character drafts isolate accounts');
  check(await rejects(() => drafts.write('one', undefined, 'stale', null, () => true), 'draft:conflict'), 'stale writer cannot replace current draft');
  const cleared = await drafts.write('one', undefined, null, first.revision, () => true);
  check(await rejects(() => drafts.write('one', undefined, 'resurrected', first.revision, () => true), 'draft:conflict'), 'cleared revision blocks late content resurrection');
  const current = await drafts.write('one', undefined, 'draft-content-only-new', cleared.revision, () => true);
  check(await rejects(() => drafts.write('one', role.id, 'foreign', null, () => false), 'draft:context'), 'inactive context cannot write');
  check(await rejects(() => drafts.write('two', role.id, 'foreign', null, () => true), 'draft:unavailable'), 'foreign account cannot create edit draft for owned role');
  try {
    await commitCharacterEditor(async () => {
      await db.characters.update(role.id, { name: '未提交名字' });
      await drafts.write('one', undefined, null, current.revision, () => true);
      throw Error('rollback');
    });
  } catch (error) { if (!(error instanceof Error) || error.message !== 'rollback') throw error; }
  check((await db.characters.get(role.id))?.name === '旧名字' && (await drafts.read('one'))?.payload === 'draft-content-only-new', 'failed role commit retains both formal data and recoverable draft');
  await commitCharacterEditor(async () => {
    await db.characters.update(role.id, { name: '已提交名字' });
    await drafts.write('one', undefined, null, current.revision, () => true);
  });
  check((await db.characters.get(role.id))?.name === '已提交名字' && (await drafts.read('one'))?.payload === null, 'successful role save clears draft in same commit');
  check(await rejects(() => drafts.write('one', undefined, 'late', current.revision, () => true), 'draft:conflict'), 'old window cannot reinsert draft after successful role save');
  const forEdit = await drafts.write('one', role.id, 'draft-content-only-edit', null, () => true);
  check(forEdit.id !== current.id, 'new and specific-role draft identities differ');
  const exported = await collectSyncData('one', 'fixture');
  check(!JSON.stringify(exported).includes('draft-content-only') && !('characterEditorDrafts' in exported), 'draft contents are excluded from sync and backup data collection');
  useAuthStore.setState({ userId: 'one', apiKey: null });
  await useChatStore.getState().deleteCharacterWithSessions(role.id);
  check(!await drafts.read('one', role.id), 'deleting role removes its edit draft');
  check(await rejects(() => drafts.write('one', role.id, 'late', null, () => true), 'draft:unavailable'), 'late writer cannot recreate deleted-role draft');
  const old = await drafts.read('one');
  await drafts.write('one', undefined, 'private-own-draft', old!.revision, () => true);
  await useChatStore.getState().deleteAccount();
  check(await db.characterEditorDrafts.where('userId').equals('one').count() === 0, 'account cleanup deletes all own draft payloads and revision rows');
  check((await drafts.read('two'))?.payload === 'draft-content-only-two', 'account cleanup preserves another account draft');
  const values = { name:'迁移保留的草稿',avatar:'星',systemPrompt:'还没保存的设定',tags:[],importedMemories:[],signature:'',greeting:'',catchphrase:'',boundaries:'',published:false,
    personality:'gentle',secretaryPreferences:'',userIdentity:'',userRelationship:'',alreadyKnow:false,sharedPast:'',
    fields:{identity:'',personality:'',speechStyle:'',speechExamples:'',boundaries:'',supplement:''},description:'',documentText:null,selectedFile:null };
  const makeDraft = (step:number,version:number,edit=false) => JSON.stringify({ version,values,relationshipTargets:[],relationshipMeta:{},expectedCharacter:edit?'prior-persona':null,
    expectedRelations:'[[],{}]',initialSnapshot:JSON.stringify(values),relationBaseline:'[[],{}]',step,mode:'simple',enableWebSearch:false,previewInput:'你好' });
  for (let step=0;step<4;step++) {
    const migrated=readCharacterDraftData(makeDraft(step,1));
    check(migrated.version===2&&migrated.step===[0,3,1,4][step]&&migrated.values.name===values.name,'four-step creation draft migrates semantic step and retains content');
    check(readCharacterDraftData(makeDraft(step,1,true)).step===step,'existing editor draft retains four-group position');
  }
  check(readCharacterDraftData(makeDraft(4,2)).step===4,'five-step draft restores final encounter');
  for (const bad of ['{', '{"version":99}', '{"version":1,"values":{"name":[]}}',makeDraft(4,2,true)]) {
    let rejected = false; try { readCharacterDraftData(bad); } catch { rejected = true; }
    check(rejected, 'malformed or unsupported draft rejected without form mutation');
  }
  return { complete: true, checks, count: checks.length, actualModelCalls: 0, android: false };
} });
