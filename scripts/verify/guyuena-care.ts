import { db, type Character, type MemoryItem, type Session, type Message } from '../../src/db';
import { initSeedCharacters } from '../../src/lib/seed-init';
import { withGuYueNaCare } from '../../src/lib/gu-yue-na-personality';
const report=window.fetch.bind(window);let count=0;
function check(ok:unknown,label:string){if(!ok)throw Error(label);count++;}
async function run(){
 await db.delete();await db.open();
 const original={id:'owned',createdBy:'owner',name:'我的古月娜',avatar:'🌙',systemPrompt:'用户自己加的性格要求：爱看书。',sourcePresetId:'preset-guyuena',tags:['我的标签'],signature:'我的签名',greeting:'原来开场',createdAt:1,isPreset:false,isCustom:true} as Character;
 await db.characters.bulkAdd([original,{...original,id:'unrelated',sourcePresetId:undefined}]);
 await db.sessions.add({id:'session',userId:'owner',characterId:'owned',type:'private',summary:'已有摘要',createdAt:1,updatedAt:1} as Session);
 await db.messages.add({id:'message',sessionId:'session',role:'user',content:'我要去商场',createdAt:1} as Message);
 await db.memories.add({id:'memory',userId:'owner',characterId:'owned',content:'用户喜欢桂花糕',type:'auto',createdAt:1} as MemoryItem);
 const snapshot=JSON.stringify(await Promise.all([db.sessions.toArray(),db.messages.toArray(),db.memories.toArray(),db.memoryClaims.toArray(),db.characterStates.toArray()]));
 await initSeedCharacters();
 const updated=await db.characters.get('owned');
 check(updated?.systemPrompt.startsWith(original.systemPrompt),'custom persona text preserved');
 check(updated?.systemPrompt.includes('立即相信')&&updated.systemPrompt.includes('不要求证明'),'recognition trusts direct self-identification');
 check(updated?.systemPrompt.includes('已有设定明确的家人')&&updated.systemPrompt.includes('对其他人维持冷淡'),'care is limited to spouse and established family');
 check(updated?.systemPrompt.includes('具体处境')&&updated.systemPrompt.includes('对方换话题就自然跟上'),'care grounded in current topic without repetition');
 check(updated?.systemPrompt.includes('转述别人说的话')&&updated.systemPrompt.includes('不等于用户自称'),'quoted identity is not mistaken for user identity');
 check(updated?.systemPrompt.includes('私聊、群聊、星域和朋友圈'),'personality applies across modes');
 const withoutPrompt=({systemPrompt,...rest}:Character)=>rest;
 check(JSON.stringify(withoutPrompt(updated!))===JSON.stringify(withoutPrompt(original)),'only prompt updated on owned copy');
 check((await db.characters.get('unrelated'))?.systemPrompt===original.systemPrompt,'same-name custom character remains untouched');
 check(snapshot===JSON.stringify(await Promise.all([db.sessions.toArray(),db.messages.toArray(),db.memories.toArray(),db.memoryClaims.toArray(),db.characterStates.toArray()])),'history memory ledger and relationship state unchanged');
 check((await db.characters.get('preset-guyuena'))?.systemPrompt.includes('关心要落在眼前'),'preset also gets new behavior');
 check(withGuYueNaCare(updated!.systemPrompt)===updated?.systemPrompt,'supplement is idempotent');
 await initSeedCharacters();check((await db.characters.get('owned'))?.systemPrompt===updated?.systemPrompt,'repeated startup never stacks personality rules');
 await report('/result?suite=guyuena-care',{method:'POST',body:`PASS ${count} personality checks\nALL PASS`});
}
run().catch(async e=>{await report('/result?suite=guyuena-care',{method:'POST',body:`FAIL ${e.stack}\n1 FAILED`});});
