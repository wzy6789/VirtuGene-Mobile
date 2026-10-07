import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SoulOrb, SoulOrbButton, type SoulOrbEmotion } from '../../src/components/ui/SoulOrb';
import { EmotionChart } from '../../src/components/chat/EmotionChart';
import { Modal } from '../../src/components/ui/Modal';
import { useThemeStore } from '../../src/store/theme-store';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { useSettingsStore } from '../../src/store/settings-store';

installUiPreferences();
type Tab = 'overview'|'emotion'|'memories'|'story';
const tabs: [Tab,string][]=[['overview','概览'],['emotion','情绪'],['memories','回忆'],['story','故事']];
const samples={
  moon:{name:'小月',initial:'月',relation:'好友',days:24,count:186,memoryCount:8,
    user:'周末想去逛逛书店。我一直更喜欢安静的地方，最近也想找点时间慢下来。',
    reply:'那就给周末留一点空白吧。找一家安静的书店，坐下来，慢慢翻几页。',
    summary:'聊到了周末逛书店，以及你想放慢生活节奏的心情。',
    memory:'你更喜欢安静的地方。',older:'你收藏过第一次一起聊音乐的那段话。',
    atmosphere:'轻松 · 期待',dims:{valence:7.8,arousal:5.2,intimacy:6.8,engagement:8.4,expressiveness:7.3,stability:7.5}},
  chen:{name:'陈言',initial:'言',relation:'熟悉',days:12,count:79,memoryCount:3,
    user:'今天完成了那个准备很久的项目。下周打算给自己放一天假，出去散散步。',
    reply:'这份努力值得被记下来。放假的那天，就去走走，让自己好好休息一下。',
    summary:'聊到了项目完成，以及下周给自己放一天假的计划。',
    memory:'你提到今天完成了准备很久的项目。',older:'你收藏过讨论新项目方向的那段话。',
    atmosphere:'满足 · 放松',dims:{valence:8.1,arousal:6.2,intimacy:5.2,engagement:8.1,expressiveness:7.6,stability:7.2}},
};
type Role=keyof typeof samples;
const paths={back:'m15 5-7 7 7 7',close:'m6 6 12 12M18 6 6 18',more:'M5 12h.01M12 12h.01M19 12h.01',arrow:'m5 12h14m-6-6 6 6-6 6',book:'M4 4h6q2 0 2 2v15q-1-2-3-2H4ZM20 4h-6q-2 0-2 2v15q1-2 3-2h5Z',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',chart:'M4 19h16M6 15l4-5 4 3 5-8',check:'m5 12 4 4L19 6',clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',send:'m4 11 16-7-7 16-2-7-7-2Zm7 2 9-9',settings:'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'};
function Icon({name}:{name:keyof typeof paths}){return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;}
function Identity({role,small=false}:{role:Role;small?:boolean}){return <span className={`cr-avatar${small?' is-small':''}`} aria-hidden="true">{samples[role].initial}</span>;}
const recorderOverlayQuery='(max-width:1060px)';
function useCompact(){
  const [value,setValue]=useState(()=>matchMedia(recorderOverlayQuery).matches);
  useEffect(()=>{const media=matchMedia(recorderOverlayQuery),sync=()=>setValue(media.matches);sync();media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);},[]);
  return value;
}

