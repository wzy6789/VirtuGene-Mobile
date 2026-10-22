/** Actual ChatWindow and settings; isolated IndexedDB and simulated transport only. */
import './chat-background-complete';
import {db} from '../../src/db';
import {useChatStore} from '../../src/store/chat-store';
import {inspectChatScene,inspectChatSceneResources,probeChatSceneDepth} from '../../src/components/chat/scene/ChatSceneLayer';
import {inspectChatParticleEngine} from '../../src/lib/chat-particle-engine';
import {loadChatParticleEngine} from '../../src/lib/chat-particle-engine';
import {CHAT_SCENES} from '../../src/lib/chat-scene/scene-registry';
import {isSceneId} from '../../src/lib/chat-scene/scene-catalog';
import {DEFAULT_CHAT_BACKGROUND} from '../../src/lib/chat-background-config';
import {useSettingsStore} from '../../src/store/settings-store';
const state=window as any;
state.sceneModelAssetsAllowed=true;
state.sceneTest={
  scenes:CHAT_SCENES,
  inspect:()=>[...document.querySelectorAll<HTMLElement>('.vg-chat-scene')].map(inspectChatScene),
  resources:()=>({...inspectChatSceneResources(),particleEngine:inspectChatParticleEngine()}),
  depth:()=>[...document.querySelectorAll<HTMLElement>('.vg-chat-scene')].map(probeChatSceneDepth),
  scene:(id='cafe-afternoon',quality='auto',extra={})=>state.backgroundTest.save({...DEFAULT_CHAT_BACKGROUND,mode:'scene',scene:{id,quality,motionEnabled:true,parallaxEnabled:true,...extra}}),
  font:(size:number)=>useSettingsStore.setState({chatFontSize:size}),
  async failParticleInit(){const engine=await loadChatParticleEngine(),load=engine.load;engine.load=async function(params){engine.load=load;const transfer=HTMLCanvasElement.prototype.transferControlToOffscreen;HTMLCanvasElement.prototype.transferControlToOffscreen=function(){throw Error('Controlled scene particle initialization failure');};try{return await load.call(engine,params);}finally{HTMLCanvasElement.prototype.transferControlToOffscreen=transfer;}};},
  async stock(count=500){
    const sampleImage='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#c8d8d6"/><circle cx="238" cy="56" r="22" fill="#f2e4bb"/><path d="M0 180 90 75 190 180 245 112 320 185V200H0Z" fill="#688b80"/></svg>');
    const templates=[
      '今晚可以坐一会儿吗？',
      '当然。杯子还温热，我们慢慢聊。',
      '中文长句与长文阅读：'+ '把今天的小事慢慢说给我听，不必着急。'.repeat(18),
      'A_long_unbroken_word_'+ 'abcdefghijklmnop'.repeat(24),
      '[示例链接](https://example.invalid/reading)\n\n```js\nconst quiet = "'+ 'readable_'.repeat(35)+'";\n```',
      '逐项阅读\n\n1. 先慢慢说。\n2. 留意清晰的文字。\n\n- 今天的小事\n- 下一次见面',
      '一张本地场景图片，也应保留稳定的消息布局。',
    ];
    const rows=Array.from({length:count},(_,i)=>({id:`scene-history-${i}`,sessionId:'a',role:i%3===0?'user' as const:'assistant' as const,content:templates[i%templates.length],...(i%6===0?{replyToContent:'被引用的原话也应当清晰可读。'}:{}),...(i%templates.length===6?{image:sampleImage}:{}),createdAt:Date.now()-(count-i)*60000,isProactive:false}));
    await db.messages.where('sessionId').equals('a').delete();await db.messages.bulkPut(rows);
    useChatStore.setState({messages:rows,hasMoreMessages:false});return rows.length;
  },
};
const params=new URLSearchParams(location.search);
if(params.has('demo'))void (async()=>{await state.backgroundTest.setup(0);await state.sceneTest.stock(2);state.backgroundTest.theme(params.get('theme')==='light'?'light':'dark');const id=params.get('demo');await state.sceneTest.scene(isSceneId(id)?id:'cafe-afternoon');})();
