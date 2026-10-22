// Current owned Gu preset + production sender, isolated synthetic database.
// Only the current main request may reach the explicitly bounded live relay.
import './chat-human-live';
import {db} from '../../src/db';
import {guYueNaRelationshipForTurn} from '../../src/lib/gu-yue-na-runtime';
const harness=(window as any).liveExpression;
const owner='isolated-live-expression-owner',actor='isolated-live-role',sessionId='isolated-live-session';
const mainFetch=window.fetch.bind(window);
let currentInput='',active=false,auxiliaryLocalCalls=0;
window.fetch=async(url,init)=>{
 const body=JSON.parse(String(init?.body));
 if(currentInput&&body.messages?.at(-1)?.content===currentInput)return mainFetch(url,init);
 auxiliaryLocalCalls++;
 return Response.json({choices:[{message:{content:'{}'},finish_reason:'stop'}]});
};
(window as any).guThinking={
 async setup(){
  const preset=harness.presets(true).find((row:any)=>row.name==='古月娜');
  if(!preset)throw Error('Current adopted Gu preset missing');
  const character=await harness.setup({...preset,createdBy:owner,isPreset:false,isCustom:true},.5);
  return {name:character.name,sourcePresetId:character.sourcePresetId,persona:character.systemPrompt,scope:'Current adopted owned preset/runtime; fresh isolated database, no paid auxiliary generation.'};
 },
 async turn(text:string){
  if(active||!text.trim())throw Error('Concurrent/empty synthetic turn');
  active=true;currentInput=text;const auxiliaryBefore=auxiliaryLocalCalls;
  try{
   const character=(await db.characters.get(actor))!;
   const before=await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt');
   const relation=guYueNaRelationshipForTurn(character,text,before.filter(row=>row.role==='user').map(row=>row.content));
   const result=await harness.turn(text);
   return {...result,partnerRecognized:relation.recognized,auxiliaryLocalCalls:auxiliaryLocalCalls-auxiliaryBefore,messages:await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt')};
  }finally{currentInput='';active=false;}
 }
};
