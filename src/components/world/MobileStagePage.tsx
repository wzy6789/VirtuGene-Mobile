import { useEffect, useMemo, useState } from 'react';
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
  startScene,
} from '../../lib/world/scene-runtime';
import { SpaceHeading } from '../ui/SpaceHeading';
import { Avatar } from '../ui/Avatar';
import { cleanConstellationTitle } from '../../lib/world/constellation-typography';
import { worldAiAvailability } from '../../lib/world/world-ai-client';

/**
 * 星域资料管理页（世界列表 / 建立新世界 / 回看）。
 *
 * 5.2 起这里**不再**是第二条发言路径：所有世界的继续与发言都进统一的世界播放器
 * （WorldCanvas + runWorldTurn）。本页保留的是历史资料管理能力：
 * 创建世界、回看正文、结束世界并结算、删除世界。
 */
const STATUS_LABEL: Record<WorldScene['status'], string> = {
  draft: '还没开始',
  active: '正在进行',
  paused: '先搁着',
  finished: '已结束',
};

function humanStageError(message?: string): string {
  const text = message?.trim() ?? '';
  if (!text) return '这一次还没接上，请再试一次。';
  if (/auth:|invalid_key|api.?key|鉴权|权限/i.test(text)) return '当前模型暂时不可用，请检查 AI 设置后再试。';
  if (/timeout|timed out|超时|network|fetch|连接|网络/i.test(text)) return '回应来得有点慢，网络恢复后再试一次。';
  return '这一次还没接上，请再试一次。';
}

