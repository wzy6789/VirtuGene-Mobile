/**
 * 世界设定（5.0.0 Living World §32 / §33 / §101）
 *
 * 这一页**不做复杂表单**。顶部就是一句话输入框：
 *   "告诉我这个世界是什么样的……"
 * 用户说什么就是什么；每条设定是一张自然语言卡片，可以改、可以暂停、可以删。
 *
 * 解析（rule / location / character_fact …）走 Intent Interpreter（1 次调用）；
 * 模型不可用时退回本地关键词分类，因此**没有 Key 也能改设定**。
 * 冲突处理在 `lib/world/world-facts.ts`：新设定与旧设定矛盾时停用旧的那一条，
 * 因此永远不会同时存在两条互相冲突的 Canon。
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import type { WorldFact } from '../../db/index';
import { SpaceHeading } from '../ui/SpaceHeading';
import {
  editWorldSetting,
  groupSettings,
  guessFactCategory,
  listWorldSettings,
  removeWorldSetting,
  toggleWorldSetting,
  upsertWorldFactWithReconcile,
} from '../../lib/world/world-facts';
import { interpretWorldIntent } from '../../lib/world/world-intent';

export function WorldSettingsPage() {
  const userId = useAuthStore((s) => s.userId);
  const characters = useChatStore((s) => s.characters);
  const [facts, setFacts] = useState<WorldFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const reload = useCallback(async () => {
    if (!userId) return;
    const world = await worldRepo.ensureDefaultWorld(userId);
    setFacts(await listWorldSettings(world.id));
  }, [userId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!userId) { setLoading(false); return; }
      await useChatStore.getState().loadCharacters();
      await reload();
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [userId, reload]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !userId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const world = await worldRepo.ensureDefaultWorld(userId);
      const list = useChatStore.getState().characters;
      // 先请意图解析器判断这是什么设定（模型不可用时自动退回本地分类）
      const interpreted = await interpretWorldIntent({
        userId, worldId: world.id, text, characters: list,
        presence: [], place: '世界设定', timeLabel: '现在',
        worldRules: facts.filter((f) => f.category === 'rule' && f.active).map((f) => f.content).slice(0, 12),
        recent: [],
      });
      const action = interpreted.action;
      const category = action.factCategory ?? guessFactCategory(text);
      const written = await upsertWorldFactWithReconcile({
        userId,
        worldId: world.id,
        category,
        content: action.worldFact ?? text,
        visibility: category === 'rule' || category === 'location' ? 'world' : 'selected',
        ...(category === 'rule' || category === 'location' ? {} : { visibleTo: list.slice(0, 5).map((c) => c.id) }),
        sourceType: 'user',
        sourceId: `fact:${(action.worldFact ?? text).slice(0, 60)}`,
        ...(action.replacesFact ? { replaces: action.replacesFact } : {}),
      });
      setDraft('');
      setNotice(written.deactivated.length > 0 ? '这条设定替换掉了之前矛盾的那一条。' : '世界记住了。');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const grouped = groupSettings(facts);

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <div className="pt-5">
        <SpaceHeading
          eyebrow="living world"
          title="世界设定"
          detail="这些是这个世界的长期事实。"
          action={(
            <button
              type="button"
              onClick={() => useUIStore.getState().openCanvas(null)}
              className="text-[11px] text-gray-500"
            >
              在世界里说 ›
            </button>
          )}
        />
      </div>

      <section className="mt-3 rounded-2xl border border-gene-purple/25 bg-gene-purple/[0.05] px-3.5 py-3.5">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="告诉我这个世界是什么样的……"
          className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-gene-purple/50"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !draft.trim()}
            className="rounded-xl bg-gene-purple px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? '正在记下…' : '记下来'}
          </button>
          <span className="text-[10.5px] text-gray-500">也可以在世界里直接说，效果完全一样。</span>
        </div>
        {notice && <p className="mt-2 text-[11px] text-life-cyan">{notice}</p>}
      </section>

      {loading ? (
        <p className="mt-10 text-center text-sm text-gray-500">正在读取世界设定…</p>
      ) : grouped.length === 0 ? (
        <p className="mt-6 text-center text-xs leading-6 text-gray-500">
          还没有任何设定。<br />试着说：「这里永远停留在秋天。」
        </p>
      ) : (
        grouped.map((group) => (
          <section key={group.category} className="mt-5">
            <p className="text-[10px] tracking-[0.16em] uppercase text-gray-500">{group.label}</p>
            {group.items.map((fact) => (
              <div key={fact.id} className="vg-setting-card">
                {editingId === fact.id ? (
                  <>
                    <textarea
                      rows={2}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none"
                    />
                    <div className="vg-setting-actions">
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            await editWorldSetting(fact.id, editingText);
                            setEditingId(null);
                            await reload();
                          })();
                        }}
                      >
                        保存
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}>取消</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={fact.active ? '' : 'vg-setting-off'}>{fact.content}</p>
                    <div className="vg-setting-actions">
                      <button
                        type="button"
                        onClick={() => { setEditingId(fact.id); setEditingText(fact.content); }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => { void (async () => { await toggleWorldSetting(fact.id, !fact.active); await reload(); })(); }}
                      >
                        {fact.active ? '暂停' : '恢复'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void (async () => { await removeWorldSetting(fact.id); await reload(); })(); }}
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
