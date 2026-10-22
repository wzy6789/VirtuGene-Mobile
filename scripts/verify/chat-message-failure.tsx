import './chat-stream';
import {db,type Message} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
import {useAuthStore} from '../../src/store/auth-store';
import {useChatStore} from '../../src/store/chat-store';
const api=window as any,owner='stream-test-user',sessionId='a',characterId='a';
const sameAccount=()=>useAuthStore.getState().userId===owner;
api.failureGuard={
 async editCurrent(){
  const current=(await db.messages.where('sessionId').equals(sessionId).toArray()).filter(row=>row.role==='user').sort((a,b)=>a.createdAt-b.createdAt).at(-1)!;
  await messageRepo.update(current.id,{content:'用户已经改写为新的内容。'});
  const edited=(await db.messages.get(current.id))!;
  useChatStore.getState().updateMessage(edited.id,edited);
  return edited;
 },
 async state(){return {rows:await db.messages.where('sessionId').equals(sessionId).sortBy('createdAt'),store:useChatStore.getState().messages.filter(row=>row.sessionId===sessionId)};},
 async repositoryChecks(){
  const checks:string[]=[],rows:any[]=[];
  const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
  const guarded=(messageRepo as any).markFailedIfUnchanged as (source:Message,userId:string,characterId:string,isCurrent:()=>boolean)=>Promise<boolean>;
  check(typeof guarded==='function','source-guarded failure API exists');
  for(const scenario of ['unchanged','content','image','role','revision','createdAt','session','owner','character','group','dispatch-task','dispatch-origin','dispatch-name','deleted','account','post-write-account','secretary']){
   await api.chatStreamTest.setup(0);
   const original:Message={id:'failure-guard-user',sessionId,role:'user',content:'合成请求。',image:'synthetic-image-a',revision:1,createdAt:1000,isProactive:false,secretaryDispatch:{taskId:'dispatch-1',assistantName:'合成助理',bodyOrigin:'literal'}};
   await db.messages.put(original);
   if(scenario==='content')await messageRepo.update(original.id,{content:'另一版合成请求。'});
   if(scenario==='image')await db.messages.update(original.id,{image:'synthetic-image-b'});
   if(scenario==='role')await db.messages.update(original.id,{role:'assistant'});
   if(scenario==='revision')await db.messages.update(original.id,{revision:2});
   if(scenario==='createdAt')await db.messages.update(original.id,{createdAt:1001});
   if(scenario==='session')await db.messages.update(original.id,{sessionId:'other-session'});
   if(scenario==='owner')await db.sessions.update(sessionId,{userId:'other-owner'});
   if(scenario==='character')await db.sessions.update(sessionId,{characterId:'b'});
   if(scenario==='group')await db.sessions.update(sessionId,{type:'group'});
   if(scenario==='dispatch-task')await db.messages.update(original.id,{secretaryDispatch:{...original.secretaryDispatch!,taskId:'dispatch-2'}});
   if(scenario==='dispatch-origin')await db.messages.update(original.id,{secretaryDispatch:{...original.secretaryDispatch!,bodyOrigin:'edited'}});
   if(scenario==='dispatch-name')await db.messages.update(original.id,{secretaryDispatch:{...original.secretaryDispatch!,assistantName:'另一位合成助理'}});
   if(scenario==='deleted')await db.messages.delete(original.id);
   if(scenario==='account')useAuthStore.setState({userId:'other-owner'});
   if(scenario==='secretary')await db.characters.update(characterId,{agentProfile:'secretary'});
   let calls=0;
   const allowed=scenario==='post-write-account'?()=>{calls++;return calls<4;}:sameAccount;
   const marked=await guarded(original,owner,characterId,allowed);
   const current=await db.messages.get(original.id);
   const valid=scenario==='unchanged'||scenario==='secretary';
   check(marked===valid&&!!current?.failed===valid,'only unchanged authorized source is marked on '+scenario);
   if(scenario==='post-write-account')check(calls===4&&!current?.failed,'guard change after write rolls back native transaction');
   rows.push({scenario,marked,guardCalls:calls,current});
  }
  return {checks,rows};
 },
};
