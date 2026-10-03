import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MobileChatListPage} from '../../src/components/chat/MobileChatListPage';
import {MobileCharacterPage} from '../../src/components/character/MobileCharacterPage';
import {ChatHeaderMoreMenu} from '../../src/components/chat/ChatHeaderMoreMenu';
import {Modal} from '../../src/components/ui/Modal';
import {SoulAtmosphere} from '../../src/components/ui/SoulAtmosphere';
import {useChatStore} from '../../src/store/chat-store';
import {useGroupStore} from '../../src/store/group-store';
import {useAuthStore} from '../../src/store/auth-store';
import {useUIStore} from '../../src/store/ui-store';
import type {Character} from '../../src/db';

const wait=(ms=120)=>new Promise(r=>setTimeout(r,ms));
let checks=0,readCalls=0;
const check=(value:unknown,label:string)=>{if(!value)throw Error(label);checks++;};
const characters=[{id:'polish-a',name:'知微',avatar:'🌙',tags:['温柔'],signature:'把今天的小事，慢慢说给你听。'},
  {id:'polish-b',name:'闻川',avatar:'🌊',tags:['可靠'],signature:'一起去看看新的风景。'}]
  .map(c=>({...c,createdBy:'fixture',createdAt:Date.now(),systemPrompt:'fixture',greeting:'你好。',isPreset:false})) as Character[];
