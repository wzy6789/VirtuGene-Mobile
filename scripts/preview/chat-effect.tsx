import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ChatWindow} from '../../src/components/chat/ChatWindow';
import {db,type Message} from '../../src/db';
import {useChatStore} from '../../src/store/chat-store';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useUIStore} from '../../src/store/ui-store';
import {fakeCharacter} from '../verify/world-harness';
import {splitReplyParts} from '../../src/lib/chat-pacing';

const owner='chat-effect-preview',session='chat-effect-session';
const styles=[
  {name:'专业',reply:'先看最急的那份。---把报告发来，我先核对结论和数据。今晚不必把所有问题一起处理。'},
  {name:'搭档',reply:'这一天够长的。---报告拿来，我们先把最卡的那段捋顺，其他的晚点再说。'},
  {name:'温柔',reply:'好，今天先不用解释那么多。---把报告给我吧，我陪你看。最费神的那段先拆开。'},
  {name:'元气',reply:'今天的电量见底了吧。---报告拿来！先过最急的一关，别的先不加戏。'},
  {name:'俏皮',reply:'今天的脑袋已经申请下班了。---报告给我看看，先揪最难缠的那段。今晚不搞全盘大扫除。'},
];
let current=2;
function messages(index:number):Message[]{
  const now=Date.now();
  const entries=[{role:'user' as const,content:'你还记得我说过那家书店呀？'},
    {role:'assistant' as const,content:'记得呀'},
    {role:'assistant' as const,content:'你说想找个安静的角落，一坐就是一下午。那个画面挺好记的😂'},
    {role:'user' as const,content:'今天好累，那个报告你帮我看看呗'},
    ...splitReplyParts(styles[index].reply).map(content=>({role:'assistant' as const,content}))];
  return entries.map((entry,i)=>({id:`effect-${index}-${i}`,sessionId:session,...entry,createdAt:now-60000+i*1000,isProactive:false}));
}
async function select(index:number){
  current=index;
  const role=fakeCharacter('chat-effect-role','星遥',owner,{tags:[styles[index].name],signature:'有自己的想法，也愿意听你说',systemPrompt:`你是星遥，${styles[index].name}风格。\n对话样本：用户说你好 → 你说在呢。`});
  await db.characters.put(role);
  useChatStore.setState({characters:[role],selectedCharacterId:role.id,currentSessionId:session,messages:messages(index),hasMoreMessages:false});
}
window.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:styles[current].reply},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
async function start(){
  useAuthStore.getState().login(owner,'你','isolated-preview-key','');
  useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false,chatFontSize:16});
  useUIStore.setState({mobileTab:'chat',activeView:'chat'});
  await db.sessions.put({id:session,characterId:'chat-effect-role',userId:owner,title:'星遥',createdAt:Date.now(),updatedAt:Date.now(),modelAsked:true});
  await select(current);
  function Preview(){const [selected,setSelected]=useState(current);return <main style={{height:'100dvh',display:'flex',flexDirection:'column',maxWidth:540,margin:'0 auto'}}>
    <div style={{padding:'8px 12px',fontSize:12,color:'var(--text-sub)',textAlign:'center',borderBottom:'1px solid var(--line)'}}>软件聊天界面 · 固定演示对话，不是实时模型输出</div>
    <div style={{display:'flex',padding:'8px',gap:4}}>{styles.map((style,i)=><button key={style.name} onClick={()=>{setSelected(i);void select(i);}} style={{flex:1,minHeight:38,borderRadius:12,color:i===selected?'var(--accent)':'var(--text-sub)',background:i===selected?'var(--surface)':'transparent',border:'1px solid var(--line)'}}>{style.name}</button>)}</div>
    <div style={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}><ChatWindow /></div>
  </main>}
  createRoot(document.getElementById('app')!).render(<Preview />);
}
void start();
