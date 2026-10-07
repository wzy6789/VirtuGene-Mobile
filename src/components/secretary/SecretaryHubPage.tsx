import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { useSecretaryIdentity } from './useSecretaryIdentity';
import { ActionCabinPage } from '../todo/ActionCabinPage';
import { Icon } from '../ui/Icon';
import { animateVisual } from '../../lib/ui-visual-motion';
import { beginSoulHandoff, soulElement } from '../../lib/soul-handoff';
import { SoulOrb, SoulOrbButton } from '../ui/SoulOrb';
import { CharacterSoulOrb } from '../chat/CharacterSoulOrb';
import { Avatar } from '../ui/Avatar';
import { lazyFeature } from '../ui/lazyFeature';
import { useActionDay } from '../../lib/action-cabin/useActionDay';
import { UNPLANNED_DATE } from '../../lib/action-cabin/query';
import { readSecretaryInbox, matchesSecretaryInbox, type SecretaryInboxFilter } from '../../lib/secretary/inbox';
import { readConversationTodo, todoConversationContext, type SecretaryTodoContext } from '../../lib/secretary/workspace-todo';
import type { TodoWithOccurrence } from '../../db/todo-repo';
import type { SecretaryTask } from '../../lib/secretary/types';
import { db } from '../../db';
import { useOrbAttention } from '../../lib/use-orb-attention';
import '../../styles/assistant-hub.css';

const ChatWindow = lazyFeature(() => import('../chat/ChatWindow').then(m => ({ default: m.ChatWindow })));
const Inbox = lazyFeature(() => import('./SecretaryInboxModal').then(m => ({ default: m.SecretaryInboxModal })));
const MoreMenu = lazyFeature(() => import('./SecretaryMoreMenu').then(m => ({ default: m.SecretaryMoreMenu })));
const Management = lazyFeature(() => import('./SecretaryManagementModal').then(m => ({ default: m.SecretaryManagementModal })));
const DailyReview = lazyFeature(() => import('./SecretaryDailyReviewModal').then(m => ({ default: m.SecretaryDailyReviewModal })));

export function SecretaryHubPage() {
  const userId = useAuthStore(s => s.userId);
  return userId ? <Workspace key={userId} userId={userId} /> : null;
}

