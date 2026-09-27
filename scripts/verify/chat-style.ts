import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CreateGeneTab } from '../../src/components/character/CreateGeneTab';
import { db, type Character } from '../../src/db';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { parseChatRecords, sampleChatRecords, mergeChatRecords, normalizeStyle, stylePrompt, stripLearnedStyle } from '../../src/lib/chat-style-import';
const report = window.fetch.bind(window);
let count=0, calls=0;
const check=(v:unknown,label:string)=>{if(!v)throw Error(label);count++;};
const wait=()=>new Promise(r=>setTimeout(r,160));
function button(text:string){return [...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;}
function input(el:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){
 const proto=el.tagName==='INPUT'?HTMLInputElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype;
 Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);
 el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
}
const learner=()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.startsWith('学习说话方式'))!;
async function run(){
 const qq=parseChatRecords('2026-09-01 12:01:00 阿岚(123456)\n嗯\n2026-09-01 12:02:00 阿岚(123456)\n嗯\n2026-09-01 12:03:00 我(23456)\n[图片]');
 check(qq.length===2&&qq.every(r=>r.speaker==='阿岚'),'QQ messages separate; attachment excluded');
 const a=parseChatRecords('对方：第一条\n我：第二条\n对方：嗯'),b=parseChatRecords('对方：嗯\n对方：嗯');
 check(mergeChatRecords(a,b).length===4,'overlap removed; repeated message retained');
 let rejected=false;try{sampleChatRecords(a,'对方');}catch{rejected=true;}check(rejected,'too few samples rejected');
 rejected=false;try{normalizeStyle({examples:[]});}catch{rejected=true;}check(rejected,'invalid model result rejected');
 check(normalizeStyle({rules:'短句',examples:['嗯',1]}).examples.length===1,'examples validated');
 const style={rules:'短句，关心时直接做事，不说大道理。',examples:['坐会儿，我去倒水。']};
 check(stripLearnedStyle('原人设\n\n'+stylePrompt(style))==='原人设','previous style stripped');
 await db.delete();await db.open();useAuthStore.setState({userId:'style-owner',apiKey:'fake'});
 let closed=0,created=0,lastPrompt='';
 useChatStore.setState({characters:[],createCharacter:async data=>{
  const result={...data,id:'style-character',createdBy:'style-owner',createdAt:1,proactivity:0} as Character;
  created++;await db.characters.add(result);return result;
 },updateCharacter:async(id,data)=>{await db.characters.update(id,data);}});
 window.fetch=async(_url,init)=>{
  calls++;const body=JSON.parse(String(init?.body));lastPrompt=JSON.stringify(body.messages);check(body.stream!==true,'nonstreaming');
  return new Response(JSON.stringify({choices:[{message:{content:body.response_format?JSON.stringify(style):'坐会儿，我去倒水。'}}]}),{headers:{'Content-Type':'application/json'}});
 };
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 root.render(createElement(CreateGeneTab,{onClose:()=>closed++}));await wait();
 check(calls===0&&!host.textContent?.includes('核对内容'),'optional starts collapsed, zero calls');
 input(document.querySelector('input[placeholder="为数字灵魂命名"]')!,'阿岚');await wait();button('如何表达').click();await wait();learner().click();await wait();
 const raw=Array.from({length:6},(_,i)=>`阿岚：今天的小事${i}\n我：不能学我的私人内容${i}`).join('\n');
 const transfer=new DataTransfer();transfer.items.add(new File([raw],'聊天.txt',{type:'text/plain'}));
 const fileInput=document.querySelector<HTMLInputElement>('[aria-label="导入聊天文本"]')!;
 fileInput.files=transfer.files;fileInput.dispatchEvent(new Event('change',{bubbles:true}));await wait();await wait();
 check((document.querySelector('[aria-label="核对聊天记录"]') as HTMLTextAreaElement).value===raw,'TXT file import survives picker reset');
 input(document.querySelector('select[aria-label="学习对象"]')!,'阿岚');await wait();
 check(button('提炼说话方式').disabled,'consent required');
 const checkbox=[...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(el=>el.parentElement?.textContent?.includes('同意将所选对象'))!;
 checkbox.click();await wait();button('提炼说话方式').click();await wait();await wait();
 check(calls===1&&!!document.querySelector('[aria-label="学习的表达方式"]'),'explicit learning succeeds');
 check(lastPrompt.includes('今天的小事5')&&!lastPrompt.includes('不能学我的私人内容'),'only chosen speaker analyzed');
 check(await db.memories.count()===0&&await db.messages.count()===0,'analysis writes no history');
 check(!button('直接使用我的设定').disabled,'style alone supports creation');button('直接使用我的设定').click();await wait();button('试着聊两句').click();await wait();await wait();
 check(lastPrompt.includes(style.rules)&&lastPrompt.includes(style.examples[0]),'trial uses style');button('让 TA 来到我的世界').click();await wait();await wait();
 const character=await db.characters.get('style-character');check(closed===1&&created===1,'saved once');
 check(character?.learnedSpeechStyle?.rules===style.rules&&character.systemPrompt.includes(style.rules),'shared persona persists style');
 check(!JSON.stringify(character).includes('今天的小事')&&!JSON.stringify(character).includes('不能学我的私人内容'),'raw never saved');check(await db.memories.count()===0,'memory defaults off');
 root.render(createElement(CreateGeneTab,{key:'edit',editCharacter:character!,onClose:()=>closed++}));await wait();learner().click();await wait();
 input(document.querySelector('[aria-label="可选共同记忆"]')!,'用户喜欢清淡早餐');await wait();
 const memoryCheckbox=[...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(el=>el.parentElement?.textContent?.includes('我确认把以上'))!;
 check(!memoryCheckbox.checked,'separate memory confirmation');memoryCheckbox.click();await wait();button('保存角色').click();await wait();await wait();
 const memories=await db.memories.toArray();check(memories.length===1&&memories[0].userId==='style-owner'&&memories[0].characterId==='style-character','memory scoped to owner and character');
 check((await db.characters.get('style-character'))!.systemPrompt.split('[从聊天学习的表达]').length===2,'style not duplicated on edit');
 check(await db.messages.count()===0&&await db.sessions.count()===0,'conversation untouched');
 root.unmount();window.fetch=report;await report('/result?suite=chat-style',{method:'POST',body:`ok ${count} assertions\nALL PASS`});
}
run().catch(async e=>{window.fetch=report;await report('/result?suite=chat-style',{method:'POST',body:`FAIL ${e.stack}\n1 FAILED`});});
