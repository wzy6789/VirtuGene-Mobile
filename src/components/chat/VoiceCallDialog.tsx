import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Character } from '../../db';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { SoulOrb } from '../ui/SoulOrb';
import { useVoiceCallStore } from '../../store/voice-call-store';
import { useVoiceCallUIStore } from '../../store/voice-call-ui-store';
import { voiceProfileRepo } from '../../db/voice-profile-repo';
import { CALL_VOICES } from '../../lib/voice-call/mimo';
import { MAX_CALL_TEXT_LENGTH, type CallInputMode } from '../../lib/voice-call/input';
import type { VoiceProfile } from '../../lib/voice-call/profile';
import { useCallElapsed } from '../../lib/voice-call/use-call-elapsed';
import { callOrbPresence } from '../../lib/voice-call/orb-presence';
import { callOrbSignal } from '../../lib/voice-call/orb-signal';
import { prefersReducedMotion, subscribeReducedMotion } from '../../lib/mobile-motion';
import { useAuthStore } from '../../store/auth-store';
import { useChatAtmosphere } from './useChatAtmosphere';
import { ChatBackgroundLayer } from './ChatBackgroundLayer';
import { VoiceCallCaptions } from './VoiceCallCaptions';
import { VoiceCallControlIcon } from './VoiceCallControlIcon';
import '../../styles/voice-call.css';
import { Suspense } from 'react';
import { lazyFeature } from '../ui/lazyFeature';
const VoiceCallHistory = lazyFeature(() => import('./VoiceCallHistory').then(module => ({ default: module.VoiceCallHistory })));
const SettingsPanel = lazyFeature(() => import('../settings/SettingsPanel').then(module => ({ default: module.SettingsPanel })));

