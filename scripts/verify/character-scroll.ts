import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CharacterAddModal } from '../../src/components/character/CharacterAddModal';
import { characterRepo } from '../../src/db/character-repo';
import { useAuthStore } from '../../src/store/auth-store';
import type { Character } from '../../src/db';
const report=window.fetch.bind(window);
const wait=(ms=150)=>new Promise(r=>setTimeout(r,ms));
let count=0;
function check(value:unknown,label:string){if(!value)throw Error(label);count++;}
async function run(){
 useAuthStore.setState({userId:'scroll-test'});
 characterRepo.getAll=async()=>Array.from({length:45},(_,i)=>({id:`c${i}`,name:`角色${i}`,avatar:'🌟',tags:[],systemPrompt:'性格',createdBy:'scroll-test',createdAt:1,isPreset:false,published:false} as Character));
 const host=document.createElement('div');document.body.append(host);
 createRoot(host).render(createElement(CharacterAddModal,{open:true,onClose:()=>{}}));await wait(400);
 const sheet=document.querySelector<HTMLElement>('[role="dialog"]')!;
 const scroll=sheet.querySelector<HTMLElement>('[data-modal-scroll]')!;
 const tabs=sheet.querySelector<HTMLElement>('.vg-character-editor-tabs')!;
 check(sheet.classList.contains('vg-mobile-sheet-full'),'mobile editor uses stable full-height sheet');
 check(scroll.scrollHeight>scroll.clientHeight,'long gene list has scrollable content');
 const top=sheet.getBoundingClientRect().top;
 const tabTop=tabs.getBoundingClientRect().top;
 scroll.scrollTop=scroll.scrollHeight;await wait();
 check(Math.abs(sheet.getBoundingClientRect().top-top)<1,'scroll never moves sheet into backdrop');
 check(Math.abs(tabs.getBoundingClientRect().top-tabTop)<1,'switch tabs stay visible while list scrolls');
 check(![...scroll.querySelectorAll<HTMLElement>('*')].some(e=>getComputedStyle(e).overflowY==='auto'&&e.scrollHeight>e.clientHeight),'gene list has no second nested vertical scroller');
 check(getComputedStyle(scroll).overscrollBehaviorY==='none','edge scroll does not chain to backdrop');
 const create=[...tabs.querySelectorAll('button')].find(b=>b.textContent?.includes('创造'))!;create.click();await wait();
 scroll.scrollTop=scroll.scrollHeight;await wait();
 check(Math.abs(sheet.getBoundingClientRect().top-top)<1,'creation form remains inside fixed sheet');
 check(!!sheet.querySelector('[aria-label="关闭"]'),'close action remains reachable');
 await report('/result?suite=character-scroll',{method:'POST',body:`PASS ${count} mobile scroll checks\nALL PASS`});
}
run().catch(async e=>{await report('/result?suite=character-scroll',{method:'POST',body:`FAIL ${e.stack}\n1 FAILED`});});
