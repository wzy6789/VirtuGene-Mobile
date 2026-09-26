import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { MobileTabSwipe } from '../../src/components/ui/MobileTabSwipe';
import { SwipeBackView } from '../../src/components/ui/SwipeBackView';
import { SwipeActionItem } from '../../src/components/ui/SwipeActionItem';
import { Modal } from '../../src/components/ui/Modal';
import { swipeCommits,swipeDirection } from '../../src/lib/swipe-policy';
const wait=(ms=30)=>new Promise(r=>setTimeout(r,ms));let checks=0;
function check(v:unknown,s:string){if(!v)throw Error(s);checks++;}
function touch(node:Element,type:string,x:number,y=100,count=1) {const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:Array.from({length:count},()=>({clientX:x,clientY:y}))});node.dispatchEvent(e);return e;}
const host=document.createElement('div');host.style.cssText='width:390px;height:740px';document.body.append(host);const root=createRoot(host);
let commits:string[]=[];
function tabs(tab:'chat'|'world'|'characters'|'me'='world',enabled=true){root.render(h(MobileTabSwipe,{activeTab:tab,enabled,onTabSwipe:t=>commits.push(t)},h('div',{id:'surface',style:{height:600}},h('button',{id:'button'},'button'),h('input',{id:'input'}),h('div',{'data-no-page-swipe':true,id:'map'},'map'),h('div',{id:'horizontal',style:{width:80,overflowX:'auto'}},h('div',{id:'scroll-child',style:{width:300}},'scroll')))));}
async function run(){
 check(swipeDirection(11,0)===null,'dead zone');check(swipeDirection(20,18)==='y','diagonal scroll');check(swipeDirection(30,10)==='x','clear horizontal');check(!swipeCommits(25,5,390),'tiny flick ignored');check(swipeCommits(100,1000,390),'slow distance');check(swipeCommits(40,50,390),'short fast flick');
 tabs();await wait();let surface=host.querySelector('#surface')!;
 touch(surface,'touchstart',200);touch(surface,'touchmove',80);touch(surface,'touchend',80);await wait(210);check(commits.pop()==='characters','left switches next');
 touch(surface,'touchstart',150);touch(surface,'touchmove',270);touch(surface,'touchend',270);await wait(210);check(commits.pop()==='chat','right switches previous');
 for(const [name,x,y,count,cancel] of [['edge-left',10,100,1,false],['edge-right',window.innerWidth-10,100,1,false],['vertical',200,260,1,false],['multitouch',200,100,2,false],['cancel',200,100,1,true],['short',200,100,1,false]] as const){
  const n=commits.length;touch(surface,'touchstart',x,100,count);touch(surface,'touchmove',name==='short'?x-20:x-120,y,count);touch(surface,cancel?'touchcancel':'touchend',x-120,y,count);await wait(210);check(commits.length===n,name+' never navigates');
 }
 for(const id of ['button','input','map','scroll-child']) {const target=host.querySelector('#'+id)!;touch(target,'touchstart',200);touch(target,'touchmove',80);touch(target,'touchend',80);await wait(210);check(commits.length===0,id+' owns its interaction');}
 const modal=document.createElement('div');modal.setAttribute('aria-modal','true');document.body.append(modal);touch(surface,'touchstart',200);touch(surface,'touchmove',80);touch(surface,'touchend',80);await wait(210);check(commits.length===0,'modal blocks background swipe');modal.remove();
 touch(surface,'touchstart',200);touch(surface,'touchmove',80);touch(surface,'touchend',80);tabs('chat');await wait(210);check(commits.length===0,'tab change cancels stale completion');
 surface=host.querySelector('#surface')!;touch(surface,'touchstart',100);touch(surface,'touchmove',240);touch(surface,'touchend',240);await wait(210);check(commits.length===0,'first tab has no wrap');
 tabs('me');await wait();surface=host.querySelector('#surface')!;touch(surface,'touchstart',200);touch(surface,'touchmove',80);touch(surface,'touchend',80);await wait(210);check(commits.length===0,'last tab has no wrap');
 tabs('world',false);await wait();surface=host.querySelector('#surface')!;touch(surface,'touchstart',200);touch(surface,'touchmove',80);touch(surface,'touchend',80);await wait(210);check(commits.length===0,'disabled navigation');
 let backs=0;root.render(h(SwipeBackView,{onBack:()=>backs++},h('div',{id:'back-surface'},'back')));await wait();surface=host.querySelector('#back-surface')!;
 touch(surface,'touchstart',100);touch(surface,'touchmove',250);touch(surface,'touchcancel',250);await wait(210);check(backs===0,'cancel does not return');
 touch(surface,'touchstart',100);touch(surface,'touchmove',250);touch(surface,'touchend',250);touch(surface,'touchend',250);await wait(210);check(backs===1,'one return per gesture');
 touch(surface,'touchstart',100);touch(surface,'touchmove',250);touch(surface,'touchend',250);root.render(h('div',null,'other'));await wait(210);check(backs===1,'unmount clears return timer');
 let opened=0;root.render(h(SwipeActionItem,{onClick:()=>opened++,actions:[{label:'Delete',color:'bg-red-500',onClick:()=>{}}]},h('div',{id:'row'},'row')));await wait();surface=host.querySelector('#row')!;
 touch(surface,'touchstart',200);touch(surface,'touchmove',100);await wait();check((surface.parentElement as HTMLElement).style.transition==='none','row tracks finger without transition lag');touch(surface,'touchcancel',100);await wait();check(surface.parentElement!.style.transform==='translateX(0px)','row cancel snaps closed');
 touch(surface,'touchstart',200);touch(surface,'touchmove',100);touch(surface,'touchend',100);surface.dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait();check(opened===0,'drag does not open chat');
 await wait(270);surface.dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait();check(opened===0&&surface.parentElement!.style.transform==='translateX(0px)','tap expanded row closes only');
 let closed=0;root.render(h(Modal,{open:true,onClose:()=>closed++,title:'fixture'},'modal'));await wait();const event=new Event('vg:back-request',{cancelable:true});window.dispatchEvent(event);check(event.defaultPrevented&&closed===1,'system back closes modal before page');root.unmount();
 await fetch('/result?suite=swipes',{method:'POST',body:`PASS ${checks} gesture checks\nALL PASS`});
}
run().catch(async e=>{await fetch('/result?suite=swipes',{method:'POST',body:`FAIL ${e.stack}\n1 FAILED`});});
