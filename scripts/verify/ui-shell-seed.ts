import {db} from '../../src/db';
import {useAuthStore} from '../../src/store/auth-store';
(window as any).shellSeed=async()=>{
  const userId='ui-shell-user';
  await db.open();
  await db.users.put({id:userId,username:'星域旅人',passwordHash:'local-fixture-only',createdAt:1});
  for(const [index,name] of ['星澜','林间的晚风','一个名字很长但仍然需要清晰展示的角色'].entries()) {
    const id=`ui-shell-role-${index}`,sessionId=`ui-shell-session-${index}`;
    await db.characters.put({id,name,avatar:['🌙','🌿','🌌'][index],createdBy:userId,createdAt:1,isPreset:false,isCustom:true,published:false,tags:['日常'],signature:'一起把普通的日子，慢慢过成故事。',proactivity:0,systemPrompt:'本地界面检查，无真实模型请求'});
    await db.sessions.put({id:sessionId,characterId:id,userId,title:name,createdAt:1,updatedAt:Date.now(),unreadCount:0,modelAsked:true});
    await db.messages.put({id:`ui-shell-msg-${index}`,sessionId,role:'assistant',content:'今天的晚风很舒服，你那边怎么样？',createdAt:Date.now()-index*60000,isProactive:false});
  }
  const sessionId='ui-shell-session-0',now=Date.now()-300000;
  await db.messages.bulkPut([
    {id:'ui-shell-long',sessionId,role:'assistant',content:'如果今天有点累，就先停下来歇一会儿吧。窗外还有晚风，杯子里还有温水，我们不用急着把所有事情都做完。你可以慢慢说，我会听着。',createdAt:now,isProactive:false},
    {id:'ui-shell-user-reply',sessionId,role:'user',content:'嗯，想在这里多待一会。',createdAt:now+5000,isProactive:false},
    {id:'ui-shell-voice',sessionId,role:'assistant',content:'当然可以。',audio:{dataUrl:'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=',duration:2,text:'当然可以。'},createdAt:now+10000,isProactive:false},
    {id:'ui-shell-failed',sessionId,role:'user',content:'刚才没有发成功的这一句，先留在这里。',failed:true,createdAt:now+15000,isProactive:false},
  ]);
  const date=new Date(),today=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  for(const [index,title] of ['读完那本一直想读的书','傍晚散步，顺路买一点水果','等朋友确认周末的时间'].entries()) {
    const id=`ui-shell-todo-${index}`;
    await db.todos.put({id,userId,title,note:'把日子慢慢安排好，也给自己留一点空白。',status:'todo',priority:index===0?'important':'normal',dueDate:today,recurrence:{kind:'none'},visibility:'private',source:'manual',workStatus:index===2?'waiting':'todo',createdAt:now,updatedAt:now});
    await db.todoOccurrences.put({id:`todo-occ:${id}:${today}`,userId,todoId:id,dueDate:today,scheduledDate:today,originalDueDate:today,status:'todo',createdAt:now,updatedAt:now});
  }
  await db.moments.put({id:'ui-shell-moment',userId,text:'在回家的路上看到了一片好看的晚霞。普通的一天，也有值得留下来的小片段。',visibility:'all',audienceCharacterIds:[],visibilityRevision:1,mediaIds:[],createdAt:now,updatedAt:now});
  useAuthStore.getState().login(userId,'星域旅人',null,'🌙');
  db.close();
};
