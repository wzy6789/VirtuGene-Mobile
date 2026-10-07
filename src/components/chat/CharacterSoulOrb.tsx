import { Suspense, useEffect, useId, useState, type CSSProperties } from 'react';
import { Icon } from '../ui/Icon';
import type { Character } from '../../db';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useEmotionStore } from '../../store/emotion-store';
import { useCharacterStateStore } from '../../store/character-state-store';
import { useUIStore } from '../../store/ui-store';
import { SoulOrbButton, SoulOrb, SOUL_ORB_LABELS, type SoulOrbEmotion } from '../ui/SoulOrb';
import { Modal } from '../ui/Modal';
import { lazyFeature } from '../ui/lazyFeature';
import '../../styles/character-orb.css';
import type { OrbAttention } from '../../lib/orb-motion-profiles';

const EmotionPanel = lazyFeature(() => import('./EmotionPanel').then(m => ({ default: m.EmotionPanel })));
const MemoryArchive = lazyFeature(() => import('../character/MemoryArchiveModal').then(m => ({ default: m.MemoryArchiveModal })));
const SecretaryMemory = lazyFeature(() => import('../secretary/SecretaryMemoryModal').then(m => ({ default: m.SecretaryMemoryModal })));
const MemoryPreview = lazyFeature(() => import('./RoleMemoryPreview').then(m => ({ default: m.RoleMemoryPreview })));
const StoryTimeline = lazyFeature(() => import('./StoryTimeline').then(m => ({ default: m.StoryTimeline })));
type Section = 'emotion' | 'relation' | 'memory';

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
  return { '--character-orb-body': `hsl(${hue} 56% 63%)`, '--character-orb-highlight': `hsl(${hue} 65% 87%)` } as CSSProperties;
}

export function CharacterSoulOrb(props: {
  character: Character; sending?: boolean; streaming?: boolean; failed?: boolean;
  emotion?: SoulOrbEmotion; soulKey?: string; soulRole?: 'chat' | 'cabin';
  attention?: OrbAttention; cueId?: string | number;
}) {
  const owner = useAuthStore(s => s.userId);
  const session = useChatStore(s => s.currentSessionId);
  // Changing owner, role or session unmounts all private panels immediately.
  return <RoleOrb key={`${owner}:${props.character.id}:${session}`} {...props} userId={owner ?? ''} sessionId={session} />;
}

