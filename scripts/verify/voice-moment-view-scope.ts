import './voice-context-latency';
import { db } from '../../src/db';
import { buildCharacterMemoryContext, type CharacterMemoryRequest } from '../../src/lib/character-memory';
const fixture=window as any;
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
Object.assign(window,{voiceMomentViewScope:async()=>{
 await fixture.voiceContextLatency(true,true,true);
 // Ledger claim IDs are normally random and do not change source text. Give
 // synthetic claims reproducible identities so the FULL context can be hashed.
 let uuid=0;crypto.randomUUID=()=>`00000000-0000-4000-8000-${(++uuid).toString(16).padStart(12,'0')}`;
 const now=Date.now();
 const post={id:'scoped-post',userId:'u',authorCharacterId:null,text:'今晚观星准备望远镜 SCOPE_POST',mediaIds:[],visibility:'selected',audienceCharacterIds:['a','b'],deleted:false,createdAt:now+10,updatedAt:now+10};
 const reaction={id:'scoped-reaction',userId:'u',momentId:post.id,characterId:'b',type:'comment',content:'一起观星 SCOPE_REACTION',status:'active',createdAt:now+10,updatedAt:now+10};
 const view={id:'scoped-view-a',userId:'u',characterId:'a',momentId:post.id,viewedAt:now};
 await db.moments.put(post as any);await db.momentReactions.put(reaction as any);
 await db.momentViews.bulkPut([view,{...view,id:'scoped-view-b',characterId:'b'},
  {...view,id:'foreign-scoped-view',userId:'foreign'}, {...view,id:'other-role-scoped-view',characterId:'c'}]);
 const base={userId:'u',characterId:'a',sources:['moment'],budget:2400} as CharacterMemoryRequest;
 const modes=[{name:'ordinary',request:{...base,topic:'你好'}},{name:'explicit',request:{...base,topic:'还记得观星动态吗'}},
  {name:'shared',request:{...base,audience:['b'],topic:'还记得观星动态吗'}}];
 const rows=[];
 for(let round=0;round<30;round++)for(const mode of modes){
  fixture.resetVoiceContextReadCounts();const start=performance.now();const result=await buildCharacterMemoryContext(mode.request);
  const elapsedMs=performance.now()-start,reads=fixture.voiceContextReadCounts();
  if(!result.references.some(r=>r.id===post.id))throw Error('Expected visible post missing in '+mode.name);
  if(!result.references.some(r=>r.id===reaction.id))throw Error('Expected authorized reaction missing in '+mode.name);
  rows.push({round,mode:mode.name,elapsedMs,reads,hash:await hash(result),ids:result.references.map(r=>r.id)});
 }
 const checks=[];
 async function check(label:string,request:CharacterMemoryRequest,predicate:(ids:string[])=>boolean){
  const result=await buildCharacterMemoryContext(request);const ids=result.references.map(r=>r.id);
  if(!predicate(ids))throw Error(label+': '+JSON.stringify(ids));checks.push({label,hash:await hash(result),ids});
 }
 await db.momentViews.delete(view.id);
 await check('Foreign account/other role views cannot certify a viewed post',modes[0].request,ids=>!ids.includes(post.id)&&!ids.includes(reaction.id));
 await db.momentViews.put(view);
 await db.momentViews.delete('scoped-view-b');
 await check('Shared reaction requires all audience views',modes[2].request,ids=>!ids.includes(reaction.id));
 await db.momentViews.put({...view,id:'scoped-view-b',characterId:'b'});
 for(const patch of [{visibility:'private'},{deleted:true},{audienceCharacterIds:['b']},{userId:'foreign'}]){
  await db.moments.put({...post,...patch} as any);
  await check('Post withdrawal '+JSON.stringify(patch),modes[1].request,ids=>!ids.includes(post.id)&&!ids.includes(reaction.id));
 }
 await db.moments.put(post as any);
 await db.momentContacts.put({id:'block-a',userId:'u',characterId:'a',blocked:true,updatedAt:now} as any);
 await check('Blocked contact cannot retrieve post/reaction',modes[1].request,ids=>!ids.includes(post.id)&&!ids.includes(reaction.id));
 await db.momentContacts.delete('block-a');
 await check('Next fresh request sees restored consent',modes[0].request,ids=>ids.includes(post.id)&&ids.includes(reaction.id));
 await check('Reaction viewing state changed after selection is freshly rechecked',{
  ...modes[0].request,beforeLedgerWrite:async()=>{await db.momentViews.delete(view.id);}
 },ids=>!ids.includes(reaction.id));
 await db.momentViews.put(view);
 // Preserve the existing candidate window: an unseen newer post must not
 // cause an older viewed post beyond the 30-post ordinary window to refill it.
 await db.moments.bulkPut(Array.from({length:35},(_,i)=>({...post,id:'newer-'+i,text:'新的普通动态 '+i,createdAt:now+20+i,updatedAt:now+20+i})) as any);
 await check('Ordinary candidate window unchanged before view filtering',modes[0].request,ids=>!ids.includes(post.id));
 return {rows,checks,apiCalls:0,microphone:false,fixture:{unrelatedSameRoleViews:10000,roundsPerMode:30,modes:3},scope:'Actual memory candidate retrieval with stocked isolated IndexedDB; no model/audio/Android.'};
}});
