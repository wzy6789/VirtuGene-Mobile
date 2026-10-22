import { Suspense, useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '../ui/Icon';
import type { Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useEmotionStore } from '../../store/emotion-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useUIStore } from '../../store/ui-store';
import { useVoiceCallUIStore } from '../../store/voice-call-ui-store';
import { useVoiceCallStore } from '../../store/voice-call-store';
import { useShallow } from 'zustand/react/shallow';
import { callOrbPresence } from '../../lib/voice-call/orb-presence';
import { callOrbSignal } from '../../lib/voice-call/orb-signal';
import { beginSoulHandoff, soulElement } from '../../lib/soul-handoff';
import { SoulOrbButton, SoulOrb, SOUL_ORB_LABELS, type SoulOrbEmotion } from '../ui/SoulOrb';
import { Modal } from '../ui/Modal';
import { lazyFeature } from '../ui/lazyFeature';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import { animateVisual } from '../../lib/ui-visual-motion';
import '../../styles/character-orb.css';
import type { OrbAttention } from '../../lib/orb-motion-profiles';
import { useChatAtmosphere } from './useChatAtmosphere';

const EmotionPanel = lazyFeature(() => import('./EmotionPanel').then(m => ({ default: m.EmotionPanel })));
const MemoryArchive = lazyFeature(() => import('../character/MemoryArchiveModal').then(m => ({ default: m.MemoryArchiveModal })));
const SecretaryMemory = lazyFeature(() => import('../secretary/SecretaryMemoryModal').then(m => ({ default: m.SecretaryMemoryModal })));
const MemoryPreview = lazyFeature(() => import('./RoleMemoryPreview').then(m => ({ default: m.RoleMemoryPreview })));
const StoryTimeline = lazyFeature(() => import('./StoryTimeline').then(m => ({ default: m.StoryTimeline })));
const SceneSettings = lazyFeature(() => import('./ImmersiveSceneCard').then(m => ({ default: m.ImmersiveSceneCard })));
const sections=['scene','emotion','relation','memory'] as const;
type Section = typeof sections[number];

export function characterOrbEmotion({ sending, streaming, failed, analyzing, valence, dominantEmotion }: {
  sending?: boolean; streaming?: boolean; failed?: boolean; analyzing?: boolean; valence?: number; dominantEmotion?: string;
}): SoulOrbEmotion {
  if (failed) return 'error';
  if (sending) return streaming ? 'working' : 'thinking';
  if (analyzing) return 'thinking';
  const qualitative = dominantEmotion?.trim();
  if (qualitative && qualitative !== '未知') {
    const expressions: Record<string, SoulOrbEmotion> = {
      开心: 'happy', 快乐: 'happy', 喜悦: 'happy', 愉悦: 'happy', 兴奋: 'happy',
      低落: 'sad', 悲伤: 'sad', 难过: 'sad', 忧郁: 'sad',
      好奇: 'curious', 惊讶: 'surprised', 害羞: 'shy', 困倦: 'sleepy',
    };
    // An unrecognized qualitative record stays neutral rather than contradicting its label.
    return expressions[qualitative] ?? 'idle';
  }
  if (valence !== undefined && Number.isFinite(valence)) {
    if (valence >= 7.5) return 'happy';
    if (valence < 4) return 'sad';
  }
  return 'idle';
}

/** A stable visual identity derived from the character ID; no fabricated emotional data. */
function palette(id: string): CSSProperties {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = [25, 85, 145, 205, 265, 325][hash % 6];
  return { '--character-orb-body': `var(--chat-accent,hsl(${hue} 56% 63%))`, '--character-orb-highlight': `var(--chat-light-panel,hsl(${hue} 65% 87%))` } as CSSProperties;
}

export function CharacterSoulOrb(props: {
  character: Character; sending?: boolean; streaming?: boolean; failed?: boolean;
  emotion?: SoulOrbEmotion; soulKey?: string; soulRole?: 'chat' | 'cabin';
  quiet?: boolean;
  attention?: OrbAttention; cueId?: string | number;
}) {
  const owner = useAuthStore(s => s.userId);
  const session = useChatStore(s => s.currentSessionId);
  // Changing owner, role or session unmounts all private panels immediately.
  return <RoleOrb key={`${owner}:${props.character.id}:${session}`} {...props} userId={owner ?? ''} sessionId={session} />;
}

function RoleOrb({ character, sending, streaming, failed, emotion: controlled, attention, cueId, soulKey, soulRole, quiet, userId, sessionId }:
  Parameters<typeof CharacterSoulOrb>[0] & { userId: string; sessionId: string | null }) {
  const [open, setOpen] = useState(false);
  const visual=useChatAtmosphere(character,userId).config.roleVisual;
  const [section, setSection] = useState<Section>('emotion');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const panelId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const entryRef=useRef<HTMLSpanElement>(null);
  const anchorKey=soulKey??`${userId}:${character.id}:${sessionId??''}`;
  const voiceKey=`${userId}:${character.id}:${sessionId??''}`;
  const signal=useCallback(()=>sessionId?callOrbSignal(userId,character.id,sessionId):undefined,[userId,character.id,sessionId]);
  const replyCue=useChatStore(s=>{const last=s.messages[s.messages.length-1];return last?.sessionId===sessionId&&last.role==='assistant'&&!last.failed?last.replyBatchId??last.id:undefined;});
  const entry=()=>entryRef.current?.querySelector<HTMLElement>('[data-soul-orb-host]');
  const closePanel=()=>{beginSoulHandoff(anchorKey,soulElement(anchorKey,'interaction'),soulRole??'chat');setOpen(false);setArchiveOpen(false);setStoryOpen(false);};
  const snapshot = useEmotionStore(s => s.currentSnapshot);
  const analyzing = useEmotionStore(s => s.isAnalyzing);
  const assistant = character.agentProfile === 'secretary';
  const call = useVoiceCallStore(useShallow(s => s.owner?.userId === userId && s.owner.characterId === character.id && s.owner.sessionId === sessionId && s.busy
    ? { phase: s.view?.phase, inputMode: s.view?.inputMode, inputModePending: s.view?.inputModePending, muted: s.view?.muted }
    : { phase: undefined, inputMode: undefined, inputModePending: undefined, muted: undefined }));
  const callPresence = callOrbPresence(call.phase ? { phase: call.phase, inputMode: call.inputMode, inputModePending: call.inputModePending, muted: call.muted } : undefined);
  const valid = !assistant && snapshot?.characterId === character.id && snapshot.sessionId === sessionId ? snapshot : null;
  const emotion = controlled ?? characterOrbEmotion({ sending, streaming, failed, analyzing: !assistant && analyzing, valence: valid?.dimensions.valence, dominantEmotion: valid?.dominantEmotion });
  useEffect(() => {
    if (!open || assistant) return;
    void useCharacterStateStore.getState().load(character.id);
  }, [open, assistant, character.id]);
  useEffect(() => {
    if (!open) return;
    contentRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    return animateVisual(contentRef.current, [{ opacity: .5 }, { opacity: 1 }], 160);
  }, [open, section]);
  const navigate = (tab: 'today' | 'pending') => { setOpen(false); useUIStore.setState({ assistantTab: tab, mobileTab: 'chat', activeView: 'actionCabin' }); };
  const recordedLabel = valid?.dominantEmotion.trim();
  const status = failed ? SOUL_ORB_LABELS.error : sending ? streaming ? '正在回复' : '正在思考' : !assistant && analyzing ? '正在分析' : recordedLabel && recordedLabel !== '未知' ? recordedLabel : SOUL_ORB_LABELS[emotion];
  return <span ref={entryRef} className="vg-character-orb" style={palette(character.id)}>
    <SoulOrbButton size={44} colorOverride={visual?.orbColor} motionOverride={visual?.orbMotion} emotion={call.phase ? callPresence.emotion : emotion} attention={attention} cueId={cueId??(!sending&&!streaming?replyCue:undefined)} motionContext="reading" activity={signal}
      animated={!open && (call.phase ? callPresence.animated : !quiet)}
      label={call.phase ? `${callPresence.label}，返回与${character.name}的通话` : `打开${character.name}的状态与互动`}
      onActivate={() => {beginSoulHandoff(call.phase?voiceKey:anchorKey,entry(),call.phase?'call':'interaction');if(call.phase)useVoiceCallUIStore.getState().restore();else setOpen(true);}} soulKey={anchorKey} soulRole={soulRole??'chat'} />
    <Modal open={open} onClose={closePanel} title={`${character.name} · 状态与互动`} width="max-w-lg" presentation="dialog" panelClassName="vg-role-orb-sheet" canSnapshotOnExit={() => useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId === sessionId}>
      <div className="vg-role-orb-summary" style={palette(character.id)}>
        <SoulOrb size={52} colorOverride={visual?.orbColor} motionOverride={visual?.orbMotion} emotion={emotion} cueId={cueId} animated={open&&!archiveOpen&&!storyOpen} motionContext="interaction" soulKey={anchorKey} soulRole="interaction"/>
        <div><span className="vg-role-orb-eyebrow">{assistant ? '助理状态' : valid ? '最近的情绪' : '此刻状态'}</span><strong>{status}</strong>
        {valid && <small><time dateTime={new Date(valid.createdAt).toISOString()} title={new Date(valid.createdAt).toLocaleString('zh-CN')}>{new Date(valid.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></small>}</div>
        {!assistant && sessionId && <button type="button" disabled={sending} className="vg-role-call disabled:opacity-40" aria-label="语音通话" title={`和${character.name}语音通话`} onClick={() => {
          const current = useChatStore.getState();
          if (sending || useAuthStore.getState().userId !== userId || current.currentSessionId !== sessionId || current.selectedCharacterId !== character.id) return;
          beginSoulHandoff(voiceKey,soulElement(anchorKey,'interaction'),'call');setOpen(false);useVoiceCallUIStore.getState().open({ character, userId, sessionId });
        }}><Icon name="phone" size={20} /></button>}
      </div>
      {assistant ? <div className="vg-role-orb-actions">
        <button onClick={() => navigate('today')}>今日安排</button><button onClick={() => navigate('pending')}>待处理</button>
        <button onClick={() => setArchiveOpen(true)}>助理记忆</button>
      </div> : <>
        <nav className="vg-role-orb-tabs" aria-label="角色互动"><div role="tablist" aria-label="状态分类" data-section={section}>
          {sections.map((s,index) => <button key={s} id={`${panelId}-${s}`} role="tab" aria-selected={section === s} aria-controls={`${panelId}-content`} tabIndex={section===s?0:-1} onClick={() => setSection(s)} onKeyDown={event=>{
            const offset=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
            if(!offset&&event.key!=='Home'&&event.key!=='End')return;
            event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?sections.length-1:(index+offset+sections.length)%sections.length;
            setSection(sections[next]);
            (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
          }}><Icon name={s==='emotion'?'heart':s==='relation'?'connection':s==='scene'?'clock':'diary'} size={17}/>{s==='emotion'?'情绪':s==='relation'?'关系':s==='scene'?'此刻':'记忆'}</button>)}
        </div></nav>
        <div ref={contentRef} id={`${panelId}-content`} className="vg-role-orb-content" role="tabpanel" aria-labelledby={`${panelId}-${section}`} tabIndex={0}>
          {section==='emotion' && valid?.summary && <details className="vg-role-orb-reading"><summary><span>情绪解读</span><Icon name="chevron" size={16}/><p>{valid.summary}</p></summary><p>{valid.summary}</p></details>}
          <Suspense fallback={<LoadingSkeleton label="正在打开记录" rows={3} />}>
            {section==='scene'?<SceneSettings character={character} userId={userId} sessionId={sessionId} embedded/>:section === 'memory' ? <MemoryPreview character={character} userId={userId} refresh={archiveOpen} onArchive={()=>setArchiveOpen(true)} onStory={()=>setStoryOpen(true)}/> : <EmotionPanel key={section} embedded section={section} />}
          </Suspense>
        </div>
      </>}
    </Modal>
    {open && archiveOpen && <Suspense fallback={null}>
      {assistant ? <SecretaryMemory open onClose={() => setArchiveOpen(false)} /> : <MemoryArchive open onClose={() => setArchiveOpen(false)} character={character} userId={userId} />}
    </Suspense>}
    {open && storyOpen && !assistant && <Suspense fallback={null}><StoryTimeline open onClose={()=>setStoryOpen(false)} characterId={character.id} characterName={character.name}/></Suspense>}
  </span>;
}
