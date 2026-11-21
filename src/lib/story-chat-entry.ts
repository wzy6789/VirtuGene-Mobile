import {db,type Character,type Session,type Message} from '../db';
import {GU_YUE_NA_CARE} from './gu-yue-na-personality';
import {LU_XUE_QI_PRESET} from './lu-xue-qi-preset';
export type StoryEntryChoice='partner'|'visitor';
export interface StoryEntrySelection { choice:StoryEntryChoice; isCurrent:()=>boolean }
export interface StoryEntryProfile { role:'guyuena'|'luxueqi'; partner:string; statement:string; greeting:string }
export function storyEntryProfile(character:Character):StoryEntryProfile|undefined {
  if(character.agentProfile==='secretary'||character.isCustom)return;
  const source=character.isPreset?character.id:character.sourcePresetId;
  if(source==='preset-guyuena'&&character.systemPrompt.includes(GU_YUE_NA_CARE))return {role:'guyuena',partner:'唐舞麟',statement:'我是唐舞麟。',greeting:'舞麟，我想听你说说话。'};
  if(source===LU_XUE_QI_PRESET.id&&character.systemPrompt===LU_XUE_QI_PRESET.systemPrompt)return {role:'luxueqi',partner:'张小凡',statement:'我是张小凡。',greeting:'小凡，我听着。'};
}
/** A visible user choice, not a hidden relationship grant. Existing conversations
 * never get reset by this first-entry path; editing/deleting the source works
 * through the ordinary user-message evidence pipeline. No model request. */
export async function prepareStoryChatEntry(characterId:string,userId:string,choice:StoryEntryChoice,current:()=>boolean):Promise<{sessionId:string;created:boolean}> {
  const check=()=>{if(!userId||!current())throw Error('页面或账号已变化，请重新打开角色。');};
  check();if(choice!=='partner'&&choice!=='visitor')throw Error('请选择故事身份。');
  return db.transaction('rw',db.characters,db.sessions,db.messages,async()=>{
    const character=await db.characters.get(characterId);check();
    if(!character||character.isPreset||character.createdBy!==userId)throw Error('角色已不可用。');
    const profile=storyEntryProfile(character);if(!profile)throw Error('角色设定已变化，请重新打开。');
    const existing=await db.sessions.where('[characterId+userId]').equals([characterId,userId]).filter(row=>row.type!=='group'&&!row.groupId).first();check();
    if(existing)return {sessionId:existing.id,created:false};
    const now=Date.now(),session:Session={id:crypto.randomUUID(),characterId,userId,title:'新对话',createdAt:now,updatedAt:now+1,unreadCount:0,modelAsked:true};
    const source:Message={id:crypto.randomUUID(),sessionId:session.id,role:'user',content:choice==='partner'?profile.statement:`我不是${profile.partner}，以访客身份和你聊天。`,createdAt:now,revision:1,isProactive:false};
    const greeting:Message={id:crypto.randomUUID(),sessionId:session.id,role:'assistant',content:choice==='partner'?profile.greeting:'有事吗？',createdAt:now+1,revision:1,isProactive:false,replyToUserMessageId:source.id,replyCompletion:'complete',replyDelivery:'settled'};
    await db.sessions.add(session);await db.messages.bulkAdd([source,greeting]);check();
    return {sessionId:session.id,created:true};
  });
}