function RoleOrb({ character, sending, streaming, failed, emotion: controlled, attention, cueId, soulKey, soulRole, userId, sessionId }:
  Parameters<typeof CharacterSoulOrb>[0] & { userId: string; sessionId: string | null }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('emotion');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const panelId = useId();
  const snapshot = useEmotionStore(s => s.currentSnapshot);
  const analyzing = useEmotionStore(s => s.isAnalyzing);
  const assistant = character.agentProfile === 'secretary';
  const valid = !assistant && snapshot?.characterId === character.id && snapshot.sessionId === sessionId ? snapshot : null;
  const emotion = controlled ?? characterOrbEmotion({ sending, streaming, failed, analyzing: !assistant && analyzing, valence: valid?.dimensions.valence, dominantEmotion: valid?.dominantEmotion });
  useEffect(() => {
    if (!open || assistant) return;
    void useCharacterStateStore.getState().load(character.id);
  }, [open, assistant, character.id]);
  const navigate = (tab: 'today' | 'pending') => { setOpen(false); useUIStore.setState({ assistantTab: tab, mobileTab: 'chat', activeView: 'actionCabin' }); };
  const recordedLabel = valid?.dominantEmotion.trim();
  const status = failed ? SOUL_ORB_LABELS.error : sending ? streaming ? '正在回复' : '正在思考' : !assistant && analyzing ? '正在分析' : recordedLabel && recordedLabel !== '未知' ? recordedLabel : SOUL_ORB_LABELS[emotion];
  return <span className="vg-character-orb" style={palette(character.id)}>
    <SoulOrbButton size={44} emotion={emotion} attention={attention} cueId={cueId} animated={!open} label={`打开${character.name}的状态与互动`} onActivate={() => setOpen(true)} soulKey={soulKey} soulRole={soulRole} />
    <Modal open={open} onClose={() => { setOpen(false); setArchiveOpen(false); setStoryOpen(false); }} title={`${character.name} · 状态与互动`} width="max-w-lg" presentation="dialog" panelClassName="vg-role-orb-sheet" canSnapshotOnExit={() => useAuthStore.getState().userId === userId && useChatStore.getState().currentSessionId === sessionId}>
      <div className="vg-role-orb-summary" style={palette(character.id)}>
        <SoulOrb size={52} emotion={emotion} cueId={cueId} animated={open&&!archiveOpen&&!storyOpen} />
        <div><span className="vg-role-orb-eyebrow">{assistant ? '助理状态' : valid ? '最近的情绪' : '此刻状态'}</span><strong>{status}</strong>
        {valid ? <small>情绪记录于 {new Date(valid.createdAt).toLocaleString('zh-CN')}</small> : <p>{assistant ? '状态来自当前办事进度。' : '暂无情绪记录，交流后可查看图谱。'}</p>}</div>
      </div>
      {assistant ? <div className="vg-role-orb-actions">
        <button onClick={() => navigate('today')}>今日安排</button><button onClick={() => navigate('pending')}>待处理</button>
        <button onClick={() => setArchiveOpen(true)}>助理记忆</button>
        <p>助理保留办事与记忆入口，不生成关系等级或情绪图谱。</p>
      </div> : <>
        <nav className="vg-role-orb-tabs" aria-label="角色互动"><div role="tablist" aria-label="状态分类" data-section={section}>
          {(['emotion', 'relation', 'memory'] as const).map((s,index) => <button key={s} id={`${panelId}-${s}`} role="tab" aria-selected={section === s} aria-controls={`${panelId}-content`} tabIndex={section===s?0:-1} onClick={() => setSection(s)} onKeyDown={event=>{
            const offset=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
            if(!offset&&event.key!=='Home'&&event.key!=='End')return;
            event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(index+offset+3)%3;
            setSection((['emotion','relation','memory'] as const)[next]);
            (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
          }}><Icon name={s==='emotion'?'heart':s==='relation'?'connection':'diary'} size={17}/>{s === 'emotion' ? '情绪' : s === 'relation' ? '关系' : '记忆'}</button>)}
        </div></nav>
        <div id={`${panelId}-content`} className="vg-role-orb-content" role="tabpanel" aria-labelledby={`${panelId}-${section}`} tabIndex={0}>
          {section==='emotion' && valid?.summary && <details className="vg-role-orb-reading"><summary><span>情绪解读</span><Icon name="chevron" size={16}/><p>{valid.summary}</p></summary><p>{valid.summary}</p></details>}
          {section === 'memory' ? <MemoryPreview character={character} userId={userId} refresh={archiveOpen} onArchive={()=>setArchiveOpen(true)} onStory={()=>setStoryOpen(true)}/> : <Suspense fallback={<div role="status" className="vg-loading">正在打开记录…</div>}><EmotionPanel key={section} embedded section={section} /></Suspense>}
        </div>
      </>}
    </Modal>
    {open && archiveOpen && <Suspense fallback={<div role="status" className="vg-loading">正在打开记忆…</div>}>
      {assistant ? <SecretaryMemory open onClose={() => setArchiveOpen(false)} /> : <MemoryArchive open onClose={() => setArchiveOpen(false)} character={character} userId={userId} />}
    </Suspense>}
    {open && storyOpen && !assistant && <StoryTimeline open onClose={()=>setStoryOpen(false)} characterId={character.id} characterName={character.name}/>}
  </span>;
}