function explain(error?: string): string {
  if (!error) return '';
  if (/^voice:text_empty$/.test(error)) return '请输入想说的话再发送。';
  if (/^voice:text_limit$/.test(error)) return `每次最多发送 ${MAX_CALL_TEXT_LENGTH} 字，请分开说。`;
  if (/^voice:input_mode_unavailable$/.test(error)) return '当前声音组件不支持切换输入方式，请结束通话后重新连接。';
  if (/^voice:input_unavailable$|^voice:input_mode_pending$|^voice:input_busy$/.test(error)) return '操作暂未完成，草稿已保留。请等待输入方式切换完成，或恢复通话后再操作。';
  if (/^forbidden$|^voice:forbidden$/.test(error)) return 'MiMo 拒绝访问，请检查账号访问限制、地区支持或密钥风控状态；这不等于密钥格式错误。';
  if (/^service$|^voice:service$/.test(error)) return 'MiMo 服务暂时故障或繁忙，当前通话已暂停，请稍后手动继续。';
  if (/key_storage/.test(error)) return '本机保存的 MiMo 密钥无法读取，请在声音服务中重新保存；尚未向 MiMo 发起鉴权请求。';
  if (/key_format/.test(error)) return '已保存的 MiMo 密钥包含空格、换行或不可见字符，请在声音服务中重新粘贴完整 API Key。';
  if (/transport_missing/.test(error)) return '当前安装版本缺少 MiMo 原生网络组件，请安装包含此修复的版本；这不是 API Key 无效。';
  if (/^(?:voice:)?transport_limit$/.test(error)) return '本机连接资源暂不可用，或本次录音超出处理上限；请稍后手动继续，也可以重新说短一些。';
  if (/^(?:voice:)?stream_closed$/.test(error)) return '本机语音连接已关闭，通话已暂停；请结束本次通话后重新连接。';
  if (/^(?:voice:)?transport_duplicate$/.test(error)) return '本机语音连接状态异常，通话已暂停；请结束本次通话并重新打开应用。';
  if (/^(?:voice:)?transport_url$/.test(error)) return '本机语音服务地址未通过校验，通话已暂停；请结束本次通话并重新打开应用。';
  if (/^(?:voice:)?utterance_queue_full$/.test(error)) return '语音识别暂时跟不上，通话已暂停。只会保留已完成识别的文字，其余内容未确认；继续后请重新说未识别部分。';
  if (/^(?:voice:)?utterance_transcript_limit$/.test(error)) return '这段话超过单轮文字处理上限，通话已暂停。只会保留已完成识别的部分，其余内容未确认；继续后请分段补充。';
  if (/^dns$|^voice:dns$/.test(error)) return '无法解析 MiMo 服务地址，请检查网络、私人 DNS 或应用联网权限后重试。';
  if (/^tls$|^voice:tls$/.test(error)) return '与 MiMo 的安全连接失败，请检查设备日期、网络代理或证书环境后重试。';
  if (/bridge-stalled/.test(error)) return '通话界面未及时响应，收音和播放已安全暂停；返回后请手动继续。';
  if (/background|heartbeat|foreground|activity|lock-screen/.test(error)) return '应用进入后台或锁屏，通话已安全暂停。返回后请手动继续。';
  if (/focus|audio-focus/.test(error)) return '其他应用正在使用声音，通话已暂停；声音可用后请手动继续。';
  if (/key|401/.test(error)) return '请在设置的声音服务中填写有效的 MiMo API Key。普通 API 与 Token Plan 的密钥和地址不能混用。';
  if (/quota/.test(error)) return 'MiMo 额度不足，请检查账户余额。';
  if (/permission/.test(error)) return '麦克风权限未开启，请允许后再继续。';
  if (/microphone_denied/.test(error)) return '麦克风权限未开启。ColorOS 请在设置 → 应用管理 → VirtuGene → 权限中允许麦克风，再返回继续。';
  if (/microphone_disabled/.test(error)) return '系统麦克风处于静音状态，请检查快捷设置或隐私设置中的麦克风访问，再继续。';
  if (/microphone_busy/.test(error)) return '麦克风正被语音消息占用，请先结束录音。';
  if (/microphone_unavailable/.test(error)) return '麦克风暂不可用，请检查麦克风权限和占用状态；文字输入仍使用原来的设置，恢复通话后可以继续。';
  if (/bluetooth[-_]connecting/.test(error)) return '蓝牙通话连接还在建立，请稍候再继续。';
  if (/bluetooth_denied/.test(error)) return '蓝牙连接权限未开启，可以先使用听筒或扬声器。';
  if (/headset_unavailable/.test(error)) return '耳机的通话连接尚未就绪，未切到手机播放。请确认耳机已连接并支持通话，再重新连接；要改用手机，请先断开耳机。';
  if (/^voice:route_cancelled$/.test(error)) return '已取消设备切换等待，通话保持暂停。确认声音设备后可手动继续。';
  if (/^voice:route_cancel_(unavailable|failed|unconfirmed)$/.test(error)) return '设备切换未能确认取消，请挂断后重新连接。';
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
  if (/audio_release_failed/.test(error)) return '声音设备未能确认释放，请挂断并重新打开应用后再通话。';
  if (/audio_bridge_timeout/.test(error)) return '音频设备未及时回应，当前播放已作废；请结束通话，重新打开应用后再试。';
  if (/audio_playback_receipt/.test(error)) return '声音设备未确认播放，通话已暂停；请结束本次通话，重新连接后再试。';
  if (/audio_backpressure/.test(error)) return '声音设备暂时无法接收新的音频，通话已暂停；请确认声音设备后再手动继续。';
  if (/checkpoint_failed/.test(error)) return '本轮记录暂未写入，挂断时会再次尝试保存。';
  if (/source_withdrawn/.test(error)) return '通话原话已被修改或撤回，请结束本次通话后重新连接。';
  if (/reply_filtered/.test(error)) return '这次回应未形成可靠的可播放台词，确认后可以继续说。';
  if (/reply_empty/.test(error)) return '这次没有收到可播放的回应，已暂停；确认后可以继续说。';
  if (/speech_boundary_limit/.test(error)) return '这次回应过长且缺少可安全播放的分句，本轮已停止；确认后可以继续。';
  if (/invalid_speech_unicode/.test(error)) return '语音回复格式异常，本轮已停止；确认后可以继续。';
  if (/^(?:voice:)?rate$/.test(error)) return 'MiMo 请求频率或套餐额度受限，请确认额度后手动继续。';
  if (/^(?:voice:)?limit$/.test(error)) return '语音服务未能完整处理本次请求，确认后可以重新说。';
  if (/^(?:voice:)?protocol$/.test(error)) return '语音服务的请求或返回格式不兼容，请检查服务配置。';
  if (/timeout|network|rate/.test(error)) return '网络或服务暂不可用，确认后可手动继续。';
  if (/context|account/.test(error)) return '账号或聊天已变化，本次通话已停止。';
  return '操作未完成，请确认音频设备与连接后再继续。';
}

