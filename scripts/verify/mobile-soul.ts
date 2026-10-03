import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileLayout } from '../../src/components/layout/MobileLayout';
import { ChatInput } from '../../src/components/chat/ChatInput';
import { MessageBubble } from '../../src/components/chat/MessageBubble';
import { useMobilePageMotion } from '../../src/components/ui/useMobilePageMotion';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { useGroupStore } from '../../src/store/group-store';
import { useUIStore, type MobileTab } from '../../src/store/ui-store';
import { useSettingsStore } from '../../src/store/settings-store';
import type { Character, Message } from '../../src/db';

const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
const check = (value: unknown, label: string) => { if (!value) throw Error(label); checks++; };
function textContrast(element: Element) {
  const style = getComputedStyle(element);
  const luminance = (color: string) => {
    const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => {
      const channel = n / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const a = luminance(style.color), b = luminance(style.backgroundColor);
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
}
const now = Date.now();
const characters: Character[] = [
  { id:'soul-zhiwei', name:'知微', avatar:'🌙', signature:'把今天的小事，慢慢说给你听。', tags:['温柔','细心'], pinned:true },
  { id:'soul-wenchuan', name:'闻川', avatar:'🌊', signature:'风景和故事，都可以一起去找。', tags:['可靠','幽默'] },
  { id:'soul-chengyan', name:'程砚', avatar:'🌿', signature:'有我在，一件一件来。', tags:['冷静','理性'] },
].map(c => ({ ...c, systemPrompt:'local visual fixture', greeting:'今天过得怎么样？坐一会儿，慢慢说。', isPreset:false, createdBy:'soul-fixture', createdAt:now })) as Character[];
const messages: Message[] = [
  { id:'soul-m1', role:'assistant', content:'刚刚路过花店，看到一束很漂亮的洋桔梗。' },
  { id:'soul-m2', role:'assistant', content:'是很淡的紫色，像傍晚的天空。忽然就想给你看看。' },
  { id:'soul-m3', role:'user', content:'下次一起去看吧。' },
  { id:'soul-m4', role:'assistant', content:'好呀，我记住了。\n等你忙完，我们慢慢走过去。' },
].map((m,i) => ({ ...m, sessionId:'soul-session', createdAt:now - (4-i)*60000 })) as Message[];
// Fixtures run in a disposable browser profile; no model, speech, or real account is used.
useAuthStore.setState({ userId:null, username:'星旅人', apiKey:'local-fixture-only', isLoggedIn:false });
useGroupStore.setState({ groups:[], loadGroups:async()=>{} });
useChatStore.setState({ characters, messages, currentSessionId:'soul-session', hasMoreMessages:false,
  charPreviews:Object.fromEntries(characters.map((c,i) => [c.id,{content:['等你忙完，我们慢慢走过去。','今天的风很舒服，要出去走走吗？','明天的计划，一起理一理。'][i], createdAt:now-i*3600000}])),
  unreadByCharacter:{'soul-wenchuan':2}, loadCharacters:async()=>{}, fetchUnreadCounts:async()=>{},
  selectCharacter:async id => { useChatStore.setState({ selectedCharacterId:id }); },
});
document.body.style.cssText='margin:0;overflow:hidden;background:var(--bg)';
const host=document.createElement('div');
host.style.cssText='width:100%;height:100dvh;max-width:430px;margin:0 auto;overflow:hidden';
document.body.append(host);
const root=createRoot(host);

function show(tab: MobileTab, chat = false) {
  useUIStore.setState({ mobileTab:tab, activeView:'chat', chatFromList:chat, chatFromCharacters:false });
  if (chat) useChatStore.setState({ selectedCharacterId:characters[0].id });
  root.render(h(MobileLayout));
}
function MotionFixture({ tab, depth = 0 }: {tab:MobileTab;depth?:number}) {
  const key=tab+depth;
  const ref=useMobilePageMotion({key,tab,depth});
  return h('div',{key,ref,'data-motion':true},key);
}
function ComposerFixture() {
  const [sent,setSent]=useState('');
  return h('div',{className:'mobile-layout h-full'},
    h(MessageBubble,{avatar:'🌙',message:messages[0]}),
    h(ChatInput,{onSend:setSent,onSendImage:()=>{}}),h('output',null,sent));
}

async function run() {
  const params=new URLSearchParams(location.search);
  const dark=params.get('theme')!=='light';
  document.documentElement.classList.toggle('dark',dark);
  if(params.has('visual')) {
    const page=params.get('visual');
    show(page==='chat'?'chat':page==='world'?'world':page==='characters'?'characters':page==='me'?'me':'chat',page==='chat');
    await wait(550);
    document.documentElement.dataset.soulReady='true';
    return;
  }
  for(const theme of [true,false]) for(const width of [360,390,430]) {
    document.documentElement.classList.toggle('dark',theme);host.style.width=width+'px';
    show('chat');await wait(380);
    check(host.scrollWidth<=width,'messages fit viewport');
    check(host.querySelectorAll('.vg-nav-tab').length===4,'all four navigation targets retained');
    check(getComputedStyle(host.querySelector('.mobile-statusbar')!).backgroundColor==='rgb(15, 15, 26)','both themes retain contrast for native white status icons');
    check(host.querySelector('.vg-soul-field')?.getAttribute('aria-hidden')==='true','decoration hidden from assistive technology');
    check(getComputedStyle(host.querySelector('.vg-soul-field')!).pointerEvents==='none','decoration never captures gestures');
    check(host.querySelector('.vg-nav-unread')?.textContent==='2','unread count survives navigation restyling');
    const world=host.querySelectorAll<HTMLButtonElement>('.vg-nav-tab')[1];world.click();await wait(380);
    check(useUIStore.getState().mobileTab==='world','navigation remains functional');
    check(host.querySelectorAll('.vg-world-life-entry').length===4,'world entrances retained');
    check(host.querySelector('.vg-world-hero h1')?.textContent==='世界','world title remains concise in Chinese');
    check([...host.querySelectorAll('.vg-world-life-entry')].every(el=>el.getBoundingClientRect().height>=44),'all world entrances retain touch targets');
    check(host.scrollWidth<=width,'world fits viewport');
    check(getComputedStyle(host.querySelector('.vg-nav-indicator')!).transform.includes('matrix'),'navigation capsule follows selected tab');
    show('characters');await wait(380);
    check(host.querySelectorAll('.vg-character-row').length===3,'characters retained');
    const addCharacter=host.querySelector('.vg-primary-action')!;
    check(addCharacter.getBoundingClientRect().height>=44,'add character retains comfortable touch target');
    check(textContrast(addCharacter)>=4.5,'primary action text is readable in both themes');
    check(host.scrollWidth<=width,'character page fits viewport');
    show('me');await wait(380);
    check(host.querySelector('.vg-personal-profile')?.textContent?.includes('星旅人'),'profile retains user identity');
    check([...host.querySelectorAll('.vg-settings-row')].every(el=>el.getBoundingClientRect().height>=44),'settings retain touch targets');
    check(host.scrollWidth<=width,'personal page fits viewport');
    show('chat',true);await wait(420);
    check(host.querySelectorAll('.vg-message-bubble').length===4,'real chat preserves all messages');
    check(getComputedStyle(host.querySelector('.mobile-bottom-nav')!).display==='none','navigation hidden inside conversation');
    check(host.querySelector('.vg-chat-presence')?.textContent?.trim(),'header displays real relationship state');
    const sceneTitle=host.querySelector('.scene-presence-mark + div p')!;
    check(getComputedStyle(sceneTitle).color===getComputedStyle(host.querySelector('.mobile-layout')!).color,'scene title follows readable theme text');
    check(getComputedStyle(host.querySelector('.chat-thread')!).backgroundSize.includes('24px'),'scene time preserves fine chat grid');
    check(host.scrollWidth<=width,'chat fits viewport');
    const input=host.querySelector<HTMLTextAreaElement>('.chat-composer-input')!;
    check(input.getBoundingClientRect().width>100,'composer retains comfortable typing space');
    check(parseFloat(getComputedStyle(input).borderTopWidth)>0,'typing field has a visible independent boundary');
    const restingBorder=getComputedStyle(input).borderTopColor;
    input.focus();await wait(200);
    check(getComputedStyle(input).borderTopColor!==restingBorder,'typing focus has a visible boundary change');
    input.blur();await wait(200);
    check(host.querySelector('.chat-composer-send')!.getBoundingClientRect().width>=44,'send target at least 44px');
    check(host.querySelector('.chat-header button')!.getBoundingClientRect().width>=44,'back target at least 44px');
    const bubble=host.querySelector('.vg-message-bubble')!;
    check(getComputedStyle(bubble).fontSize==='14px','default chat typography retained');
    check(getComputedStyle(bubble).backgroundImage!=='none','chat surface has visible material');
    const historical=host.querySelector('.vg-chat-message-row:not(.animate-message-in)')!;
    check(getComputedStyle(historical).animationName==='none','historical messages do not replay arrival animations');
    (host.querySelector('.chat-header button') as HTMLButtonElement).click();await wait(380);
    check(!!host.querySelector('.vg-conversations'),'chat returns to message list');
  }
  root.render(h(MotionFixture,{tab:'chat'}));await wait(50);
  root.render(h(MotionFixture,{tab:'world'}));await wait(20);
  const forward=host.querySelector('[data-motion]')!.getAnimations()[0];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduced) {
    check(!!forward,'tab switch animates in real browser');
    check(host.querySelector('.vg-page-exit')?.getAttribute('aria-hidden')==='true' && (host.querySelector('.vg-page-exit') as HTMLElement)?.inert,'outgoing frame is visually retained but inert');
    check(String((forward.effect as KeyframeEffect).getKeyframes()[0].transform).includes('26px'),'next tab enters from right');
  } else check(!forward,'reduced motion skips page animation');
  root.render(h(MotionFixture,{tab:'chat'}));await wait(20);
  if(!reduced) {
    check(forward.playState==='idle','rapid navigation cancels stale animation');
    check(host.querySelectorAll('.vg-page-exit').length<=1,'rapid navigation retains at most one outgoing frame');
    const backward=host.querySelector('[data-motion]')!.getAnimations()[0];
    check(String((backward.effect as KeyframeEffect).getKeyframes()[0].transform).includes('-26px'),'previous tab enters from left');
  }
  await wait(400);
  check(host.querySelector('[data-motion]')!.getAnimations().length===0,'finished transitions release animations');
  check(!host.querySelector('.vg-page-exit'),'outgoing frames are released after transition');
  root.render(h(MotionFixture,{tab:'chat',depth:1}));await wait(20);
  if(!reduced) check(!!host.querySelector('[data-motion]')!.getAnimations().length,'chat push animates');
  root.render(h(MotionFixture,{tab:'chat',depth:0}));await wait(20);
  if(!reduced) check(new DOMMatrixReadOnly(String((host.querySelector('[data-motion]')!.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform)).m41<0,'return animates in reverse direction');
  const resizeAnimation=host.querySelector('[data-motion]')!.getAnimations()[0];
  window.dispatchEvent(new Event('resize'));
  if(!reduced) check(resizeAnimation.playState==='idle','keyboard or viewport resize cancels page transform');
  root.render(h(ComposerFixture));await wait();
  useSettingsStore.getState().setChatFontSize(18);await wait();
  check(getComputedStyle(host.querySelector('.vg-message-bubble')!).fontSize==='18px','font preference remains functional');
  useSettingsStore.getState().setChatFontSize(14);
  const input=host.querySelector<HTMLTextAreaElement>('textarea')!;
  const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
  setter.call(input,'一会儿见。');input.dispatchEvent(new Event('input',{bubbles:true}));await wait();
  await wait(180); // Inspect the enabled state after its color transition settles.
  check(textContrast(host.querySelector('.chat-composer-send')!)>=4.5,'enabled send action has readable icon');
  (host.querySelector('.chat-composer-send') as HTMLButtonElement).click();await wait();
  check(host.querySelector('output')?.textContent==='一会儿见。','composer sends draft unchanged');
  check(input.value==='','draft clears after send');
  root.unmount();
  const result=`PASS ${checks} mobile soul checks\nALL PASS`;
  document.documentElement.dataset.soulResult=result;
  await fetch('/result?suite=mobile-soul',{method:'POST',body:result});
}
run().catch(async error=>{
  const result=`FAIL ${error.stack}\n1 FAILED`;
  document.documentElement.dataset.soulResult=result;
  await fetch('/result?suite=mobile-soul',{method:'POST',body:result});
});
