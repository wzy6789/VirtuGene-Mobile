import { useEffect, useRef, useState } from 'react';
import type { Character } from '../../db';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { GeneGlyph } from '../ui/GeneGlyph';
import { SoulOrb } from '../ui/SoulOrb';
import { avatarImageSrc } from '../../lib/avatar';
import { useVoiceCallStore } from '../../store/voice-call-store';
import { useVoiceCallUIStore } from '../../store/voice-call-ui-store';
import { voiceProfileRepo } from '../../db/voice-profile-repo';
import { CALL_VOICES } from '../../lib/voice-call/mimo';
import type { VoiceProfile } from '../../lib/voice-call/profile';
import { useCallElapsed } from '../../lib/voice-call/use-call-elapsed';
import { useAuthStore } from '../../store/auth-store';
import '../../styles/voice-call.css';
import { Suspense } from 'react';
import { lazyFeature } from '../ui/lazyFeature';
const VoiceCallHistory = lazyFeature(() => import('./VoiceCallHistory').then(module => ({ default: module.VoiceCallHistory })));
const SettingsPanel = lazyFeature(() => import('../settings/SettingsPanel').then(module => ({ default: module.SettingsPanel })));

const labels = { initializing: '正在准备声音', connecting: '正在连接', listening: '正在听你说', recognizing: '正在听清', generating: '正在想回应', playing: '正在回应', interrupting: '已停下，听你说', paused: '通话已暂停', error: '连接需要恢复', ended: '通话已结束' };
function explain(error?: string): string {
  if (!error) return '';
  if (/bridge-stalled/.test(error)) return '通话界面未及时响应，收音和播放已安全暂停；返回后请手动继续。';
  if (/background|heartbeat|foreground|activity|lock-screen/.test(error)) return '应用进入后台或锁屏，通话已安全暂停。返回后请手动继续。';
  if (/focus|audio-focus/.test(error)) return '其他应用正在使用声音，通话已暂停；声音可用后请手动继续。';
  if (/key|401|403/.test(error)) return '请在设置的声音服务中填写有效的 MiMo API Key。';
  if (/quota/.test(error)) return 'MiMo 额度不足，请检查账户余额。';
  if (/permission/.test(error)) return '麦克风权限未开启，请允许后再继续。';
  if (/microphone_denied/.test(error)) return '麦克风权限未开启，请允许后再继续。';
  if (/microphone_busy/.test(error)) return '麦克风正被语音消息占用，请先结束录音。';
  if (/bluetooth[-_]connecting/.test(error)) return '蓝牙通话连接还在建立，请稍候再继续。';
  if (/bluetooth_denied/.test(error)) return '蓝牙连接权限未开启，可以先使用听筒或扬声器。';
  if (/bluetooth[-_]disconnected|headset[-_]disconnected|route[-_]lost|^音频设备发生变化/.test(error)) return '耳机或声音设备已断开，通话已暂停。请重新选择可用设备，再手动继续。';
  if (/route[-_]change/.test(error)) return '声音设备已切换，通话已暂停。确认声音输出后，请手动继续。';
  if (/route[-_](error|failed)/.test(error)) return '声音设备未能切换成功，请选择其他可用设备后再继续。';
  if (/capture[-_](error|failed)/.test(error)) return '麦克风收音中断，通话已暂停。请确认麦克风未被其他应用占用，再手动继续。';
  if (/native[-_]unavailable/.test(error)) return '原生音频服务暂不可用，通话已暂停。请结束本次通话并重新打开应用。';
  if (/android_required/.test(error)) return '连续语音通话需要 Android 应用中的原生音频服务。';
  if (/summary_failed/.test(error)) return '通话原文已保留，摘要暂未整理成功。';
  if (/save_failed/.test(error)) return '交流文字未能保存成功，不能确认本次记录已保留。';
  if (/memory_failed/.test(error)) return '交流文字已保留，记忆检查暂未完成。可在通话记录中查看进度。';
  if (/postprocess_failed/.test(error)) return '交流文字已保留，后续整理未完成。可在通话记录中核对。';
  if (/audio_release_failed/.test(error)) return '通话已结束并尝试保存记录，音频设备释放出现异常，请重新打开应用后再通话。';
  if (/audio_bridge_timeout/.test(error)) return '音频设备未及时回应，当前播放已作废；请结束通话，重新打开应用后再试。';
  if (/audio_playback_receipt/.test(error)) return '声音设备未确认播放，通话已暂停；请结束本次通话，重新连接后再试。';
  if (/checkpoint_failed/.test(error)) return '本轮记录暂未写入，挂断时会再次尝试保存。';
  if (/source_withdrawn/.test(error)) return '通话原话已被修改或撤回，请结束本次通话后重新连接。';
  if (/reply_filtered/.test(error)) return '这次回应未形成可靠的可播放台词，确认后可以继续说。';
  if (/reply_empty/.test(error)) return '这次没有收到可播放的回应，已暂停；确认后可以继续说。';
  if (/^voice:rate$/.test(error)) return 'MiMo 请求频率或套餐额度受限，请确认额度后手动继续。';
  if (/^voice:limit$/.test(error)) return '语音服务未能完整处理本次请求，确认后可以重新说。';
  if (/^voice:protocol$/.test(error)) return '语音服务的请求或返回格式不兼容，请检查服务配置。';
  if (/timeout|network|rate/.test(error)) return '网络或服务暂不可用，确认后可手动继续。';
  if (/context|account/.test(error)) return '账号或聊天已变化，本次通话已停止。';
  return '操作未完成，请确认音频设备与连接后再继续。';
}

