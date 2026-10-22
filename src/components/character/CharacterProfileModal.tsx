import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Modal } from '../ui/Modal';
import { Suspense } from 'react';
import { lazyFeature } from '../ui/lazyFeature';
const StyleWorkspace=lazyFeature(()=>import('./CharacterStyleWorkspace').then(m=>({default:m.CharacterStyleWorkspace})));
import { Avatar } from '../ui/Avatar';
import { categorizeTag, CATEGORY_LABELS, CATEGORY_ORDER, type TagCategory } from '../../lib/tag-categories';
import { db, type Character, type CharacterState, type ContinuityThread } from '../../db/index';
import { stateRepo } from '../../db/state-repo';
import { getRelationLevel, levelProgress } from '../../lib/affinity';
import { continuityRepo } from '../../db/continuity-repo';
import { LifeTimelineModal } from './LifeTimelineModal';
import { MemoryArchiveModal } from './MemoryArchiveModal';
import { Icon } from '../ui/Icon';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { characterSignature, characterSpaceStyle } from './character-space-model';
import { CharacterPortrait } from './CharacterCover';
import { useAuthStore } from '../../store/auth-store';
import { useVoiceCallUIStore } from '../../store/voice-call-ui-store';
import { openCharacterVoiceCall } from '../../lib/open-character-call';
import { resolveOwnedChatCharacter } from '../../lib/character-chat';
import { EmotionPanel } from '../chat/EmotionPanel';
import '../../styles/character-space.css';
import '../../styles/character-detail.css';

interface CharacterProfileModalProps {
  character: Character;
  userId: string;
  onClose: () => void | Promise<void>;
  onChat: (c: Character) => void | Promise<void>;
  worldCharacters?: Character[];
  sessionId?: string | null;
  initialSection?: 'now' | 'stories' | 'memory';
}

function groupTags(tags: string[]): Partial<Record<TagCategory, string[]>> {
  const groups: Partial<Record<TagCategory, string[]>> = {};
  for (const tag of tags) (groups[categorizeTag(tag)] ??= []).push(tag);
  return groups;
}

/** Account/role changes remount the entire private detail, including nested views. */
export function CharacterProfileModal(props: CharacterProfileModalProps) {
  const owner = useAuthStore(state => state.userId);
  if (owner !== props.userId) return null;
  return <CharacterSpace key={`${props.userId}:${props.character.id}:${props.sessionId ?? ''}:${props.initialSection ?? 'now'}`} {...props} />;
}