function Workspace({ userId }: { userId: string }) {
  const hub = useRef<HTMLElement>(null);
  const contextBanner = useRef<HTMLDivElement>(null);
  const contextOrigin = useRef<DOMRect | undefined>(undefined);
  const [successPulse, setSuccessPulse] = useState(false);
  const { character, loading, error, retry } = useSecretaryIdentity(userId);
  const tab = useUIStore(s => s.assistantTab);
  const { data } = useActionDay(userId);
  const selectedId = useChatStore(s => s.selectedCharacterId);
  const sessionId = useChatStore(s => s.currentSessionId);
  const [chatOpened, setChatOpened] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatRevision, setChatRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [todayActivity, setTodayActivity] = useState({ busy: false, failed: false, reaction: 0 });
  const [inboxActivity, setInboxActivity] = useState({ busy: false, failed: false, reaction: 0 });
  const completionCue=todayActivity.reaction+inboxActivity.reaction;
  const orbAttention=useOrbAttention(completionCue?`${userId}:${character?.id}:${completionCue}`:undefined,hub,()=>null,'[data-occurrence-id]');
  const onTodayActivity = useCallback(setTodayActivity, []);
  const onInboxActivity = useCallback(setInboxActivity, []);
  const [showManagement, setShowManagement] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [draft, setDraft] = useState<{ id: number; text: string }>();
  const draftSequence = useRef(0);
  const [context, setContext] = useState<SecretaryTodoContext>();
  const [contextRow, setContextRow] = useState<TodoWithOccurrence>();
  const [contextError, setContextError] = useState('');
  const [pendingFilter, setPendingFilter] = useState<'unplanned' | SecretaryInboxFilter>('unplanned');
  const [tasks, setTasks] = useState<SecretaryTask[]>([]);
  const [tasksError, setTasksError] = useState(false);
  const [pendingVisited, setPendingVisited] = useState(tab === 'pending');
  const lastReaction = useRef(0);
  useEffect(() => {
    const next = todayActivity.reaction + inboxActivity.reaction;
    if (next === lastReaction.current) return;
    lastReaction.current = next; setSuccessPulse(true);
    const timer = setTimeout(() => setSuccessPulse(false), 320);
    return () => clearTimeout(timer);
  }, [todayActivity.reaction, inboxActivity.reaction]);
  useLayoutEffect(() => {
    const origin = contextOrigin.current, node = contextBanner.current;
    if (tab !== 'chat' || !origin || !node) return;
    contextOrigin.current = undefined;
    const end = node.getBoundingClientRect();
    const dy = Math.max(-80, Math.min(80, origin.top - end.top));
    return animateVisual(node, [{opacity:.4, transform:`translateY(${dy}px) scale(.96)`}, {opacity:1, transform:'none'}], 320);
  }, [context?.todoId, context?.scheduledDate, tab]);
  useEffect(() => {
    const node = hub.current, header = node?.querySelector<HTMLElement>('.vg-assistant-header');
    if (!node || !header) return;
    const sync = () => {
      const scroller = node.querySelector<HTMLElement>(tab === 'today' ? '#assistant-today .vg-cabin' : tab === 'pending' ? '.vg-assistant-pending-content' : '.chat-thread');
      const compact = String((scroller?.scrollTop ?? 0) > 32);
      if (header.dataset.compact !== compact) header.dataset.compact = compact;
    };
    node.addEventListener('scroll', sync, {capture:true, passive:true}); sync();
    return () => node.removeEventListener('scroll', sync, true);
  }, [tab]);
  const active = character && character.secretaryStatus !== 'dismissed';
  const currentChat = character && selectedId === character.id && !!sessionId;
  const onBusy = useCallback((value: boolean) => setBusy(value), []);
  const setTab = (next: 'today' | 'chat' | 'pending') => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    useUIStore.getState().setAssistantTab(next);
  };
  const manage = () => character ? setShowManagement(true) : window.dispatchEvent(new Event('virtugene:open-secretary'));
  const continueWithDraft = (text: string) => {
    setContext(undefined); setContextRow(undefined); setContextError('');
    setDraft({ id: ++draftSequence.current, text }); setTab('chat');
  };
  const ask = () => continueWithDraft('今天先做什么？帮我看看待办安排。');
  const discuss = (row: TodoWithOccurrence) => {
    if (busy) { setChatError('正在处理上一条请求，请稍后再选择任务。'); return; }
    contextOrigin.current = [...(hub.current?.querySelectorAll<HTMLElement>('[data-occurrence-id]') ?? [])].find(node => node.dataset.occurrenceId === row.occurrence.id)?.getBoundingClientRect();
    setContext(todoConversationContext(row)); setContextRow(row); setContextError(''); setTab('chat');
  };
  const todoHandled = async (results: import('../../lib/secretary/types').SecretaryResult[]) => {
    const result = [...results].reverse().find(r => r.status === 'done' && r.targetId === context?.todoId && r.targetDate === context?.scheduledDate && r.afterTodoVersion != null);
    if (!context || !result) return;
    try {
      const row = await readConversationTodo(userId, context, false);
      if (row.todo.updatedAt !== result.afterTodoVersion || row.occurrence.updatedAt !== result.afterVersion) return;
      setContext(current => current?.occurrenceId === context.occurrenceId && current.occurrenceVersion === context.occurrenceVersion ? todoConversationContext(row) : current);
    } catch { /* The selected card reports removal/version changes; a committed request stays successful. */ }
  };

  // Mount the conversation only on first use, then hide it rather than aborting it on tab switches.
  useEffect(() => {
    if (tab !== 'chat' || !character) return;
    let alive = true;
    setChatError('');
    if (currentChat) { setChatOpened(true); return; }
    void (async () => {
      await useChatStore.getState().loadCharacters();
      if (!alive || useAuthStore.getState().userId !== userId) return;
      const current = await db.characters.get(character.id);
      if (!current || current.createdBy !== userId) throw new Error('助理资料已变化，请重新打开。');
      await useChatStore.getState().selectCharacter(character.id);
      if (alive && useAuthStore.getState().userId === userId) setChatOpened(true);
    })().catch(e => { if (alive && useAuthStore.getState().userId === userId) setChatError(e instanceof Error ? e.message : '对话未打开，请重试。'); });
    return () => { alive = false; };
  }, [tab, character?.id, userId, currentChat, chatRevision]);
  useEffect(() => { if (tab === 'pending') setPendingVisited(true); }, [tab]);
  useEffect(() => {
    if (!pendingVisited || !character) return;
    const subscription = liveQuery(() => readSecretaryInbox(userId, character.id)).subscribe({ next: value => { setTasks(value); setTasksError(false); }, error: () => { setTasks([]); setTasksError(true); } });
    return () => subscription.unsubscribe();
  }, [pendingVisited, userId, character?.id, chatRevision]);
  useEffect(() => {
    setContextRow(undefined); setContextError('');
    if (!context) return;
    const subscription = liveQuery(() => readConversationTodo(userId, context)).subscribe({ next: setContextRow, error: e => { setContextRow(undefined); setContextError(e instanceof Error ? e.message : '事项已变化，请重新选择。'); } });
    return () => subscription.unsubscribe();
  }, [userId, context]);

  const back = () => {
    const key = `action-cabin:${userId}`;
    beginSoulHandoff(key, soulElement(key, 'cabin'), 'list');
    useUIStore.setState({ activeView: 'chat', mobileTab: 'chat', chatFromList: false, chatFromCharacters: false });
  };
  const unplanned = data?.pending.filter(row => row.occurrence.dueDate === UNPLANNED_DATE).length ?? 0;
  const pendingCategories: { id: 'unplanned' | SecretaryInboxFilter; label: string; count: number }[] = [
    { id: 'unplanned', label: '未安排', count: unplanned },
    { id: 'input', label: '需你补充', count: tasks.filter(t => matchesSecretaryInbox(t, 'input')).length },
    { id: 'review', label: '待确认草稿', count: tasks.filter(t => matchesSecretaryInbox(t, 'review')).length },
    { id: 'failed', label: '未办成', count: tasks.filter(t => matchesSecretaryInbox(t, 'failed')).length },
    { id: 'done', label: '办事记录', count: tasks.filter(t => matchesSecretaryInbox(t, 'done')).length },
  ];
  return <section ref={hub} className="vg-assistant-hub" aria-label={character?.name ?? '聘用助理'}>
    <header className="vg-assistant-header">
      <button type="button" className="vg-cabin-back" aria-label="返回消息" onClick={back}><Icon name="back" /></button>
      {character && <Avatar avatar={character.avatar} size="sm" className="vg-assistant-avatar" />}
      <div className="vg-assistant-identity"><h1 title={character?.name}>{character?.name ?? (loading ? '读取中…' : '聘用助理')}</h1><p role={busy ? 'status' : undefined}>{busy ? '正在为你处理' : active ? '把琐事理顺，把日子留下' : '记录保留，事情仍可手动安排'}</p></div>
      {character ? <CharacterSoulOrb character={character} attention={orbAttention} cueId={completionCue||undefined} emotion={chatError || contextError || error || todayActivity.failed || inboxActivity.failed ? 'error' : busy || todayActivity.busy || inboxActivity.busy ? 'working' : successPulse ? 'success' : context && tab === 'chat' ? 'thinking' : data && !data.pending.length ? 'success' : 'idle'} soulKey={`action-cabin:${userId}`} soulRole="cabin" /> : <SoulOrbButton size={48} label="聘用助理" onActivate={manage} emotion="curious" />}
      {character ? <MoreMenu name={character.name} onInbox={() => setTab('pending')} onManage={manage} onReview={() => { setTab('chat'); setShowReview(true); }} disabled={busy || !active} /> : <button type="button" disabled={loading || !!error} className="vg-assistant-hire" onClick={manage}>聘用</button>}
    </header>
    <nav className="vg-assistant-tabs" data-tab={tab} aria-label="助理页面">
      <span className="vg-assistant-tab-track" aria-hidden="true"><i /></span>
      {([['today', '今日'], ['chat', '对话'], ['pending', '待处理']] as const).map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} aria-controls={`assistant-${id}`} onClick={() => setTab(id)}>{label}{id === 'pending' && unplanned > 0 && <span>{unplanned} 未安排</span>}</button>)}
    </nav>
    {error && <div role="alert" className="vg-assistant-status">{error}<button type="button" onClick={retry}>重试</button></div>}
    <div id="assistant-today" className="vg-assistant-panel" hidden={tab !== 'today'} inert={tab !== 'today'}>
      <ActionCabinPage embedded page="today" onAsk={ask} onDiscuss={discuss} onActivity={onTodayActivity} />
    </div>
    <div id="assistant-chat" className="vg-assistant-panel vg-assistant-conversation" hidden={tab !== 'chat'} inert={tab !== 'chat'}>
      {context && <div ref={contextBanner} className="vg-assistant-context" role="status"><div><strong>{contextRow ? `正在讨论：${contextRow.todo.title}` : '当前事项已变化'}</strong><p>{contextError || `${contextRow?.occurrence.dueDate === UNPLANNED_DATE ? '未安排日期' : contextRow?.occurrence.dueDate ?? context.scheduledDate}${contextRow?.todo.recurrence.kind !== 'none' ? ' · 仅这一次，系列设置请在编辑器调整' : ''}`}</p></div><button type="button" aria-label="结束讨论这件事" disabled={busy} onClick={() => setContext(undefined)}><Icon name="close" size={18} /></button></div>}
      {chatError && <div role="alert" className="vg-assistant-status">{chatError}<button type="button" onClick={() => setChatRevision(n => n + 1)}>重试打开</button></div>}
      {!character && !loading && !error && <div className="vg-assistant-empty"><SoulOrb size={100} emotion="curious" /><p>给助理取个名字，再开始交代事情。</p><button type="button" className="vg-cabin-primary" onClick={manage}>聘用助理</button></div>}
      {character && (!chatOpened || !currentChat) && !chatError && <p role="status" className="vg-assistant-status">正在打开对话…</p>}
      {chatOpened && currentChat && <ChatWindow workspace={{ onInbox: () => setTab('pending'), onManage: manage, onReview: () => setShowReview(true), draft, onBusy, todoContext: context, onTodoHandled: todoHandled }} />}
    </div>
    <div id="assistant-pending" className="vg-assistant-panel vg-assistant-pending" hidden={tab !== 'pending'} inert={tab !== 'pending'}>
      <div className="vg-assistant-categories" role="group" aria-label="待处理分类">{pendingCategories.map(item => <button type="button" key={item.id} aria-pressed={pendingFilter === item.id} onClick={() => setPendingFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}</div>
      <p className="vg-assistant-category-note">{pendingFilter === 'unplanned' ? '这里是还没排上日期的事项，安排后会进入日程。' : '这里是你交代给助理的请求；办理完成不代表对应待办已经做完。'}</p>
      <div className="vg-assistant-pending-content">
        {pendingFilter === 'unplanned' ? <ActionCabinPage embedded page="inbox" onDiscuss={discuss} onActivity={onInboxActivity} /> : character && pendingVisited ? <Inbox character={character} open embedded category={pendingFilter} onClose={() => {}} onDraft={continueWithDraft} busy={busy} /> : <div className="vg-assistant-empty"><p>聘用助理后，办事请求会保留在这里。</p><button type="button" onClick={manage}>聘用助理</button></div>}
        {tasksError && <div role="alert" className="vg-assistant-status">办事记录读取失败<button onClick={() => setChatRevision(n => n + 1)}>重试</button></div>}
      </div>
    </div>
    {showManagement && character && <Management key={character.id} character={character} open onClose={() => setShowManagement(false)} />}
    {showReview && character && currentChat && <DailyReview character={character} open onClose={() => setShowReview(false)} />}
  </section>;
}
