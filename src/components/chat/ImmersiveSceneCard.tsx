import { memo, useCallback, useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Character } from '../../db/index';
import { sessionRepo } from '../../db/session-repo';
import type { SceneAtmosphere, SceneTimeOfDay } from '../../lib/chat-context';

interface Props {
  character: Character;
  userId: string;
  sessionId?: string | null;
  affinity: number;
  mood: number;
  lastMessageAt?: number;
  onPrompt: (text: string) => void;
}

const SCENE_SLOT_HOURS: Record<SceneTimeOfDay, number> = {
  morning: 8,
  afternoon: 14,
  dusk: 18,
  night: 22,
  'late-night': 2,
};

const SCENE_TIME_OPTIONS: Array<{ value?: SceneTimeOfDay; label: string; icon: string }> = [
  { label: '跟随现在', icon: '◌' },
  { value: 'morning', label: '清晨', icon: '◔' },
  { value: 'afternoon', label: '午后', icon: '☼' },
  { value: 'dusk', label: '傍晚', icon: '◐' },
  { value: 'night', label: '夜晚', icon: '☾' },
  { value: 'late-night', label: '深夜', icon: '✦' },
];

const SCENE_PLACE_OPTIONS = ['各自在家', '窗边', '回家路上', '安静的房间', '街道'];
const SCENE_ATMOSPHERE_OPTIONS: Array<{ value: SceneAtmosphere; label: string; detail: string }> = [
  { value: 'daily', label: '日常', detail: '像平常一样，自然聊着' },
  { value: 'quiet', label: '安静', detail: '留一点空白，让语气慢下来' },
  { value: 'light', label: '轻松', detail: '可以开个玩笑，也可以随口聊聊' },
  { value: 'serious', label: '认真', detail: '把重要的话说清楚' },
  { value: 'close', label: '亲近', detail: '不急着解释，彼此更靠近一点' },
  { value: 'low', label: '低落', detail: '不强行打起精神，先陪在这里' },
];

function placeLabel(place?: string) {
  return place?.trim() || '未设地点';
}

function getSceneTime(slot?: SceneTimeOfDay) {
  const hour = slot ? SCENE_SLOT_HOURS[slot] : new Date().getHours();
  if (hour < 5) return { label: '深夜', detail: '城市已经安静下来', icon: '✦', tone: 'night' };
  if (hour < 11) return { label: '清晨', detail: '新的片段正开始', icon: '◌', tone: 'morning' };
  if (hour < 17) return { label: '午后', detail: '光线停在故事里', icon: '☼', tone: 'day' };
  if (hour < 21) return { label: '傍晚', detail: '今天还没有结束', icon: '◐', tone: 'dusk' };
  return { label: '夜晚', detail: '适合说些真实的话', icon: '☾', tone: 'night' };
}

/**
 * Shared Space 2.0 —— 角色此刻的"在场感"。
 * 这里仅管理本会话的场域设置；全部读写本地 Session，不在这里发任何 AI 请求。
 */
