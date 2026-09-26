import { createElement as h, useRef, useEffect } from 'react';
import { useLatestMessageScroll } from '../../src/components/ui/useLatestMessageScroll';
import { createRoot } from 'react-dom/client';
import { MobileChatListPage } from '../../src/components/chat/MobileChatListPage';
import { MobileWorldPage } from '../../src/components/world/MobileWorldPage';
import { MobileCharacterPage } from '../../src/components/character/MobileCharacterPage';
import { CharacterProfileModal } from '../../src/components/character/CharacterProfileModal';
import { MessageBubble } from '../../src/components/chat/MessageBubble';
import { ImmersiveSceneCard } from '../../src/components/chat/ImmersiveSceneCard';
import { useChatStore } from '../../src/store/chat-store';
import { useGroupStore } from '../../src/store/group-store';
import { useAuthStore } from '../../src/store/auth-store';
import type { Character, Message } from '../../src/db';
const wait = () => new Promise(r => setTimeout(r, 90));
let checks = 0;
function check(value:unknown, label:string) { if (!value) throw Error(label); checks++; }
const c = { id:'ui-fixture',name:'星遥',avatar:'🌙',signature:'刚看见一朵很像猫的云。',tags:[],systemPrompt:'fixture',createdBy:'ui-user',createdAt:1,isPreset:false } as Character;
useAuthStore.setState({userId:null});
useChatStore.setState({characters:[c],charPreviews:{[c.id]:{content:'你今天想去哪里？',createdAt:Date.now()}},loadCharacters:async()=>{},fetchUnreadCounts:async()=>{}});
useGroupStore.setState({groups:[],loadGroups:async()=>{}});
document.body.style.cssText='margin:0;background:var(--bg);overflow:auto';
const host=document.createElement('div');host.className='mobile-layout';host.style.cssText='width:390px;height:760px;margin:0 auto;overflow:hidden';document.body.append(host);
const root=createRoot(host);const params=new URLSearchParams(location.search);
function chat() {
 return h('div',{className:'chat-room h-full flex flex-col'},h('header',{className:'chat-header h-14 flex items-center justify-center'},h('strong',null,'星遥')),
 h('div',{className:'chat-thread flex-1 min-h-0 overflow-y-auto'},...['刚看见一朵很像猫的云。','真的，耳朵都翘着。你那边现在是什么天气？','要不要等你忙完，我们去河边走走？'].map((content,i)=>h(MessageBubble,{key:i,avatar:c.avatar,message:{id:`ai-${i}`,role:'assistant',content,createdAt:1,sessionId:'fixture'} as Message})),h(MessageBubble,{avatar:'🌱',message:{id:'u',role:'user',content:'等我下班！',createdAt:1,sessionId:'fixture'} as Message})),
 h('div',{className:'chat-composer p-3'},h('input',{className:'w-full rounded-xl bg-surface p-3 text-sm',placeholder:'发消息…'})));
}
async function run(){
 document.documentElement.classList.add('dark');
 if(params.has('visual')) {const page=params.get('visual');root.render(page==='chat'?chat():page==='world'?h(MobileWorldPage):page==='characters'?h(MobileCharacterPage,{onSelect:()=>{}}):page==='profile'?h(CharacterProfileModal,{character:{...c,greeting:'今天来得正好。坐一会儿？',tags:['安静','观察细致','有自己的节奏']},userId:'',onClose:()=>{},onAdd:()=>{},onChat:()=>{}}):h(MobileChatListPage,{onSelect:()=>{}}));return;}
 for(const dark of [true,false]) for(const width of [360,390,430]) {
  document.documentElement.classList.toggle('dark',dark);host.style.width=`${width}px`;
  root.render(h(MobileChatListPage,{onSelect:()=>{}}));await wait();
  check(host.querySelector('.vg-conversation-brand')?.textContent==='VIRTUGENE','brand remains at top');
  check(!host.querySelector('h1,.vg-conversation-summary'),'no redundant heading or summary');
  const row=host.querySelector('.vg-conversation-row')!;
  check(row.getBoundingClientRect().height>=80,'comfortable row target');
  check(parseFloat(getComputedStyle(row.querySelector('.font-medium')!).fontSize)===16,'readable names');
  check(host.scrollWidth<=width,'list has no horizontal overflow');
  const searchInput=host.querySelector('input')!;searchInput.focus();await wait();
  check(getComputedStyle(searchInput).outlineStyle==='none','search input never shows the square purple outline');searchInput.blur();
  const shell=host.querySelector('.vg-conversation-shell') as HTMLElement;
  const actions=shell.previousElementSibling as HTMLElement;
  check(getComputedStyle(actions).visibility==='hidden','closed swipe actions do not bleed through corners');
  const touch=(type:string,x:number)=>{const event=new Event(type,{bubbles:true});Object.defineProperty(event,'touches',{value:[{clientX:x,clientY:200}]});shell.dispatchEvent(event);};
  touch('touchstart',200);touch('touchmove',100);await wait();touch('touchend',100);await wait();
  check(getComputedStyle(actions).visibility==='visible','swipe still reveals actions');
  await new Promise(r=>setTimeout(r,270));shell.click();await wait();check(getComputedStyle(actions).visibility==='hidden','tap closes swipe actions');
  root.render(chat());await wait();
  check(host.querySelectorAll('.vg-chat-identity').length===4,'each consecutive bubble retains avatar');
  check([...host.querySelectorAll('.vg-message-bubble')].every(b=>getComputedStyle(b).fontSize==='14px'),'original chat size');
  check(host.scrollWidth<=width,'chat fits viewport');
  root.render(h('div',{className:'chat-thread'},h(MessageBubble,{avatar:c.avatar,message:{id:'long',role:'assistant',content:'很长的文字'.repeat(80)+'https://example.test/'+ 'x'.repeat(200),createdAt:1,sessionId:'fixture'} as Message})));await wait();
  check(host.scrollWidth<=width,'long Chinese and unbroken URLs wrap');
  check(host.querySelector('.vg-message-bubble')!.getBoundingClientRect().right<=host.getBoundingClientRect().right,'long bubble stays inside viewport');
  root.render(h(MobileWorldPage));await wait();
  check(host.querySelectorAll('.vg-world-life-entry').length===4,'four world entrances remain');
  check([...host.querySelectorAll('.vg-world-life-entry')].every(b=>b.getBoundingClientRect().height>=160),'world entrances comfortable');
  check(host.scrollWidth<=width,'world fits viewport');
  check([...host.querySelectorAll('.vg-world-life-entry strong')].every(b=>getComputedStyle(b).fontSize==='20px'),'consistent world labels');
 }
 root.render(h('div',{className:'chat-room h-full flex flex-col'},h(ImmersiveSceneCard,{character:c,userId:'fixture',affinity:0,mood:0,onPrompt:()=>{}}),h('div',{className:'chat-thread flex-1 min-h-0','data-fixture-thread':true},'对话原文保持原位')));await wait();
 const trigger=host.querySelector('[aria-haspopup="dialog"]') as HTMLButtonElement;
 const thread=host.querySelector('[data-fixture-thread]')!;
 const before=thread.getBoundingClientRect();
 for(let i=0;i<3;i++) {
  trigger.click();await wait();
  const panel=document.querySelector('.scene-settings-panel')!;
  check(!!panel,'scene settings open in independent portal');
  check(Math.abs(thread.getBoundingClientRect().height-before.height)<1 && Math.abs(thread.getBoundingClientRect().top-before.top)<1,'opening never squeezes chat thread');
  check(panel.querySelectorAll('.scene-orb,.scene-grain').length===3,'all atmosphere effect layers retained');
  check(panel.getBoundingClientRect().bottom<=window.innerHeight,'panel fits viewport');
  (panel.querySelector('.scene-settings-panel-header button') as HTMLElement).click();await wait();
  check(!!document.querySelector('.scene-settings-panel.is-closing'),'close retains effect until animation ends');
  await new Promise(r=>setTimeout(r,180));
  check(!document.querySelector('.scene-settings-overlay'),'close removes overlay and releases interactions');
  check(document.activeElement===trigger,'focus returns to trigger without scrolling');
 }
 trigger.click();await wait();
 const dragHeader=document.querySelector('.scene-settings-panel-header') as HTMLElement;
 // Synthetic pointer sequences have no browser-owned pointer capture.
 dragHeader.setPointerCapture=()=>{};dragHeader.hasPointerCapture=()=>false;
 const pointer=(type:string,y:number)=>dragHeader.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,isPrimary:true,button:0,clientY:y}));
 pointer('pointerdown',100);pointer('pointermove',120);
 check((document.querySelector('.scene-settings-panel') as HTMLElement).style.transform.includes('13px'),'drag moves only the overlay');
 pointer('pointercancel',120);await wait();
 check((document.querySelector('.scene-settings-panel') as HTMLElement).style.transform==='','cancel restores the panel');
 pointer('pointerdown',100);pointer('pointermove',200);pointer('pointerup',200);await new Promise(r=>setTimeout(r,230));
 check(!document.querySelector('.scene-settings-overlay'),'downward drag closes and removes the entire overlay');
 check(Math.abs(thread.getBoundingClientRect().height-before.height)<1,'drag never reflows messages');
 function ScrollFixture({ count }: { count:number }) {
  const ref=useRef<HTMLDivElement>(null);const latest=useLatestMessageScroll(ref);
  useEffect(()=>latest(),[count,latest]);
  return h('div',null,h('div',{ref,'data-scroll-fixture':true,style:{height:120,overflow:'auto'}},h('div',{style:{height:800+count*100}},'latest')),h('input',{'data-focus-fixture':true,onFocus:()=>latest(),onClick:()=>latest()}));
 }
 root.render(h(ScrollFixture,{count:1}));await new Promise(r=>setTimeout(r,400));
 const scrollBox=host.querySelector('[data-scroll-fixture]') as HTMLElement;
 const isBottom=()=>Math.abs(scrollBox.scrollHeight-scrollBox.clientHeight-scrollBox.scrollTop)<2;
 scrollBox.scrollTop=0;(host.querySelector('[data-focus-fixture]') as HTMLInputElement).focus();await wait();
 check(isBottom(),'input focus positions newest content above composer');
 scrollBox.scrollTop=0;window.visualViewport?.dispatchEvent(new Event('resize'));await wait();
 check(isBottom(),'visual viewport keyboard resize follows latest');
 scrollBox.scrollTop=0;root.render(h(ScrollFixture,{count:2}));await wait();
 check(isBottom(),'new content follows latest even after reading earlier messages');
 root.unmount();await new Promise(r=>setTimeout(r,400));
 await fetch('/result?suite=mobile-refinement',{method:'POST',body:`PASS ${checks} mobile visual layout checks\nALL PASS`});
}
run().catch(async error=>{await fetch('/result?suite=mobile-refinement',{method:'POST',body:`FAIL ${error.stack}\n1 FAILED`});});
