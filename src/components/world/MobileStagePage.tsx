import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type WorldScene, type WorldSceneEntry } from '../../db/index';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import { hasAiGatewayAccess } from '../../lib/ai/gateway';
import {
  deleteScene,
  finishSceneAndSettle,
  listScenes,
  loadScene,
  pauseScene,
  runSceneTurn,
  startScene,
} from '../../lib/world/scene-runtime';
import { SpaceHeading } from '../ui/SpaceHeading';
import { Avatar } from '../ui/Avatar';
import { actLabel } from '../../lib/world/scene-acts';
import { cleanConstellationTitle } from '../../lib/world/constellation-typography';
import { worldAiAvailability } from '../../lib/world/world-ai-client';

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
function stageRevealDelay(previous: WorldSceneEntry | undefined, next: WorldSceneEntry): number {
  if (!previous || (next.kind !== 'dialogue' && next.kind !== 'action')) return 0;
  if (previous.speakerId && next.speakerId && previous.speakerId !== next.speakerId) return 260;
  return 90;
}

/**
 * 世界剧场（World Stage，Phase 3）
 *
 * 成本纪律（§56/§57）写进 UI：
 * - 打开 / 离开 / 暂停：不花钱
 * - 每个用户动作：先用 1 次调用（一次出多条），无效回复才切换备用模型
 * - 结束这场戏：正常 1 次结算调用，把后果真正写回世界层
 */
const STATUS_LABEL: Record<WorldScene['status'], string> = {
  draft: '还没开始',
  active: '正在进行',
  paused: '先搁着',
  finished: '已经结束',
};