function Demo(){
  const [role,setRole]=useState<Role>('moon'),[open,setOpen]=useState(false),[tab,setTab]=useState<Tab>('overview');
  const [empty,setEmpty]=useState(false),[source,setSource]=useState(false),[allMemories,setAllMemories]=useState(false);
  const [stage,setStage]=useState<'idle'|'thinking'|'working'|'success'>('idle'),[notice,setNotice]=useState('');
  const compact=useCompact(),r=samples[role],theme=useThemeStore(s=>s.theme),reduced=useSettingsStore(s=>s.reduceMotion);
  const timers=useRef<number[]>([]),content=useRef<HTMLDivElement>(null),focusTarget=useRef<HTMLElement|null>(null);
  const clearTimers=()=>{timers.current.forEach(clearTimeout);timers.current=[];};
  useEffect(()=>()=>clearTimers(),[]);
  useLayoutEffect(()=>{content.current?.scrollTo(0,0);},[tab,role,source]);
  useLayoutEffect(()=>{const trigger=document.querySelector('.cr-orb-entry button');if(!trigger)return;trigger.setAttribute('aria-expanded',String(open));if(compact)trigger.setAttribute('aria-haspopup','dialog');else trigger.removeAttribute('aria-haspopup');if(open)trigger.setAttribute('aria-controls','cr-recorder-panel');else trigger.removeAttribute('aria-controls');},[open,compact,role]);
  useEffect(()=>{document.documentElement.classList.toggle('dark',theme==='dark');},[theme]);
  useEffect(()=>{if(open&&!compact)content.current?.focus({preventScroll:true});},[open,compact]);
  const close=()=>{setOpen(false);setSource(false);requestAnimationFrame(()=>focusTarget.current?.focus({preventScroll:true}));};
  const reveal=(event?:React.MouseEvent<HTMLElement>)=>{focusTarget.current=event?.currentTarget??document.querySelector<HTMLElement>('.cr-orb-entry button');setSource(false);setOpen(true);};
  const selectRole=(value:Role)=>{clearTimers();setRole(value);setStage('idle');setOpen(false);setSource(false);setAllMemories(false);setTab('overview');};
  const simulate=()=>{if(empty)return;clearTimers();setStage('thinking');timers.current.push(window.setTimeout(()=>setStage('working'),750),window.setTimeout(()=>setStage('success'),1450),window.setTimeout(()=>setStage('idle'),2700));};
  const status=stage==='thinking'?'正在解读对话':stage==='working'?'正在保存记录':stage==='success'?'记录已更新':'对话记录者';
  const emotion:SoulOrbEmotion=stage;
  const changeTab=(value:Tab)=>{setTab(value);setSource(false);};
  const panel=<div className="cr-recorder" id="cr-recorder-panel">
    {!compact&&<header className="cr-panel-title"><h2>你们的记录</h2><button className="cr-icon-button" aria-label="关闭记录面板" onClick={close}><Icon name="close"/></button></header>}
    <div className="cr-recorder-identity"><SoulOrb size={52} animated={false} emotion={emotion}/><div><strong>小星</strong><span>{r.name}与你的对话记录</span></div><span className="cr-local-badge">{empty?'尚无记录':'示例记录'}</span></div>
    {!source&&<div role="tablist" aria-label="对话记录分类" className="cr-tabs">{tabs.map(([key,label],index)=><button key={key} role="tab" id={`cr-tab-${key}`} aria-controls="cr-tab-content" aria-selected={tab===key} tabIndex={tab===key?0:-1} onClick={()=>changeTab(key)} onKeyDown={event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();changeTab(tabs[next][0]);document.getElementById(`cr-tab-${tabs[next][0]}`)?.focus();}}>{label}</button>)}</div>}
    <div className="cr-panel-content" ref={content} id="cr-tab-content" role={source?'region':'tabpanel'} aria-label={source?'记录原文':undefined} aria-labelledby={source?undefined:`cr-tab-${tab}`} tabIndex={0}>
      {source?<><button className="cr-inline-back" onClick={()=>setSource(false)}><Icon name="back"/>返回记录</button><div className="cr-section-heading"><span className="cr-eyebrow">记录依据</span><h3>看看原来的那句话</h3><p>本会话 · 今天 18:42 · 你发送的消息</p></div><blockquote className="cr-source">{r.user}</blockquote><p className="cr-muted">记忆提取与对话解读应当能回到原文核对。</p></>:empty?<div className="cr-empty"><SoulOrb emotion="curious" size={104} animated={false}/><h3>{tab==='emotion'?'这里还没有情绪图谱':tab==='memories'?'你们的回忆，从一句话开始':tab==='story'?'故事还在第一页':'你们的记录，从这里开始'}</h3><p>继续和{r.name}聊一聊，已有对话与之后形成的记录会在这里汇集。</p><button className="cr-primary" onClick={close}>回到聊天<Icon name="arrow"/></button></div>:<>
      {tab==='overview'&&<>
        <div className="cr-section-heading"><span className="cr-eyebrow">这一次交谈</span><h3>留住聊过的那些小事。</h3><p>本会话 · 最近记录于 18:42</p></div>
        <article className="cr-summary"><div className="cr-card-title"><Icon name="spark"/><strong>对话摘要</strong><span>AI 整理</span></div><p>{r.summary}</p><button className="cr-text-action" onClick={()=>setSource(true)}>查看依据<Icon name="arrow"/></button></article>
        <button className="cr-feature-card" onClick={()=>changeTab('emotion')}><div><span className="cr-eyebrow">情绪图谱</span><strong>{r.atmosphere}</strong><small>来自对话的 AI 解读</small></div><svg viewBox="0 0 120 52" width="112" height="52" aria-hidden="true"><path d="M1 39Q15 38 24 32T48 29T72 23T96 18L119 8" fill="none" stroke="var(--vg-cyan)" strokeWidth="2"/><path d="M1 39Q15 38 24 32T48 29T72 23T96 18L119 8V52H1Z" fill="var(--vg-panel-light)"/></svg></button>
        <div className="cr-section-line"><h3>最近留下的回忆</h3><button onClick={()=>changeTab('memories')}>全部回忆<Icon name="arrow"/></button></div>
        <button className="cr-memory-teaser" onClick={()=>{changeTab('memories');setSource(true);}}><Icon name="book"/><span>{r.memory}<small>本会话 · AI 提取</small></span></button>
        <div className="cr-relation"><div><span className="cr-eyebrow">你们的关系</span><strong>{r.relation}</strong></div><button className="cr-text-action" onClick={()=>changeTab('story')}>共同故事<Icon name="arrow"/></button><div className="cr-stats"><span><strong>{r.days}</strong>相识天数</span><span><strong>{r.count}</strong>本会话消息</span><span><strong>{r.memoryCount}</strong>角色回忆</span></div></div>
        <p className="cr-footnote">回忆与关系按角色汇集，情绪解读按会话记录。</p>
      </>}
      {tab==='emotion'&&<><div className="cr-section-heading"><span className="cr-eyebrow">本会话</span><h3>情绪，有了可以回看的轮廓。</h3><p>最近解读 · 今天 18:42</p></div><div className="cr-chart-card"><div className="cr-card-title"><strong>六维情绪图谱</strong><span>AI 对话解读</span></div><div className="cr-chart"><EmotionChart dimensions={r.dims} size={248}/></div><p className="cr-atmosphere">{r.atmosphere}</p><p className="cr-muted">描述这段对话中的表达与互动，和你的心情打卡分开展示。</p><button className="cr-text-action" onClick={()=>setSource(true)}>查看分析依据<Icon name="arrow"/></button></div><div className="cr-section-line"><h3>历史解读</h3><span>本会话</span></div><div className="cr-history"><span className="cr-history-dot"/><div><strong>{r.atmosphere}</strong><small>今天 18:42 · 示例快照</small></div></div><button className="cr-secondary" onClick={()=>{simulate();setNotice('正在演示整理过程，没有调用模型。');}}>演示重新解读<Icon name="chart"/></button></>}
      {tab==='memories'&&<><div className="cr-section-heading"><span className="cr-eyebrow">有些话，值得留下</span><h3>你们的回忆</h3><p>每条记录都保留自己的来源。</p></div><div className="cr-scope" aria-label="回忆范围"><button aria-pressed={!allMemories} onClick={()=>setAllMemories(false)}>本会话</button><button aria-pressed={allMemories} onClick={()=>setAllMemories(true)}>与{r.name}的全部回忆</button></div><article className="cr-memory-card"><span className="cr-eyebrow">AI 提取 · 本会话</span><h4>{r.memory}</h4><p>今天 18:42</p><button className="cr-text-action" onClick={()=>setSource(true)}>查看原文<Icon name="arrow"/></button></article>{allMemories&&<article className="cr-memory-card"><span className="cr-eyebrow">你收藏的 · 往期会话</span><h4>{r.older}</h4><p>示例条目 · 来源属于这个角色的另一段会话</p></article>}<div className="cr-guidance"><Icon name="book"/><p>在聊天中长按一句话，也可以把它收藏为共同记忆。</p></div></>}
      {tab==='story'&&<><div className="cr-section-heading"><span className="cr-eyebrow">与{r.name}的全部故事</span><h3>从相识，到此刻。</h3><p>关系进展、共同记忆与分享时刻，按时间汇集。</p></div><div className="cr-story-relation"><Identity role={role}/><div><strong>{r.relation}</strong><span>相识 {r.days} 天</span></div></div><ol className="cr-timeline"><li><span>今天 18:42</span><h4>留下了新的回忆</h4><p>{r.memory}</p><button className="cr-text-action" onClick={()=>setSource(true)}>查看原文<Icon name="arrow"/></button></li><li><span>一周前</span><h4>你们的关系成为「{r.relation}」</h4><p>示例关系里程碑</p></li><li><span>{r.days} 天前</span><h4>故事的第一页</h4><p>第一次和{r.name}交谈</p></li></ol></>}
      </>}
    </div>
  </div>;
  return <div className="cr-lab">
    <div className="cr-demo-bar"><span><i/>设计预览<span className="cr-demo-extra"> · 示例数据</span></span><div><button aria-label="切换预览主题" onClick={()=>useThemeStore.getState().setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?'深色':'浅色'}</button><button aria-pressed={empty} onClick={()=>{clearTimers();setStage('idle');setSource(false);setEmpty(!empty);}}>空记录</button><button className="cr-demo-extra" disabled={empty} onClick={simulate}>演示整理</button><button aria-label="减少动态效果" aria-pressed={reduced} onClick={()=>useSettingsStore.getState().setReduceMotion(!reduced)}><Icon name="settings"/></button></div></div>
    <div className="cr-workspace">
      <aside className="cr-sidebar"><div className="cr-brand"><Icon name="spark"/>VirtuGene</div><span className="cr-eyebrow">普通聊天</span>{(Object.keys(samples) as Role[]).map(value=><button className={`cr-conversation${value===role?' is-selected':''}`} key={value} onClick={()=>selectRole(value)}><Identity role={value}/><span><strong>{samples[value].name}</strong><small>{value==='moon'?'给周末留一点空白':'这份努力值得记下来'}</small></span></button>)}<div className="cr-design-note"><span className="cr-eyebrow">小星 · 对话记录者</span><h1>让每次交谈，<br/>都有迹可循。</h1><p>头像代表聊天对象。<br/>小星收起你们的情绪、回忆与故事。</p><button className="cr-secondary" onClick={event=>reveal(event)}>看看你们的记录<Icon name="arrow"/></button></div></aside>
      <main className="cr-chat">
        <header className="cr-chat-header"><button className="cr-icon-button cr-mobile-back" aria-label="切换聊天示例" onClick={()=>selectRole(role==='moon'?'chen':'moon')}><Icon name="back"/></button><div className="cr-chat-identity"><Identity role={role} small/><div><strong>{r.name}</strong><span>{r.relation}</span></div></div><div className="cr-orb-entry"><SoulOrbButton key={role} label={`查看与${r.name}的对话记录`} size={40} animated={!open&&stage==='idle'} emotion={emotion} onActivate={()=>reveal()}/>{stage==='success'&&<span className="cr-update-dot" aria-hidden="true"/>}</div><button className="cr-icon-button" aria-label="聊天偏好说明" onClick={()=>setNotice('语音、字号和模型等偏好继续收在更多菜单；情绪、回忆和故事由小星承接。')}><Icon name="more"/></button></header>
        <div className="cr-chat-reading"><div className="cr-time">今天 18:42</div>{empty?<div className="cr-chat-empty"><Identity role={role}/><h2>和{r.name}聊一聊</h2><p>从今天的一件小事开始。</p></div>:<><div className="cr-message is-user"><div className="vg-message-bubble is-user-bubble">{r.user}</div></div><div className="cr-message"><Identity role={role} small/><div className="vg-message-bubble is-character-bubble">{r.reply}</div></div><div className="cr-message is-user"><div className="vg-message-bubble is-user-bubble">嗯，就这么说定了。</div></div><button className="cr-chat-record-link" onClick={event=>reveal(event)}><Icon name={stage==='success'?'check':'book'}/><span>{stage==='idle'?'小星留下了这次交谈的记录':status}</span><Icon name="arrow"/></button></> }</div>
        <form className="cr-composer" onSubmit={event=>{event.preventDefault();setNotice('这是布局预览，消息没有发送。');}}><input aria-label="聊天输入预览" placeholder={`和${r.name}说点什么…`}/><button className="cr-send" aria-label="发送预览消息"><Icon name="send"/></button></form>
      </main>
      {open&&!compact&&<aside className="cr-desktop-panel" aria-label="对话记录面板" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();source?setSource(false):close();}}}>{panel}</aside>}
    </div>
    {open&&compact&&<Modal open onClose={close} title="你们的记录" onBack={source?()=>setSource(false):undefined} panelClassName="cr-sheet" canSnapshotOnExit={()=>true}>{panel}</Modal>}
    {notice&&<div className="cr-demo-notice" role="status"><span>{notice}</span><button aria-label="关闭预览提示" onClick={()=>setNotice('')}><Icon name="close"/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Demo/></StrictMode>);
