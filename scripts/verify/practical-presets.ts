import { db, type Character, type Session, type Message, type MemoryItem } from '../../src/db';
import { initSeedCharacters } from '../../src/lib/seed-init';
import { PRACTICAL_PRESETS } from '../../src/lib/practical-presets';
const report=window.fetch.bind(window);let count=0,calls=0;
function check(v:unknown,label:string){if(!v)throw Error(label);count++;}
async function run(){
 await db.delete();await db.open();
 const owned={id:'owned-fixture',name:'我的角色',systemPrompt:'用户自己的设定',avatar:'🌙',createdBy:'owner',isPreset:false,isCustom:true,createdAt:1} as Character;
 const session={id:'session-fixture',userId:'owner',characterId:owned.id,createdAt:1} as Session;
 const message={id:'message-fixture',sessionId:session.id,role:'user',content:'旧聊天内容',createdAt:1} as Message;
 const memory={id:'memory-fixture',userId:'owner',characterId:owned.id,content:'旧记忆',type:'auto',createdAt:1} as MemoryItem;
 await db.characters.add(owned);await db.sessions.add(session);await db.messages.add(message);await db.memories.add(memory);
 window.fetch=async()=>{calls++;throw Error('unexpected network');};
 await initSeedCharacters();
 for(const preset of PRACTICAL_PRESETS){
  const stored=await db.characters.get(preset.id);check(stored?.isPreset&&stored.name===preset.name,'preset registered '+preset.name);
  const image=new Image();image.src=stored!.avatar;await image.decode();check(image.width===256&&image.height===256,'offline portrait decodes '+preset.name);
  check(stored!.systemPrompt.length>700&&stored!.greeting.includes(preset.name),'complete persona '+preset.name);
 }
 await initSeedCharacters();
 check((await db.characters.toArray()).filter(c=>PRACTICAL_PRESETS.some(p=>p.id===c.id)).length===3,'repeat startup is idempotent');
 check(JSON.stringify(await db.characters.get(owned.id))===JSON.stringify(owned),'owned persona untouched');
 check(JSON.stringify(await db.sessions.get(session.id))===JSON.stringify(session),'session untouched');
 check(JSON.stringify(await db.messages.get(message.id))===JSON.stringify(message),'chat history untouched');
 check(JSON.stringify(await db.memories.get(memory.id))===JSON.stringify(memory),'memory untouched');
 check(calls===0,'preset initialization has zero model/network calls');
 window.fetch=report;await report('/result?suite=practical-presets',{method:'POST',body:`ok ${count} assertions\nALL PASS`});
}
run().catch(async e=>{window.fetch=report;await report('/result?suite=practical-presets',{method:'POST',body:`FAIL ${e.stack}\n1 FAILED`});});
