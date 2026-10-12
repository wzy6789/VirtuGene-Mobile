import { db } from '../../src/db';
import { voiceProfileRepo } from '../../src/db/voice-profile-repo';
import { stateRepo } from '../../src/db/state-repo';
import { callDeliveryStyle, normalizeVoiceProfile } from '../../src/lib/voice-call/profile';
import { collectSyncData, importSyncData } from '../../src/lib/sync';

async function main() {
  let checks = 0;
  function check(value: unknown, label: string) { if (!value) throw new Error(label); checks++; }
  await db.open();
  const first = await voiceProfileRepo.getOrCreate('call-role', 'account-a');
  const repeat = await voiceProfileRepo.getOrCreate('call-role', 'account-a');
  check(first.voice === repeat.voice && first.updatedAt === repeat.updatedAt, 'default sound identity is persisted once');
  await stateRepo.adjust('call-role', 'account-a', 12, -3);
  const chosen = await voiceProfileRepo.set('call-role', 'account-a', { ...first, voice: 'Dean', delivery: '沉静、留出停顿。' });
  const state = await stateRepo.get('call-role', 'account-a');
  check(state?.affinity === 12 && state.mood === 67, 'profile editing preserves original relationship');
  check(state?.voiceProfile?.voice === 'Dean', 'explicit built-in choice survives persistence');
  await stateRepo.adjust('call-role', 'account-a', 1, 2);
  check((await voiceProfileRepo.getOrCreate('call-role', 'account-a')).voice === 'Dean', 'relationship updates preserve sound identity');
  check((await voiceProfileRepo.getOrCreate('call-role', 'account-b')).voice === '茉莉', 'another account does not inherit the chosen sound');
  check((await voiceProfileRepo.getOrCreate('other-role', 'account-a')).voice === '茉莉', 'another role remains isolated');
  check(!normalizeVoiceProfile({ ...first, voice: 'mimo_default' }), 'cluster-dependent default is rejected');
  check(!normalizeVoiceProfile({ ...first, version: 2 }), 'unknown profile version is rejected');
  check(normalizeVoiceProfile({ ...first, delivery: '字'.repeat(1000) })?.delivery.length === 160, 'delivery style is bounded');
  check(callDeliveryStyle(chosen).includes('沉静、留出停顿。'), 'style is separate from the spoken text');
  try { await voiceProfileRepo.getOrCreate('call-role', ''); throw new Error('missing identity accepted'); } catch (error) { check((error as Error).message === 'voice:identity', 'anonymous storage is rejected'); }
  await db.close(); await db.open();
  check((await voiceProfileRepo.getOrCreate('call-role', 'account-a')).voice === 'Dean', 'voice survives database reopen');
  const archive = await collectSyncData('account-a', null);
  const importedState = archive.characterStates.find(s => s.characterId === 'call-role')!;
  check(importedState.voiceProfile?.voice === 'Dean', 'existing backup export carries voice identity');
  delete importedState.voiceProfile;
  await importSyncData(archive);
  check((await voiceProfileRepo.getOrCreate('call-role', 'account-a')).voice === 'Dean', 'legacy archive lacking voice does not erase the local choice');
  importedState.voiceProfile = { ...chosen, voice: 'Mia', updatedAt: chosen.updatedAt + 10000 };
  await importSyncData(archive);
  check((await voiceProfileRepo.getOrCreate('call-role', 'account-a')).voice === 'Mia', 'newer imported sound choice is applied');
  await stateRepo.deleteByCharacter('call-role', 'account-a');
  check(!(await stateRepo.get('call-role', 'account-a')), 'original character cleanup removes its voice too');
  return { checks, realApiCalls: 0, modelTokens: 0, mode: 'browser-indexeddb', deviceTested: false };
}
main().then(result => { (window as any).voiceProfileResult = result; }).catch(error => { (window as any).voiceProfileResult = { error: String(error) }; });
