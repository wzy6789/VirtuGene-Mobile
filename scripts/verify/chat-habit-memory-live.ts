import './chat-human-live';
import {db} from '../../src/db';
import {useChatStore} from '../../src/store/chat-store';

/** Only the fresh isolated browser DB created by liveExpression.setup. */
async function seedHabitMemory() {
  const session=await db.sessions.get(useChatStore.getState().currentSessionId!);
  if(!session||session.id!=='isolated-live-session')throw Error('Isolated setup required');
  const at=Date.now()-10000;
  await db.sessions.add({id:'isolated-earlier-habit',userId:session.userId,characterId:session.characterId,title:'先前原话',createdAt:at,updatedAt:at});
  await db.messages.add({id:'isolated-earlier-habit-source',sessionId:'isolated-earlier-habit',role:'user',content:'我不爱重复。',revision:1,createdAt:at,isProactive:false});
  await db.memories.add({id:'isolated-habit-memory',userId:session.userId,characterId:session.characterId,content:'用户不爱重复',type:'auto',status:'active',memoryKind:'preference',stability:'stable',pinned:true,confidence:1,createdAt:at+1,sourceSessionId:'isolated-earlier-habit',sourceMessageIds:['isolated-earlier-habit-source'],sourceMessageRevisions:{'isolated-earlier-habit-source':1}});
}
(window as any).habitMemoryTest={seedHabitMemory};
