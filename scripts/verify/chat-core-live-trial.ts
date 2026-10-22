import type {Message} from '../../src/db';
import {db} from '../../src/db';
import {useChatStore} from '../../src/store/chat-store';
import {ChatReplyStream} from '../../src/lib/chat-stream';
import {sendRoleChatReply,type ChatRequest} from '../../src/lib/chat/send-service';
import {withChatSessionLock} from '../../src/lib/chat/request-coordinator';
import {inspectChatOutput} from '../../src/lib/chat-output-quality';
import {allowsDramaticReply} from '../../src/lib/chat-expression-boundary';
declare const LIVE_PROXY:string;
declare const LIVE_TOKEN:string;
const scope={userId:'isolated-live-expression-owner',sessionId:'isolated-live-session',characterId:'isolated-live-role'};
const actualFetch=window.fetch.bind(window);
Object.assign(window,{
  async prepareCoreTrial(){
    await import('./chat-human-live');
    const harness=(window as any).liveExpression;
    const persona=harness.presets().find((role:any)=>role.name==='古月娜');
    if(!persona)throw Error('Actual Gu preset unavailable');
    await harness.setup(persona);
    window.fetch=async(url,init)=>{
      if(!String(url).includes('/chat/completions'))throw Error('Unexpected external request in bounded live trial');
      const variant=new URL(location.href).pathname.includes('before')?'before':'current';
      const caseId=new URL(location.href).searchParams.get('case')??'initial';
      return actualFetch(LIVE_PROXY+'?variant='+variant+'&case='+encodeURIComponent(caseId),{...init,headers:{'Content-Type':'application/json',Authorization:'Bearer '+LIVE_TOKEN}});
    };
  },
  async runCoreTrialTurn(text:string){
    const actor=await db.characters.get(scope.characterId);if(!actor)throw Error('Missing isolated role');
    const source:Message={id:crypto.randomUUID(),sessionId:scope.sessionId,role:'user',content:text,createdAt:Date.now(),revision:1,isProactive:false};
    await db.messages.add(source);useChatStore.getState().addMessage(source);
    const started=performance.now();let firstPublishedMs:number|undefined;
    const stream=new ChatReplyStream(scope.sessionId,()=>{if(stream.getSnapshot().some(Boolean))firstPublishedMs??=performance.now()-started;});
    const request:ChatRequest={userId:scope.userId,controller:new AbortController(),stream,completed:false,stopped:false};
    let error:string|undefined;
    try{await withChatSessionLock(scope.sessionId,()=>sendRoleChatReply(actor,source,request,{userId:scope.userId,text}));}
    catch{error='send-failed';}finally{stream.dispose();}
    const rows=await db.messages.where('replyToUserMessageId').equals(source.id).sortBy('createdAt');
    return {input:text,replies:rows.map(row=>row.content),completed:request.completed,failed:!!(await db.messages.get(source.id))?.failed,
      firstPublishedMs,totalMs:performance.now()-started,error,rows:rows.map(({sourceEvidenceKey,...row})=>row),
      timingScope:'Publication callback in isolated desktop browser, not an Android presented frame'};
  },
  async inspectRecordedCoreTrialDraft(raw:string,text:string){
    const actor=await db.characters.get(scope.characterId);if(!actor)throw Error('Missing isolated role');
    const rows=await db.messages.where('sessionId').equals(scope.sessionId).sortBy('createdAt');
    const userSources=rows.filter(row=>row.role==='user').map(row=>row.content);
    const own=rows.filter(row=>row.role==='assistant').map(row=>row.content);
    const review=inspectChatOutput(raw,{mode:'private',userMessage:text,persona:actor.systemPrompt,catchphrase:actor.catchphrase,
      recentReplies:own.slice(-4),speakerSources:own,recentUserMessages:userSources,userHabitSources:[...userSources,text],hasCurrentImage:false,hasUserVisualEvidence:false});
    return {...review,fictionalContext:allowsDramaticReply(text,userSources)};
  },
  async seedRecordedCoreTrial(turns:Array<{input:string;replies:string[]}>){
    if(turns.length>10||turns.some(turn=>typeof turn.input!=='string'||turn.replies.some(reply=>typeof reply!=='string')))throw Error('Invalid synthetic replay');
    let createdAt=Date.now()-60000;
    for(const turn of turns){
      const user:Message={id:crypto.randomUUID(),sessionId:scope.sessionId,role:'user',content:turn.input,createdAt:createdAt++,revision:1,isProactive:false};
      await db.messages.add(user);useChatStore.getState().addMessage(user);
      for(const content of turn.replies){
        const reply:Message={id:crypto.randomUUID(),sessionId:scope.sessionId,role:'assistant',content,createdAt:createdAt++,revision:1,isProactive:false,replyToUserMessageId:user.id,replyCompletion:'complete',replyDelivery:'settled'};
        await db.messages.add(reply);useChatStore.getState().addMessage(reply);
      }
    }
  },
});
