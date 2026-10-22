import {db,type Character} from '../../src/db';
import {initSeedCharacters,PRESET_CHARACTERS} from '../../src/lib/seed-init';
import {avatarImageSrc} from '../../src/lib/avatar';
import {collectSyncData,importSyncData} from '../../src/lib/sync';

(window as any).presetAvatarPortability=async()=>{
 const checks:string[]=[];const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
 await db.delete();await db.open();await initSeedCharacters();
 const owner='preset-avatar-owner',presets=PRESET_CHARACTERS.filter(c=>c.avatar.startsWith('preset-avatar:'));
 const copies=presets.map(p=>({...p,id:'owned-'+p.id,sourcePresetId:p.id,createdBy:owner,isPreset:false,isCustom:true,systemPrompt:p.systemPrompt+'\n用户自定义段落',createdAt:1})) as Character[];
 await db.characters.bulkAdd(copies);
 for(const copy of copies){const image=new Image(),source=avatarImageSrc(copy.avatar);check(!!source,copy.id+' stable identity resolves');image.src=source!;await image.decode();check(image.naturalWidth>0,copy.id+' original offline image decodes');}
 const legacy='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
 check(avatarImageSrc(legacy)===legacy,'existing data URI remains unchanged');
 check(avatarImageSrc('https://example.com/avatar.png')==='https://example.com/avatar.png','existing custom remote avatar remains unchanged');
 check(avatarImageSrc('blob:local-avatar')==='blob:local-avatar','existing uploaded blob remains unchanged');
 check(!!avatarImageSrc('secretary-avatar:gentle:female'),'existing secretary identity still resolves');
 for(const value of ['','🌙','__proto__','constructor','preset-avatar:../../private','preset-avatar:preset-no-such-id'])check(avatarImageSrc(value)===undefined,'invalid/non-image identity does not become an asset URL: '+value);
 await initSeedCharacters();
 for(const copy of copies){const current=await db.characters.get(copy.id);check(current?.avatar===copy.avatar&&current.createdBy===copy.createdBy&&current.systemPrompt.includes('用户自定义段落'),copy.id+' initialization preserves owned avatar, account and custom paragraph');}
 // Existing preset relation migrations may add their known blocks; test their
 // settled output rather than assuming that legacy migration never runs.
 const settled=await db.characters.bulkGet(copies.map(c=>c.id));
 const exported=await collectSyncData(owner,'本地头像验收'),serialized=JSON.stringify(exported);
 for(const copy of copies)check(serialized.includes(copy.avatar),copy.id+' stable avatar is present in actual sync export');
 await db.characters.bulkDelete(copies.map(c=>c.id));
 const imported=await importSyncData(JSON.parse(serialized));check(imported.ok,'real JSON sync import accepts portable avatar identities');
 for(const [index,copy] of copies.entries()){const restored=await db.characters.get(copy.id);check(restored?.avatar===copy.avatar&&restored.createdBy===owner&&restored.systemPrompt===settled[index]?.systemPrompt,copy.id+' sync round trip preserves avatar, owner and settled custom persona');const image=new Image();image.src=avatarImageSrc(restored!.avatar)!;await image.decode();check(image.naturalWidth>0,copy.id+' restored identity renders original local image');}
 return {status:'pass',checks,scope:'Real IndexedDB seeding, actual avatar resolver, same-origin bundled image decoding and sync JSON round trip. No native filesystem backup, model or Android.'};
};