export function MobileStagePage() {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const username = useAuthStore((s) => s.username) ?? undefined;
  const apiKey = useAuthStore((s) => s.apiKey) ?? '';
  const [providerAiAvailable, setProviderAiAvailable] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const turnInFlight = useRef(false);
  const hasAi = Boolean(apiKey) || hasAiGatewayAccess() || providerAiAvailable;
  const characters = useChatStore((s) => s.characters);

  // DeepSeek Key 在登录态里，千问/MiMo Key 在设备加密存储里；不能只看前者，
  // 否则用户切到其它模型后发送按钮会被错误地禁用。
  useEffect(() => {
    let alive = true;
    void worldAiAvailability().then((availability) => {
      if (alive) setProviderAiAvailable(availability.status !== 'UNAVAILABLE');
    }).catch(() => {
      if (alive) setProviderAiAvailable(false);
    });
    return () => { alive = false; };
  }, [apiKey]);

  const [worldId, setWorldId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  /** 打开的那场戏 */
  const [openScene, setOpenScene] = useState<WorldScene | null>(null);
  const [entries, setEntries] = useState<WorldSceneEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 新开一场戏的表单 */
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', place: '', timeLabel: '傍晚', mood: '安静', goal: '', picked: [] as string[], entryMemoryMode: 'memory' as 'memory' | 'present' });

  const myCharacters = useMemo(() => characters.filter((c) => c.createdBy === userId), [characters, userId]);
  const nameOf = useCallback((id: string) => characters.find((c) => c.id === id)?.name ?? '某人', [characters]);
  const occupiedByScene = useMemo(() => {
    const map = new Map<string, WorldScene>();
    for (const scene of scenes) {
      if (scene.status !== 'active' && scene.status !== 'paused') continue;
      for (const characterId of scene.characterIds) map.set(characterId, scene);
    }
    return map;
  }, [scenes]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!userId) { setLoading(false); return; }
      setLoading(true);
      setLoadError(false);
      try {
        const world = await worldRepo.ensureDefaultWorld(userId, username);
        const rows = await listScenes(world.id, undefined, userId);
        if (!alive) return;
        setWorldId(world.id);
        setScenes(rows);
      } catch {
        if (alive) { setScenes([]); setLoadError(true); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    if (characters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; };
  }, [userId, username, characters.length, reloadToken]);

  const openTheScene = async (sceneId: string) => {
    setError(null);
    setNotice(null);
    const { scene, entries: rows } = await loadScene(sceneId, userId);
    if (!scene) { setError('这场戏已经不在了'); return; }
    setOpenScene(scene);
    setEntries(rows);
  };

  const createAndOpen = async () => {
    if (!worldId) return;
    if (form.picked.length === 0) { setError('至少选一个角色一起上场'); return; }
    const conflicts = form.picked
      .map((characterId) => ({ characterId, scene: occupiedByScene.get(characterId) }))
      .filter((item): item is { characterId: string; scene: WorldScene } => Boolean(item.scene));
    if (conflicts.length > 0) {
      setError(`${conflicts.map((item) => nameOf(item.characterId)).join('、')} 正在另一段剧情中，请先结束并保存那段经历。`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 空标题直接使用地点（或“此刻”），不要替用户拼接生硬的“的那场戏”。
      const requestedTitle = form.title.trim() || form.place.trim() || '此刻';
      const sceneId = await startScene({
        userId,
        worldId,
        title: requestedTitle.slice(0, 5),
        place: form.place.trim() || '未命名的地方',
        timeLabel: form.timeLabel,
        mood: form.mood,
        characterIds: form.picked,
        participants: form.picked.map((characterId) => ({
          characterId,
          goals: [],
          knowsEventIds: [],
          secrets: [],
          entryMemoryMode: form.entryMemoryMode,
        })),
        ...(form.goal.trim() ? { sceneGoal: form.goal.trim() } : {}),
      });
      setCreating(false);
      setForm({ title: '', place: '', timeLabel: '傍晚', mood: '安静', goal: '', picked: [], entryMemoryMode: 'memory' });
      setReloadToken((n) => n + 1);
      await openTheScene(sceneId);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'scene:character_occupied'
        ? '有人还在另一段剧情里，请先结束并保存那段经历。'
        : '没能开始这场戏，请再试一次');
    } finally {
      setBusy(false);
    }
  };

  /** 结束旧剧情并保存经历，角色随后才能进入另一段剧情。 */
  const finishAndRelease = async (scene: WorldScene) => {
    if (scene.status === 'finished' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await finishSceneAndSettle({ userId, sceneId: scene.id, apiKey });
      if (result.error) {
        setError(result.error);
      } else {
        setNotice(`《${scene.title}》已保存，角色可以进入新的剧情了。`);
        setReloadToken((n) => n + 1);
      }
    } catch {
      setError('这段经历暂时没能保存，请稍后再试。');
    } finally {
      setBusy(false);
    }
  };

  /** 推演一轮：优先 1 次调用；无效回复时由备用模型接续。 */
  const takeTurn = async (action?: string, chosenFromEntryId?: string) => {
    if (!openScene || busy || turnInFlight.current) return;
    const normalizedAction = action?.trim().slice(0, 600) || '';
    turnInFlight.current = true;
    if (normalizedAction) setPendingAction(normalizedAction);
    const knownIds = new Set(entries.map((entry) => entry.id));
    setBusy(true);
    setError(null);
    try {
      const result = await runSceneTurn({
        userId,
        sceneId: openScene.id,
        ...(normalizedAction ? { userAction: normalizedAction } : {}),
        ...(chosenFromEntryId ? { chosenFromEntryId } : {}),
        apiKey,
      });
      const { scene, entries: rows } = await loadScene(openScene.id, userId);
      if (scene) setOpenScene(scene);
      const fresh = rows.filter((entry) => !knownIds.has(entry.id));
      const existing = rows.filter((entry) => knownIds.has(entry.id));
      setPendingAction(null);
      setEntries(existing);
      let previous = existing[existing.length - 1];
      for (const entry of fresh) {
        await wait(stageRevealDelay(previous, entry));
        setEntries((current) => (current.some((item) => item.id === entry.id) ? current : [...current, entry]));
        previous = entry;
      }
      if (result.error) setError(result.error);
      if (normalizedAction) setDraft('');
    } catch {
      setPendingAction(null);
      setError('这一轮没能接上，请再试一次');
    } finally {
      turnInFlight.current = false;
      setBusy(false);
    }
  };

  /** 结束并结算：优先 1 次调用，后果真正写回世界层 */
  const finish = async () => {
    if (!openScene || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await finishSceneAndSettle({ userId, sceneId: openScene.id, apiKey });
      if (result.error) {
        setError(result.error);
      } else {
        const parts: string[] = ['这场戏已经记进你们的世界'];
        if (result.memoryId) parts.push('留下了一段共同记忆');
        if (result.relationshipEvents > 0) parts.push(`${result.relationshipEvents} 处关系变化`);
        if (result.unresolvedThreads > 0) parts.push(`${result.unresolvedThreads} 件未完成的事`);
        setNotice(parts.join(' · '));
      }
      const { scene, entries: rows } = await loadScene(openScene.id, userId);
      if (scene) setOpenScene(scene);
      setEntries(rows);
      setReloadToken((n) => n + 1);
    } catch {
      setError('结算没能完成，请再试一次');
    } finally {
      setBusy(false);
    }
  };

  /** 先离开（暂停）：**0 次调用** */
  const leave = async () => {
    if (!openScene) return;
    await pauseScene(openScene.id, userId);
    setOpenScene(null);
    setEntries([]);
    setError(null);
    setReloadToken((n) => n + 1);
  };

  /** 明确离开剧场，回到世界入口；进行中的场景会保留为暂停状态。 */
  const exitTheater = async () => {
    if (openScene?.status === 'active') await pauseScene(openScene.id, userId);
    setOpenScene(null);
    setEntries([]);
    setError(null);
    setReloadToken((n) => n + 1);
    useUIStore.getState().setActiveView('chat');
    useUIStore.getState().setMobileTab('world');
  };

  const removeScene = async (sceneId: string) => {
    await deleteScene(sceneId, userId);
    setReloadToken((n) => n + 1);
  };

  /* ------------------------------ 舞台上（正在演一场戏） ------------------------------ */
  if (openScene) {
    const finished = openScene.status === 'finished';
    return (
      <div className="vg-stage-active flex h-full flex-col">
        <div className="vg-stage-active-header shrink-0 px-4 pt-3">
          <div className="vg-stage-active-title">
            <div className="min-w-0">
              <p className="vg-story-title-text truncate text-ink">{cleanConstellationTitle(openScene.title)}</p>
              <p className="mt-0.5 truncate text-[11px] text-gray-500">{openScene.place} · {openScene.timeLabel} · {openScene.mood}</p>
            </div>
            <button type="button" onClick={() => void exitTheater()} className="vg-stage-exit">退出</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="vg-stage-status rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-gray-500">
              {STATUS_LABEL[openScene.status]}
            </span>
            <span className="rounded-full border border-gene-purple/30 bg-gene-purple/10 px-2 py-0.5 text-[10px] text-gene-purple">
              {actLabel(openScene.state.currentAct)}
            </span>
            {openScene.characterIds.map((id) => (
              <span key={id} className="text-[10px] text-gray-500">{nameOf(id)}</span>
            ))}
            <div className="flex-1" />
          </div>
        </div>

        <div className="vg-stage-transcript min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {entries.length === 0 && (
            <p className="py-10 text-center text-xs text-gray-500">让他们先开口，故事会自己找到方向。</p>
          )}
          <ul className="space-y-3">
            {pendingAction && (
              <li className="vg-stage-pending flex justify-end" aria-live="polite">
                <p className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-br from-gene-purple/80 to-[#5B4BD4]/80 px-4 py-2.5 text-sm text-white">
                  {pendingAction}
                  <span className="ml-2 text-[10px] text-white/60">正在回应…</span>
                </p>
              </li>
            )}
            {entries.map((entry) => {
              if (entry.kind === 'system') {
                // 幕次标记单独强调（用户能看见"翻幕了"）
                const isAct = entry.content.startsWith('——');
                return (
                  <li key={entry.id} className="py-1 text-center">
                    <span className={isAct ? 'text-[11px] tracking-[0.22em] text-gene-purple' : 'text-[10px] text-gray-500'}>
                      {entry.content}
                    </span>
                  </li>
                );
              }
              if (entry.kind === 'user_input') {
                return (
                  <li key={entry.id} className="flex justify-end">
                    <p className="max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-br from-gene-purple to-[#5B4BD4] px-4 py-2.5 text-sm text-white">
                      {entry.content}
                    </p>
                  </li>
                );
              }
              if (entry.kind === 'choice') {
                const options = entry.meta?.options ?? [];
                const chosen = typeof entry.meta?.chosen === 'string' ? entry.meta.chosen : '';
                /**
                 * 已经选过的选择：只留一行"你选了…"。
                 * 注意必须**先判断 chosen**：选项文本仍留在 meta.options 里（用于回看当时有哪些岔路），
                 * 如果先看 options 就会把已经做过的选择继续显示成可点按钮（验收 C② 抓到的真实缺陷）。
                 */
                if (chosen) {
                  return (
                    <li key={entry.id} className="flex justify-end">
                      <p className="max-w-[80%] rounded-2xl rounded-br-md border border-gene-purple/30 bg-gene-purple/10 px-4 py-2.5 text-sm text-ink">
                        {chosen}
                      </p>
                    </li>
                  );
                }
                return (
                  <li key={entry.id} className="rounded-2xl border border-gene-purple/25 bg-gene-purple/[0.05] px-4 py-3">
                    <p className="text-[13px] leading-6 text-ink">{entry.content}</p>
                    {options.length > 0 && (
                      <div className="mt-2.5 space-y-1.5">
                        {options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            disabled={busy || finished}
                            onClick={() => void takeTurn(option, entry.id)}
                            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-[13px] text-sub transition-colors hover:border-gene-purple/40 disabled:opacity-50"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              }
              if (entry.kind === 'action') {
                return (
                  <li key={entry.id} className="px-1">
                    <p className="vg-stage-action">{entry.content}</p>
                  </li>
                );
              }
              if (entry.kind === 'narration') {
                return (
                  <li key={entry.id} className="px-1">
                    <p className="vg-stage-narration">{entry.content}</p>
                  </li>
                );
              }
              const speaker = entry.speakerId ? characters.find((c) => c.id === entry.speakerId) : undefined;
              return (
                <li key={entry.id} className="flex items-start gap-2">
                  <Avatar avatar={speaker?.avatar ?? '🌙'} size="sm" className="ring-1 ring-life-cyan/30" />
                  <div className="min-w-0">
                    <p className="mb-1 text-[10px] tracking-[0.08em] text-gray-500">{speaker?.name ?? '有人'}</p>
                    <p className="rounded-2xl rounded-bl-md border-l-2 border-life-cyan bg-msgai px-4 py-2.5 text-sm leading-relaxed text-msgaitxt">
                      {entry.content}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {notice && (
            <p className="mt-4 rounded-2xl border border-life-cyan/30 bg-life-cyan/[0.06] px-4 py-3 text-[11px] leading-5 text-life-cyan">
              {notice}
            </p>
          )}
          {error && (
            <p className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-[11px] leading-5 text-amber-500">
              {error}
            </p>
          )}
        </div>

        {!finished && (
          <div className="vg-stage-composer shrink-0 border-t border-line px-4 py-3">
            {entries.length === 0 && (
              <button
                type="button"
                disabled={busy || !hasAi}
                onClick={() => void takeTurn()}
                className="mb-2 w-full rounded-xl bg-gene-purple px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? '正在发生…' : '让他们先开口'}
              </button>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // 与聊天输入一致的约定：Enter 继续，Shift+Enter 换行（中文输入法组合键不触发）
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (draft.trim().length > 0 && !busy) void takeTurn(draft.trim());
                  }
                }}
                rows={2}
                placeholder={hasAi ? '写下你的行动…' : '写下你的行动（会先保存）…'}
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple/50"
              />
              <button
                type="button"
                disabled={busy || draft.trim().length === 0}
                onClick={() => void takeTurn(draft.trim())}
                className="rounded-xl bg-gene-purple px-3.5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? '…' : '继续'}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => void leave()} className="text-[11px] text-gray-400 hover:text-ink">
                离开
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={busy || !hasAi || entries.length === 0}
                onClick={() => void finish()}
                className="text-[11px] text-life-cyan disabled:opacity-40"
              >
                结束
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ------------------------------ 剧场（场景列表） ------------------------------ */
  return (
    <div className="vg-stage-room h-full overflow-y-auto px-4 pb-6">
      <div className="pt-5">
        <SpaceHeading eyebrow="world stage" title="世界剧场" detail="和他们一起演一场戏，结束后它会真的留在你们的世界里。" />
      </div>
      <button
        type="button"
        onClick={() => useUIStore.getState().setActiveView('chat')}
        className="mt-3 text-xs text-gray-400 transition-colors hover:text-ink"
      >
        ‹ 返回世界
      </button>

      {loading ? (
        <div className="mt-10 text-center text-sm text-gray-500" role="status">正在读取剧场…</div>
      ) : loadError ? (
        <section className="mt-5 rounded-[26px] border border-rose-400/25 bg-rose-500/[0.06] px-5 py-7 text-center">
          <h2 className="text-base font-semibold text-ink">剧场读取失败</h2>
          <p className="mt-2 text-xs leading-6 text-gray-500">没能从本机读到场景记录。你的数据仍保存在这台设备上。</p>
          <button
            type="button"
            onClick={() => setReloadToken((n) => n + 1)}
            className="mt-5 w-full rounded-xl border border-line px-4 py-2.5 text-sm text-sub active:scale-[.99]"
          >
            重新读取
          </button>
        </section>
      ) : (
        <>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={myCharacters.length === 0}
              className="mt-4 w-full rounded-xl bg-gene-purple px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              ＋ 开一场戏
            </button>
          )}

          {creating && (
            <section className="vg-stage-create mt-4 rounded-[22px] border border-line bg-surface/70 px-4 py-4">
              <div className="vg-stage-create-head">
                <span className="vg-stage-create-code">SCENE INITIALIZER</span>
                <p className="vg-stage-create-title">开启一段剧情</p>
                <p className="vg-stage-create-subtitle">让一个地点、一束记忆，先成为世界的入口。</p>
              </div>
              <p className="vg-stage-create-question text-xs font-medium text-ink">这场戏发生在哪里？</p>
              {myCharacters.length === 0 ? (
                <p className="mt-2 text-[11px] text-gray-500">先去「角色」里认识一个角色，才有戏可演。</p>
              ) : (
                <>
                  <input
                    value={form.place}
                    onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
                    placeholder="地方（例如：凌晨的便利店）"
                    className="mt-2 w-full rounded-xl border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple/50"
                  />
                  <input
                    value={form.title}
                    maxLength={5}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value.slice(0, 5) }))}
                    placeholder="主题名（最多5个字，可留空）"
                    className="mt-2 w-full rounded-xl border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple/50"
                  />
                  <p className="mt-1 text-right text-xs text-gray-500">{form.title.length}/5</p>
                  <input
                    value={form.goal}
                    onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
                    placeholder="你想在这一场里做什么（可留空）"
                    className="mt-2 w-full rounded-xl border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple/50"
                  />
                  <p className="mt-3 text-[10px] text-gray-500">谁上场（可多选）</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {myCharacters.map((c) => {
                      const on = form.picked.includes(c.id);
                      const occupied = occupiedByScene.get(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={Boolean(occupied) && !on}
                          onClick={() => setForm((f) => ({ ...f, picked: on ? f.picked.filter((id) => id !== c.id) : [...f.picked, c.id] }))}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                            on ? 'border-gene-purple/50 bg-gene-purple/12 text-gene-purple' : occupied ? 'border-line bg-surface/40 text-gray-600 opacity-60' : 'border-line bg-surface text-gray-500'
                          }`}
                          title={occupied ? `正在《${occupied.title}》中，请先结束并保存那段剧情` : undefined}
                        >
                          {c.avatar.startsWith('data:') ? '🙂' : c.avatar} {c.name}{occupied ? ' · 剧情中' : ''}
                        </button>
                      );
                    })}
                  </div>
                  {Array.from(occupiedByScene.values()).some((scene) => scene.status !== 'finished') && (
                    <p className="mt-2 text-[10px] leading-5 text-gray-500">角色一次只能属于一段未结束的剧情。离开后会暂停并留在星图中；结束并保存经历后，才能加入新的剧情。</p>
                  )}
                  <div className="vg-entry-memory mt-4">
                    <p className="text-[10px] text-gray-500">角色进入时带着什么</p>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, entryMemoryMode: 'memory' }))}
                        className={`rounded-xl border px-3 py-2 text-[11px] transition-colors ${form.entryMemoryMode === 'memory' ? 'border-gene-purple/50 bg-gene-purple/12 text-gene-purple' : 'border-line bg-surface text-gray-500'}`}
                      >
                        带上与你的记忆
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, entryMemoryMode: 'present' }))}
                        className={`rounded-xl border px-3 py-2 text-[11px] transition-colors ${form.entryMemoryMode === 'present' ? 'border-gene-purple/50 bg-gene-purple/12 text-gene-purple' : 'border-line bg-surface text-gray-500'}`}
                      >
                        只带此刻状态
                      </button>
                    </div>
                  </div>
                  {error && <p className="mt-2 text-[11px] text-amber-500">{error}</p>}
                  <div className="mt-3 flex items-center gap-3">
                    <button type="button" onClick={() => { setCreating(false); setError(null); }} className="text-[11px] text-gray-400">
                      取消
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      disabled={busy || form.picked.length === 0}
                      onClick={() => void createAndOpen()}
                      className="rounded-xl bg-gene-purple px-3.5 py-2 text-xs font-medium text-white disabled:opacity-40"
                    >
                      开始
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {scenes.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-line bg-surface/60 px-4 py-6 text-center text-xs leading-6 text-gray-500">
              还没有演过任何一场戏。<br />
              世界舞台是"你们一起经历故事"的地方——开一场，故事就会真的发生。
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {scenes.map((scene) => (
                <li key={scene.id} className="rounded-[22px] border border-line bg-surface/70 px-4 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="vg-story-title-text truncate">{cleanConstellationTitle(scene.title)}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {scene.place} · {scene.timeLabel} · {scene.characterIds.map(nameOf).join('、')}
                      </p>
                    </div>
                    <span className="vg-stage-status shrink-0 rounded-full border border-line bg-app px-2 py-0.5 text-[10px] text-gray-500">
                      {STATUS_LABEL[scene.status]}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void openTheScene(scene.id)}
                      className="text-[11px] text-life-cyan"
                    >
                      {scene.status === 'finished' ? '回看' : '继续这场戏'}
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => void removeScene(scene.id)}
                      className="text-[11px] text-gray-500 hover:text-rose-400"
                    >
                      删除
                    </button>
                    {scene.status !== 'finished' && scene.status !== 'draft' && (
                      <button
                        type="button"
                        disabled={busy || !hasAi}
                        onClick={() => void finishAndRelease(scene)}
                        className="text-[11px] text-gene-purple disabled:opacity-40"
                      >
                        结束并保存
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
