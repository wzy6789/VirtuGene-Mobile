import './chat-runtime-voice-stock';
import {db} from '../../src/db';
import {PRESET_CHARACTERS} from '../../src/lib/seed-init';
import {reviseOriginalPresetCard,reviseOriginalPresetVoice} from '../../src/lib/original-preset-voice';

// Use the existing native stock fixture, with the current adopted Lu preset as
// a second role. All exports are synthetic and contain no user credentials.
(window as any).prepareCurrentSpeedFixture=async(role:string)=>{
  const fixture=await (window as any).prepareRuntimeVoiceStock();
  if(role==='陆雪琪'){
    const preset=PRESET_CHARACTERS.find(character=>character.name===role);
    if(!preset)throw Error('Lu preset missing');
    await db.characters.update('resume-actor',{
      ...preset,...reviseOriginalPresetCard(preset,preset.id),id:'resume-actor',
      createdBy:'resume-owner',isPreset:false,isCustom:true,sourcePresetId:preset.id,
      proactivity:0,systemPrompt:reviseOriginalPresetVoice(preset.systemPrompt,preset.id),
    });
  }
  const tables:Record<string,unknown[]>={};
  for(const table of db.tables)tables[table.name]=await table.toArray();
  const data={tables};
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(data))))).map(n=>n.toString(16).padStart(2,'0')).join('');
  return {data,sha256,clock:fixture.clock};
};
