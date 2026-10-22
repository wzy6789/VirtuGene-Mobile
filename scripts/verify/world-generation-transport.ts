/** Local model transport only; actual world parsing, queue, review, storage and UI run unchanged. */
export function installWorldGenerationTransport(){
 const encoder=new TextEncoder(),calls:{stage:string;stream:boolean}[]=[],actors:{stream:boolean;controller?:ReadableStreamDefaultController<Uint8Array>;resolve?:(response:Response)=>void;closed:boolean}[]=[];
 const frame=(content:string)=>encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`);
 let failActor=false,suggestions:string[]=[];
 const json=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
 const original=window.fetch;
 window.fetch=async(_input,init)=>{
  const payload=JSON.parse(String(init?.body??'{}')),system=String(payload.messages?.find((m:any)=>m.role==='system')?.content??'');
  const stage=system.startsWith('你是一个"世界意图解析器"')?'intent':system.startsWith('你是一段"共同生活"的导演')?'director':system.startsWith('你现在**只扮演一个角色**')?'actor':system.startsWith('你是一致性守护者')?'guard':system.startsWith('你是一段共同生活里的旁白')?'narrator':system.startsWith('你是一段共同生活的记录者')?'settlement':'unknown';
  calls.push({stage,stream:payload.stream===true});
  if(stage==='intent')return json({intent:'talk',addressedCharacters:['知微'],requiresCharacterResponse:true});
  if(stage==='director'){const choices=suggestions;suggestions=[];return json({narration:'',speakers:[{character:'知微',intent:'回应用户的话',mode:'dialogue'}],sequential:false,worldChanges:[],shouldSettle:false,suggestions:choices});}
  if(stage==='guard')return json({ok:true,issues:[],rewrites:[]});
  if(stage==='narrator')return json({narration:'站台上安静了一会儿。'});
  if(stage==='settlement')return json({events:[],sharedMemories:[],relationshipChanges:[],facts:[],threads:[]});
  if(stage==='actor'){
   if(failActor){failActor=false;return new Response('Controlled denied transport',{status:401});}
   const actor={stream:payload.stream===true,closed:false} as typeof actors[number];actors.push(actor);
   if(!actor.stream)return new Promise<Response>(resolve=>{actor.resolve=resolve;});
   return new Response(new ReadableStream<Uint8Array>({start(controller){actor.controller=controller;controller.enqueue(frame('{"dialogue":"'));}}),{headers:{'Content-Type':'text/event-stream'}});
  }
  throw Error('Unexpected isolated world stage: '+stage);
 };
 return {
  snapshot:()=>({calls:[...calls],actors:actors.map(a=>({stream:a.stream,closed:a.closed}))}),
  failNextActor:()=>{failActor=true;},
  suggestNext:(values:string[])=>{suggestions=values;},
  push:(index:number,text:string)=>{const actor=actors[index];if(!actor?.controller||actor.closed)throw Error('No live world actor');actor.controller.enqueue(frame(text));},
  finish:(index:number,text='')=>{const actor=actors[index];if(!actor||actor.closed)throw Error('No unfinished world actor');actor.closed=true;if(actor.controller){if(text)actor.controller.enqueue(frame(text));actor.controller.enqueue(frame('","action":""}'));actor.controller.enqueue(encoder.encode('data: [DONE]\n\n'));actor.controller.close();}else actor.resolve?.(json({dialogue:text,action:''}));},
  restore:()=>{window.fetch=original;},
 };
}
