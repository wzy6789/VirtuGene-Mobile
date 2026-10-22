import { useEffect, useMemo, useState } from 'react';
import { useFeedback } from '../lib/feedback';
import { useDiaryStore } from '../store/diary-store';
import { useUIStore } from '../store/ui-store';
import { useSettingsStore } from '../store/settings-store';
import { useAuthStore } from '../store/auth-store';
import { ipc } from '../lib/ipc-client';
import { DiaryCalendar } from '../components/diary/DiaryCalendar';
import { DiaryTimeline } from '../components/diary/DiaryTimeline';
import { DiaryTagsView } from '../components/diary/DiaryTagsView';
import { DiaryChatPage } from '../components/diary/DiaryChatPage';
import { DiarySharingOverviewModal } from '../components/diary/DiarySharing';
import { DiaryView } from '../components/diary/DiaryView';
import { AutoGenModal } from '../components/diary/AutoGenModal';
import { ReviewModal } from '../components/diary/ReviewModal';
import { YearReviewModal } from '../components/diary/YearReviewModal';
import { RecallModal } from '../components/diary/RecallModal';
import { PersonaModal } from '../components/diary/PersonaModal';
import { YearTableModal } from '../components/diary/YearTableModal';
import { InsightModal } from '../components/diary/InsightModal';
import { DiaryPreferences } from '../components/settings/DiaryPreferences';
import { DiaryLockScreen, PinSettingsModal } from '../components/diary/DiaryLock';
import { sha256 } from '../store/settings-store';
import { FilterSelect } from '../components/ui/FilterSelect';
import { Modal } from '../components/ui/Modal';
import { moodColor, moodEmoji, formatDateFull } from '../lib/diary-utils';
import { diaryRepo, todayStr } from '../db/diary-repo';
import { IS_MOBILE } from '../lib/platform';
import type { Diary } from '../db/index';
import { Icon } from '../components/ui/Icon';
import '../styles/diary-ui.css';

const VIEWS: { key: 'calendar' | 'timeline' | 'tags'; label: string }[] = [
  { key: 'calendar', label: '日历' },
  { key: 'timeline', label: '时间线' },
  { key: 'tags', label: '标签' },
];

/** 隐私锁：应用会话内保持解锁（切走再回来不重复输入）——状态存于独立模块，避免 Sidebar 静态依赖本页破坏拆包 */
import { isDiaryUnlocked, setDiaryUnlocked as setDiaryUnlockState } from '../lib/diary-unlock';

export function DiaryPage() {
  const owner = useAuthStore(s => s.userId);
  return <DiaryPageContent key={owner ?? 'signed-out'} owner={owner} />;
}

