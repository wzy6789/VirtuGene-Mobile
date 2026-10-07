import { createRoot } from 'react-dom/client';
import { Icon } from '../../src/components/ui/Icon';
import { LoadingSkeleton } from '../../src/components/ui/LoadingSkeleton';
import { OrbEmptyState } from '../../src/components/ui/OrbEmptyState';
import { FeedbackNotice } from '../../src/components/ui/FeedbackNotice';
import { SoulOrbButton } from '../../src/components/ui/SoulOrb';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { installUiFont } from '../../src/lib/ui-font';
import { useSettingsStore } from '../../src/store/settings-store';
import { useState } from 'react';
import { SettingsGroup, SettingsRow, SettingsSwitch } from '../../src/components/settings/SettingsUI';
import '../../src/styles/assistant-hub.css';
import { LivingWorldHero } from '../../src/components/character/LivingWorldHero';
import { RelationMilestoneToast } from '../../src/components/chat/RelationMilestoneToast';
import { useCharacterStateStore } from '../../src/store/character-state-store';
const root=createRoot(document.getElementById('root')!);
function Comparison(){
  const [done,setDone]=useState(false);
  const [tab,setTab]=useState('today');
  const [quiet,setQuiet]=useState(false);
  return <div className="mobile-layout" style={{height:'auto',minHeight:'100vh',overflow:'visible',padding:16,background:'var(--bg)',color:'var(--text)'}}>
    <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}><div><p style={{fontSize:12,color:'var(--text-secondary)'}}>VIRTUGENE · 6.0.1</p><h1 style={{fontSize:22}}>同一件事，全新的质感</h1></div><SoulOrbButton size={48} emotion={done?'success':'idle'} label="完成反馈预览" onActivate={()=>setDone(v=>!v)}/></header>
    <section aria-label="改造前"><p style={{fontSize:12,color:'var(--text-secondary)',marginBottom:8}}>原有表面</p><div style={{padding:16,border:'1px solid var(--border)',borderRadius:18,background:'var(--bg-panel)'}}><strong style={{fontSize:15}}>整理今天的生活记录</strong><p style={{fontSize:12,color:'var(--text-secondary)',marginTop:6}}>普通底色与细边框，层次较平。</p></div></section>
    <section className="vg-cabin-focus" aria-label="改造后"><div className="vg-cabin-section-title"><h2>今日先做这 1 件事</h2></div><article className={`vg-cabin-task ${done?'is-done':''}`} data-energy="today"><button type="button" className="vg-cabin-task-main" aria-label="完成：整理今天的生活记录" onClick={()=>setDone(v=>!v)}><span className="vg-cabin-check">{done?<Icon name="check"/>:'01'}</span><span><strong>整理今天的生活记录</strong><small>今天 20:30 · 让日子有回声</small></span></button><div className="vg-cabin-task-meta"><span>{done?'已完成':'今日重点'}</span></div><div className="vg-cabin-task-actions"><button type="button">编辑</button><button type="button">和助理聊聊</button></div></article></section>
    <div className="vg-cabin-stats">{[['3','待完成'],['12','已完成'],['1','已逾期'],['2','需跟进']].map(([count,label])=><button key={label}><strong>{count}</strong><span>{label}</span></button>)}</div>
    <p className="vg-cabin-stat-note">今日及逾期共 4 件 · 同一事项只计一次</p>
    <FeedbackNotice message="已保存，事情有了着落" tone="success"/>
    <div style={{marginTop:12}}><FeedbackNotice message="操作未完成，原记录保留" tone="error"/></div>
    <section aria-label="四级按钮" style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:24}}><button className="vg-button vg-button-primary">保存</button><button className="vg-button vg-button-secondary">稍后</button><button className="vg-button vg-button-ghost">编辑</button><button className="vg-button vg-button-danger">删除</button></section>
    <section aria-label="聊天阅读对照" style={{marginTop:32}}>
      <h2 style={{fontSize:20,marginBottom:16}}>让文字，安静地被看见</h2>
      <div className="vg-message-bubble is-character-bubble" data-length="long">今天不用把所有事情做完。先留一点时间，整理最重要的安排；剩下的，我们慢慢来。<br />长句、标点与换行都保持清晰，阅读表面不叠加发光纹理。</div>
      <div className="vg-message-bubble is-user-bubble" data-length="short" style={{margin:'12px 0 16px auto',width:'fit-content'}}>好，就从这一件开始。</div>
      <div className="vg-search-field"><Icon name="search"/><input aria-label="输入框预览" placeholder="搜索聊天或记录"/><button type="button" aria-label="搜索预览"><Icon name="arrow"/></button></div>
    </section>
    <section className="vg-settings-design" aria-label="设置分组对照" style={{marginTop:32,padding:0}}>
      <SettingsGroup title="相处与阅读" scope="当前偏好"><SettingsRow title="外观与阅读" detail="调整主题与字号，让每段对话清晰舒适。" icon="appearance" value="跟随系统" onClick={()=>{}}/><SettingsRow title="连接与模型" detail="查看当前连接和可用模型。" icon="connection" value="已连接" onClick={()=>{}}/><SettingsSwitch title="触感反馈" detail="关键操作时，给予轻微回应。" checked={quiet} onChange={setQuiet}/></SettingsGroup>
    </section>
    <nav className="vg-assistant-tabs" data-tab={tab} aria-label="页签动效预览"><span className="vg-assistant-tab-track" aria-hidden="true"><i/></span>{[['today','今日'],['chat','对话'],['pending','待处理']].map(([id,label])=><button type="button" key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <LoadingSkeleton label="读取预览" rows={1}/>
    <OrbEmptyState title="今天暂无待做安排" detail="留一点空白，给自己的生活。" action="记下一件事" onAction={()=>{}}/>
    <section aria-label="世界入口对照" style={{marginTop:24}}>
      <LivingWorldHero characters={[]} states={{}} onCreate={()=>{}} onOpenNetwork={()=>{}} />
      <nav aria-label="世界入口" className="vg-world-life-entries" style={{marginTop:16}}>{[['is-diary','diary','日记','留下今天的故事'],['is-stage','play','星域','进入正在发生的世界']].map(([kind,icon,title,detail])=><button type="button" key={kind} className={`vg-world-life-entry ${kind}`}><Icon name={icon as 'diary'|'play'} /><strong>{title}</strong><span>{detail}</span><i><Icon name="arrow" size={18}/></i></button>)}</nav>
      <div className="vg-character-row" style={{display:'flex',alignItems:'center',marginTop:16}}><button type="button" style={{flex:1,textAlign:'left',padding:16}}><strong>清和 · 一个很长的角色名字</strong><p style={{fontSize:13,color:'var(--text-secondary)',marginTop:4}}>在每一次对话里，慢慢认识彼此。</p></button><button type="button" aria-label="角色管理预览" style={{minWidth:44,minHeight:48}}><Icon name="more"/></button></div>
    </section>
    <RelationMilestoneToast />
  </div>;
}
installUiPreferences();installUiFont();root.render(<Comparison/>);
(window as any).uiV2={useSettingsStore,useCharacterStateStore};
