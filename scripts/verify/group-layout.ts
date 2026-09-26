import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { GroupChatPage } from '../../src/components/chat/GroupChatPage';
import { useGroupStore } from '../../src/store/group-store';
import { useChatStore } from '../../src/store/chat-store';
import type { Character, Group } from '../../src/db';
const report=window.fetch.bind(window);const wait=()=>new Promise(r=>setTimeout(r,180));
let count=0;function check(ok:unknown,text:string){if(!ok)throw Error(text);count++;}
async function run(){
 const chars=Array.from({length:5},(_,i)=>({id:`c${i}`,name:`成员${i}`,avatar:'🌷',createdBy:'u'} as Character));
 const group={id:'g',name:'很长的群聊标题，仍然应该完整占据标题区域',characterIds:chars.map(c=>c.id)} as Group;
 useChatStore.setState({characters:chars});
 useGroupStore.setState({groups:[group],currentGroup:group,groupMessages:[],groupSending:false,groupError:null,loadGroups:async()=>{},selectGroup:async()=>{}});
 const host=document.createElement('div');host.style.cssText='transform:translateY(100px);height:240px;overflow:hidden';document.body.append(host);
 const root=createRoot(host);root.render(createElement(GroupChatPage,{initialGroupId:'g',onClose:()=>{}}));await wait();
 const page=document.querySelector<HTMLElement>('[data-group-page]')!;
 const header=document.querySelector<HTMLElement>('[data-group-header]')!;
 check(page.parentElement===document.body,'overlay escapes transformed/clipped tab parent');
 check(Math.abs(page.getBoundingClientRect().top)<1,'overlay stays at viewport origin');
 check(header.getBoundingClientRect().top>=24,'header clears mobile status bar fallback');
 check(header.getBoundingClientRect().height>=64,'header provides space for title and portraits');
 const avatars=[...header.querySelectorAll<HTMLElement>('[aria-label="群成员头像"] > span')];
 check(avatars.length===5,'five member portraits remain visible');
 for(const wrapper of avatars){const inner=wrapper.firstElementChild as HTMLElement;
   check(inner.getBoundingClientRect().width<=wrapper.getBoundingClientRect().width+.1&&inner.getBoundingClientRect().height<=wrapper.getBoundingClientRect().height+.1,'portrait fits container');
   check(wrapper.getBoundingClientRect().bottom<=header.getBoundingClientRect().bottom,'portrait stays within header');
 }
 (document.querySelector('[aria-label="返回群聊列表"]') as HTMLElement).click();await wait();
 check(!!document.querySelector('[data-group-header]')?.textContent?.includes('发起群聊'),'list header remains reachable');
 check(document.querySelector('[data-group-page]')?.parentElement===document.body,'list remains a viewport portal');
 root.unmount();await report('/result?suite=group-layout',{method:'POST',body:`PASS ${count} group layout checks\nALL PASS`});
}
run().catch(async e=>{await report('/result?suite=group-layout',{method:'POST',body:`FAIL ${e.stack}\n1 FAILED`});});
