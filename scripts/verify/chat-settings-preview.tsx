import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ChatHeaderMoreMenu } from '../../src/components/chat/ChatHeaderMoreMenu';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useSettingsStore } from '../../src/store/settings-store';
useAuthStore.setState({userId:'preview-owner'});
useSettingsStore.setState({ttsEngine:'edge'});
let writes = 0;
useChatStore.setState({setCharacterVoice:async () => { writes++; throw Error('controlled write failure'); }});
function Fixture() {
  const [show,setShow] = useState(true);
  (window as any).previewFixture = {hide:()=>setShow(false),writes:()=>writes,changeOwner:()=>useAuthStore.setState({userId:'another-owner'})};
  return show ? <ChatHeaderMoreMenu character={{id:'preview-role',name:'试听角色',avatar:'🧬',voice:{voice:'standard',band:'female-young',rate:'+0%',pitch:'+0Hz'}} as any}/> : null;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
