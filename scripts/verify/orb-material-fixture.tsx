import { createRoot } from 'react-dom/client';
import { useState, useLayoutEffect } from 'react';
import { SoulOrb, SOUL_ORB_EMOTIONS, SOUL_ORB_LABELS } from '../../src/components/ui/SoulOrb';
import { useSettingsStore } from '../../src/store/settings-store';
import { soulOrbMotionActivity } from '../../src/lib/soul-orb-motion';
import type { OrbColor } from '../../src/lib/orb-colors';
const w = window as any;
if (!w.orbMaterialTestOrigin) throw Error('Isolated material entry only');
useSettingsStore.setState({ reduceMotion: true, orbColor: 'auto' });
const sizes = [24,32,44,52,80,160];
type Mode = { host: 'plain'|'character'|'voice'; color: OrbColor; theme: 'dark'|'light'; explicitAuto?: boolean };
function Gallery() {
  const [mode,setMode] = useState<Mode>({host:'plain',color:'auto',theme:'dark'});
  useLayoutEffect(() => { document.documentElement.classList.toggle('dark', mode.theme === 'dark'); w.orbMaterialMode=mode; }, [mode]);
  w.orbMaterial = { setMode, motion: soulOrbMotionActivity };
  const context = mode.host === 'voice' ? 'voice' : 'interaction';
  return <main className="orb-material-lab" data-host={mode.host} data-color={mode.color}>
    <header><h1>小球静态材质检查</h1><p>实际 SVG 组件 · 固定表情与静止帧 · 无模型、麦克风或音频</p></header>
    <div className="orb-material-matrix">{sizes.map(size => <section key={size}><h2>{size}px</h2><div className="orb-material-row">{SOUL_ORB_EMOTIONS.map(emotion => <figure key={emotion} data-size={size} data-emotion={emotion}>
      <div className={mode.host === 'voice' ? 'vg-voice-call-soul' : mode.host === 'character' ? 'vg-character-orb' : ''} style={{width:size,height:size,margin:0}}>
        <SoulOrb key={`${mode.host}-${mode.color}-${mode.explicitAuto}`} size={size} animated={false} emotion={emotion} motionContext={context} colorOverride={mode.color === 'auto' && !mode.explicitAuto ? undefined : mode.color}/>
      </div><figcaption>{SOUL_ORB_LABELS[emotion]}</figcaption>
    </figure>)}</div></section>)}</div>
  </main>;
}
createRoot(document.getElementById('app')!).render(<Gallery/>);