export function VoiceCallDialog({ character, sessionId, userId, onClose, onMinimize, visible = true }: { character: Character; sessionId: string; userId: string; onClose: () => void; onMinimize?: () => void; visible?: boolean }) {
  const atmosphere = useChatAtmosphere(character, userId);
  const quietBackground = useMemo(() => ({ ...atmosphere.config, strength: 'off' as const,
    scene: atmosphere.config.scene ? { ...atmosphere.config.scene, quality: 'power-save' as const, motionEnabled: false, parallaxEnabled: false, renderer: 'layered' as const } : undefined,
  }), [atmosphere.config]);
  const call = useVoiceCallStore(useShallow(state => ({owner:state.owner,busy:state.busy,saving:state.saving,finishing:state.finishing,record:state.record,error:state.error,
    start:state.start,end:state.end,mute:state.mute,interrupt:state.interrupt,resume:state.resume,routes:state.routes,route:state.route,cancelRouteWait:state.cancelRouteWait,summarize:state.summarize,
    sendText:state.sendText,setInputMode:state.setInputMode})));
  // Capture levels and unplayed model drafts must never redraw the call surface.
  const presentation = useVoiceCallStore(useShallow(state => state.view ? ({phase:state.view.phase,muted:state.view.muted,routing:state.view.routing,routeWait:state.view.routeWait,error:state.view.error,
    errorStage:state.view.errorStage,errorHttpStatus:state.view.errorHttpStatus,inputMode:state.view.inputMode,inputModePending:state.view.inputModePending,
    capabilities:state.view.capabilities,userText:state.view.userText,heardText:state.view.heardText,speakingText:state.view.speakingText}) : undefined));
  const [profile, setProfile] = useState<VoiceProfile>();
  const [error, setError] = useState('');
  const [routing, setRouting] = useState(false);
  const [routeWaitLong, setRouteWaitLong] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [captionSize, setCaptionSize] = useState<'standard' | 'large'>('standard');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(() => { try { return localStorage.getItem(`vg:call-ready:${userId}`) !== 'yes'; } catch { return true; } });
  const [starting, setStarting] = useState(false);
  const [preferredInputMode, setPreferredInputMode] = useState<CallInputMode>('voice');
  const [draft, setDraft] = useState('');
  const composing = useRef(false);
  const composerId = useId();
  const mounted = useRef(true);
  const operation = useRef(0);
  const deviceOperation = useRef(0);
  const launching = useRef(false);
  const actionLocks = useRef(new Set<string>());
  const [pendingActions, setPendingActions] = useState<string[]>([]);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const orbSignal=useCallback(()=>callOrbSignal(userId,character.id,sessionId),[userId,character.id,sessionId]);
  const owned = call.owner?.userId === userId && call.owner.characterId === character.id && call.owner.sessionId === sessionId;
  const view = owned ? presentation : undefined;
  const busy = owned && call.busy;
  // Starting replaces a possibly scrolled setup form. Audio/phase updates must
  // not keep pulling the user away from captions they are reading.
  useLayoutEffect(() => {
    if (busy) surfaceRef.current?.closest<HTMLElement>('[data-modal-scroll]')?.scrollTo({top:0,behavior:'instant'});
  }, [busy, userId, character.id, sessionId]);
  const routeWait = busy ? view?.routeWait : undefined;
  useEffect(() => {
    setRouteWaitLong(false);
    if (!routeWait || !visible) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const remaining = Math.max(0, routeWait.startedAt + 4000 - Date.now());
      setRouteWaitLong(remaining === 0);
      if (remaining) timer = setTimeout(update, remaining);
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pageshow', update);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('pageshow', update); };
  }, [routeWait?.requestId, routeWait?.startedAt, visible]);
  const inputMode = busy ? view?.inputMode ?? 'voice' : preferredInputMode;
  const textMode = inputMode === 'text';
  const status = routeWait ? routeWait.stage === 'cancelling' ? '正在取消设备切换' : '正在切换声音设备'
    : view?.inputModePending ? '正在切换输入方式' : view ? callOrbPresence(view).label : '用声音，接续你们的对话';
  useEffect(() => { setDraft(''); setPreferredInputMode('voice'); composing.current = false; }, [userId, character.id, sessionId]);
  useEffect(() => {
    const node = statusRef.current;
    if (!node || !visible || document.hidden || prefersReducedMotion()) return;
    const animation = node.animate([{ opacity:.55, transform:'translateY(2px)' }, { opacity:1, transform:'translateY(0)' }], {duration:160,easing:'cubic-bezier(.2,.8,.2,1)'});
    const cancel = () => animation.cancel();
    const hidden = () => { if (document.hidden) cancel(); };
    const unsubscribe = subscribeReducedMotion(cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => { cancel(); unsubscribe(); document.removeEventListener('visibilitychange', hidden); };
  }, [status, visible]);
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
  const pending = (key: string) => pendingActions.includes(key);
  const run = (action: () => Promise<unknown>, key = 'operation') => {
    if (actionLocks.current.has(key)) return;
    actionLocks.current.add(key); setPendingActions([...actionLocks.current]); setError('');
    const token = operation.current;
    const deviceAction = key.startsWith('device:') || key.startsWith('route-recovery:');
    const deviceIdentity = deviceOperation.current;
    const callIdentity = useVoiceCallStore.getState().record?.id;
    void Promise.resolve().then(action).catch(value => {
      if ((['mute','resume','interrupt','input-mode','text'].includes(key) || deviceAction) && !useVoiceCallStore.getState().busy) return;
      if (deviceAction && useVoiceCallStore.getState().record?.id !== callIdentity) return;
      if (deviceAction && deviceIdentity !== deviceOperation.current) return;
      const current = token === operation.current || (key === 'start' && operation.current === token + 1);
      const message = value instanceof Error ? value.message : (value as { message?: unknown })?.message;
      if (mounted.current && current && useAuthStore.getState().userId === userId) setError(typeof message === 'string' && /^voice:[a-z_:-]{1,80}$/.test(message) ? message : 'voice:unknown');
    }).finally(() => { actionLocks.current.delete(key); if (mounted.current) setPendingActions([...actionLocks.current]); });
  };
  const runDevice = (action: () => Promise<unknown>) => run(action, `device:${call.record?.id}:${++deviceOperation.current}`);
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
      await call.start({ userId, characterId: character.id, sessionId }, undefined, preferredInputMode);
    } finally {
      if (token === operation.current) { launching.current = false; if (mounted.current) setStarting(false); }
    }
  };
  const orbPresence = callOrbPresence(view);
  const ended = owned && !!call.record && view?.phase === 'ended';
  const hasSpeech = call.record?.exchanges.some(exchange => exchange.userText.trim());
  const issue = error || (owned ? call.error : undefined) || view?.error;
  const reconnectRequired = /source_withdrawn|audio_release_failed|audio_bridge_timeout|audio_playback_receipt|native[-_]unavailable|transport_missing|transport_duplicate|transport_url|stream_closed|route_cancel_(unavailable|failed|unconfirmed)/.test(issue ?? '');
  const saveState = call.finishing === 'saving' ? 'active' : call.error === 'voice:save_failed' ? 'error' : call.record?.status === 'ended' ? 'done' : 'waiting';
  const summaryState = call.finishing === 'summary' ? 'active' : call.record?.summaryState === 'ready' ? 'done' : ['partial','failed'].includes(call.record?.summaryState ?? '') || call.error === 'voice:summary_failed' ? 'error' : 'waiting';
  const memoryState = call.finishing === 'memory' ? 'active' : call.error === 'voice:memory_failed' || (call.record?.memoryProgress?.failed ?? 0) > 0 ? 'error' : call.record?.memoryProgress && !call.record.memoryProgress.pending ? 'done' : 'waiting';
  const switchingInput = pending('input-mode') || !!view?.inputModePending;
  const devicePending = pending(`device:${call.record?.id}:${deviceOperation.current}`);
  const recoveryPending = pending(`route-recovery:${call.record?.id}:${routeWait?.requestId}`) || routeWait?.stage === 'cancelling';
  const showRouteRecovery = !!routeWait && (routeWaitLong || routeWait.stage === 'cancelling');
  const inputActionLocked = starting || pending('start') || switchingInput || pending('text') || pending('mute') || pending('interrupt') || devicePending || recoveryPending || pending('resume') || !!view?.routing || !!routeWait;
  const inputLocked = inputActionLocked || (busy && (!view || ['initializing','connecting','paused','error','ended'].includes(view.phase)));
  // A rejected microphone permission has no native session yet. Users can
  // choose text here, then explicitly resume without requesting microphone access.
  const modeLocked = inputActionLocked || (busy && (!view || (['initializing','connecting','paused','error','ended'].includes(view.phase) && !(view.phase === 'error' && !view.capabilities))));
  const canSendText = busy && textMode && !inputLocked && !!draft.trim() && draft.length <= MAX_CALL_TEXT_LENGTH;
  const recoverRoute = (device?: { id: number; type?: number }) => {
    if (!routeWait || recoveryPending) return;
    const requestId = routeWait.requestId, token = operation.current;
    const currentCallId = useVoiceCallStore.getState().record?.id;
    // A cancelled selection may keep its old bridge promise pending. Its key
    // and error no longer own controls for the user's recovery action.
    deviceOperation.current++;
    run(async () => {
      const current = useVoiceCallStore.getState();
      if (current.view?.routeWait?.requestId !== requestId) return;
      if (typeof current.cancelRouteWait !== 'function') throw new Error('voice:route_cancel_unavailable');
      await current.cancelRouteWait();
      const latest = useVoiceCallStore.getState();
      if (!mounted.current || token !== operation.current || !latest.busy || useAuthStore.getState().userId !== userId
        || latest.owner?.userId !== userId || latest.owner.characterId !== character.id || latest.owner.sessionId !== sessionId
        || latest.record?.id !== currentCallId) return;
      if (latest.view?.routeWait || latest.view?.phase !== 'paused') throw new Error('voice:route_cancel_unconfirmed');
      if (device) {
        // Recheck availability after cancellation; a stale route row cannot
        // select a newly reused ID or pretend the legacy system path is an earpiece.
        if (!latest.view.capabilities?.routes.some(row => row.id === device.id && row.type === device.type)) throw new Error('voice:route_unavailable');
        await latest.route(device.id);
      }
    }, `route-recovery:${currentCallId}:${requestId}`);
  };
  const routeFeedback = routeWait ? <section className="vg-voice-call-route-recovery" aria-label="声音设备切换">
    <p role="status">{recoveryPending ? '正在取消设备切换，请稍候…' : showRouteRecovery ? '声音设备仍未确认' : '正在切换声音设备…'}</p>
    {showRouteRecovery && <><p>可以取消等待，或主动改选可用设备。切换后仍需手动继续通话。</p>
      <div className="vg-voice-call-route-recovery-actions">
        <button type="button" disabled={recoveryPending || reconnectRequired} aria-busy={recoveryPending} onClick={() => recoverRoute()}>{recoveryPending ? '正在取消等待…' : '取消等待，保持暂停'}</button>
        {view?.capabilities?.routes.filter(device => device.type === 1 || device.type === 2).map(device => <button type="button" key={device.id}
          disabled={recoveryPending || reconnectRequired} onClick={() => recoverRoute(device)}>{device.type === 1 ? '改用听筒' : '使用扬声器'}</button>)}
      </div></>}
  </section> : null;
  const sendText = () => {
    if (!canSendText || composing.current) return;
    const submitted = draft, token = operation.current;
    run(async () => {
      const accepted = await call.sendText(submitted);
      if (!mounted.current || token !== operation.current || useAuthStore.getState().userId !== userId) return;
      if (accepted) setDraft(current => current === submitted ? '' : current);
      else if (useVoiceCallStore.getState().busy) setError('voice:input_unavailable');
    }, 'text');
  };
  const changeInputMode = (mode: CallInputMode) => {
      if (inputMode === mode) return;
      if (busy) {
        const token = operation.current, callId = useVoiceCallStore.getState().record?.id;
        run(async () => {
          await call.setInputMode(mode);
          const current = useVoiceCallStore.getState();
          if (mounted.current && token === operation.current && useAuthStore.getState().userId === userId && current.busy
            && current.owner?.userId === userId && current.owner.characterId === character.id && current.owner.sessionId === sessionId
            && current.record?.id === callId && current.view?.inputMode === mode) setPreferredInputMode(mode);
        }, 'input-mode');
      }
      else setPreferredInputMode(mode);
  };
  const inputSelector = <div className="vg-voice-call-input-mode" role="group" aria-label="输入方式" aria-busy={switchingInput}>
    {(['voice', 'text'] as const).map(mode => <button key={mode} type="button" aria-pressed={inputMode === mode} disabled={modeLocked} onClick={() => changeInputMode(mode)}><Icon name={mode === 'voice' ? 'mic' : 'edit'} size={16}/>{mode === 'voice' ? '语音输入' : '文字输入'}</button>)}
  </div>;
  const controls = busy ? <div className={`vg-voice-call-footer${textMode ? ' vg-voice-call-footer-text' : ''}`}>
    {textMode && <form className="vg-voice-call-composer" onSubmit={event => { event.preventDefault(); sendText(); }}>
      <label htmlFor={composerId}>你打字，{character.name}用声音回答</label>
      <div className="vg-voice-call-compose-row"><textarea id={composerId} aria-describedby={`${composerId}-hint`} rows={2} maxLength={MAX_CALL_TEXT_LENGTH}
        value={draft} placeholder="写下想说的话…" onChange={event => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); sendText(); } }}/>
        <button type="submit" className="vg-voice-call-send" disabled={!canSendText} aria-busy={pending('text')}><Icon name="send" size={18}/><span>{pending('text') ? '正在发送' : view && ['generating','playing'].includes(view.phase) ? '发送并打断' : '发送'}</span></button></div>
      <div id={`${composerId}-hint`} className="vg-voice-call-compose-hint"><span>{switchingInput ? '正在切换输入方式…' : view && ['paused','error'].includes(view.phase) ? '草稿已保留，继续通话后再发送' : '麦克风未开启 · 回车换行'}</span><span>{draft.length}/{MAX_CALL_TEXT_LENGTH}</span></div>
    </form>}
    <footer className={`vg-voice-call-controls${textMode ? ' vg-voice-call-controls-text' : ''}`}>
      <button type="button" aria-pressed={textMode || !!view?.muted} aria-busy={pending('mute')} disabled={textMode || pending('mute') || switchingInput} onClick={() => run(call.mute,'mute')}><span className="vg-voice-call-control-disc"><VoiceCallControlIcon kind="mic" muted={textMode || view?.muted}/></span><span>{textMode ? '麦克风关闭' : view?.muted ? '取消静音' : '静音'}</span></button>
      <button type="button" aria-label={view?.routing ? '切换设备中…' : '声音设备'} aria-expanded={routing} disabled={view?.routing && !showRouteRecovery} onClick={() => { setRouting(!routing); if (!routeWait) runDevice(() => call.routes()); }}><span className="vg-voice-call-control-disc"><VoiceCallControlIcon kind="speaker"/></span><span>{view?.routing ? '切换设备中…' : view?.capabilities?.routes.find(route => route.selected)?.label ?? '声音设备'}</span></button>
      <button type="button" aria-label={captionsVisible ? '收起实时字幕' : '显示实时字幕'} aria-pressed={captionsVisible} onClick={() => setCaptionsVisible(value => !value)}><span className="vg-voice-call-control-disc"><VoiceCallControlIcon kind="text"/></span><span>文字</span></button>
      <button type="button" className="vg-voice-call-hangup" aria-label="挂断" disabled={pending('end')} onClick={() => run(call.end,'end')}><span className="vg-voice-call-control-disc"><VoiceCallControlIcon kind="phone"/></span><span>{pending('end') ? '正在结束' : '结束通话'}</span></button>
    </footer>
    {view && ['paused', 'error'].includes(view.phase) ? <button className="vg-voice-call-resume" aria-busy={pending('resume')} disabled={pending('resume') || reconnectRequired || !!routeWait || recoveryPending} onClick={() => run(call.resume,'resume')}>{reconnectRequired ? '请挂断后重新连接' : pending('resume') ? '正在恢复声音…' : '继续通话'}</button> : null}
  </div> : undefined;
  return <Modal open={visible} title={`${character.name} · 语音通话`} onClose={close} footer={controls} closeOnBackdrop={false} mobileFullHeight panelClassName="vg-voice-call-modal vg-chat-atmosphere vg-light-paper" panelStyle={atmosphere.style} canSnapshotOnExit={() => false}>
    <section ref={surfaceRef} className={`vg-voice-call${textMode ? ' is-text-input' : ''}`} data-call-phase={view?.phase ?? 'ready'} data-call-active={visible && busy && !['paused','error','ended'].includes(view?.phase ?? '') ? 'true' : 'false'}>
      <div className="vg-voice-call-room" aria-hidden="true"><ChatBackgroundLayer config={quietBackground} userId={userId}/></div>
      <header className="vg-voice-call-header">
        <button type="button" className="vg-voice-call-minimize" aria-label={busy && onMinimize ? '收起通话' : '返回'} onClick={close}><Icon name="back" /></button>
        <div className="vg-voice-call-identity"><div><strong role="heading" aria-level={1} title={character.name}>{character.name}</strong><span>语音通话</span></div></div>
        <button type="button" className="vg-voice-call-menu-toggle" aria-label="通话菜单" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="more" size={24}/></button>
      </header>
      <div className="vg-voice-call-persona">
        <div className="vg-voice-call-soul" aria-hidden="true"><span className="vg-voice-call-halo"/><SoulOrb size={224} colorOverride={atmosphere.config.roleVisual?.orbColor} motionOverride={atmosphere.config.roleVisual?.orbMotion} animated={visible && orbPresence.animated} emotion={orbPresence.emotion} motionContext="voice" activity={orbSignal} soulKey={`${userId}:${character.id}:${sessionId}`} soulRole="call" /></div>
        <p ref={statusRef} role="status" className="vg-voice-call-status" data-phase={view?.phase ?? 'ready'}>{status}</p>
        <time aria-label={`通话时长 ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`}>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</time>
      </div>
      {!busy && !ended && <div className="vg-voice-call-setup">
        {inputSelector}
        {textMode && <p className="vg-voice-call-input-note">你打字，{character.name}用声音回答。无需开启麦克风。</p>}
        <p className="vg-voice-call-current-voice"><Icon name="volume" size={18}/><span>当前音色<strong>{profile?.voice ?? '正在读取'}</strong></span></p>
        <details open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary>音色与通话准备</summary>
        <label>固定音色<select value={profile?.voice ?? '茉莉'} disabled={!profile} onChange={event => setProfile(profile ? { ...profile, voice: event.target.value as VoiceProfile['voice'] } : profile)}>{CALL_VOICES.map(voice => <option key={voice}>{voice}</option>)}</select></label>
        <label>说话风格<input maxLength={160} value={profile?.delivery ?? ''} placeholder="例如：语速舒缓，留一点停顿" onChange={event => setProfile(profile ? { ...profile, delivery: event.target.value } : profile)}/></label>
        <p>音色保持稳定，情绪与说话方式沿用角色设定。{!textMode && '录音分段发送给 MiMo，停顿后再回应，不保存音频。'}</p>
        <p>{textMode ? '文字直接发送给角色，回复仍使用所选音色。' : '语音输入会申请麦克风权限。'}通话需要 Android 应用，声音服务使用 MiMo。</p>
        <button type="button" onClick={() => setSettingsOpen(true)}>声音服务配置</button></details>
        <button className="vg-voice-call-connect" disabled={!profile || starting || call.saving || pending('start')} onClick={() => run(start,'start')}><Icon name="phone"/>{starting ? '准备连接…' : '开始通话'}</button>
        {call.saving && !owned && <p role="status">上一通交流正在整理，完成后可开始新的通话。</p>}
        <button className="vg-voice-call-history" onClick={() => setHistoryOpen(true)}><Icon name="clock"/>查看通话记录</button>
      </div>}
      {routeFeedback}
      {view && !ended && <div className="vg-voice-call-caption-area" hidden={!captionsVisible}><VoiceCallCaptions key={owned ? call.record?.id ?? sessionId : sessionId} name={character.name} view={view} fontSize={captionSize}
        record={owned && call.record?.userId === userId && call.record.characterId === character.id && call.record.sessionId === sessionId ? call.record : undefined} /></div>}
      {issue && <div className="vg-voice-call-error"><p role="alert">{explain(issue)}</p>
        {issue === view?.error && view.errorStage && <p>{({ asr: '语音识别', dialogue: '角色回应', tts: '声音生成' })[view.errorStage]}阶段失败{view.errorHttpStatus ? ` · 服务返回 ${view.errorHttpStatus}` : ''}</p>}
        {/key|401|403|quota|rate|protocol/.test(issue) && <button type="button" onClick={() => setSettingsOpen(true)}>{/quota|rate/.test(issue) ? '查看服务与额度配置' : '检查声音服务配置'}</button>}
        {/permission|microphone_denied/.test(issue) && <p>请在系统应用权限中允许麦克风。授权后点“继续通话”；尚未连接时重新点“开始通话”。</p>}
        {busy && !view?.capabilities && /permission|microphone_denied/.test(issue) && <p>也可以选择“文字输入”，再点“继续通话”，无需开启麦克风。</p>}
        {/timeout|network/.test(issue) && <p>请先确认网络连接；网络恢复后再继续通话。</p>}
        {busy && /bluetooth|headset|route|^音频设备发生变化/.test(issue) && <button type="button" onClick={() => setRouting(true)}>检查声音设备</button>}
      </div>}
      {ended && <section className="vg-voice-call-ended" aria-label="本次通话结果"><h3>本次交流已结束</h3>
        <p>通话时长 {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</p>
        <div className="vg-voice-call-progress">
        <p data-state={saveState}><Icon name={saveState === 'done' ? 'check' : saveState === 'error' ? 'warning' : 'diary'} size={18}/><span>交流文字：{call.finishing === 'saving' ? '正在保存…' : call.error === 'voice:save_failed' ? '保存失败' : call.record?.status === 'ended' ? '已保存已确认的交流' : '尚未确认保存'}</span></p>
        <p data-state={summaryState}><Icon name={summaryState === 'done' ? 'check' : summaryState === 'error' ? 'warning' : 'edit'} size={18}/><span>摘要：{call.finishing === 'summary' ? '正在整理…' : call.record?.summaryState === 'ready' ? '已整理' : call.record?.summaryState === 'partial' ? '部分已整理' : call.record?.summaryState === 'failed' || call.error === 'voice:summary_failed' ? '整理失败，原话保留' : call.finishing === 'saving' ? '等待文字保存' : !hasSpeech ? '没有可整理的交流' : '待整理'}</span></p>
        <p data-state={memoryState}><Icon name={memoryState === 'done' ? 'check' : memoryState === 'error' ? 'warning' : 'database'} size={18}/><span>记忆检查：{call.finishing === 'memory' ? '正在检查原话…' : call.record?.memoryProgress ? `${call.record.memoryProgress.completed} 条已检查，${call.record.memoryProgress.pending} 条待检查，${call.record.memoryProgress.failed} 条异常` : call.error === 'voice:memory_failed' ? '检查未完成' : call.finishing ? '等待检查' : !hasSpeech ? '没有可检查的原话' : '尚未检查'}</span></p>
        </div>
        <button type="button" disabled={call.record?.status !== 'ended'} onClick={() => setHistoryOpen(true)}><Icon name="diary" />查看交流文字</button>
        <button type="button" disabled={!profile || starting || call.saving || pending('start')} onClick={() => run(start,'start')}>再次通话</button>
      </section>}
      {busy && !textMode && view?.capabilities && !view.capabilities.echoCancellation && <small className="vg-voice-call-note">外放可能受到回声影响，建议使用耳机通话。</small>}
      {view?.phase === 'paused' && <small className="vg-voice-call-note">切后台、锁屏或其他通话占用声音时安全暂停，返回后手动继续。</small>}
      {owned && call.saving && <p role="status" className="vg-voice-call-note">{call.finishing === 'memory' ? '声音已停止，正在检查可作为记忆的原话…' : call.finishing === 'summary' ? '声音已停止，交流文字已保存，正在整理摘要…' : '声音已停止，正在保存已确认的交流文字…'}</p>}
      {owned && call.record?.summary && <p className="vg-voice-call-summary">{call.record.summary}</p>}
      {owned && !busy && call.record?.memoryProgress && (call.record.memoryProgress.pending > 0 || call.record.memoryProgress.failed > 0) && <p className="vg-voice-call-note">还有 {call.record.memoryProgress.pending} 条原话待检查，{call.record.memoryProgress.failed} 条检查异常；可在通话记录中查看进度。</p>}
      {owned && !busy && !call.saving && call.record && ['partial', 'failed'].includes(call.record.summaryState) && <div className="vg-voice-call-note"><p>已整理 {call.record.summaryParts?.length ?? 0}/{call.record.summaryTotalParts ?? '?'} 段，原文均已保留。</p><button onClick={() => run(call.summarize)}>继续整理（会调用 MiMo）</button></div>}
    </section>
    <Modal open={menuOpen && visible} title="通话菜单" onClose={() => setMenuOpen(false)} presentation="dialog" panelClassName="vg-voice-call-menu-dialog" canSnapshotOnExit={() => false}>
      <div className="vg-voice-call-menu">
        <div className="vg-voice-call-menu-row"><span><strong>实时字幕</strong><small>可收起，也可回看已完成句</small></span><button type="button" role="switch" aria-label="实时字幕" aria-checked={captionsVisible} onClick={() => setCaptionsVisible(value => !value)}>{captionsVisible ? '已开启' : '已收起'}</button></div>
        <fieldset className="vg-voice-call-caption-size"><legend>字幕字号</legend><div>{(['standard', 'large'] as const).map(size => <button key={size} type="button" aria-pressed={captionSize === size} onClick={() => setCaptionSize(size)}>{size === 'standard' ? '标准' : '大字'}</button>)}</div></fieldset>
        <div className="vg-voice-call-menu-section"><p>输入方式</p>{inputSelector}</div>
        <button type="button" className="vg-voice-call-menu-action" onClick={() => { setMenuOpen(false); setHistoryOpen(true); }}><Icon name="clock" size={20}/><span>通话记录</span><Icon name="chevron" size={16}/></button>
        {busy && (view?.phase === 'playing' || view?.phase === 'generating') && <button type="button" className="vg-voice-call-menu-action" disabled={pending('interrupt') || switchingInput || pending('text')} onClick={() => { run(call.interrupt, 'interrupt'); setMenuOpen(false); }}><Icon name="pause" size={20}/><span>停止当前回应</span></button>}
        <button type="button" className="vg-voice-call-menu-action" onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}><Icon name="settings" size={20}/><span>声音服务配置</span><Icon name="chevron" size={16}/></button>
      </div>
    </Modal>
    <Modal open={routing && busy && visible} title="声音设备" onClose={() => setRouting(false)} presentation="dialog" panelClassName="vg-voice-call-route-dialog" canSnapshotOnExit={() => false}>
      <div className="vg-voice-call-routes" aria-busy={view?.routing}>
        {routeFeedback}
        {!view?.capabilities?.routes.length && <p role="status">暂未获取到可用设备，请刷新后选择。</p>}
        <p className="vg-voice-call-route-note">切换期间保持暂停，确认声音设备后再继续通话。</p>
        {view?.capabilities?.routes.map(route => <button type="button" key={route.id} disabled={view.routing || !!routeWait || devicePending || recoveryPending || reconnectRequired} aria-pressed={route.selected} onClick={() => runDevice(() => call.route(route.id))}><Icon name="volume" size={18}/><span>{route.label}{route.selected ? ' · 当前' : ''}</span>{route.selected && <Icon name="check" size={18}/>}</button>)}
        <button type="button" aria-busy={devicePending} disabled={view?.routing || !!routeWait || devicePending || recoveryPending} onClick={() => runDevice(() => call.routes(true))}>{devicePending ? '正在读取声音设备…' : '允许蓝牙并刷新'}</button>
        {error && <p role="alert">{explain(error)}</p>}
      </div>
    </Modal>
    {historyOpen && <Suspense fallback={<p role="status">正在打开通话记录…</p>}><VoiceCallHistory sessionId={sessionId} userId={userId} name={character.name} onClose={() => setHistoryOpen(false)}/></Suspense>}
    {settingsOpen && <Suspense fallback={<p role="status">正在打开声音服务配置…</p>}><SettingsPanel open initialPage="keys" onClose={() => setSettingsOpen(false)} /></Suspense>}
  </Modal>;
}
