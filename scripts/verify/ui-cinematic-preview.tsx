/** Existing product components on an isolated origin. Transport stays controlled. */
import './chat-scene-preview';
import {createRoot} from 'react-dom/client';
import {MobileLayout} from '../../src/components/layout/MobileLayout';
import {VoiceCallHost} from '../../src/components/chat/VoiceCallHost';
import {useUIStore} from '../../src/store/ui-store';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useChatStore} from '../../src/store/chat-store';
import {db} from '../../src/db';
import {fakeCharacter} from './world-harness';
import {installUiPreferences} from '../../src/lib/ui-preferences';
import {installUiFont} from '../../src/lib/ui-font';
import {GlassSurface} from '../../src/components/ui/GlassSurface';
import {CHAT_SCENES} from '../../src/lib/chat-scene/scene-registry';
const w=window as any;
let attempts=0;
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=async()=>{attempts++;throw Error('Isolated UI preview blocks microphone');};
HTMLMediaElement.prototype.play=async()=>{attempts++;throw Error('Isolated UI preview blocks audio');};
if(typeof Notification!=='undefined')Notification.requestPermission=async()=>{attempts++;return 'denied';};
async function boot(){
 await w.backgroundTest.setup(0);await w.sceneTest.stock(2);
 // Default entry exercises the product default. A cafe sample stays opt-in.
 if(new URLSearchParams(location.search).get('sample')==='cafe')await w.backgroundTest.save({mode:'scene',scene:{id:'cafe-afternoon',quality:'auto',motionEnabled:true,parallaxEnabled:false,renderer:'layered'},presentation:{preset:'cinematic',transparency:'balanced',ambient:true,avatar:true}},'');
 w.chatStreamTest.unmount();
 const userId=useAuthStore.getState().userId!;
 const roles=[fakeCharacter('cinema-preset','晓来','system',{avatar:'preset-avatar:preset-xiaowu',isPreset:true,signature:'穿过漫长的夜，迎来新的天光。',tags:['温柔','日常','阅读']}),fakeCharacter('cinema-shared','顾策','other',{avatar:'preset-avatar:preset-wenchuan',published:true,signature:'理性之外，也有柔软的诗。',tags:['理性','成熟']})];
 await db.characters.update('a',{avatar:'preset-avatar:preset-zhiwei'});await db.characters.update('b',{avatar:'preset-avatar:preset-luxueqi'});
 await db.characters.bulkPut(roles);useChatStore.setState(s=>({characters:[...s.characters.map(c=>c.id==='a'?{...c,avatar:'preset-avatar:preset-zhiwei'}:c.id==='b'?{...c,avatar:'preset-avatar:preset-luxueqi'}:c),...roles]}));
 useSettingsStore.setState({reduceMotion:false,ttsEnabled:false,aiVoiceMode:false});
 localStorage.setItem('virtugene:lastSeenVersion',__APP_VERSION__);localStorage.setItem('virtugene:onboarded:'+userId,'1');
 installUiPreferences();installUiFont();
 const open=(view:string)=>useUIStore.setState({activeView:'chat',mobileTab:view==='world'?'world':view==='characters'||view==='genes'?'characters':view==='me'?'me':'chat',chatFromList:view==='chat',chatFromCharacters:false});
 const root=createRoot(document.getElementById('app')!);
 const renderApp=()=>root.render(<><MobileLayout/><VoiceCallHost/></>);renderApp();
 const materials=()=>root.render(<div className="vg-material-calibration">{['cafe-afternoon','cafe-rain-night','guofeng-tea-room'].map((id,i)=>{const scene=CHAT_SCENES.find(s=>s.id===id)??CHAT_SCENES[0];return <section key={id} style={{backgroundImage:`url(${scene.poster[0].src})`}}><GlassSurface roleType="control" quality="realtime"><strong>{['明亮环境 · 控制玻璃','夜景环境 · 控制玻璃','高纹理 · 控制玻璃'][i]}</strong><button type="button" style={{marginLeft:12,minHeight:44}}>操作</button></GlassSurface><GlassSurface roleType="content"><strong>内容玻璃</strong><p>同一底面承托标题、标签与操作。</p></GlassSurface><GlassSurface roleType="reading" quality="static">正文玻璃：杯子还温热，我们慢慢聊。Clear words stay readable.</GlassSurface></section>;})}</div>);
 w.cinematicTest={open,materials,renderApp,
 async sceneSession(){const row=await db.sessions.get(useChatStore.getState().currentSessionId!);return row?{sceneTimeOfDay:row.sceneTimeOfDay,scenePlace:row.scenePlace,sceneAtmosphere:row.sceneAtmosphere}:undefined;},
 async settings(page:'voice'|'appearance'){const {SettingsPanel}=await import('../../src/components/settings/SettingsPanel');root.render(<><MobileLayout/><SettingsPanel open initialPage={page} onClose={renderApp}/></>);},
 async worldSample(){const {worldRepo}=await import('../../src/db/world-repo');const {worldSceneRepo}=await import('../../src/db/world-scene-repo');const world=await worldRepo.ensureDefaultWorld(userId);const ids=[];for(const [title,place,timeLabel] of [['街角咖啡','临街咖啡厅','午后'],['竹窗喝茶','竹林茶室','清晨'],['冬夜归家','卧室','夜晚']])ids.push(await worldSceneRepo.createScene({userId,worldId:world.id,title,place,timeLabel,mood:'安静',characterIds:['a','b']}));useUIStore.setState({activeView:'chat',mobileTab:'world',worldTheaterOpen:true,chatFromList:false,chatFromCharacters:false});return ids;},
 selectRole:(id:string)=>useChatStore.getState().selectCharacter(id),async assistantSample(){const role={...fakeCharacter('cinema-assistant','日常助理',userId),agentProfile:'secretary' as const};await db.characters.put(role);await useChatStore.getState().loadCharacters();await useChatStore.getState().selectCharacter(role.id);},snapshot:()=>({userId:useAuthStore.getState().userId,mediaAttempts:attempts,extraNetwork:w.chatStreamTest.extraNetwork(),view:useUIStore.getState().mobileTab})};
 open(new URLSearchParams(location.search).get('view')??'chat');
 w.cinematicReady=true;
}
void boot().catch(error=>{w.cinematicError=String(error);console.error(error);});
