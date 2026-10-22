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
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { useFeedback } from '../../lib/feedback';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { worldRepo } from '../../db/world-repo';
import type { WorldFact } from '../../db/index';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { FeedbackNotice } from '../ui/FeedbackNotice';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
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
  // Do not retain another account's cards or unfinished editors for even one render.
  return <WorldSettingsContent key={userId ?? 'signed-out'} userId={userId} />;
}

function WorldSettingsContent({ userId }: { userId: string | null }) {
  const [facts, setFacts] = useState<WorldFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ id?: string; action: string } | null>(null);
  const feedback = useFeedback();
  const mounted = useRef(true), readVersion = useRef(0), mutation = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const draftId=useId();
  const current = useCallback(() => mounted.current && !!userId && useAuthStore.getState().userId === userId, [userId]);
  const restoreFocus = (id?: string, action = 'edit') => setFocusTarget({id,action});
  useEffect(() => {
    if (!focusTarget || busy || loading) return;
    // Wait for the committed DOM, not merely for the async write to resolve.
    const frame = requestAnimationFrame(() => {
      if (!current()) return;
      const target = focusTarget.id ? document.querySelector<HTMLButtonElement>(`[data-world-fact="${CSS.escape(focusTarget.id)}"] [data-world-action="${focusTarget.action}"]`) : null;
      (target && !target.disabled ? target : heading.current)?.focus({preventScroll:true});
      setFocusTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusTarget,busy,loading,current]);

  const reload = useCallback(async (withCharacters = false) => {
    if (!current() || !userId) return;
    const version = ++readVersion.current;
    setLoading(true); setLoadError(false);
    try {
      if (withCharacters) await useChatStore.getState().loadCharacters();
      if (!current()) return;
      const world = await worldRepo.ensureDefaultWorld(userId);
      if (!current()) return;
      const rows = await listWorldSettings(world.id, userId);
      if (current() && version === readVersion.current) setFacts(rows);
    } catch {
      if (current() && version === readVersion.current) setLoadError(true);
    } finally {
      if (current() && version === readVersion.current) setLoading(false);
    }
  }, [userId, current]);

  useEffect(() => {
    mounted.current = true;
    if (userId) void reload(true); else setLoading(false);
    return () => { mounted.current = false; ++readVersion.current; };
  }, [userId, reload]);

  // The ref closes the same-frame double-submit window; state only paints feedback.
  const runMutation = async (write: () => Promise<void>, failure: string, success: () => void, deleting = false, focusAfter?: () => void) => {
    if (!current() || mutation.current || loading || loadError) return;
    mutation.current = true; setBusy(true); setNotice(null); setDeleteError(false);
    let committed = false;
    try {
      await write();
      if (!current()) return;
      success();
      committed = true;
      await reload(); // Refresh errors are reported separately from an already committed write.
    } catch {
      if (current()) {
        if (deleting) setDeleteError(true);
        else setNotice({ message: failure, tone: 'error' });
      }
    } finally {
      mutation.current = false;
      if (current()) {
        setBusy(false);
        if (committed) focusAfter?.();
      }
    }
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !userId) return;
    let replaced = false;
    await runMutation(async () => {
      const world = await worldRepo.ensureDefaultWorld(userId);
      if (!current()) return;
      const list = useChatStore.getState().characters;
      // 先请意图解析器判断这是什么设定（模型不可用时自动退回本地分类）
      const interpreted = await interpretWorldIntent({
        userId, worldId: world.id, text, characters: list,
        presence: [], place: '世界设定', timeLabel: '现在',
        worldRules: facts.filter((f) => f.category === 'rule' && f.active).map((f) => f.content).slice(0, 12),
        recent: [],
      });
      if (!current()) return;
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
      replaced = written.deactivated.length > 0;
    }, '未能保存设定，你写的内容已保留，请重试。', () => {
      setDraft('');
      setNotice({ message: replaced ? '这条设定替换掉了之前矛盾的那一条。' : '世界记住了。', tone: 'success' });
    });
  };

  const grouped = groupSettings(facts);
  const blocked = busy || loading || loadError || !userId;

  return (
    <div className="vg-settings-design vg-settings-world vg-light-paper">
      <header className="vg-world-setting-header"><button type="button" aria-label="返回星域" onClick={()=>useUIStore.getState().setActiveView('chat')}><Icon name="back" size={22}/></button><h1 ref={heading} tabIndex={-1}>世界设定</h1><span aria-hidden="true"/></header>
      <p className="vg-settings-intro vg-world-setting-intro">长期生效的规则、地点与人物事实。</p>
      <button type="button" className="vg-preference-row vg-world-setting-inline" onClick={() => useUIStore.getState().openCanvas(null)}><span className="vg-preference-copy"><strong>在世界里直接说</strong><small>一句话也能添加或调整长期设定</small></span><Icon name="chevron" size={20}/></button>

      <section className="vg-settings-form vg-world-setting-compose">
        <h2>新增设定</h2>
        <label htmlFor={draftId}>设定内容</label>
        <textarea
          id={draftId}
          rows={2}
          value={draft}
          disabled={busy || !userId}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="新的世界设定" placeholder="例如：这里一直是秋天，街角有一家咖啡店。"
          className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-ink"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={blocked || !draft.trim()}
            className="vg-button vg-button-primary min-h-11 px-4 text-sm disabled:opacity-40"
          >
            {busy ? '正在记下…' : '记下来'}
          </button>
          <span className="vg-world-setting-hint">也可以在世界里直接说，效果完全一样。</span>
        </div>
        {notice && <FeedbackNotice className="mt-3" {...notice} />}
      </section>

      {loadError && <FeedbackNotice className="mt-3" tone="error" message="世界设定读取失败，已有内容会保留，请重试。"><button type="button" className="vg-button vg-button-secondary min-h-11" disabled={busy} onClick={() => void reload(true)} aria-label="重新读取世界设定">重新读取</button></FeedbackNotice>}
      {loading && <LoadingSkeleton label="正在读取世界设定" rows={2} />}
      {!loading && !loadError && grouped.length === 0 ? (
        <p className="vg-world-setting-empty">
          还没有任何设定。<br />试着说：「这里永远停留在秋天。」
        </p>
      ) : (
        grouped.map((group) => (
          <section key={group.category} className="vg-world-setting-group">
            <h2>{group.label}</h2>
            {group.items.map((fact) => (
              <div key={fact.id} className="vg-setting-card" data-world-fact={fact.id} data-world-status={fact.active?'active':'paused'}>
                {editingId === fact.id ? (
                  <>
                    <textarea
                      rows={2}
                      aria-label="编辑世界设定"
                      value={editingText}
                      disabled={busy}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
                    />
                    <div className="vg-setting-actions">
                      <button
                        type="button"
                        className="min-h-11 px-3"
                        disabled={blocked || !editingText.trim()}
                        onClick={() => {
                          if (!userId) return;
                          void runMutation(async () => {
                            const updated = await editWorldSetting(fact.id, editingText, userId);
                            if (!updated) throw Error('World setting is no longer available');
                          }, '未能保存修改，你写的内容已保留，请重试。', () => {
                            setEditingId(null); setNotice({message:'设定已更新。',tone:'success'});
                          }, false, () => restoreFocus(fact.id));
                        }}
                      >
                        保存
                      </button>
                      <button type="button" className="min-h-11 px-3" disabled={busy} onClick={() => {setEditingId(null); restoreFocus(fact.id);}}>取消</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2"><span className="vg-preference-scope">{fact.active ? '生效中' : '已暂停'}</span></div><p className={fact.active ? '' : 'vg-setting-off'}>{fact.content}</p>
                    <div className="vg-setting-actions">
                      <button
                        type="button"
                        className="min-h-11 px-3" data-world-action="edit" disabled={blocked}
                        onClick={() => { setEditingId(fact.id); setEditingText(fact.content); }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="min-h-11 px-3" disabled={blocked}
                        onClick={() => {if(userId) void runMutation(() => toggleWorldSetting(fact.id, !fact.active, userId), '未能更新生效状态，请重试。', () => setNotice({message:fact.active?'设定已暂停。':'设定已恢复。',tone:'success'}));}}
                      >
                        {fact.active ? '暂停' : '恢复'}
                      </button>
                      <button
                        type="button"
                        className="min-h-11 px-3 vg-world-setting-remove" data-world-action="delete" disabled={blocked}
                        onClick={() => {setDeletingId(fact.id); setDeleteError(false);}}
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
      <Modal presentation="dialog" open={!!deletingId} onClose={() => {if(!mutation.current)setDeletingId(null);}} canSnapshotOnExit={()=>false} title="删除长期设定？" panelClassName="vg-settings-panel vg-light-paper vg-world-setting-delete"><div className="vg-settings-design vg-delete-confirmation m-5"><blockquote className="vg-world-setting-delete-target">{facts.find(fact=>fact.id===deletingId)?.content}</blockquote><p className="vg-settings-intro">这条设定将从长期规则中删除。如果只是暂时不用，可以选择“暂停”。</p>{deleteError && <FeedbackNotice tone="error" message="未能删除设定，原内容仍保留，请重试。" />}<div className="flex gap-3"><button type="button" disabled={busy} className="flex-1 min-h-11 text-sub" onClick={() => setDeletingId(null)}>保留设定</button><button type="button" disabled={blocked} className="flex-1 min-h-11 rounded-xl bg-red-500/15 text-red-400" onClick={() => { if (!deletingId || !userId) return; void runMutation(() => removeWorldSetting(deletingId, userId), '未能删除设定，请重试。', () => {setDeletingId(null); feedback('长期设定已删除', { tone: 'success' }); restoreFocus();}, true); }}>{busy ? '正在删除…' : '删除设定'}</button></div></div></Modal>
    </div>
  );
}
