import { createRoot } from 'react-dom/client';
import { MobileCharacterPage } from '../../src/components/character/MobileCharacterPage';
import { CharacterList } from '../../src/components/character/CharacterList';
import { db } from '../../src/db';
import { useChatStore } from '../../src/store/chat-store';
import { useAuthStore } from '../../src/store/auth-store';
import { fakeCharacter } from './world-harness';
let root:ReturnType<typeof createRoot>|undefined,network=0;
window.fetch=(()=>{network++;throw Error('No external requests in deletion verification');}) as typeof fetch;
async function setup(mobile=true) {
  root?.unmount();await db.delete();await db.open();
  useAuthStore.setState({userId:'delete-ui-user',apiKey:null});
  const character=fakeCharacter('delete-ui-role','删除压力测试角色','delete-ui-user');
  await db.characters.add(character);const now=Date.now();
  await db.sessions.add({id:'delete-ui-session',characterId:character.id,userId:'delete-ui-user',title:character.name,createdAt:now,updatedAt:now});
  for(let start=0;start<10000;start+=500)await db.messages.bulkAdd(Array.from({length:500},(_,i)=>({id:`ui-message-${start+i}`,sessionId:'delete-ui-session',role:'assistant' as const,content:'长消息删除测试。'.repeat(100),createdAt:now+start+i,isProactive:false})));
  useChatStore.setState({characters:[character],selectedCharacterId:character.id,currentSessionId:'delete-ui-session',messages:await db.messages.where('sessionId').equals('delete-ui-session').limit(200).toArray()});
  root=createRoot(document.getElementById('app')!);root.render(mobile?<MobileCharacterPage onSelect={()=>undefined}/>:<CharacterList collapsed={false}/>);
}
(window as any).characterDeleteUI={setup,remaining:()=>db.messages.count(),network:()=>network};