export function VoiceCallDialog({ character, sessionId, userId, onClose, onMinimize, visible = true }: { character: Character; sessionId: string; userId: string; onClose: () => void; onMinimize?: () => void; visible?: boolean }) {
  const call = useVoiceCallStore();
  const [profile, setProfile] = useState<VoiceProfile>();
  const [error, setError] = useState('');
  const [captions, setCaptions] = useState(true);
  const [routing, setRouting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => { try { return localStorage.getItem(`vg:call-ready:${userId}`) !== 'yes'; } catch { return true; } });
  const [starting, setStarting] = useState(false);
  const mounted = useRef(true);
  const operation = useRef(0);
  const launching = useRef(false);
  const image = avatarImageSrc(character.avatar);
  const owned = call.owner?.userId === userId && call.owner.characterId === character.id && call.owner.sessionId === sessionId;
  const view = owned ? call.view : undefined;
  const busy = owned && call.busy;
  const elapsed = useCallElapsed(owned ? call.record?.startedAt : undefined,
    owned && (call.record?.status === 'ended' || view?.phase === 'ended') ? call.record?.endedAt : undefined, busy, visible);
  useEffect(() => {
    if (owned && view?.phase === 'listening') {
      try { localStorage.setItem(`vg:call-ready:${userId}`, 'yes'); } catch { /* The call remains usable when local preferences are unavailable. */ }
    }
  }, [owned, view?.phase, userId]);
  useEffect(() => {
    if (busy || starting || (owned && call.finishing === 'saving')) useVoiceCallUIStore.getState().setChatBlocked(sessionId, userId, true);
    else if (owned && view?.phase === 'ended') useVoiceCallUIStore.getState().setChatBlocked(sessionId, userId, false);
  }, [busy, starting, owned, view?.phase, call.finishing, sessionId, userId]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void voiceProfileRepo.getOrCreate(character.id, userId).then(value => { if (active) setProfile(value); }).catch(() => { if (active) setError('voice:profile'); });
    return () => { active = false; mounted.current = false; operation.current++; launching.current = false; const current = useVoiceCallStore.getState(); if (!onMinimize && current.busy && current.owner?.sessionId === sessionId && current.owner.userId === userId && current.owner.characterId === character.id) void current.end(); };
  }, [character.id, userId, sessionId, onMinimize]);
  const run = (action: () => Promise<unknown>) => { setError(''); void action().catch(value => { if (mounted.current && useAuthStore.getState().userId === userId) setError(value instanceof Error ? value.message : 'voice:unknown'); }); };
  const close = () => {
    if (onMinimize && (busy || starting)) { onMinimize(); return; }
    mounted.current = false; operation.current++; if (busy) run(call.end); onClose();
  };
  const start = async () => {
    if (!profile || launching.current || !mounted.current || useAuthStore.getState().userId !== userId) return;
    launching.current = true; setStarting(true);
    const token = ++operation.current;
    try {
      await voiceProfileRepo.set(character.id, userId, profile);
      if (!mounted.current || token !== operation.current || useAuthStore.getState().userId !== userId) return;
      await call.start({ userId, characterId: character.id, sessionId });
    } finally {
      if (token === operation.current) { launching.current = false; if (mounted.current) setStarting(false); }
    }
  };
  const quiet = !busy || view?.phase === 'paused' || view?.phase === 'error';
  const ended = owned && !!call.record && view?.phase === 'ended';
  const hasSpeech = call.record?.exchanges.some(exchange => exchange.userText.trim());
  const issue = error || (owned ? call.error : undefined) || view?.error;
  const speaking = view?.phase === 'playing' ? view.speakingText : '';
  const controls = busy ? <div className="vg-voice-call-footer">
    <footer className="vg-voice-call-controls">
      <button type="button" aria-pressed={view?.muted} onClick={() => run(call.mute)}><Icon name="mic"/>{view?.muted ? '取消静音' : '静音'}</button>
      <button type="button" className="vg-voice-call-hangup" onClick={() => run(call.end)}><Icon name="phone"/>挂断</button>
      <button type="button" aria-expanded={routing} disabled={view?.routing} onClick={() => { setRouting(!routing); run(() => call.routes()); }}><Icon name="volume"/>{view?.routing ? '切换设备中…' : '声音设备'}</button>
    </footer>
    {view && ['paused', 'error'].includes(view.phase) ? <button className="vg-voice-call-resume" disabled={view.error === 'voice:source_withdrawn'} onClick={() => run(call.resume)}>{view.error === 'voice:source_withdrawn' ? '请挂断后重新连接' : '继续通话'}</button>
      : view?.phase === 'playing' || view?.phase === 'generating' ? <button className="vg-voice-call-resume" onClick={() => run(call.interrupt)}>停下，听我说</button> : null}
  </div> : undefined;
  return <Modal open={visible} title={`${character.name} · 语音通话`} onClose={close} footer={controls} closeOnBackdrop={false} mobileFullHeight panelClassName="vg-voice-call-modal" canSnapshotOnExit={() => false}>
    <section className="vg-voice-call">
      <div className="vg-voice-call-art" aria-hidden="true">{image && <img src={image} alt=""/>}</div>
      <header className="vg-voice-call-header">
        <button type="button" aria-label={busy && onMinimize ? '收起通话' : '返回'} onClick={close}><Icon name="back" /></button>
        <strong>与{character.name}通话</strong>
        <button type="button" className="vg-voice-call-caption-toggle" aria-label={captions ? '隐藏字幕' : '显示字幕'} aria-pressed={captions} onClick={() => setCaptions(!captions)}><Icon name="diary" size={18}/><span>字幕</span></button>
      </header>
      <div className="vg-voice-call-persona">
        <div className="vg-voice-call-portrait">{image ? <img src={image} alt={`${character.name}的头像`}/> : <span>{character.avatar || <GeneGlyph size={64}/>}</span>}</div>
        <div className="vg-voice-call-soul" aria-hidden="true"><SoulOrb size={52} animated={!quiet} emotion={quiet ? 'idle' : view?.phase === 'playing' ? 'happy' : view?.phase === 'generating' ? 'thinking' : 'listening'} /></div>
        <h2>{character.name}</h2><p role="status">{view?.muted && view.phase === 'listening' ? '麦克风已静音' : view ? labels[view.phase] : '用声音，接续你们的对话'}</p>
        <time aria-label={`通话时长 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`}>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</time>
      </div>
      {!busy && !ended && <div className="vg-voice-call-setup">
        <p>当前音色 · {profile?.voice ?? '正在读取'}</p>
        <details open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary>音色与通话准备</summary>
        <label>固定音色<select value={profile?.voice ?? '茉莉'} disabled={!profile} onChange={event => setProfile(profile ? { ...profile, voice: event.target.value as VoiceProfile['voice'] } : profile)}>{CALL_VOICES.map(voice => <option key={voice}>{voice}</option>)}</select></label>
        <label>说话风格<input maxLength={160} value={profile?.delivery ?? ''} placeholder="例如：语速舒缓，留一点停顿" onChange={event => setProfile(profile ? { ...profile, delivery: event.target.value } : profile)}/></label>
        <p>音色保持稳定，情绪与说话方式沿用角色设定。录音按停句发送给 MiMo，不保存音频。</p>
        <p>开始时会申请麦克风权限，连续收音需要 Android 应用。声音服务使用 MiMo。</p>
        <button type="button" onClick={() => setSettingsOpen(true)}>声音服务配置</button></details>
        <button className="vg-voice-call-connect" disabled={!profile || starting || call.saving} onClick={() => run(start)}><Icon name="phone"/>{starting ? '准备连接…' : '开始通话'}</button>
        {call.saving && !owned && <p role="status">上一通交流正在整理，完成后可开始新的通话。</p>}
        <button className="vg-voice-call-history" onClick={() => setHistoryOpen(true)}><Icon name="clock"/>查看通话记录</button>
      </div>}
      {captions && view && !ended && <div className="vg-voice-call-captions"><p><span>{speaking || view.heardText ? `${character.name}${speaking ? ' · 正在播放' : ''}` : '你'}</span>{speaking || view.heardText || view.userText || '说完后稍作停顿，我会接着回应。'}</p></div>}
      {issue && <div className="vg-voice-call-error"><p role="alert">{explain(issue)}</p>
        {/key|401|403|quota|rate|protocol/.test(issue) && <button type="button" onClick={() => setSettingsOpen(true)}>{/quota|rate/.test(issue) ? '查看服务与额度配置' : '检查声音服务配置'}</button>}
        {/permission|microphone_denied/.test(issue) && <p>请在系统应用权限中允许麦克风。授权后点“继续通话”；尚未连接时重新点“开始通话”。</p>}
        {/timeout|network/.test(issue) && <p>请先确认网络连接；网络恢复后再继续通话。</p>}
        {busy && /bluetooth|headset|route|^音频设备发生变化/.test(issue) && <button type="button" onClick={() => setRouting(true)}>检查声音设备</button>}
      </div>}
      {ended && <section className="vg-voice-call-ended" aria-label="本次通话结果"><h3>本次交流已结束</h3>
        <p>通话时长 {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</p>
        <p>交流文字：{call.finishing === 'saving' ? '正在保存…' : call.error === 'voice:save_failed' ? '保存失败' : call.record?.status === 'ended' ? '已保存已确认的交流' : '尚未确认保存'}</p>
        <p>摘要：{call.finishing === 'summary' ? '正在整理…' : call.record?.summaryState === 'ready' ? '已整理' : call.record?.summaryState === 'partial' ? '部分已整理' : call.record?.summaryState === 'failed' || call.error === 'voice:summary_failed' ? '整理失败，原话保留' : call.finishing === 'saving' ? '等待文字保存' : !hasSpeech ? '没有可整理的交流' : '待整理'}</p>
        <p>记忆检查：{call.finishing === 'memory' ? '正在检查原话…' : call.record?.memoryProgress ? `${call.record.memoryProgress.completed} 条已检查，${call.record.memoryProgress.pending} 条待检查，${call.record.memoryProgress.failed} 条异常` : call.error === 'voice:memory_failed' ? '检查未完成' : call.finishing ? '等待检查' : !hasSpeech ? '没有可检查的原话' : '尚未检查'}</p>
        <button type="button" disabled={call.record?.status !== 'ended'} onClick={() => setHistoryOpen(true)}><Icon name="diary" />查看交流文字</button>
        <button type="button" disabled={!profile || starting || call.saving} onClick={() => run(start)}>再次通话</button>
      </section>}
      {busy && view?.capabilities && !view.capabilities.echoCancellation && <small className="vg-voice-call-note">外放可能受到回声影响；可用耳机，或点“停下，听我说”打断。</small>}
      {view?.phase === 'paused' && <small className="vg-voice-call-note">切后台、锁屏或其他通话占用声音时安全暂停，返回后手动继续。</small>}
      {owned && call.saving && <p role="status" className="vg-voice-call-note">{call.finishing === 'memory' ? '声音已停止，正在检查可作为记忆的原话…' : call.finishing === 'summary' ? '声音已停止，交流文字已保存，正在整理摘要…' : '声音已停止，正在保存已确认的交流文字…'}</p>}
      {owned && call.record?.summary && <p className="vg-voice-call-summary">{call.record.summary}</p>}
      {owned && !busy && call.record?.memoryProgress && (call.record.memoryProgress.pending > 0 || call.record.memoryProgress.failed > 0) && <p className="vg-voice-call-note">还有 {call.record.memoryProgress.pending} 条原话待检查，{call.record.memoryProgress.failed} 条检查异常；可在通话记录中查看进度。</p>}
      {owned && !busy && !call.saving && call.record && ['partial', 'failed'].includes(call.record.summaryState) && <div className="vg-voice-call-note"><p>已整理 {call.record.summaryParts?.length ?? 0}/{call.record.summaryTotalParts ?? '?'} 段，原文均已保留。</p><button onClick={() => run(call.summarize)}>继续整理（会调用 MiMo）</button></div>}
    </section>
    <Modal open={routing && busy && visible} title="声音设备" onClose={() => setRouting(false)} presentation="dialog" panelClassName="vg-voice-call-route-dialog" canSnapshotOnExit={() => false}>
      <div className="vg-voice-call-routes" aria-busy={view?.routing}>
        {!view?.capabilities?.routes.length && <p role="status">暂未获取到可用设备，请刷新后选择。</p>}
        {view?.capabilities?.routes.map(route => <button type="button" key={route.id} disabled={view.routing} aria-pressed={route.selected} onClick={() => run(() => call.route(route.id))}>{route.label}{route.selected ? ' · 当前' : ''}</button>)}
        <button type="button" disabled={view?.routing} onClick={() => run(() => call.routes(true))}>允许蓝牙并刷新</button>
        {error && <p role="alert">{explain(error)}</p>}
      </div>
    </Modal>
    {historyOpen && <Suspense fallback={<p role="status">正在打开通话记录…</p>}><VoiceCallHistory sessionId={sessionId} userId={userId} name={character.name} onClose={() => setHistoryOpen(false)}/></Suspense>}
    {settingsOpen && <Suspense fallback={<p role="status">正在打开声音服务配置…</p>}><SettingsPanel open initialPage="keys" onClose={() => setSettingsOpen(false)} /></Suspense>}
  </Modal>;
}
