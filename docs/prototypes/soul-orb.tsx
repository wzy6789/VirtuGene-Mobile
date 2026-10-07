import { Profiler, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SoulOrb, SoulOrbButton, SOUL_ORB_EMOTIONS, SOUL_ORB_LABELS, type SoulOrbEmotion } from '../../src/components/ui/SoulOrb';
import { useSettingsStore } from '../../src/store/settings-store';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { soulOrbMotionActivity } from '../../src/lib/soul-orb-motion';
import type { OrbAttention } from '../../src/lib/orb-motion-profiles';
installUiPreferences();
let commits=0, activations=0;
function Demo() {
  const [emotion,setEmotion]=useState<SoulOrbEmotion>('idle'),[light,setLight]=useState(false),[small,setSmall]=useState(false),[dual,setDual]=useState(false);
  const reduced=useSettingsStore(s=>s.reduceMotion);
  const [attention,setAttention]=useState<OrbAttention>();
  const [cueId,setCueId]=useState<number>();
  Object.assign((window as any).soulOrbDemo,{look:(point:{x:number;y:number},key:string)=>setAttention({key,point,expiresInMs:1200}),cue:(value:SoulOrbEmotion,id:number)=>{setEmotion(value);setCueId(id);}});
  return <div className="orb-lab">
    <header className="orb-lab-header"><a href="#" aria-label="VirtuGene 表情小球预览"><svg aria-hidden="true" viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 3c10 4 0 14 10 18M17 3C7 7 17 17 7 21M8 6h8M8 18h8M9 10h6M9 14h6"/></svg><span>VirtuGene</span></a><button className="orb-theme" aria-label="切换预览主题" aria-pressed={light} onClick={()=>{setLight(!light);document.documentElement.classList.toggle('dark',light);}}>{light?'浅色':'深色'}<span aria-hidden="true">◐</span></button></header>
    <main><div className="orb-intro"><span className="orb-eyebrow">小星 · 表情与交互预览</span><h1>给灵魂<br/>一点表情。</h1><p>一个会看你、会思考，<br/>也会为你开心的小伙伴。</p><div className="orb-now"><span className="orb-status-dot"/><span>现在的表情</span><strong role="status">{SOUL_ORB_LABELS[emotion]}</strong></div><button className="orb-reduce" aria-pressed={reduced} onClick={()=>useSettingsStore.getState().setReduceMotion(!reduced)}><span className="orb-toggle" data-on={reduced}/><span>减少动态效果</span></button></div>
    <div className="orb-stage"><div className="orb-stage-orbit"/><SoulOrbButton className="orb-pet" label="轻轻碰一下小星" emotion={emotion} attention={attention} cueId={cueId} size={280} onActivate={()=>activations++}/>{dual&&<span className="orb-companion"><SoulOrbButton emotion={emotion} size={40} label="轻触小星缩略预览"/></span>}<span className="orb-stage-hint">轻触互动，在附近移动指针或手指</span></div>
    <section className="orb-expressions" aria-label="选择表情"><div className="orb-section-caption"><h2>此刻的小星</h2><span>选一个表情，看看它的反应</span></div><div className="orb-preview-controls"><button aria-pressed={small} onClick={()=>setSmall(value=>!value)}>40px 小尺寸</button><button aria-pressed={dual} onClick={()=>setDual(value=>!value)}>双球同屏</button></div><div className="orb-expression-grid">{SOUL_ORB_EMOTIONS.map(value=><button key={value} className="orb-expression" aria-pressed={emotion===value} onClick={()=>setEmotion(value)}><SoulOrb emotion={value} size={small?40:66} animated={false}/><span>{SOUL_ORB_LABELS[value]}</span></button>)}</div></section>
    <footer>表情演示 · 正式接入后由助理的实际状态驱动</footer></main>
  </div>;
}
(window as any).soulOrbDemo={activity:soulOrbMotionActivity,commits:()=>commits,activations:()=>activations,settings:useSettingsStore};
createRoot(document.getElementById('root')!).render(<StrictMode><Profiler id="orb-lab" onRender={()=>commits++}><Demo/></Profiler></StrictMode>);
