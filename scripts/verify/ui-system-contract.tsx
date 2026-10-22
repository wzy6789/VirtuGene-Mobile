/** Production components and CSS; fixture interactions never call product services. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon, type IconName } from '../../src/components/ui/Icon';
import { SoulOrb } from '../../src/components/ui/SoulOrb';
import { FeedbackNotice } from '../../src/components/ui/FeedbackNotice';
import { LoadingSkeleton } from '../../src/components/ui/LoadingSkeleton';
import { ConnectionEmptyState } from '../../src/components/ui/ConnectionEmptyState';
import { Modal } from '../../src/components/ui/Modal';
import { PressLightCard } from '../../src/components/ui/PhysicalInteractions';
import { SettingsField, SettingsSwitch, SettingsChoices, SettingsRow } from '../../src/components/settings/SettingsUI';
import { installThemePreferences } from '../../src/lib/theme';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { installUiFont } from '../../src/lib/ui-font';
import { useThemeStore } from '../../src/store/theme-store';
import { useSettingsStore } from '../../src/store/settings-store';

installThemePreferences(); installUiPreferences(); installUiFont();
useSettingsStore.getState().setHapticsEnabled(false);
useThemeStore.getState().setTheme(new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark');

const contracts = [
  { id: 'role-chat', title: '角色空间 → 聊天', total: 600,
    frames: [{ label: '身份确认', at: '0–100ms', kind: 'profile' }, { label: '头像迁移，正文就位', at: '0–360ms', kind: 'chat' }, { label: '环境光收束', at: '360–600ms', kind: 'chat' }],
    phases: ['0–100ms：按下确认并锁定当前角色。', '0–260ms：头像对齐聊天头部；100–360ms：正文和输入层就位。', '环境光最迟600ms收束，会话可用即允许输入。'],
    interruption: 'Back 从当前位置回收；连续选择只保留最后角色；账号或权限改变立即取消私密快照。',
    downgrade: '缺图、目标节点失效或减少动态：短淡入或直接落位，正文与输入不等待。' },
  { id: 'chat-call', title: '文字聊天 → 语音舞台', total: 650,
    frames: [{ label: '小球确认', at: '0–160ms', kind: 'chat' }, { label: '舞台展开', at: '120–360ms', kind: 'call' }, { label: '内光稳定', at: '360–650ms', kind: 'call' }],
    phases: ['0–160ms：小球确认，背景进入语音舞台。', '120–360ms：小球移入中心，控制栏出现。', '360–650ms：内光稳定；连接状态由真实链路决定。'],
    interruption: '关闭回到聊天锚点；最小化与挂断分开；失败或取消立即停止成功姿态，字幕与权限焦点可预测。',
    downgrade: '减少动态直接展示舞台和真实准备/连接状态；不提前显示“正在听”。' },
  { id: 'cover-world', title: '世界封面 → 第一场景', total: 700,
    frames: [{ label: '确定世界与场景', at: '0–160ms', kind: 'cover' }, { label: '封面展开', at: '0–360ms', kind: 'world' }, { label: '正文逐层进入', at: '240–700ms', kind: 'world' }],
    phases: ['0–160ms：确认封面与确切世界、场景标识。', '0–360ms：封面展开为画布，标题保持连续。', '240–700ms：场景正文就位；正文到达就显示，已读场景短恢复。'],
    interruption: '返回恢复同一封面位置；快速切换、取消与重试按请求代隔离；场景未准备好仍可返回。',
    downgrade: '稳定骨架与真实加载说明替代开幕，不用演示剧情填空；减少动态直接展示可用内容。' },
] as const;

function Section({ id, title, detail, children }: { id: string; title: string; detail?: string; children: ReactNode }) {
  return <section id={id} className="contract-section" aria-labelledby={`${id}-title`}><div className="contract-section-heading"><h2 id={`${id}-title`}>{title}</h2>{detail && <p>{detail}</p>}</div>{children}</section>;
}

function StoryboardFrame({ kind }: { kind: string }) {
  const call = kind === 'call', chat = kind === 'chat', story = kind === 'world' || kind === 'cover';
  return <svg aria-hidden="true" className="contract-frame" viewBox="0 0 160 188" fill="none">
    <rect x="1" y="1" width="158" height="186" rx="13" fill="var(--bg-panel)" stroke="var(--border)" />
    <path d="m13 13-5 5 5 5" stroke="var(--text-secondary)" strokeWidth="1.5" />
    <rect x="52" y="15" width="55" height="5" rx="2.5" fill="var(--text-secondary)" opacity=".5" />
    {story ? <><path d="M8 95 53 48 82 78 118 40 152 90v24H8Z" fill="var(--vg-accent)" opacity=".22" /><path d="M8 104 62 78 93 105 130 70l22 34v22H8Z" fill="var(--vg-cyan)" opacity=".15" />{kind === 'world' && <><rect x="15" y="124" width="130" height="7" rx="3" fill="var(--text-secondary)" opacity=".4" /><rect x="15" y="139" width="130" height="7" rx="3" fill="var(--text-secondary)" opacity=".3" /><rect x="15" y="154" width="88" height="7" rx="3" fill="var(--text-secondary)" opacity=".3" /></>}</>
      : call ? <><circle cx="80" cy="87" r="42" stroke="var(--vg-accent)" opacity=".2" /><circle cx="80" cy="87" r="28" fill="var(--vg-accent)" opacity=".5" /><circle cx="71" cy="84" r="2.5" fill="var(--bg)" /><circle cx="89" cy="84" r="2.5" fill="var(--bg)" /><path d="M74 94q6 4 12 0" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" /><circle cx="48" cy="155" r="10" fill="var(--bg-surface)" /><circle cx="80" cy="155" r="12" fill="var(--vg-danger)" /><circle cx="112" cy="155" r="10" fill="var(--bg-surface)" /></>
      : chat ? <><circle cx="29" cy="18" r="8" fill="var(--vg-accent)" opacity=".6" /><rect x="14" y="45" width="108" height="34" rx="9" fill="var(--bg-surface)" /><rect x="21" y="55" width="86" height="5" rx="2.5" fill="var(--text-secondary)" opacity=".55" /><rect x="21" y="64" width="63" height="5" rx="2.5" fill="var(--text-secondary)" opacity=".4" /><rect x="50" y="92" width="96" height="27" rx="9" fill="var(--vg-action)" /><rect x="60" y="102" width="70" height="5" rx="2.5" fill="var(--vg-on-action)" opacity=".8" /><rect x="13" y="153" width="113" height="23" rx="7" stroke="var(--border)" /><circle cx="139" cy="164" r="8" fill="var(--vg-accent)" /></>
      : <><rect x="87" y="41" width="60" height="83" rx="16" fill="var(--vg-accent)" opacity=".35" /><circle cx="117" cy="66" r="13" fill="var(--text-secondary)" opacity=".55" /><path d="M96 110v-7a21 21 0 0 1 42 0v7" fill="var(--text-secondary)" opacity=".35" /><rect x="14" y="60" width="57" height="9" rx="4" fill="var(--text)" opacity=".7" /><rect x="14" y="81" width="60" height="5" rx="2.5" fill="var(--text-secondary)" opacity=".4" /><rect x="14" y="92" width="48" height="5" rx="2.5" fill="var(--text-secondary)" opacity=".4" /><rect x="14" y="151" width="132" height="25" rx="8" fill="var(--vg-action)" /></>}
  </svg>;
}

function UiSystemContract() {
  const theme = useThemeStore(state => state.theme);
  const reduced = useSettingsStore(state => state.reduceMotion);
  const [draft, setDraft] = useState('今天也想慢慢聊。');
  const [checked, setChecked] = useState(true);
  const [choice, setChoice] = useState('gentle');
  const [operation, setOperation] = useState<'idle' | 'busy' | 'success' | 'error'>('idle');
  const [press, setPress] = useState('默认');
  const [modal, setModal] = useState<'dialog' | 'page' | null>(null);
  const [items, setItems] = useState(['雾月 · 角色主题', '暖杏 · 阅读氛围']);
  const [listDetail, setListDetail] = useState('点击列表行可查看当前选择。');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const simulate = (failed: boolean) => {
    if (operation === 'busy') return;
    setOperation('busy');
    timer.current = setTimeout(() => setOperation(failed ? 'error' : 'success'), 650);
  };
  const focusInput = () => document.getElementById('contract-draft')?.focus({ preventScroll: true });
  return <div className="contract-shell">
    <header className="contract-header"><div><span className="contract-kicker">VirtuGene · 本地组件合同</span><h1>一种界面语言，完整的状态。</h1><p>当前生产组件与构建样式。示例内容仅用于验收；交互为本地模拟，模型、麦克风与音频隔离。</p></div>
      <div className="contract-toolbar"><button type="button" className="vg-button vg-button-secondary" onClick={() => useThemeStore.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name="moon" />{theme === 'dark' ? '切换浅色' : '切换深色'}</button><button type="button" className="vg-button vg-button-secondary" aria-pressed={reduced} onClick={() => useSettingsStore.getState().setReduceMotion(!reduced)}><Icon name="pause" />{reduced ? '减少动态：开' : '减少动态：关'}</button></div>
    </header>
    <nav className="contract-nav" aria-label="组件目录">{[['type','字阶与材料'],['controls','按钮状态'],['forms','输入与选择'],['content','阅读与反馈'],['dialogs','弹层'],['motion','转场合同']].map(([id,title]) => <a key={id} href={`#${id}`}>{title}</a>)}</nav>
    <main>
      <Section id="type" title="字阶与材料" detail="读取生产主题 token；角色环境光与正文颜色各司其职。">
        <div className="contract-two-columns"><div className="contract-type-samples"><p style={{fontSize:'var(--vg-type-title)',lineHeight:'var(--vg-leading-title)',fontWeight:'var(--vg-weight-heading)'}}>26 · 标题 / 与你慢慢相处</p><p style={{fontSize:'var(--vg-type-body)',lineHeight:'var(--vg-leading-body)'}}>16 · 正文 / 消息可以很长，阅读仍要从容。中文、English 以及 012345 保持清楚。</p><p style={{fontSize:'var(--vg-type-caption)',lineHeight:'var(--vg-leading-caption)',color:'var(--text-secondary)'}}>13 · 说明 / 操作解释、时间与来源。</p><p style={{fontSize:'var(--vg-type-micro)',lineHeight:'var(--vg-leading-caption)',color:'var(--text-secondary)'}}>12 · 微型 / 只承载辅助信息。</p><span className="vg-display-number">1,234</span></div>
          <div className="contract-materials">{[0,1,2,3].map(level => <div key={level} style={{background:`var(--vg-elev-${level})`,boxShadow:level ? `inset 0 1px 0 var(--vg-elev-highlight),var(--vg-elev-shadow-${level})` : undefined}}><strong>{['稳定画布','阅读纸面','操作表面','浮层表面'][level]}</strong><code>--vg-elev-{level}</code><p>主文字清楚，辅助文字安静。</p></div>)}</div></div>
      </Section>
      <Section id="controls" title="按钮与操作反馈" detail="四级按钮复用 vg-button；按住、滑出取消及键盘焦点可直接操作。">
        <div className="contract-button-row">{[['primary','继续聊天','moment'],['secondary','查看详情','diary'],['ghost','编辑','edit'],['danger','删除示例','trash']].map(([kind,label,icon]) => <button key={kind} className={`vg-button vg-button-${kind}`} onClick={() => setListDetail(`已选择：${label}（本地示例）`)}><Icon name={icon as IconName} />{label}</button>)}</div>
        <div className="contract-state-grid"><article><h3>默认与按下</h3><PressLightCard className="vg-button vg-button-secondary" onPointerDown={() => setPress('按下')} onPointerUp={() => setPress('默认')} onPointerLeave={() => setPress('已滑出，可取消')} onPointerCancel={() => setPress('已取消')} onClick={() => setPress('触发完成')}>按住体验</PressLightCard><p role="status">{press}</p></article><article><h3>焦点</h3><button type="button" className="vg-button vg-button-secondary" onClick={focusInput}>聚焦输入框</button><p>也可用 Tab 逐项检查焦点。</p></article><article><h3>禁用</h3><button type="button" disabled className="vg-button vg-button-primary">暂不可用</button><p>不可提交，不消耗请求。</p></article><article><h3>加载</h3><button type="button" disabled aria-busy="true" className="vg-button vg-button-primary"><SoulOrb size={24} emotion="working" />正在保存</button><p>忙碌时保留操作含义。</p></article></div>
      </Section>
      <Section id="forms" title="输入与选择" detail="输入失败保留草稿；开关、选择组和列表复用设置页正式组件。">
        <div className="contract-two-columns"><div className="vg-settings-design"><SettingsField id="contract-draft" label="聊天草稿" hint="这是隔离预览，不会发送或保存到角色。" value={draft} onChange={event => setDraft(event.target.value)} /><SettingsField label="只读示例" value="角色资料归属于当前账号" readOnly /><SettingsField label="禁用输入" value="等待当前操作完成" disabled />
          <div className="contract-button-row"><button type="button" className="vg-button vg-button-primary" disabled={operation === 'busy'} aria-busy={operation === 'busy'} onClick={() => simulate(false)}>{operation === 'busy' ? '保存中…' : '模拟保存成功'}</button><button type="button" className="vg-button vg-button-secondary" disabled={operation === 'busy'} onClick={() => simulate(true)}>模拟保存失败</button></div>
          {operation === 'success' && <FeedbackNotice tone="success" message="示例保存成功，草稿仍保留在此页面。" />}{operation === 'error' && <FeedbackNotice tone="error" message="示例保存失败，输入内容已保留。"><button className="vg-button vg-button-secondary" onClick={() => simulate(false)}>重试</button></FeedbackNotice>}
        </div><div className="vg-settings-design"><SettingsSwitch title="氛围效果" detail="此开关仅改变本页选中状态。" checked={checked} onChange={setChecked} /><SettingsSwitch title="不可用开关" detail="用于核验禁用状态。" checked={false} disabled onChange={() => {}} /><SettingsChoices label="氛围强度示例" value={choice} onChange={setChoice} options={[{value:'off',title:'关闭',detail:'保持静态表面'},{value:'gentle',title:'轻柔',detail:'默认陪伴强度'},{value:'vivid',title:'生动',detail:'更明显的角色氛围'}]} />
          {items.map(item => <SettingsRow key={item} title={item} detail="打开后就近显示选择结果" icon="appearance" onClick={() => setListDetail(`当前查看：${item}`)} />)}<p className="contract-status" role="status">{listDetail}</p></div></div>
      </Section>
      <Section id="content" title="阅读、骨架与空态" detail="气泡使用生产样式；加载、空态和消息反馈保持明确。">
        <div className="contract-two-columns"><div className="contract-chat-sample"><p className="contract-caption">示例对话 · 没有模型请求</p><div className="vg-message-bubble is-character-bubble" data-length="long">我在听。长一点的话也可以慢慢说，文字始终是聊天的中心。<br />这里保留中文断行与正常阅读行高。</div><div className="vg-message-bubble is-user-bubble" data-length="short">那我们继续聊。</div><FeedbackNotice tone="success" message="操作完成。" /><FeedbackNotice tone="error" message="没有完成，请保留当前内容后重试。" /><FeedbackNotice tone="info" message="这是一条普通提示。" /></div><div><LoadingSkeleton label="正在读取示例列表" rows={2} /><ConnectionEmptyState title="还没有示例记录" detail="空态有说明，也有清晰的下一步。" action={<button className="vg-button vg-button-secondary" onClick={() => setItems(current => [...current, `示例记录 ${current.length + 1}`])}>添加一条示例</button>} /></div></div>
      </Section>
      <Section id="dialogs" title="弹窗与详情承载" detail="少量选项采用居中弹窗，长内容使用完整详情页。两者均复用正式 Modal。"><div className="contract-button-row"><button className="vg-button vg-button-secondary" onClick={() => setModal('dialog')}>打开居中弹窗</button><button className="vg-button vg-button-secondary" onClick={() => setModal('page')}>打开详情页</button></div></Section>
      <Section id="motion" title="三种签名转场 · 目标合同" detail="以下是代码原生分镜和验收规则，不是实际导航链路已完成的证明。">
        {contracts.map(contract => <article className="contract-storyboard" key={contract.id}><div className="contract-storyboard-heading"><h3>{contract.title}</h3><span>环境收束 ≤ {contract.total}ms</span></div><div className="contract-frames">{contract.frames.map((frame,index) => <figure key={`${frame.kind}-${index}`}><StoryboardFrame kind={frame.kind} /><figcaption><strong>{frame.at}</strong><span>{frame.label}</span></figcaption></figure>)}</div><ol>{contract.phases.map(phase => <li key={phase}>{phase}</li>)}</ol><dl><div><dt>中断与返回</dt><dd>{contract.interruption}</dd></div><div><dt>降级合同</dt><dd>{contract.downgrade}</dd></div></dl></article>)}
      </Section>
    </main>
    <footer className="contract-footer">本地组件与合同预览 · 当前样式取 dist/renderer · 不代表 Android 验收或签名链路已交付</footer>
    <Modal open={modal !== null} onClose={() => setModal(null)} presentation={modal ?? 'dialog'} title={modal === 'page' ? '详情页示例' : '居中弹窗示例'} width="max-w-md" mobileFullHeight={modal === 'page'} panelClassName="vg-settings-panel" canSnapshotOnExit={() => false} footer={<div className="contract-dialog-actions"><button className="vg-button vg-button-secondary" onClick={() => setModal(null)}>取消</button><button className="vg-button vg-button-primary" onClick={() => { setModal(null); setListDetail('弹层已确认（本地示例）'); }}>确认</button></div>}><div className="vg-settings-design"><p>这是正式 Modal 的隔离示例。关闭后返回原焦点；Escape、返回与按钮使用同一退出行为。</p>{modal === 'page' && <><SettingsField label="详情输入" placeholder="退出不会提交到产品" /><LoadingSkeleton label="详情骨架示例" rows={3} /><FeedbackNotice message="长内容使用稳定滚动区，底部操作固定。" /></>}</div></Modal>
  </div>;
}

createRoot(document.getElementById('app')!).render(<UiSystemContract />);
(window as unknown as { uiSystemContract: unknown }).uiSystemContract = {
  theme: (theme: 'light' | 'dark') => useThemeStore.getState().setTheme(theme),
  reduced: (value: boolean) => useSettingsStore.getState().setReduceMotion(value),
  contracts,
  inspect: () => ({theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', reduced: document.documentElement.dataset.vgReducedMotion,
    draft: (document.getElementById('contract-draft') as HTMLInputElement | null)?.value, dialogs: document.querySelectorAll('[role=dialog]').length}),
};
