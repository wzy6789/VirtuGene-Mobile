import './voice-call-ui';
import {useVoiceCallStore} from '../../src/store/voice-call-store';
async function main(){
 await (window as any).callUiTest.hosted();
 const store=useVoiceCallStore;
 const patch=(view:Record<string,unknown>)=>store.setState({view:{...store.getState().view!,...view}});
 patch({phase:'listening',inputMode:'voice',userText:'',speakingText:'',heardText:'',capabilities:{sampleRate:16000,echoCancellation:true,noiseSuppression:true,routes:[{id:1,type:7,label:'蓝牙耳机 · 预览',selected:true},{id:2,type:2,label:'扬声器 · 预览',selected:false}]}});
 store.setState({
  start:async()=>{store.setState({busy:true});patch({phase:'listening',error:undefined});},
  mute:async()=>patch({muted:!store.getState().view?.muted}),resume:async()=>patch({phase:'listening',error:undefined}),interrupt:async()=>patch({phase:'listening',speakingText:''}),
  routes:async()=>{},route:async id=>patch({capabilities:{...store.getState().view!.capabilities!,routes:store.getState().view!.capabilities!.routes.map(route=>({...route,selected:route.id===id}))}}),
  setInputMode:async inputMode=>patch({inputMode,phase:'listening'}),
  sendText:async userText=>{patch({userText,phase:'playing',speakingText:'这是界面演示，未请求模型，也没有播放声音。'});setTimeout(()=>patch({phase:'listening',speakingText:''}),1200);return true;},
 });
 Object.assign(window,{rhythmPreview:{ready:true,speaking:()=>patch({phase:'playing',speakingText:'还在吗？不着急，我在。'}),listening:()=>patch({phase:'listening',speakingText:''})}});
}
void main();
