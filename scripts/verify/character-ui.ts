import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileCharacterPage } from '../../src/components/character/MobileCharacterPage';
import { useChatStore } from '../../src/store/chat-store';
import { useAuthStore } from '../../src/store/auth-store';
import { stateRepo } from '../../src/db/state-repo';
import type { Character } from '../../src/db';
const report = window.fetch.bind(window);
const wait = (ms=80) => new Promise(r => setTimeout(r, ms));
let count=0;
function check(ok: unknown, label: string) { if(!ok) throw Error(label); count++; }
const button = (text:string) => [...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;
async function run(){
 useAuthStore.setState({userId:'test-user'});
 const c={id:'test-character',name:'星遥',avatar:'🌙',tags:['温柔'],systemPrompt:'独立的人格设定',signature:'听见星光',createdBy:'test-user',isPreset:false,isCustom:true,createdAt:1} as Character;
 stateRepo.get=async()=>undefined;
 let failDelete=true, deletes=0;
 useChatStore.setState({characters:[c],unreadByCharacter:{[c.id]:12},loadCharacters:async()=>{},fetchUnreadCounts:async()=>{},deleteCharacter:async()=>{deletes++;if(failDelete)throw Error('disk');useChatStore.setState({characters:[]});}});
 const host=document.createElement('div');host.style.height='740px';document.body.append(host);
 createRoot(host).render(createElement(MobileCharacterPage,{onSelect:()=>{throw Error('unexpected navigation')}}));await wait();
 check(host.textContent?.includes('关系星图'),'network entry remains');
 check(!host.querySelector('[aria-label*="未读"]'),'character page does not display unread badges');
 check(!host.textContent?.includes('独立的人格设定'),'list never dumps prompt');
 rowProfile();await wait();
 check(!!document.querySelector('.vg-profile-hero'),'profile has focused character hero');
 check(!!document.querySelector('.vg-profile-primary'),'primary chat action remains visible');
 check(!(document.querySelector('.vg-profile-details') as HTMLDetailsElement).open,'long archive begins collapsed');
 check(document.querySelector('.vg-profile-primary')!.getBoundingClientRect().top < document.querySelector('.vg-profile-details')!.getBoundingClientRect().top,'chat action precedes archive');
 (document.querySelector('.vg-profile-details summary') as HTMLElement).click();await wait();
 check((document.querySelector('.vg-profile-details') as HTMLDetailsElement).open,'archive can expand');
 (document.querySelector('[aria-label="关闭"]') as HTMLElement).click();await wait();
 (document.querySelector('[aria-label="管理星遥"]') as HTMLElement).click();await wait();button('编辑角色').click();await wait();
 check(!!document.querySelector('[role="dialog"] input[value="星遥"]'),'edit keeps target and prefilled name');
 check(!button('基因库'),'edit cannot accidentally switch to creation');
 (document.querySelector('[aria-label="关闭"]') as HTMLElement).click();await wait();
 const row=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('听见星光'))!;
 row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:10,clientY:10}));
 row.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:10,clientY:40}));await wait(650);
 check(!document.querySelector('[role="dialog"]'),'scroll cancels long press');
 row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:10,clientY:10}));await wait(600);
 check(!!button('编辑角色'),'single long press opens manage within 600ms');
 row.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));button('删除角色').click();await wait();button('确认删除').click();await wait();
 check(!!button('确认删除') && document.body.textContent?.includes('删除未完成'),'failure retains delete dialog and error');
 failDelete=false;button('确认删除').click();await wait();check(deletes===2 && !button('确认删除'),'successful retry closes confirmation');
 check(host.textContent?.includes('在这里，认识一个新的灵魂'),'empty state after deletion');
 await report('/result?suite=character-ui',{method:'POST',body:`PASS ${count} character UI checks\nALL PASS`});
}
run().catch(async e=>{await report('/result?suite=character-ui',{method:'POST',body:`FAIL ${e.stack}\n1 FAILED`});});

function rowProfile() { ([...document.querySelectorAll('button')].find(b=>b.textContent?.includes('听见星光')) as HTMLElement).click(); }

