import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {MessageBubble} from '../../src/components/chat/MessageBubble';
import {PRACTICAL_PRESETS} from '../../src/lib/practical-presets';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import type {Message} from '../../src/db';
declare const CORE_DIALOGUE_GROUPS:Array<{title:string;rows:Array<{input:string;replies:string[]}>}>;
useAuthStore.setState({userId:'isolated-dialogue-review',apiKey:undefined});
useSettingsStore.setState({aiVoiceMode:false,ttsEnabled:false});
// This artifact never imports a connection/key loader or sends a model request.
window.fetch=async()=>{throw Error('Read-only dialogue preview: network API disabled');};
HTMLMediaElement.prototype.play=async()=>{throw Error('Audio disabled in this preview');};
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{throw Error('Microphone disabled in this preview');};
const role=PRACTICAL_PRESETS.find(role=>role.name==='古月娜');
function Preview(){
  const [selected,setSelected]=useState(CORE_DIALOGUE_GROUPS.length-1);
  const group=CORE_DIALOGUE_GROUPS[selected];
  const messages:Message[]=group.rows.flatMap((row,index)=>[
    {id:'input-'+index,sessionId:'readonly',role:'user' as const,content:row.input,createdAt:index*10,isProactive:false},
    ...row.replies.map((content,part)=>({id:'reply-'+index+'-'+part,sessionId:'readonly',role:'assistant' as const,content,createdAt:index*10+part+1,isProactive:false,replyCompletion:'complete' as const,replyDelivery:'settled' as const})),
  ]);
  return <main className="dialogue-preview">
    <header><p>完整原稿 · 只读回看</p><h1>古月娜</h1><label>对话场景<select aria-label="对话场景" value={selected} onChange={event=>setSelected(Number(event.target.value))}>{CORE_DIALOGUE_GROUPS.map((group,index)=><option key={group.title} value={index}>{group.title}</option>)}</select></label></header>
    <div className="preview-notice">各组完整保留原始回复及其问题。独立复查单独展示，不拼入旧组；有限样本不代表所有对话效果。</div>
    <section aria-label="完整对话" key={selected}>{messages.map(message=><MessageBubble key={message.id} message={message} avatar={message.role==='user'?'🧬':role?.avatar??'🌙'} animate={false} isLatest={false}/>)}</section>
    <footer>展示历史验收原稿，不发送消息，不播放声音。</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