export const ImmersiveSceneCard = memo(function ImmersiveSceneCard({ sessionId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closePanel = useCallback(() => {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setExpanded(false); setClosing(false); }, 180);
  }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; y: number; started: number; distance: number } | null>(null);
  const resetDrag = () => {
    if (panelRef.current) { panelRef.current.style.transform = ''; panelRef.current.style.transition = ''; }
    drag.current = null;
  };
  const panelId = useId();
  const [placement, setPlacement] = useState({ top: 80, left: 16, width: 320, height: 480 });
  useLayoutEffect(() => {
    if (!expanded) return;
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const top = Math.max(16, Math.min(rect.bottom + 8, bottom - 220));
      const width = Math.min(rect.width, window.innerWidth - 32, 640);
      setPlacement({ top, left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), width, height: Math.max(120, bottom - top - 16) });
    };
    position();
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [expanded]);
  useEffect(() => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; setExpanded(false); setClosing(false); }, [sessionId]);
  useEffect(() => {
    if (!expanded) return;
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
      if (event.key !== 'Tab') return;
      const nodes = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const onBack = (event: Event) => { if (!event.defaultPrevented) { event.preventDefault(); closePanel(); } };
    window.addEventListener('vg:back-request', onBack);
    const trigger = triggerRef.current;
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('vg:back-request', onBack); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [expanded, closePanel]);
  const [sceneSlot, setSceneSlot] = useState<SceneTimeOfDay | undefined>();
  const [scenePlace, setScenePlace] = useState('');
  const [scenePlaceDraft, setScenePlaceDraft] = useState('');
  const [customPlaceOpen, setCustomPlaceOpen] = useState(false);
  const [sceneAtmosphere, setSceneAtmosphere] = useState<SceneAtmosphere>('daily');
  const [sceneMode, setSceneMode] = useState<'follow-now' | 'fixed'>('follow-now');
  const [scene, setScene] = useState(getSceneTime);
  useEffect(() => {
    const update = () => { if (!document.hidden && !sceneSlot) setScene(getSceneTime()); };
    const timer = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [sceneSlot]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = sessionId ? await sessionRepo.getById(sessionId).catch(() => undefined) : undefined;
      if (cancelled) return;
      const savedMode = session?.sceneMode ?? (session?.sceneTimeOfDay ? 'fixed' : 'follow-now');
      setSceneSlot(session?.sceneTimeOfDay);
      setScenePlace(session?.scenePlace ?? '');
      setScenePlaceDraft(session?.scenePlace ?? '');
      setCustomPlaceOpen(Boolean(session?.scenePlace && !SCENE_PLACE_OPTIONS.includes(session.scenePlace)));
      setSceneAtmosphere(session?.sceneAtmosphere ?? 'daily');
      setSceneMode(savedMode);
      setScene(getSceneTime(savedMode === 'fixed' ? session?.sceneTimeOfDay : undefined));
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const chooseSceneTime = useCallback(async (slot?: SceneTimeOfDay) => {
    setSceneSlot(slot);
    setSceneMode(slot ? 'fixed' : 'follow-now');
    setScene(getSceneTime(slot));
    if (!sessionId) return;
    try {
      await sessionRepo.update(sessionId, { sceneTimeOfDay: slot, sceneMode: slot ? 'fixed' : 'follow-now' });
    } catch {
      // 本地持久化失败时保留当前界面选择，下一次进入会回到已保存的值。
    }
  }, [sessionId]);

  const choosePlace = useCallback(async (place: string) => {
    const next = place.replace(/[\r\n]+/g, ' ').trim().slice(0, 24);
    setScenePlace(next);
    setScenePlaceDraft(next);
    setCustomPlaceOpen(Boolean(next && !SCENE_PLACE_OPTIONS.includes(next)));
    if (!sessionId) return;
    try {
      await sessionRepo.update(sessionId, { scenePlace: next });
    } catch {
      // Keep the local selection visible; it will retry when the user chooses again.
    }
  }, [sessionId]);

  const chooseAtmosphere = useCallback(async (atmosphere: SceneAtmosphere) => {
    setSceneAtmosphere(atmosphere);
    if (!sessionId) return;
    try {
      await sessionRepo.update(sessionId, { sceneAtmosphere: atmosphere });
    } catch {
      // Keep the local selection visible.
    }
  }, [sessionId]);

  return (
    <section className={`scene-card scene-${scene.tone} shrink-0 mx-4 mt-2 animate-fade-in`}>
      <div className="scene-grain" />
      <div className="scene-orb scene-orb-a" />
      <div className="scene-orb scene-orb-b" />
      <button
        ref={triggerRef}
        type="button"
        onClick={() => expanded ? closePanel() : setExpanded(true)}
        className="relative z-[1] w-full flex items-center gap-3 px-3.5 py-2.5 text-left"
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        aria-haspopup="dialog"
      >
        <span className="scene-presence-mark" aria-hidden="true"><i /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[13px] font-medium tracking-[0.08em] text-white/80">
            <span>{scene.icon}</span> 此刻 · {scene.label}
            {scenePlace && <span className="scene-setting-summary">· {scenePlace}</span>}
          </p>
        </div>
        <span className={`text-white/40 text-xs transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}>⌄</span>
      </button>

      {expanded && createPortal(<div className="scene-settings-overlay" data-no-page-swipe="true">
        <button type="button" className="scene-settings-backdrop" tabIndex={-1} aria-label="收起此刻设置" onClick={closePanel} />
        <div ref={panelRef} id={panelId} role="dialog" aria-modal="true" aria-label="此刻设置" className={`scene-settings-panel scene-card scene-card-expanded scene-${scene.tone} ${closing ? 'is-closing' : ''}`} style={{ top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.height }}>
          <div className="scene-grain" aria-hidden="true" />
          <div className="scene-orb scene-orb-a" aria-hidden="true" />
          <div className="scene-orb scene-orb-b" aria-hidden="true" />
          <header className="scene-settings-panel-header"
            onPointerDown={(event) => {
              if (closing || (event.target as HTMLElement).closest('button') || !event.isPrimary || event.button !== 0) return;
              drag.current = { pointerId: event.pointerId, y: event.clientY, started: performance.now(), distance: 0 };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.pointerId !== event.pointerId || !panelRef.current) return;
              current.distance = Math.max(0, Math.min(140, event.clientY - current.y));
              panelRef.current.style.transition = 'none';
              panelRef.current.style.transform = `translate3d(0,${current.distance * .65}px,0)`;
            }}
            onPointerUp={(event) => {
              const current = drag.current;
              if (!current || current.pointerId !== event.pointerId) return;
              const dismiss = current.distance > 72 || (current.distance > 28 && current.distance / Math.max(1, performance.now() - current.started) > .55);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              resetDrag();
              if (dismiss) closePanel();
              else if (panelRef.current) {
                panelRef.current.animate([{ transform: `translateY(${current.distance * .65}px)` }, { transform: 'translateY(0)' }], { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
              }
            }}
            onPointerCancel={resetDrag}
            onLostPointerCapture={() => { if (drag.current) resetDrag(); }}
          ><strong>此刻 · {scene.label}</strong><button type="button" aria-label="收起此刻设置" onClick={closePanel}>⌃</button></header>
          <div className="scene-settings-scroll px-4 pb-3.5">
            <div className="scene-time-picker" aria-label="选择这段对话的时段">
              <div className="scene-time-picker-heading">
                <span>这段对话发生在</span>
                <b>{scene.label}</b>
              </div>
              <div className="scene-time-options">
                {SCENE_TIME_OPTIONS.map((option) => {
                  const selected = sceneMode === 'follow-now' ? option.value === undefined : option.value === sceneSlot;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={`scene-time-option ${selected ? 'is-selected' : ''}`}
                      onClick={() => void chooseSceneTime(option.value)}
                      aria-pressed={selected}
                    >
                      <span aria-hidden="true">{option.icon}</span>
                      <strong>{option.label}</strong>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="scene-setting-section">
              <div className="scene-setting-heading"><span>地点</span><b>{placeLabel(scenePlace)}</b></div>
              <div className="scene-chip-grid">
                {SCENE_PLACE_OPTIONS.map((place) => (
                  <button key={place} type="button" className={`scene-chip ${scenePlace === place ? 'is-selected' : ''}`} onClick={() => void choosePlace(place)} aria-pressed={scenePlace === place}>
                    {place}
                  </button>
                ))}
                <button type="button" className={`scene-chip ${!scenePlace && !customPlaceOpen ? 'is-selected' : ''}`} onClick={() => void choosePlace('')} aria-pressed={!scenePlace && !customPlaceOpen}>
                  不设地点
                </button>
                <button type="button" className={`scene-chip ${customPlaceOpen ? 'is-selected' : ''}`} onClick={() => { setCustomPlaceOpen(true); setScenePlaceDraft(SCENE_PLACE_OPTIONS.includes(scenePlace) ? '' : scenePlace); }}>
                  自定义
                </button>
              </div>
              {customPlaceOpen && (
                <div className="scene-custom-place">
                  <input value={scenePlaceDraft} maxLength={24} onChange={(event) => setScenePlaceDraft(event.target.value)} placeholder="写下一个地点" aria-label="自定义地点" />
                  <button type="button" onClick={() => void choosePlace(scenePlaceDraft)} disabled={!scenePlaceDraft.trim()}>保存</button>
                </div>
              )}
            </div>

            <div className="scene-setting-section">
              <div className="scene-setting-heading"><span>气氛</span><b>{SCENE_ATMOSPHERE_OPTIONS.find((option) => option.value === sceneAtmosphere)?.label}</b></div>
              <div className="scene-chip-grid scene-atmosphere-grid">
                {SCENE_ATMOSPHERE_OPTIONS.map((option) => (
                  <button key={option.value} type="button" className={`scene-chip ${sceneAtmosphere === option.value ? 'is-selected' : ''}`} onClick={() => void chooseAtmosphere(option.value)} aria-pressed={sceneAtmosphere === option.value}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="scene-setting-preview">
              <span aria-hidden="true">{scene.icon}</span>
              <div>
                <strong>{scene.label}{scenePlace ? ` · ${scenePlace}` : ''} · {SCENE_ATMOSPHERE_OPTIONS.find((option) => option.value === sceneAtmosphere)?.label}</strong>
                <p>{SCENE_ATMOSPHERE_OPTIONS.find((option) => option.value === sceneAtmosphere)?.detail}</p>
              </div>
            </div>
            <p className="scene-time-picker-note">只影响聊天里的环境、节奏和语气，不会改动消息显示的发送时间。选择“跟随现在”后，时段会随现实时间变化。</p>
          </div>
        </div>
      </div>, document.body)}

    </section>
  );
});