function CharacterSpace({ character, userId, onClose, onChat, worldCharacters = [], sessionId, initialSection = 'now' }: CharacterProfileModalProps) {
  const actionLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState<'chat' | 'voice' | 'close' | null>(null);
  const [actionError, setActionError] = useState('');
  const isCurrent = () => mounted.current && useAuthStore.getState().userId === userId;
  const act = async (kind: 'chat' | 'voice' | 'close', action: () => unknown | Promise<unknown>) => {
    if (actionLock.current || !isCurrent()) return;
    actionLock.current = true; setBusy(kind); setActionError('');
    try { await action(); }
    catch { if (isCurrent()) setActionError(kind === 'voice' ? '语音暂时无法打开，请重试。' : '操作没有完成，请重试。'); }
    finally { actionLock.current = false; if (isCurrent()) setBusy(null); }
  };
  const [lifeState, setLifeState] = useState<CharacterState | null>(null);
  const [showLifeTimeline, setShowLifeTimeline] = useState(false);
  const [showMemoryArchive, setShowMemoryArchive] = useState(false);
  const [focusMemoryId, setFocusMemoryId] = useState<string>();
  const [showStyle,setShowStyle]=useState(false);
  const [openThreads, setOpenThreads] = useState<ContinuityThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [greetingExpanded, setGreetingExpanded] = useState(false);
  const [section, setSection] = useState(initialSection);
  const sectionId = useId();
  const [privateStatus, setPrivateStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [chatState, setChatState] = useState<{ status: 'loading' | 'ready' | 'error'; owned?: Character; hasSession: boolean; available?: boolean }>({ status: 'loading', hasSession: false });
  const isOwn = !character.isPreset && character.createdBy === userId;
  const isAssistant = character.agentProfile === 'secretary';
  const privateVisible = isOwn && privateStatus === 'ready';
  const groups = useMemo(() => groupTags(character.tags ?? []), [character.tags]);
  const style = useMemo(() => characterSpaceStyle(character), [character]);
  const callTarget = useVoiceCallUIStore(state => state.target);
  const callPresent = callTarget?.userId === userId;

  useEffect(() => {
    if (!isOwn) { setPrivateStatus('unavailable'); return; }
    const subscription = liveQuery(() => db.characters.get(character.id)).subscribe({ next: row => {
      if (!isCurrent()) return;
      setPrivateStatus(row && !row.isPreset && row.createdBy === userId ? 'ready' : 'unavailable');
    }, error: () => { if (isCurrent()) setPrivateStatus('error'); } });
    return () => subscription.unsubscribe();
  }, [character.id, userId, isOwn, retry]);

  useEffect(() => {
    let active = true;
    setChatState({ status: 'loading', hasSession: false });
    const subscription = liveQuery(async () => {
      const owned = await resolveOwnedChatCharacter(character, userId);
      if (!owned) {
        const source = await db.characters.get(character.id);
        return { owned: undefined, hasSession: false, available: !!source && !!(source.isPreset || source.createdBy === userId || source.published) };
      }
      const [keys, groups] = await Promise.all([
        db.sessions.where('[characterId+userId]').equals([owned.id, userId]).primaryKeys(),
        db.sessions.where('[characterId+userId+type]').equals([owned.id, userId, 'group']).primaryKeys(),
      ]);
      return { owned, available: true, hasSession: keys.some(id => !groups.includes(id)) };
    }).subscribe({ next: result => { if (active && isCurrent()) setChatState({ status: 'ready', ...result }); }, error: () => { if (active && isCurrent()) setChatState({ status: 'error', hasSession: false }); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [character.id, userId, retry]);

  const beginChat = async () => {
    const owned = await resolveOwnedChatCharacter(character, userId);
    if (!isCurrent()) return;
    if (isOwn && !owned) throw Error('character:unavailable');
    await onChat(owned ?? character);
  };

  useEffect(() => {
    let active = true;
    setLifeState(null); setOpenThreads([]); setReadError('');
    if (!userId || !privateVisible || isAssistant || section !== 'stories') return;
    setLoading(true);
    const subscription = liveQuery(async () => {
      const role = await db.characters.get(character.id);
      if (!role || role.isPreset || role.createdBy !== userId) return [undefined, []] as const;
      return Promise.all([stateRepo.get(character.id, userId), continuityRepo.getOpenByCharacter(character.id, userId)]);
    }).subscribe({ next: ([state, threads]) => {
        if (!active || useAuthStore.getState().userId !== userId) return;
        setLifeState(state?.userId === userId && state.characterId === character.id ? state : null);
        setOpenThreads(threads.filter(thread => thread.userId === userId && thread.characterId === character.id));
        setLoading(false);
      }, error: () => { if (active && useAuthStore.getState().userId === userId) { setLifeState(null); setOpenThreads([]); setReadError('最近的故事暂时无法读取。'); setLoading(false); } } });
    return () => { active = false; subscription.unsubscribe(); };
  }, [character.id, userId, privateVisible, isAssistant, section, retry]);

  const relation = lifeState ? getRelationLevel(lifeState.affinity) : undefined;
  const recentEvents = [...(lifeState?.lifeEvents ?? [])].filter(event => Number.isFinite(new Date(event.createdAt).getTime())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 2);
  const storyLinks = (lifeState?.storyRelations ?? [])
    .map(link => ({ ...link, character: worldCharacters.find(item => item.id === link.targetCharacterId && item.createdBy === userId) }))
    .filter(link => link.character).slice(0, 4);

  return <Modal open mobileFullHeight onClose={() => { if (!busy) void act('close', onClose); }} title={isAssistant ? '助理空间' : '角色空间'} width="max-w-lg"
    panelClassName="vg-character-space vg-character-unified-detail" panelStyle={style} surfaceMode="long-form" canSnapshotOnExit={() => false}
    footer={<div className="vg-space-footer">
      {actionError && <FeedbackNotice tone="error" message={actionError} />}
      <div className="vg-space-footer-actions">
        <button type="button" disabled={!!busy || chatState.status === 'loading' || chatState.available === false} aria-busy={busy === 'chat' || chatState.status === 'loading'} onClick={() => void act('chat', beginChat)} className="vg-space-chat-action"><Icon name="moment" size={20} /><span>{busy === 'chat' ? '正在进入…' : chatState.status === 'loading' ? '正在读取…' : chatState.status === 'error' ? '重试打开角色' : chatState.available === false ? '角色已不可用' : isAssistant ? '打开助理' : !chatState.owned ? '添加并开始聊天' : chatState.hasSession ? '继续聊天' : '开始聊天'}</span></button>
        {!isAssistant && <button type="button" disabled={!!busy} aria-busy={busy === 'voice'} onClick={() => void act('voice', () => openCharacterVoiceCall(character, userId, isCurrent))} className="vg-space-voice-action"><Icon name="phone" size={20} /><span>{busy === 'voice' ? '正在打开…' : callPresent ? '返回通话' : '语音'}</span></button>}
      </div>
    </div>}>
    <div data-vg-surface-mode="long-form" className="vg-character-detail-reading">
    <section className="vg-space-cover" aria-label={`${character.name}的角色封面`}>
      <div className="vg-space-cover-light" aria-hidden="true" />
      <CharacterPortrait character={character} className="vg-space-avatar" soulRole="profile" />
      <div className="vg-space-identity"><h3>{character.name}</h3>
        {(character.tags ?? []).length > 0 && <div className="vg-space-traits" aria-label="角色特点">{character.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div>}
        <p>{characterSignature(character)}</p>
      </div>
    </section>

    <div className="vg-space-content">
      {privateVisible && !isAssistant && <>
        <nav className="vg-detail-tabs" role="tablist" aria-label="角色详情分区">{(['now', 'stories', 'memory'] as const).map((value, index) => <button key={value} type="button" role="tab" id={`${sectionId}-${value}`} aria-controls={`${sectionId}-content`} aria-selected={section === value} tabIndex={section === value ? 0 : -1} onClick={() => setSection(value)} onKeyDown={event => {
          const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (!offset && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + offset + 3) % 3;
          setSection((['now', 'stories', 'memory'] as const)[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{value === 'now' ? '此刻' : value === 'stories' ? '共同经历' : '记忆档案'}</button>)}</nav>
        {section !== 'stories' && <div id={`${sectionId}-content`} role="tabpanel" aria-labelledby={`${sectionId}-${section}`} tabIndex={0}>
          {section === 'now' && <EmotionPanel embedded character={character} userId={userId} sessionId={sessionId}/>}
          {section === 'memory' && <MemoryArchiveModal key={`${userId}:${character.id}:embedded`} open={!showMemoryArchive} embedded onClose={() => undefined} character={character} userId={userId} onManage={id => { setFocusMemoryId(id); setShowMemoryArchive(true); }}/>}
        </div>}
      </>}
      {isOwn && privateStatus === 'loading' && <p role="status" className="vg-detail-empty">正在核对角色资料…</p>}
      {isOwn && privateStatus === 'error' && <FeedbackNotice tone="error" message="角色资料暂未读到，私人记录已收起。"><button type="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></FeedbackNotice>}
      {!isAssistant && !privateVisible && privateStatus === 'unavailable' && <p className="vg-detail-empty">{isOwn ? '角色资料已不可用，私人记录已收起。' : '私人记录请在自己的角色详情中查看。'}</p>}
      {isAssistant && privateVisible && <section className="vg-space-section"><h4>工作与偏好</h4><p>{character.secretaryStatus === 'dismissed' ? '助理空缺，既有记录仍然保留。' : '生活助理 · 在职'}</p><p className="vg-space-muted">{character.secretaryPreferences?.trim() || '在助理空间中安排日常、处理事项和调整偏好。'}</p></section>}
      {!isAssistant && privateVisible && section === 'stories' && <section className="vg-space-section" aria-label="共同经历" id={`${sectionId}-content`} role="tabpanel" aria-labelledby={`${sectionId}-stories`} tabIndex={0}>
        <div className="vg-space-section-heading"><h4>共同经历</h4>{relation && lifeState && <span className="vg-space-relation">{lifeState.tierNames?.[relation.level.name] || relation.level.name}</span>}</div>
        {loading ? <div role="status" className="vg-space-story-loading"><span className="sr-only">正在读取共同故事</span><i aria-hidden="true" /><i aria-hidden="true" /></div> : readError ? <FeedbackNotice tone="error" message={readError}><button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></FeedbackNotice> : <>
          {lifeState?.lifeFocus && <p className="vg-space-focus">{lifeState.lifeFocus}</p>}
          {lifeState && relation && <div className="vg-space-relation-progress" role="img" aria-label={`关系阶段：${lifeState.tierNames?.[relation.level.name] || relation.level.name}`}><i style={{ width: `${levelProgress(lifeState.affinity, relation.level, relation.next)}%` }} /></div>}
          {recentEvents.length > 0 ? <ol className="vg-space-stories">{recentEvents.map(event => <li key={event.id}><time dateTime={new Date(event.createdAt).toISOString()}>{new Date(event.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</time><strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}</li>)}</ol> : <p className="vg-space-muted">{isOwn ? '还没有共同故事记录。慢慢聊，让经历自然留下。' : '开始聊天后，你们的故事会从这里留下。'}</p>}
          {openThreads.length > 0 && <div className="vg-space-unfinished"><h5>还没做完的事</h5>{openThreads.slice(0, 2).map(thread => <p key={thread.id}><Icon name="clock" size={16} />{thread.title}</p>)}</div>}
          {storyLinks.length > 0 && <div className="vg-space-connections">{storyLinks.map(link => <span key={link.targetCharacterId}><Avatar avatar={link.character!.avatar} size="xs" /><span>{link.character!.name} · {link.label}</span></span>)}</div>}
        </>}
        <div className="vg-space-story-links"><button type="button" onClick={() => setShowLifeTimeline(true)}><Icon name="clock" size={18} /><span>成长轨迹</span></button><button type="button" onClick={() => setSection('memory')}><Icon name="diary" size={18} /><span>记忆档案</span></button></div>
      </section>}

      {privateVisible&&!isAssistant&&<button type="button" className="vg-preference-row w-full" onClick={()=>setShowStyle(true)}><Icon name="image" size={20}/><span className="vg-preference-copy"><strong>角色造型间</strong><small>头像、聊天氛围与小球外观</small></span></button>}
      {character.greeting && <section className="vg-space-opening"><h4>初次见面</h4><blockquote>{greetingExpanded || character.greeting.length <= 240 ? character.greeting : `${character.greeting.slice(0, 240)}…`}</blockquote>{character.greeting.length > 240 && <button type="button" className="vg-space-expand" aria-expanded={greetingExpanded} onClick={() => setGreetingExpanded(value => !value)}>{greetingExpanded ? '收起开场白' : '展开开场白'}<Icon name="chevron" size={16} /></button>}</section>}
      {(character.catchphrase || character.learnedSpeechStyle?.rules) && <section className="vg-space-section"><h4>说话方式</h4>{character.catchphrase && <p className="vg-space-catchphrase">“{character.catchphrase}”</p>}{character.learnedSpeechStyle?.rules && <details className="vg-space-disclosure"><summary><span>表达习惯</span><Icon name="chevron" size={17} /></summary><p className="vg-space-authored">{character.learnedSpeechStyle.rules}</p>{(character.learnedSpeechStyle.examples ?? []).slice(0, 2).map((example, index) => <blockquote key={index}>{example}</blockquote>)}</details>}</section>}

      <section className="vg-space-section"><h4>人物档案</h4>
        {CATEGORY_ORDER.some(cat => (groups[cat]?.length ?? 0) > 0) && <dl className="vg-space-tag-groups">{CATEGORY_ORDER.map(cat => groups[cat]?.length ? <div key={cat}><dt>{CATEGORY_LABELS[cat]}</dt><dd>{groups[cat]!.map(tag => <span key={tag}>{tag}</span>)}</dd></div> : null)}</dl>}
        {character.boundaries && <details className="vg-space-disclosure"><summary><span>互动边界</span><Icon name="chevron" size={17} /></summary><p className="vg-space-authored">{character.boundaries}</p></details>}
        {character.systemPrompt && <details className="vg-space-disclosure"><summary><span>完整角色设定</span><Icon name="chevron" size={17} /></summary><p className="vg-space-authored">{character.systemPrompt}</p></details>}
      </section>
    </div>
    </div>
    {privateVisible && !isAssistant && <>
      {showStyle&&<Suspense fallback={<p role="status">正在打开造型间…</p>}><StyleWorkspace character={character} userId={userId} onClose={()=>setShowStyle(false)}/></Suspense>}
      <LifeTimelineModal open={showLifeTimeline} onClose={() => setShowLifeTimeline(false)} character={character} userId={userId} characters={worldCharacters} />
      {showMemoryArchive && <MemoryArchiveModal key={focusMemoryId ?? 'all'} open onClose={() => setShowMemoryArchive(false)} character={character} userId={userId} focusMemoryId={focusMemoryId} />}
    </>}
  </Modal>;
}
