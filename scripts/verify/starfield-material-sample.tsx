/** P1 material study only. No account data, product settings, or model calls. */
import { createRoot } from 'react-dom/client';
import { SoulOrb } from '../../src/components/ui/SoulOrb';
import { installUiFont } from '../../src/lib/ui-font';
import planet from '../../.tmp-preview/starfield-upgrade-20261017/P1/assets/mineral-world-concept.png';

installUiFont();
function MaterialSample(){
  return <main className="star-material-shell" aria-label="P1静态材质样板">
    <header><p className="sample-caption">静态材质样板 · 非正式产品界面</p><h1>留住共同的时刻</h1><p className="sample-intro">低彩度紫与深墨蓝，给故事一个安静的背景。</p></header>
    <figure className="sample-world"><img src={planet} alt="左上受光、右下沉静的雾紫矿物星体材质样本" width="1254" height="1254"/><figcaption>一枚主星体 · 左上单光 · 清晰轮廓</figcaption></figure>
    <section className="sample-panel" aria-label="拟用实色面板">
      <p className="sample-caption">共同世界</p><h2>那些没说完的话</h2><p>雨停以后，仍可以慢慢继续。文字与操作拥有独立、稳定的阅读表面。</p>
      <div className="sample-actions"><button type="button" className="sample-primary">聊一聊</button><button type="button" className="sample-secondary">助理空间</button></div>
    </section>
    <section className="sample-orb" aria-label="44像素原有SVG小球">
      <SoulOrb size={44} emotion="idle" animated={false} interactive={false} fallbackLabel={false}/><div><strong>44px 原有小球</strong><p>表情与状态保留；材质将在 P5 单独调整。</p></div>
    </section>
    <section className="sample-comparison" aria-label="表面对比">
      <div className="sample-current"><strong>当前表面</strong><span>偏紫褐 · 边界较软</span></div><div className="sample-proposed"><strong>拟用表面</strong><span>深墨蓝 · 明暗分层</span></div>
    </section>
    <footer>2.5D 栅格星体 / 正式 SVG 小球 / 原生文字与按钮。此页不保存或发送任何内容。</footer>
  </main>;
}
createRoot(document.getElementById('app')!).render(<MaterialSample/>);
(window as any).starfieldMaterial={inspect:()=>({sample:true,theme:document.documentElement.classList.contains('dark')?'dark':'light',viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},orbSize:44,animated:false,productChanged:false,isolation:(window as any).uiContractIsolation})};