function DiaryPageContent({ owner }: { owner: string | null }) {
  const { diaries: storedDiaries, loaded, load, view, setView, search, setSearch, moodFilter, setMoodFilter, yearFilter, setYearFilter, tagFilter, setTagFilter, clearFilters } = useDiaryStore();
  const diaries = useMemo(() => storedDiaries.filter(d => d.userId === owner), [storedDiaries, owner]);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const diaryAiEnabled = useSettingsStore((s) => s.diaryAiEnabled);
  const setDiaryAiEnabled = useSettingsStore((s) => s.setDiaryAiEnabled);
  const diaryPin = useSettingsStore((s) => s.diaryPin);
  const setDiaryPin = useSettingsStore((s) => s.setDiaryPin);
  const diaryReminderEnabled = useSettingsStore((s) => s.diaryReminderEnabled);
  const diaryReminderTime = useSettingsStore((s) => s.diaryReminderTime);
  const apiKey = useAuthStore((s) => s.apiKey);
  const storedTrash = useDiaryStore((s) => s.trash);
  const trash = useMemo(() => storedTrash.filter(d => d.userId === owner), [storedTrash, owner]);
  const restoreDiary = useDiaryStore((s) => s.restoreDiary);
  const purgeDiary = useDiaryStore((s) => s.purgeDiary);
  const feedback = useFeedback();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [writingDate, setWritingDate] = useState<string | null>(null);
  const [focusedDiaryId, setFocusedDiaryId] = useState<string | undefined>();
  const lifeRecordFocus = useUIStore(s => s.lifeRecordFocus);
  useEffect(() => {
    if (lifeRecordFocus?.kind !== 'diary') return;
    if (lifeRecordFocus.userId === useAuthStore.getState().userId && lifeRecordFocus.date) {
      setWritingDate(lifeRecordFocus.date);
      setFocusedDiaryId(lifeRecordFocus.id);
    }
    useUIStore.setState({ lifeRecordFocus: null });
  }, [lifeRecordFocus]);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showAutoGen, setShowAutoGen] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showYearReview, setShowYearReview] = useState(false);
  /** 回收站视图 */
  const [showTrash, setShowTrash] = useState(false);
  /** 5.0：谁能看到我的日记（逐条授权的总览与收回入口，取代 4.x 的全局开关） */
  const [sharingOpen, setSharingOpen] = useState(false);
  /** 隐私锁：应用会话内已解锁（Pin 校验通过） */
  const [unlocked, setUnlockedState] = useState(isDiaryUnlocked());
  /** 隐私锁设置弹窗 */
  const [pinModal, setPinModal] = useState(false);
  /** 每日提醒设置弹窗 */
  const [reminderModal, setReminderModal] = useState(false);
  /** 「更多」菜单 */
  const [moreOpen, setMoreOpen] = useState(false);
  /** 补记助手 / 人格画像 / 人生年表 */
  const [showRecall, setShowRecall] = useState(false);
  const [showPersona, setShowPersona] = useState(false);
  const [showYearTable, setShowYearTable] = useState(false);
  const [showInsight, setShowInsight] = useState(false);

  const setUnlocked = (v: boolean) => {
    setDiaryUnlockState(v);
    setUnlockedState(v);
  };

  useEffect(() => {
    void load();
    const refresh = (event: Event) => { if ((event as CustomEvent).detail?.userId === useAuthStore.getState().userId) void load(); };
    window.addEventListener('virtugene:diaries-updated', refresh);
    return () => window.removeEventListener('virtugene:diaries-updated', refresh);
  }, [load]);

  // 筛选（多词 AND：空格分隔的关键词需全部命中）
  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return diaries.filter((d) => {
      const hay = (d.title + ' ' + d.content + ' ' + (d.tags ?? []).join(' ')).toLowerCase();
      if (terms.length > 0 && !terms.every((t) => hay.includes(t))) return false;
      if (moodFilter != null && d.mood !== moodFilter) return false;
      if (yearFilter && !d.date.startsWith(yearFilter)) return false;
      if (tagFilter && !(d.tags ?? []).includes(tagFilter)) return false;
      return true;
    });
  }, [diaries, search, moodFilter, yearFilter, tagFilter]);

  // 统计
  const stats = useMemo(() => {
    const total = diaries.length;
    const dateSet = new Set(diaries.map((d) => d.date));
    let streak = 0;
    const cursor = new Date();
    if (!dateSet.has(todayStr())) cursor.setDate(cursor.getDate() - 1);
    while (dateSet.has(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    const ym = todayStr().slice(0, 7);
    const thisMonth = diaries.filter((d) => d.date.startsWith(ym)).length;
    const moodDist = [1, 2, 3, 4, 5].map((m) => diaries.filter((d) => d.mood === m).length);
    return { total, streak, thisMonth, moodDist };
  }, [diaries]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const d of diaries) for (const t of d.tags ?? []) s.add(t);
    return [...s];
  }, [diaries]);

  const years = useMemo(() => [...new Set(diaries.map((d) => d.date.slice(0, 4)))].sort().reverse(), [diaries]);

  /** 近 30 天心情曲线数据（无日记的天为 null）+ 对应日期 */
  const moodTrend = useMemo(() => {
    const byDate = new Map(diaries.map((d) => [d.date, d.mood ?? 3]));
    const data: (number | null)[] = [];
    const dates: string[] = [];
    const base = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dates.push(key);
      data.push(byDate.has(key) ? byDate.get(key)! : null);
    }
    return { data, dates };
  }, [diaries]);

  /** 每日一忆：历史中「同月同日」的日记（不含今年今天），取最近一篇 */
  const memoryOfToday = useMemo(() => {
    const now = new Date();
    const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const thisYear = String(now.getFullYear());
    return diaries
      .filter((d) => d.date.endsWith(md) && !d.date.startsWith(thisYear) && d.content.trim().length > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  }, [diaries]);

  const openNew = () => {
    setWritingDate(todayStr());
  };
  const openEdit = (d: Diary) => {
    setWritingDate(d.date);
  };

  // 日历选中某天的日记列表
  const dayEntries = useMemo(() => (selectedDate ? filtered.filter((d) => d.date === selectedDate) : []), [selectedDate, filtered]);

  // 导出（scope: all=当前筛选结果, month=本月）
  const doExport = async (fmt: 'txt' | 'docx' | 'pdf', scope: 'all' | 'month' = 'all') => {
    setShowExportMenu(false);
    const ym = todayStr().slice(0, 7);
    const entries = (scope === 'month' ? filtered.filter((d) => d.date.startsWith(ym)) : filtered)
      .map((d) => ({ title: d.title || '无标题', date: d.date, content: d.content }));
    if (entries.length === 0) { setExportMsg(scope === 'month' ? '本月还没有日记' : '没有可导出的日记'); return; }
    setExporting(true);
    setExportMsg(null);
    try {
      let r: { ok?: boolean; error?: string } | undefined;
      if (fmt === 'txt') {
        r = await ipc.diary.exportTxt(entries);
      } else if (fmt === 'docx') {
        r = await ipc.diary.exportDocx(entries);
      } else {
        const html =
          '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
          '<style>body{font-family:"Noto Sans SC",sans-serif;color:#1A1A2E;padding:8px 16px}'
          + '.entry{page-break-inside:avoid;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #E5E7EB}'
          + '.title{font-size:18px;font-weight:700;margin-bottom:2px}.date{font-size:12px;color:#6B7280;margin-bottom:8px}'
          + '.content{font-size:14px;line-height:1.8;white-space:pre-wrap}</style></head><body>' +
          entries.map((e) => `<div class="entry"><div class="title">${escapeHtml(e.title)}</div><div class="date">${e.date}</div><div class="content">${escapeHtml(e.content)}</div></div>`).join('') +
          '</body></html>';
        r = await ipc.diary.exportPdf(html);
      }
      // 手机端 DOCX/PDF 不支持时 web-api 返回 { ok:false, error } 而不抛异常 → 必须检查 ok
      if (r && r.ok === false) {
        setExportMsg(r.error || '导出失败');
      } else {
        setExportMsg(`已导出 ${entries.length} 篇日记`);
      }
    } catch {
      setExportMsg('导出失败');
    } finally {
      setExporting(false);
    }
  };

  /** 完整备份（JSON，含回收站，可再导入恢复） */
  const doBackup = async () => {
    setShowExportMenu(false);
    setExporting(true);
    setExportMsg(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const all = await diaryRepo.getAllForBackup(userId);
      const r = await ipc.diary.exportJson(all);
      setExportMsg(r.ok ? `已备份 ${all.length} 篇日记` : r.canceled ? null : '备份失败');
    } catch {
      setExportMsg('备份失败');
    } finally {
      setExporting(false);
    }
  };

  /** 全量导出 Markdown */
  const doExportMarkdown = async () => {
    setShowExportMenu(false);
    setExporting(true);
    setExportMsg(null);
    try {
      const userId = useAuthStore.getState().userId ?? '';
      const all = (await diaryRepo.getByUser(userId))
        .map((d) => ({ date: d.date, title: d.title, content: d.content, mood: d.mood, tags: d.tags }));
      if (all.length === 0) { setExportMsg('还没有日记可导出'); return; }
      const r = await ipc.diary.exportMarkdown(all);
      setExportMsg(r.ok ? `已导出 ${all.length} 篇日记` : r.canceled ? null : '导出失败');
    } catch {
      setExportMsg('导出失败');
    } finally {
      setExporting(false);
    }
  };

  /** 导入恢复：按日期去重，已存在该日期的日记跳过 */
  const doImport = async () => {
    setShowExportMenu(false);
    setExporting(true);
    setExportMsg(null);
    try {
      const r = await ipc.diary.importJson();
      if (r.canceled) return;
      if (!r.ok || !Array.isArray(r.diaries)) { setExportMsg('导入失败：文件格式不对'); return; }
      const userId = useAuthStore.getState().userId ?? '';
      const items = (r.diaries as { date?: string; title?: string; content?: string; mood?: number; tags?: string[]; weather?: string; characterId?: string; images?: string[]; aiNote?: string; aiNoteAt?: number }[])
        .filter((d): d is { date: string; title?: string; content?: string; mood?: number; tags?: string[]; weather?: string; characterId?: string; images?: string[]; aiNote?: string; aiNoteAt?: number } => !!d && typeof d.date === 'string');
      const { imported, skipped } = await diaryRepo.importBackup(userId, items);
      await load();
      setExportMsg(`导入完成：新增 ${imported} 篇，跳过已存在 ${skipped} 篇`);
    } catch {
      setExportMsg('导入失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="vg-diary relative h-full flex flex-col bg-app">
      {/* 隐私锁门：设置过 PIN 且本会话未解锁 → 只显示解锁界面 */}
      {diaryPin && !unlocked ? (
        <DiaryLockScreen onUnlock={() => setUnlocked(true)} />
      ) : (
      <>
      {/* 头部（仅管理器视图显示；写日记/看某一天时由 DiaryChatPage 自己的头部接管） */}
      {!writingDate && (
      <div className="vg-diary-header vg-diary-index-header flex items-center gap-1 px-3 sm:px-4 border-b border-line shrink-0">
        <h1 className="text-xl font-bold text-ink shrink-0">日记</h1>

        <div className="flex-1 min-w-0" />

        {/* 导出 */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={exporting}
            title="导出日记"
            aria-label={exporting ? '正在导出日记' : '导出日记'}
            aria-expanded={showExportMenu}
            className="vg-diary-icon flex items-center justify-center rounded-lg text-sub hover:text-ink disabled:opacity-40"
          >
            {exporting ? (
              <>
                <svg aria-hidden="true" className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="40 16" /></svg>
                <span className="hidden sm:inline">导出中…</span>
              </>
            ) : (
              <>
                <Icon name="download" size={18} />
                <span className="hidden sm:inline">导出</span>
              </>
            )}
          </button>
          {showExportMenu && (
            <Modal open presentation="dialog" title="导出与备份" width="max-w-sm" onClose={()=>setShowExportMenu(false)} canSnapshotOnExit={()=>false} panelClassName="vg-diary">
              <div className="max-h-[70vh] overflow-y-auto py-2">
                <div className="px-4 pt-1.5 pb-1 text-[12px] uppercase tracking-wider text-sub">当前筛选（{filtered.length} 篇）</div>
                {([['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['txt', '纯文本 (TXT)']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => doExport(k, 'all')} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors">
                    {label}
                  </button>
                ))}
                <div className="my-1 mx-3 h-px bg-line" />
                <div className="px-4 pb-1 text-[12px] uppercase tracking-wider text-sub">仅本月（{stats.thisMonth} 篇）</div>
                {([['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['txt', '纯文本 (TXT)']] as const).map(([k, label]) => (
                  <button key={`m-${k}`} onClick={() => doExport(k, 'month')} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors">
                    {label}
                  </button>
                ))}
                <div className="my-1 mx-3 h-px bg-line" />
                <button onClick={() => void doBackup()} disabled={exporting} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors disabled:opacity-40">
                  <Icon name="database" size={16} /> 完整备份 (JSON)
                </button>
                <button onClick={() => void doExportMarkdown()} disabled={exporting} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors disabled:opacity-40">
                  <Icon name="diary" size={16} /> 全量导出 (Markdown)
                </button>
                <button onClick={() => void doImport()} disabled={exporting} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors disabled:opacity-40">
                  <Icon name="upload" size={16} /> 导入恢复
                </button>
              </div>
            </Modal>
          )}
        </div>
        {exportMsg && <span className="text-xs text-life-cyan shrink-0 hidden sm:inline">{exportMsg}</span>}

        <button
          onClick={() => setShowAutoGen(true)}
          className="vg-diary-icon flex items-center justify-center rounded-lg text-sub hover:text-ink shrink-0"
          aria-label="自动生成日记"
          title="AI 根据今天和各角色的聊天，自动写一篇日记"
        >
          <Icon name="spark" size={20} />
        </button>

        {/* 更多：低频操作收纳 */}
        <div className="relative shrink-0">
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`vg-diary-icon w-9 h-9 flex items-center justify-center rounded-lg text-lg transition-all ${
              moreOpen ? 'bg-gene-purple/15 text-gene-purple' : 'text-sub hover:bg-surface hover:text-ink'
            }`}
            title="更多"
            aria-label="手账更多选项"
            aria-expanded={moreOpen}
          >
            <Icon name="more" size={20} />
          </button>
          {moreOpen && (
            <Modal open presentation="dialog" width="max-w-sm" title="手账工具" onClose={()=>setMoreOpen(false)} canSnapshotOnExit={()=>false} panelClassName="vg-diary">
              <div className="max-h-[70vh] overflow-y-auto py-2">
                <button
                  onClick={() => { setShowReview(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <Icon name="calendar" size={16} /> 本周回顾
                </button>
                <button
                  onClick={() => { setShowYearReview(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <Icon name="spark" size={16} /> 年度回顾
                </button>
                <button
                  onClick={() => { setShowRecall(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <Icon name="diary" size={16} /> 补记助手
                </button>
                <button
                  onClick={() => { setShowPersona(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 3c0 9 10 9 10 18M17 3c0 9-10 9-10 18M8 6h8M8 18h8M10 9h4M10 15h4" /></svg>数字人格画像
                </button>
                <button
                  onClick={() => { setShowYearTable(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <Icon name="clock" size={16} /> 人生年表
                </button>
                <button
                  onClick={() => { setShowInsight(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <Icon name="heart" size={16} /> 情绪周期洞察
                </button>
                <div className="my-1 mx-3 h-px bg-line" />
                <button
                  onClick={() => { setDiaryAiEnabled(!diaryAiEnabled); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="spark" size={16} /> AI 辅助</span>
                  <span className={`text-[12px] ${diaryAiEnabled ? 'text-gene-purple' : 'text-sub'}`}>{diaryAiEnabled ? '开' : '关'}</span>
                </button>
                <button
                  onClick={() => { setSharingOpen(true); setMoreOpen(false); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="shield" size={16} /> 谁能看到我的日记</span>
                  <span className="text-[12px] text-sub">逐条授权</span>
                </button>
                <button
                  onClick={() => { setReminderModal(true); setMoreOpen(false); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <span>日记设置</span>
                  <span className={`text-[12px] ${diaryReminderEnabled ? 'text-gene-purple' : 'text-sub'}`}>{diaryReminderEnabled ? diaryReminderTime : '关'}</span>
                </button>
                <div className="my-1 mx-3 h-px bg-line" />
                <button
                  onClick={() => { setPinModal(true); setMoreOpen(false); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="lock" size={16} />{diaryPin ? '手账锁' : '设置手账锁'}</span>
                  <span className={`text-[12px] ${diaryPin ? 'text-life-cyan' : 'text-sub'}`}>{diaryPin ? '已上锁' : '未设置'}</span>
                </button>
                <button
                  onClick={() => { setShowTrash(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400/80 hover:bg-red-500/10 transition-colors"
                >
                  <Icon name="trash" size={16} /> 回收站{trash.length > 0 ? ` (${trash.length})` : ''}
                </button>
              </div>
            </Modal>
          )}
        </div>

        <button
          onClick={openNew}
          className="vg-button vg-button-primary px-3 text-sm shrink-0"
        >
          <span className="inline-flex items-center gap-1"><Icon name="edit" size={18} /> 写日记</span>
        </button>
      </div>
      )}

      {writingDate ? (
        <DiaryChatPage key={`${writingDate}:${focusedDiaryId ?? ''}`} date={writingDate} diaryId={focusedDiaryId} onBack={() => { setWritingDate(null); setFocusedDiaryId(undefined); }} />
      ) : (
        <>
        {/* 左下角返回聊天（管理器视图；手机端底部已有「聊天」tab，隐藏以免冗余） */}
        {!IS_MOBILE && (
        <button
          onClick={() => setActiveView('chat')}
          title="返回聊天"
          className="absolute left-4 bottom-4 z-10 flex items-center gap-1.5 text-sm text-sub hover:text-ink transition-colors"
        >
          <Icon name="back" size={16} /> 聊天
        </button>
        )}
        <div className="vg-diary-index-scroll flex-1 overflow-y-auto px-5 py-4 pb-20"><div className="max-w-4xl mx-auto space-y-3">
          <section className="vg-diary-stats grid grid-cols-3 py-4" aria-label="日记统计">
            {[
              { label: '总篇数', value: stats.total },
              { label: '连续记录', value: `${stats.streak} 天` },
              { label: '本月', value: stats.thisMonth },
            ].map((s, index) => (
              <div key={s.label} className={`grid gap-1 min-w-0 text-center ${index ? 'border-l border-line' : ''}`}>
                <strong className="text-2xl font-semibold tabular-nums leading-snug">{loaded ? s.value : '—'}</strong>
                <span className="text-[13px] text-sub">{s.label}</span>
              </div>
            ))}
          </section>
          <details className="vg-diary-mood">
            <summary><Icon name="smile" size={20}/><span>心情回顾</span><small className="text-[13px] text-sub">分布与趋势</small><Icon name="chevron" size={18}/></summary>
            <div className="space-y-3 px-4 pb-4">
          {/* 心情分布 */}
            <div>
              <div className="text-[12px] text-sub mb-1.5">全部日记心情分布</div>
              <div className="flex items-end justify-between h-6 gap-1">
                {stats.moodDist.map((n, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                    <span className="text-[12px] text-sub leading-none">{n || ''}</span>
                    <div
                      className="w-full rounded-t"
                      style={{ height: `${Math.max(4, (n / Math.max(1, Math.max(...stats.moodDist))) * 16)}px`, backgroundColor: moodColor(i + 1), opacity: n > 0 ? 0.85 : 0.15 }}
                    />
                  </div>
                ))}
              </div>
            </div>
          {/* 近 30 天心情曲线 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] text-sub">近 30 天心情</span>
              <span className="text-[12px] text-sub">近 30 天心情曲线，点数据看日期</span>
            </div>
            <MoodTrendLine data={moodTrend.data} dates={moodTrend.dates} />
          </div>
          </div></details>

          {/* 每日一忆：过去的今天 */}
          {memoryOfToday && (
            <button
              onClick={() => openEdit(memoryOfToday)}
              className="w-full text-left rounded-xl border border-dashed border-life-cyan/40 bg-life-cyan/5 px-4 py-3 hover:bg-life-cyan/10 hover:border-life-cyan/60 transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon name="clock" size={16} className="text-life-cyan" />
                <span className="text-xs font-medium text-life-cyan">每日一忆 · 过去的今天</span>
                <span className="text-[12px] text-sub ml-auto group-hover:text-life-cyan transition-colors">重温</span>
              </div>
              <p className="text-sm text-sub line-clamp-2 whitespace-pre-wrap">
                {memoryOfToday.title ? `《${memoryOfToday.title}》` : ''} {memoryOfToday.date.slice(0, 4)} 年的今天你写道：{memoryOfToday.content.slice(0, 80)}
              </p>
            </button>
          )}

          {/* 工具栏 */}
          <div className="vg-diary-index-tools flex items-center gap-2 flex-wrap">
            <div className="vg-search-field flex items-center gap-2 w-full px-3 py-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-sub shrink-0">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="search" aria-label="搜索日记"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索日记…"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-sub outline-none min-w-0"
              />
            </div>

            <div className="vg-diary-index-views flex w-full rounded-lg border border-line overflow-hidden" role="group" aria-label="日记视图">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  aria-pressed={view === v.key}
                  className={`flex-1 px-3 py-1.5 text-sm transition-colors ${view === v.key ? 'bg-gene-purple/15 text-gene-purple' : 'text-sub hover:text-ink'}`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <FilterSelect
              value={moodFilter != null ? String(moodFilter) : ''}
              onChange={(v) => setMoodFilter(v ? Number(v) : null)}
              options={[
                { value: '', label: '全部心情' },
                { value: '1', label: '😞 很差' },
                { value: '2', label: '😔 低落' },
                { value: '3', label: '😐 一般' },
                { value: '4', label: '😊 开心' },
                { value: '5', label: '🤩 很棒' },
              ]}
            />

            <FilterSelect
              value={yearFilter ?? ''}
              onChange={(v) => setYearFilter(v || null)}
              options={[{ value: '', label: '全部年份' }, ...years.map((y) => ({ value: y, label: `${y}年` }))]}
            />

            <FilterSelect
              value={tagFilter ?? ''}
              onChange={(v) => setTagFilter(v || null)}
              options={[{ value: '', label: '全部标签' }, ...allTags.map((t) => ({ value: t, label: `#${t}` }))]}
            />

            {(search || moodFilter != null || yearFilter || tagFilter) && (
              <button onClick={clearFilters} className="text-xs text-life-cyan hover:underline">清除筛选</button>
            )}
          </div>

          {/* 主体 */}
          {!loaded ? (
            <div className="vg-loading-skeleton" role="status" aria-label="正在唤醒日记">{[0, 1, 2].map(i => <div className="vg-skeleton-card" key={i} aria-hidden="true"><i /><span><i /><i /><i /></span></div>)}</div>
          ) : search.trim() ? (
            /* 搜索模式：直接显示结果时间线，让搜索可见生效 */
            <div className="space-y-3">
              <p className="text-[12px] tracking-[0.2em] text-sub uppercase">
                搜索「{search.trim()}」· 找到 {filtered.length} 篇
              </p>
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-sub">
                  <Icon name="search" size={32} className="mx-auto mb-2" />
                  <p className="text-sm">没有找到匹配的日记</p>
                  <p className="text-xs text-sub mt-1">换个关键词试试（可多词）</p>
                </div>
              ) : (
                <DiaryTimeline entries={filtered} onEdit={openEdit} highlight={search} />
              )}
            </div>
          ) : view === 'calendar' ? (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-3">
                <DiaryCalendar diaries={filtered} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
              </div>
              <div className="lg:col-span-2 space-y-2">
                <p className="text-[12px] tracking-[0.2em] text-sub uppercase">
                  {selectedDate ? formatDateFull(selectedDate) : '选中日期查看日记'}
                </p>
                {selectedDate && dayEntries.length === 0 && (
                  <div className="rounded-xl border border-dashed border-line py-8 text-center">
                    <p className="text-xs text-sub mb-2">这一天还没有日记</p>
                    {selectedDate === todayStr() ? (
                      <button
                        onClick={() => setWritingDate(selectedDate)}
                        className="text-xs text-life-cyan hover:underline"
                      >
                        写一篇
                      </button>
                    ) : selectedDate < todayStr() ? (
                      <button
                        onClick={() => setWritingDate(selectedDate)}
                        className="text-xs text-life-cyan hover:underline"
                      >
                        补写一篇
                      </button>
                    ) : (
                      <p className="text-xs text-sub">还没到这一天</p>
                    )}
                  </div>
                )}
                {selectedDate && dayEntries.length > 0 && (
                  <button
                    onClick={() => openEdit(dayEntries[0])}
                    title="点击编辑这一天"
                    className="w-full text-left rounded-xl hover:shadow-[0_2px_16px_rgba(108,92,231,0.12)] transition-all"
                  >
                    <DiaryView diary={dayEntries[0]} />
                  </button>
                )}
              </div>
            </div>
          ) : view === 'timeline' ? (
            <DiaryTimeline entries={filtered} onEdit={openEdit} highlight={search} />
          ) : (
            <DiaryTagsView entries={filtered} onEdit={openEdit} tagFilter={tagFilter} onTagClick={setTagFilter} highlight={search} />
          )}
        </div>
      </div>
        </>
      )}

      {/* 5.0：谁能看到我的日记（逐条授权总览 + 收回入口；取代 4.x 的全局「角色可见」开关） */}
      <DiarySharingOverviewModal open={sharingOpen} onClose={() => setSharingOpen(false)} />

      {/* 回收站视图 */}
      {showTrash && (
        <div className="absolute inset-0 z-30 bg-app pt-14">
          <div className="h-full overflow-y-auto px-6 py-5">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowTrash(false)}
                    title="返回手账"
                    className="flex items-center gap-1.5 text-sm text-sub hover:text-ink transition-colors"
                  >
                    ‹ 返回手账
                  </button>
                  <span className="w-px h-4 bg-line" />
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon name="trash" size={18} />回收站</p>
                </div>
                <p className="text-xs text-sub">删除的日记在这里保留 7 天，可恢复或彻底删除</p>
              </div>
              {trash.length === 0 ? (
                <div className="py-16 text-center text-sub">
                  <Icon name="trash" size={30} className="mx-auto mb-2" />
                  <p className="text-sm">回收站是空的</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {trash.map((d) => (
                    <div key={d.id} className="vg-diary-card rounded-xl border border-line bg-panel/60 p-4 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-ink truncate">{d.title || '无标题'}</span>
                          <span className="text-xs text-sub shrink-0">{d.date}</span>
                        </div>
                        <p className="text-sm text-sub line-clamp-2 whitespace-pre-wrap">{d.content || '（空）'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => void restoreDiary(d.id).then(() => feedback('日记已恢复', { tone: 'success' })).catch(() => feedback('日记未能恢复，请重试', { tone: 'error' }))}
                          className="px-3 py-1.5 rounded-lg text-xs bg-life-cyan/10 text-life-cyan hover:bg-life-cyan/20 transition-colors"
                        >
                            <Icon name="refresh" size={16} className="inline" /> 恢复
                        </button>
                        <button
                          onClick={() => void purgeDiary(d.id).then(() => feedback('日记已彻底删除', { tone: 'success' })).catch(() => feedback('日记未能删除，请重试', { tone: 'error' }))}
                          title="彻底删除（不可恢复）"
                          className="px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                            <Icon name="trash" size={16} className="inline" /> 删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AutoGenModal open={showAutoGen} onClose={() => setShowAutoGen(false)} />
      <ReviewModal open={showReview} onClose={() => setShowReview(false)} />
      <YearReviewModal open={showYearReview} onClose={() => setShowYearReview(false)} />
      <RecallModal open={showRecall} onClose={() => setShowRecall(false)} />
      <PersonaModal open={showPersona} onClose={() => setShowPersona(false)} />
      <YearTableModal open={showYearTable} onClose={() => setShowYearTable(false)} />
      <InsightModal open={showInsight} onClose={() => setShowInsight(false)} />

      {/* PIN 设置/修改弹窗 */}
      <PinSettingsModal
        open={pinModal}
        onClose={() => setPinModal(false)}
        currentPin={diaryPin}
        onSave={async (pin) => {
          if (pin) {
            // 设置/修改密码后本会话保持解锁，避免刚设完就被锁在门外
            setDiaryPin(await sha256(pin));
            setUnlocked(true);
          } else {
            setDiaryPin(null);
            setUnlocked(false);
          }
          setPinModal(false);
        }}
      />
      {/* 每日写日记提醒设置 */}
      <Modal open={reminderModal} onClose={() => setReminderModal(false)} title="日记设置" mobileFullHeight panelClassName="vg-settings-panel"><div className="vg-settings-design"><DiaryPreferences /></div></Modal>
      </>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 近 30 天心情折线图：mood 1-5，null = 未记录（不画点，但连线跨过空缺）。x 轴标注日期刻度 + 悬停显示日期/心情 */
function MoodTrendLine({ data, dates }: { data: (number | null)[]; dates: string[] }) {
  const W = 560;
  const H = 72;
  const PAD = 8;
  const n = data.length;
  const x = (i: number) => PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2);
  const y = (m: number) => H - PAD - ((m - 1) / 4) * (H - PAD * 2);

  // 只取有记录的点（null 跳过，但时间轴位置保留，连线直接跨过空缺）
  const points = data
    .map((m, i) => ({ m, idx: i }))
    .filter((p): p is { m: number; idx: number } => p.m != null)
    .map((p) => ({ x: x(p.idx), y: y(p.m), mood: p.m, idx: p.idx }));

  const line =
    points.length >= 2 ? (
      <polyline
        points={points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke="url(#moodGrad)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
    ) : null;

  /** x 轴刻度：每 5 天一个（含今天） */
  const ticks = [...new Set([0, 5, 10, 15, 20, 25, n - 1])].filter((i) => i >= 0 && i < n);
  const md = (dateStr: string) => {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${m}/${d}`;
  };

  return (
    <div>
      <div style={{ aspectRatio: '560 / 72' }} className="w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="moodGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6C5CE7" />
              <stop offset="100%" stopColor="#00CEC9" />
            </linearGradient>
          </defs>
          {/* 心情刻度虚线 */}
          {[1, 3, 5].map((lv) => (
            <line key={lv} x1={PAD} y1={y(lv)} x2={W - PAD} y2={y(lv)} stroke="rgba(161,161,170,0.18)" strokeWidth="1" strokeDasharray="3 4" />
          ))}
          {/* x 轴竖刻度线 */}
          {ticks.map((i) => (
            <line key={`t-${i}`} x1={x(i)} y1={H - PAD - 2} x2={x(i)} y2={H - PAD + 3} stroke="rgba(161,161,170,0.45)" strokeWidth="1" />
          ))}
          {line}
          {/* 数据点（悬停显示日期 + 心情） */}
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={p.idx === n - 1 ? 3.6 : 2.6} fill={moodColor(p.mood)} stroke="#0F0F1A" strokeWidth="1">
                <title>{`${dates[p.idx]} · 心情 ${p.mood}/5`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
      {/* x 轴日期标签（HTML 层，避免 SVG 文字被拉伸） */}
      <div className="relative h-4 mt-0.5">
        {ticks.map((i) => {
          const isToday = i === n - 1;
          const leftPct = (i / Math.max(1, n - 1)) * 100;
          return (
            <span
              key={`l-${i}`}
              className={`absolute -translate-x-1/2 text-[12px] leading-none whitespace-nowrap ${
                isToday ? 'text-gene-purple font-semibold' : 'text-sub'
              }`}
              style={{ left: `${leftPct}%` }}
            >
              {isToday ? '今天' : md(dates[i])}
            </span>
          );
        })}
      </div>
    </div>
  );
}