export function MobileStagePage() {
  const userId = useAuthStore((s) => s.userId) ?? '';
  const username = useAuthStore((s) => s.username) ?? undefined;
  const apiKey = useAuthStore((s) => s.apiKey) ?? '';
  const [providerAiAvailable, setProviderAiAvailable] = useState(false);
  const hasAi = Boolean(apiKey) || hasAiGatewayAccess() || providerAiAvailable;
  const characters = useChatStore((s) => s.characters);

  // DeepSeek Key 在登录态里，千问/MiMo Key 在设备加密存储里；不能只看前者，
  // 否则用户切到其它模型后按钮会被错误地禁用。
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

  /** 当前打开回看的世界（只读；继续/发言去统一的世界播放器） */
  const [openScene, setOpenScene] = useState<WorldScene | null>(null);
  const [entries, setEntries] = useState<WorldSceneEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 建立新世界的表单 */
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', place: '', timeLabel: '傍晚', mood: '安静', goal: '', picked: [] as string[], entryMemoryMode: 'memory' as 'memory' | 'present' | 'amnesiac' });

  /** 从星图「新的世界」进来时直接展开创建表单 */
  const createIntent = useUIStore((s) => s.worldCreateIntent);
  const setCreateIntent = useUIStore((s) => s.setWorldCreateIntent);

  const myCharacters = useMemo(() => characters.filter((c) => c.createdBy === userId), [characters, userId]);
  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? '某人';
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
        if (createIntent) setCreating(true);
      } catch {
        if (alive) { setScenes([]); setLoadError(true); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    if (characters.length === 0) void useChatStore.getState().loadCharacters();
    return () => { alive = false; };
    // createIntent 只在进入页面时消费一次，不作为持续依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, username, characters.length, reloadToken]);

  useEffect(() => () => setCreateIntent(false), [setCreateIntent]);

  const openTheScene = async (sceneId: string) => {
    setError(null);
    setNotice(null);
    try {
      const { scene, entries: rows } = await loadScene(sceneId, userId);
      if (!scene) { setError('这个世界已经不在了'); return; }
      setOpenScene(scene);
      setEntries(rows);
    } catch {
      setError('没能打开这个世界，请再试一次');
    }
  };

  /** 进入统一的世界播放器：新建、继续、回看都走同一条路径 */
  const continueInCanvas = (sceneId: string) => {
    useUIStore.getState().openCanvas(sceneId);
  };

  const createAndOpen = async () => {
    if (!worldId) return;
    if (form.picked.length === 0) { setError('至少选一位同行者'); return; }
    const conflicts = form.picked
      .map((characterId) => ({ characterId, scene: occupiedByScene.get(characterId) }))
      .filter((item): item is { characterId: string; scene: WorldScene } => Boolean(item.scene));
    if (conflicts.length > 0) {
      setError(`${conflicts.map((item) => nameOf(item.characterId)).join('、')} 正在另一个世界中，请先结束并保存那段经历。`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 空标题直接使用地点（或“此刻”），不要替用户拼接生硬的标题。
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
      // 创建成功后直接进入统一播放器（§5.2 单一可交互播放器）
      continueInCanvas(sceneId);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'scene:character_occupied'
        ? '有人还在另一个世界中，请先结束并保存那段经历。'
        : '没能进入这个世界，请再试一次');
    } finally {
      setBusy(false);
    }
  };

  /** 结束旧世界并结算（幂等：finished 的世界不会重复结算） */
  const finishAndRelease = async (scene: WorldScene) => {
    if (scene.status === 'finished' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await finishSceneAndSettle({ userId, sceneId: scene.id, apiKey });
      if (result.error) {
        setError(humanStageError(result.error));
      } else {
        setNotice(`《${scene.title}》已结束，经历已经写入世界。`);
        setReloadToken((n) => n + 1);
      }
    } catch {
      setError('这段经历暂时没能保存，请稍后再试。');
    } finally {
      setBusy(false);
    }
  };

  /** 明确离开，回到世界首页 */
  const exitPage = () => {
    setOpenScene(null);
    setEntries([]);
    setError(null);
    useUIStore.getState().setActiveView('chat');
    useUIStore.getState().setMobileTab('world');
  };

  const removeScene = async (sceneId: string) => {
    await deleteScene(sceneId, userId);
    setReloadToken((n) => n + 1);
  };

  /* ------------------------------ 世界正文回看（只读） ------------------------------ */
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
            <button type="button" onClick={() => { setOpenScene(null); setEntries([]); setError(null); }} className="vg-stage-exit">返回</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="vg-stage-status rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-gray-500">
              {STATUS_LABEL[openScene.status]}
            </span>
            {openScene.characterIds.map((id) => (
              <span key={id} className="text-[10px] text-gray-500">{nameOf(id)}</span>
            ))}
            <div className="flex-1" />
          </div>
        </div>

        <div className="vg-stage-transcript min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {entries.length === 0 && (
            <p className="py-10 text-center text-xs text-gray-500">这里还没有发生过的痕迹。</p>
          )}
          <ul className="space-y-3">
            {entries.map((entry) => {
              if (entry.kind === 'system') {
                // 旧版本写入的“第一幕/第二幕”等标记只在数据里保留，不当作正文展示。
                if (entry.content.startsWith('——')) return null;
                return (
                  <li key={entry.id} className="py-1 text-center">
                    <span className="text-[10px] text-gray-500">
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
                const chosen = typeof entry.meta?.chosen === 'string' ? entry.meta.chosen : entry.content;
                return (
                  <li key={entry.id} className="flex justify-end">
                    <p className="max-w-[80%] rounded-2xl rounded-br-md border border-gene-purple/30 bg-gene-purple/10 px-4 py-2.5 text-sm text-ink">
                      {chosen}
                    </p>
                  </li>
                );
              }
              if (entry.kind === 'suggestion') return null;
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

        <div className="vg-stage-composer shrink-0 border-t border-line px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => continueInCanvas(openScene.id)}
            className="w-full rounded-xl bg-gene-purple px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {finished ? '在世界播放器中回看' : '继续这个世界'}
          </button>
          {!finished && (
            <p className="mt-2 text-center text-[10px] text-gray-400">继续与发言都在统一的世界播放器里进行。</p>
          )}
        </div>
      </div>
    );
  }

  /* ------------------------------ 星域（世界列表 / 建立新世界） ------------------------------ */
  return (
    <div className="vg-stage-room h-full overflow-y-auto px-4 pb-6">
      <div className="pt-5">
        <SpaceHeading eyebrow="world constellation" title="星域" detail="让一个世界在这里继续生长。" />
      </div>
      <button
        type="button"
        onClick={() => useUIStore.getState().setActiveView('chat')}
        className="mt-3 text-xs text-gray-400 transition-colors hover:text-ink"
      >
        ‹ 返回世界
      </button>

      {loading ? (
        <div className="mt-10 text-center text-sm text-gray-500" role="status">正在读取星域…</div>
      ) : loadError ? (
        <section className="mt-5 rounded-[26px] border border-rose-400/25 bg-rose-500/[0.06] px-5 py-7 text-center">
          <h2 className="text-base font-semibold text-ink">星域读取失败</h2>
          <p className="mt-2 text-xs leading-6 text-gray-500">没能从本机读到世界记录。你的数据仍保存在这台设备上。</p>
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
              ＋ 新的世界
            </button>
          )}

          {creating && (
            <section className="vg-stage-create mt-4 rounded-[22px] border border-line bg-surface/70 px-4 py-4">
              <div className="vg-stage-create-head">
                <span className="vg-stage-create-code">WORLD INITIALIZER</span>
                <p className="vg-stage-create-title">建立一个新的世界</p>
                <p className="vg-stage-create-subtitle">从一个地点和一束记忆开始，让它成为你们共同的去处。</p>
              </div>
              <p className="vg-stage-create-question text-xs font-medium text-ink">从哪里开始？</p>
              {myCharacters.length === 0 ? (
                <p className="mt-2 text-[11px] text-gray-500">先去「角色」里认识一位角色，才能一起进入世界。</p>
              ) : (
                <>
                  <input
                    value={form.place}
                    onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
                    placeholder="起始地点（例如：凌晨的便利店）"
                    className="mt-2 w-full rounded-xl border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple/50"
                  />
                  <input
                    value={form.title}
                    maxLength={5}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value.slice(0, 5) }))}
                    placeholder="世界名称（最多5个字，可留空）"
                    className="mt-2 w-full rounded-xl border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple/50"
                  />
                  <p className="mt-1 text-right text-xs text-gray-500">{form.title.length}/5</p>
                  <input
                    value={form.goal}
                    onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
                    placeholder="你想怎样开始？（可留空）"
                    className="mt-2 w-full rounded-xl border border-line bg-app px-3 py-2 text-sm text-ink outline-none focus:border-gene-purple/50"
                  />
                  <p className="mt-3 text-[10px] text-gray-500">和谁一起？（可多选）</p>
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
                          title={occupied ? `正在《${occupied.title}》中，请先结束并保存那段经历` : undefined}
                        >
                          {c.avatar.startsWith('data:') ? '🙂' : c.avatar} {c.name}{occupied ? ' · 世界中' : ''}
                        </button>
                      );
                    })}
                  </div>
                  {Array.from(occupiedByScene.values()).some((scene) => scene.status !== 'finished') && (
                    <p className="mt-2 text-[10px] leading-5 text-gray-500">角色一次只能属于一个未结束的世界。暂时离开会暂停并留在星域；结束并保存经历后，才能进入新的世界。</p>
                  )}
                  <div className="vg-entry-memory mt-4">
                    <p className="text-[10px] text-gray-500">进入世界时带着什么</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, entryMemoryMode: 'memory' }))}
                        className={`rounded-xl border px-2 py-2 text-[11px] transition-colors ${form.entryMemoryMode === 'memory' ? 'border-gene-purple/50 bg-gene-purple/12 text-gene-purple' : 'border-line bg-surface text-gray-500'}`}
                      >
                        带上与你的记忆
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, entryMemoryMode: 'present' }))}
                        className={`rounded-xl border px-2 py-2 text-[11px] transition-colors ${form.entryMemoryMode === 'present' ? 'border-gene-purple/50 bg-gene-purple/12 text-gene-purple' : 'border-line bg-surface text-gray-500'}`}
                      >
                        从此刻开始参与
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, entryMemoryMode: 'amnesiac' }))}
                        className={`rounded-xl border px-2 py-2 text-[11px] transition-colors ${form.entryMemoryMode === 'amnesiac' ? 'border-amber-400/50 bg-amber-400/10 text-amber-500' : 'border-line bg-surface text-gray-500'}`}
                      >
                        失忆设定
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10px] leading-5 text-gray-500">
                      「从此刻开始参与」不继承这场戏入场前的正文，但仍保有自己的私聊、群聊与过往经历。
                      「失忆设定」是明确的特殊玩法：连他自己的过往记忆也不带入。
                    </p>
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
                      进入世界
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {scenes.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-line bg-surface/60 px-4 py-6 text-center text-xs leading-6 text-gray-500">
              这里还没有新的世界。<br />
              从一个地方、几位熟悉的人开始，经历会在这里留下痕迹。
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
                      className="text-[11px] text-gray-500"
                    >
                      回看
                    </button>
                    <button
                      type="button"
                      onClick={() => continueInCanvas(scene.id)}
                      className="text-[11px] text-life-cyan"
                    >
                      {scene.status === 'finished' ? '在世界播放器中回看' : '继续'}
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
