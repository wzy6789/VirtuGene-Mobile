import './chat-stream-ui';
import {useChatStore} from '../../src/store/chat-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {db} from '../../src/db';
import {messageRepo} from '../../src/db/message-repo';
const w=window as any,original=messageRepo.getPage.bind(messageRepo);
let hold=false,fail=false,release:(()=>void)|undefined,calls=0,finished=0,interruptFrame=false,interrupted=0;
const nativeFrame=requestAnimationFrame.bind(window);
const visible=()=>{const el=document.querySelector<HTMLElement>('.chat-thread')!,box=el.getBoundingClientRect(),node=[...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(n=>{const rect=n.getBoundingClientRect();return rect.bottom>box.top+2&&rect.top<box.bottom;});return{top:el.scrollTop,id:node?.dataset.messageId,offset:node?node.getBoundingClientRect().top-box.top:null};};
requestAnimationFrame=callback=>{
 if(interruptFrame&&new Error().stack?.includes('handleLoadEarlier')){interruptFrame=false;return nativeFrame(()=>{const el=document.querySelector<HTMLElement>('.chat-thread')!;el.dispatchEvent(new WheelEvent('wheel',{deltaY:700}));el.scrollTop+=700;nativeFrame(time=>{interrupted++;w.historyFrameInterruption=visible();callback(time);});});}
 return nativeFrame(callback);
};
messageRepo.getPage=async(...args)=>{
 if(args[1]?.beforeMessage){calls++;if(hold){hold=false;await new Promise<void>(resolve=>{release=resolve;});}try{if(fail){fail=false;throw Error('Controlled history read failure');}return await original(...args);}finally{finished++;}}
 return original(...args);
};
w.historyTest={
 async setup(allLoaded=false){release?.();release=undefined;hold=false;fail=false;calls=0;finished=0;interruptFrame=false;interrupted=0;w.historyFrameInterruption=undefined;await w.chatStreamTest.setup(400);useSettingsStore.setState({reduceMotion:true,chatFontSize:16});if(!allLoaded)useChatStore.setState(state=>({messages:state.messages.slice(-200),hasMoreMessages:true}));else useChatStore.setState({hasMoreMessages:true});},
 hold(){hold=true;},fail(){fail=true;},release(){release?.();release=undefined;},
 snapshot(){return{calls,finished,interrupted,held:!!release,count:useChatStore.getState().messages.length,unique:new Set(useChatStore.getState().messages.map(row=>row.id)).size,session:useChatStore.getState().currentSessionId,more:useChatStore.getState().hasMoreMessages,requests:w.chatStreamTest.requests().length,extraNetwork:w.chatStreamTest.extraNetwork()};},
 interruptAfterAwait(){interruptFrame=true;},
 font(size:number){useSettingsStore.setState({chatFontSize:size});},
 image:(path:string)=>db.messages.update('history-199',{image:path}),
 async remove(id:string){await db.messages.delete(id);useChatStore.setState(state=>({messages:state.messages.filter(message=>message.id!==id)}));},
 async resetView(){await w.chatStreamTest.switchTo('a');},
};