useAuthStore.setState({userId:null,isLoggedIn:false,apiKey:''});
useChatStore.setState({characters,loadCharacters:async()=>{},fetchUnreadCounts:async()=>{},charPreviews:{},unreadByCharacter:{},markCharacterRead:async()=>{readCalls++;}});
useGroupStore.setState({groups:[],loadGroups:async()=>{}});
document.body.style.cssText='margin:0;overflow:hidden';
const host=document.createElement('div');host.style.cssText='height:100dvh;width:100%;max-width:430px;margin:auto';document.body.append(host);
const root=createRoot(host);
function render(page:'messages'|'characters'|'focus'|'more') {
  root.render(h('div',{className:'mobile-layout relative h-full overflow-hidden'},h(SoulAtmosphere),h('div',{className:'relative h-full'},page==='messages'?h(MobileChatListPage,{onSelect:()=>{}}):page==='characters'?h(MobileCharacterPage,{onSelect:()=>{}}):page==='more'?h(ChatHeaderMoreMenu,{character:characters[0]}):h(FocusFixture))));
}
function FocusFixture() {
  const [open,setOpen]=useState(false),[nested,setNested]=useState(false);
  return h('div',{className:'p-5'},h('button',{'data-open-sheet':true,onClick:()=>setOpen(true)},'打开偏好'),
    h(Modal,{open,onClose:()=>setOpen(false),title:'偏好与连接',mobileFullHeight:true},
      h('div',{className:'p-5'},h('p',{className:'text-sm text-sub mb-4'},'为你的数字生活，留一点自己的空间。'),
        h('button',{'data-open-nested':true,className:'min-h-12 w-full rounded-xl bg-surface text-ink',onClick:()=>setNested(true)},'打开第二层'),
        h('input',{'aria-label':'测试昵称',className:'mt-4 w-full rounded-xl border border-line bg-surface p-3'}),
        ...Array.from({length:24},(_,i)=>h('p',{key:i,className:'py-3 text-sm text-sub'},`第 ${i+1} 项偏好内容`)),
        h('button',{'data-last':true,className:'min-h-12 w-full',onClick:()=>setOpen(false)},'完成'))),
    h(Modal,{open:nested,onClose:()=>setNested(false),title:'第二层'},h('button',{'data-close-nested':true,className:'min-h-12 w-full p-4',onClick:()=>setNested(false)},'返回偏好')));
}
const click=(selector:string)=>{const el=document.querySelector<HTMLButtonElement>(selector)!;check(!!el,`target exists ${selector}`);el.click();};
function enter(input:HTMLInputElement,text:string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,text);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}
const buttonNamed=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name)!;
function menu() {const row=host.querySelector<HTMLButtonElement>('.vg-conversation-row')!;row.focus();row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:2,clientY:2}));}
async function run() {
  const params=new URLSearchParams(location.search);
  if(params.has('visual')) {
    document.documentElement.classList.toggle('dark',params.get('theme')!=='light');
    const view=params.get('visual');
    if(view==='empty')useChatStore.setState({characters:[]});
    if(view==='loading')useChatStore.setState({characters:[],loadCharacters:()=>new Promise(()=>{})});
    render(view==='sheet'?'focus':view==='loading'?'characters':'messages');await wait(400);
    if(view==='search') {enter(host.querySelector('input')!,'未找到的名字');await wait();}
    if(view==='actions'){menu();await wait(400);}
    if(view==='sheet'){click('[data-open-sheet]');await wait(400);}
    document.documentElement.dataset.polishReady='true';return;
  }
  for(const dark of [true,false])for(const width of [320,390,430]) {
    document.documentElement.classList.toggle('dark',dark);host.style.width=width+'px';
    render('messages');await wait(350);
    const input=host.querySelector<HTMLInputElement>('[aria-label="搜索聊天"]')!;
    check(!!input,'search has a persistent accessible name');enter(input,'找不到');await wait();
    check(!!host.querySelector('.vg-connection-empty'),'no match displays a useful empty state');
    check(host.querySelector('.vg-empty-action button')!.getBoundingClientRect().height>=48,'empty action is comfortable on Android');
    const clear=host.querySelector('[aria-label="清空搜索"]')!;
    check(clear.getBoundingClientRect().width>=48 && clear.getBoundingClientRect().height>=48,'clear search has a full touch target');
    click('.vg-empty-action button');await wait();check(host.querySelectorAll('.vg-conversation-row').length===2,'empty action restores all conversations');
    menu();await wait(350);
    const panel=document.querySelector('.vg-mobile-sheet')!;
    check(!!panel,'long press opens one coherent operation sheet');
    check(getComputedStyle(panel).getPropertyValue('--bg-panel').trim()===getComputedStyle(host.querySelector('.mobile-layout')!).getPropertyValue('--bg-panel').trim(),'portal sheet shares mobile theme tokens');
    check(panel.getBoundingClientRect().left>=0 && panel.getBoundingClientRect().right<=innerWidth,'operation sheet stays inside viewport');
    check([...panel.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=48),'sheet controls retain touch targets');
    buttonNamed('标为已读').click();await wait();check(readCalls>0 && !document.querySelector('[role="dialog"]'),'menu action still runs and closes');
    render('characters');await wait(350);
    buttonNamed('温柔').click();await wait();
    enter(host.querySelector('[aria-label="搜索角色"]')!,'不存在');await wait();
    check(!!host.querySelector('.vg-connection-empty'),'combined search and tag filtering explain no results');
    buttonNamed('清除筛选').click();await wait();
    check(host.querySelectorAll('.vg-character-row').length===2,'clear filters resets both search and tags');
    check(host.scrollWidth<=width,'list fits narrow viewport');
    root.render(h('div'));await wait();
  }
  render('more');await wait();
  const more=host.querySelector<HTMLButtonElement>('[aria-label="聊天更多操作"]')!;
  check(more.getAttribute('aria-expanded')==='false','more control announces its collapsed state');more.focus();more.click();await wait(350);
  check(more.getAttribute('aria-expanded')==='true' && !!document.querySelector('[role="dialog"]'),'more opens an accessible operation sheet');
  buttonNamed('聊天设置').click();await wait();
  const voice=document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="角色语音"]')!;
  const enabled=voice.getAttribute('aria-checked');voice.click();await wait();
  check(voice.getAttribute('aria-checked')!==enabled,'voice switch exposes its actual changed preference');
  check(voice.getBoundingClientRect().height>=48 && voice.getBoundingClientRect().width>=48,'voice switch has a comfortable touch target');
  voice.click();await wait();check(voice.getAttribute('aria-checked')===enabled,'voice preference can be restored');
  (document.querySelector('[aria-label="返回设置"]') as HTMLButtonElement).click();await wait();buttonNamed('心情打卡').click();await wait();
  check(document.querySelectorAll('.vg-mood-choice[aria-label]').length===5,'all five moods have visible and accessible labels');
  check([...document.querySelectorAll('.vg-mood-choice')].every(el=>el.getBoundingClientRect().width>=48 && el.getBoundingClientRect().height>=48),'mood choices remain touchable');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait();
  check(more.getAttribute('aria-expanded')==='false' && document.activeElement===more,'closing more restores focus and expanded state');
  render('focus');await wait();
  const opener=host.querySelector<HTMLButtonElement>('[data-open-sheet]')!;opener.focus();opener.click();await wait(400);
  const parent=document.querySelector<HTMLElement>('[role="dialog"]')!;
  check(document.activeElement===parent,'opening focuses sheet without summoning form keyboard');
  const close=parent.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!,last=parent.querySelector<HTMLButtonElement>('[data-last]')!;
  close.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
  check(document.activeElement===last,'Shift Tab wraps inside sheet');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));check(document.activeElement===close,'Tab wraps inside sheet');
  opener.focus();check(parent.contains(document.activeElement),'background cannot steal sheet focus');
  const scroller=parent.querySelector<HTMLElement>('[data-modal-scroll]')!;
  const top=parent.getBoundingClientRect().top;scroller.scrollTop=300;await wait();
  check(scroller.scrollTop>=300 && parent.getBoundingClientRect().top===top,'long form scrolls while sheet frame stays stable');
  const nestedButton=parent.querySelector<HTMLButtonElement>('[data-open-nested]')!;nestedButton.focus();nestedButton.click();await wait(350);
  check(document.querySelectorAll('[role="dialog"]').length===2,'nested sheet opens');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait();
  check(document.querySelectorAll('[role="dialog"]').length===1 && document.activeElement===nestedButton,'Escape closes only top sheet and restores parent focus');
  scroller.scrollTop=300;await wait();const scrollPosition=scroller.scrollTop;
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait();
  check(!document.querySelector('[role="dialog"]') && document.activeElement===opener,'closing final sheet restores initiating control');
  const closing=document.querySelector<HTMLElement>('.vg-modal-exit');
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    check(!!closing && closing.inert && closing.getAttribute('aria-hidden')==='true','closing sheet retains only an inert visual frame');
    check(closing!.querySelector<HTMLElement>('[data-modal-scroll]')!.scrollTop===scrollPosition,'closing frame preserves long form scroll position');
  } else check(!closing,'reduced motion closes without a visual frame');
  await wait(100);
  check(!document.querySelector('.vg-modal-exit'),'closing animation releases its visual frame');
  check(document.body.style.overflow==='hidden','modal restores previous body scroll state');
  root.unmount();
  const result=`PASS ${checks} UI polish checks\nALL PASS`;document.documentElement.dataset.polishResult=result;
  await fetch('/result?suite=ui-polish',{method:'POST',body:result});
}
run().catch(async error=>{const result=`FAIL ${error.stack}\n1 FAILED`;document.documentElement.dataset.polishResult=result;await fetch('/result?suite=ui-polish',{method:'POST',body:result});});
