import { memo, useCallback, useEffect, useState } from 'react';
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
    <section className={`scene-card scene-${scene.tone} shrink-0 mx-4 mt-2 animate-fade-in ${expanded ? 'scene-card-expanded' : ''}`}>
      <div className="scene-grain" />
      <div className="scene-orb scene-orb-a" />
      <div className="scene-orb scene-orb-b" />
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="relative z-[1] w-full flex items-center gap-3 px-3.5 py-2.5 text-left"
        aria-expanded={expanded}
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

      <div className={`relative z-[1] grid transition-[grid-template-rows,opacity] duration-300 ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-3.5">
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
      </div>

    </section>
  );
});
