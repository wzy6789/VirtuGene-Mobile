import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CreateGeneTab } from '../../src/components/character/CreateGeneTab';
import { db, type Character, type MemoryItem } from '../../src/db';
import { memoryRepo } from '../../src/db/memory-repo';
import { useAuthStore } from '../../src/store/auth-store';
import { useChatStore } from '../../src/store/chat-store';
import { stateRepo } from '../../src/db/state-repo';
const report = window.fetch.bind(window);
let count = 0;
const wait = () => new Promise(r => setTimeout(r, 140));
function check(value: unknown, label: string) { if (!value) throw Error(label); count++; }
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
function input(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
 Object.getOwnPropertyDescriptor(el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
 el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function run() {
 if (new URLSearchParams(location.search).has('visual')) {
   useAuthStore.setState({userId:'visual-owner'});
   useChatStore.setState({characters:[]});
   const host=document.createElement('div');document.body.append(host);
   createRoot(host).render(createElement(CreateGeneTab,{onClose:()=>{}}));
   return;
 }
 await db.delete(); await db.open();
 const userId = 'create-owner';
 useAuthStore.setState({ userId, apiKey: 'fake-preview-key' });
 const source = { id:'source', name:'旧友', avatar:'🌙', systemPrompt:'旧人物', tags:[], createdBy:userId, createdAt:1, isPreset:false } as Character;
 await db.characters.add(source);
 const make = (id:string, content:string, owner=userId, status:MemoryItem['status']='active') => ({id, content, userId:owner, characterId:'source', type:'auto', status, createdAt:10} as MemoryItem);
 await db.memories.bulkAdd([make('picked','用户喜欢桂花糕'), make('unpicked','与旧友一起去海边'), make('foreign','外国账号秘密','foreign-owner'), make('revoked','已撤回信息',userId,'withdrawn')]);
 let createdCount=0, closed=0, saved:Character|undefined;
 let failRelation=true;
 const realReplace=stateRepo.replaceStoryRelations;
 stateRepo.replaceStoryRelations=async (...args) => {if(failRelation){failRelation=false;throw Error('disk');}return realReplace(...args);};
 useChatStore.setState({characters:[source], createCharacter:async data => {
   createdCount++; saved={...data,id:'new-person',createdBy:userId,createdAt:20,proactivity:0} as Character;
   await db.characters.add(saved);return saved;
 }, updateCharacter:async (id,updates)=>{await db.characters.update(id,updates);} });
 const host=document.createElement('div');document.body.append(host);
 const root=createRoot(host);root.render(createElement(CreateGeneTab,{onClose:()=>closed++}));await wait();
 check(!!document.querySelector('[aria-label="创建角色步骤"]'),'four step navigation');
 check(button('下一步').disabled,'name required before next');
 input(document.querySelector('input[placeholder="为数字灵魂命名"]')!,'岚');await wait();button('下一步').click();await wait();
 check(!button('下一步').disabled,'one-character names allowed');
 input(document.querySelector('input[placeholder^="例如：我自己"]')!,'林舟');
 input(document.querySelector('input[placeholder^="例如：搭档"]')!,'旧友');await wait();
 button('已经认识').click();await wait();
 input(document.querySelector('textarea[placeholder="写下你希望成为出场背景的经历"]')!,'一起修过船');await wait();
 check(!document.querySelector('input[aria-label^="分享记忆"]'),'memory import section removed');
 check(!!button('相遇') && !button('相遇预览'),'encounter label shortened');
 button('下一步').click();await wait();
 input(document.querySelector('textarea[placeholder^="TA 在意什么"]')!,'嘴硬心软，用短句，不乱用比喻。');await wait();
 button('直接使用我的设定').click();await wait();
 check(!button('让 TA 来到我的世界').disabled,'manual creation requires no model');
 let prompt='';let network=0;
 window.fetch=async (_url,init)=>{network++;prompt=JSON.parse(String(init?.body)).messages[0].content;return new Response(JSON.stringify({choices:[{message:{content:'先坐会儿，我给你倒水。'}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
 button('试着聊两句').click();await new Promise(r=>setTimeout(r,300));
 check(network===1 && host.textContent?.includes('先坐会儿'),'explicit nonstreaming preview works');
 check(prompt.includes('林舟')&&prompt.includes('一起修过船'),'preview uses explicitly written relationship');
 check(!prompt.includes('与旧友一起去海边')&&!prompt.includes('用户喜欢桂花糕')&&!prompt.includes('外国账号秘密'),'preview imports no existing character memories');
 check(await db.sessions.count()===0 && await db.messages.count()===0,'preview creates no chat history');
 button('让 TA 来到我的世界').click();await wait();
 check(closed===0&&host.textContent?.includes('保存未完成'),'failure retains form and retry');
 button('让 TA 来到我的世界').click();await wait();
 check(closed===1&&createdCount===1,'retry creates only one character');
 const character=await db.characters.get('new-person');
 check(character?.systemPrompt.includes('林舟')&&character.systemPrompt.includes('旧友'),'relationship saved to persona');
 const imported=await db.memories.where('characterId').equals('new-person').toArray();
 check(imported.length===0,'creation imports no old memories');
 check(await db.memories.count()===4,'source memories remain unchanged');
 await memoryRepo.importRecentUserMemories('new-person',userId,12,['foreign','revoked','unpicked']);
 check((await db.memories.where('characterId').equals('new-person').toArray()).length===1,'repository rejects foreign and withdrawn IDs');
 check((await db.characters.get('source'))?.systemPrompt==='旧人物','original persona unchanged');
 root.render(createElement(CreateGeneTab,{key:'edit',editCharacter:{...source,boundaries:'不说长篇旁白',systemPrompt:'旧人物\n\n[互动边界]\n不说长篇旁白'},onClose:()=>closed++}));await wait();
 check(!document.querySelector('[aria-label="创建角色步骤"]'),'editing retains existing single-form entry');
 button('保存角色').click();await wait();
 check((await db.characters.get('source'))?.systemPrompt.split('[互动边界]').length===2,'editing does not duplicate boundary blocks');
 root.unmount();window.fetch=report;
 await report('/result?suite=character-create',{method:'POST',body:`PASS ${count} creation checks\nALL PASS`});
}
run().catch(async error=>{await report('/result?suite=character-create',{method:'POST',body:`FAIL ${error.stack}\n1 FAILED`});});
