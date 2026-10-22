import './chat-continuity-resume';
import {db} from '../../src/db';
import {reviseGuYueNaPresetPrompt} from '../../src/lib/gu-yue-na-personality';
import {withDouluoRelations} from '../../src/lib/douluo-relations';
import {reviseOriginalPresetCard} from '../../src/lib/original-preset-voice';
// Prepare the same currently adopted app persona used by chat-human-live,
// while retaining the existing complete native stock/measurement harness.
(window as any).prepareRuntimeVoiceStock=async()=>{
 const prior=await (window as any).prepareResumeStock();
 const role=(await db.characters.get('resume-actor'))!;
 await db.characters.update(role.id,{
  ...reviseOriginalPresetCard(role,role.sourcePresetId),
  systemPrompt:withDouluoRelations(reviseGuYueNaPresetPrompt(role.systemPrompt),role.sourcePresetId),
 });
 const tables:Record<string,unknown[]>={};for(const table of db.tables)tables[table.name]=await table.toArray();
 const data={tables},sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))).map(n=>n.toString(16).padStart(2,'0')).join('');
 return {data,sha256,clock:prior.clock};
};
