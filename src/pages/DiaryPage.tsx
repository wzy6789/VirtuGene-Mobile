import { useEffect, useMemo, useState } from 'react';
import { useDiaryStore } from '../store/diary-store';
import { useUIStore } from '../store/ui-store';
import { useSettingsStore } from '../store/settings-store';
import { useAuthStore } from '../store/auth-store';
import { ipc } from '../lib/ipc-client';
import { DiaryCalendar } from '../components/diary/DiaryCalendar';
import { DiaryTimeline } from '../components/diary/DiaryTimeline';
import { DiaryTagsView } from '../components/diary/DiaryTagsView';
import { DiaryChatPage } from '../components/diary/DiaryChatPage';
import { DiaryView } from '../components/diary/DiaryView';
import { AutoGenModal } from '../components/diary/AutoGenModal';
import { ReviewModal } from '../components/diary/ReviewModal';
import { YearReviewModal } from '../components/diary/YearReviewModal';
import { RecallModal } from '../components/diary/RecallModal';
import { PersonaModal } from '../components/diary/PersonaModal';
import { YearTableModal } from '../components/diary/YearTableModal';
import { InsightModal } from '../components/diary/InsightModal';
import { DiaryLockScreen, PinSettingsModal } from '../components/diary/DiaryLock';
import { sha256 } from '../store/settings-store';
import { FilterSelect } from '../components/ui/FilterSelect';
import { Modal } from '../components/ui/Modal';
import { moodColor, moodEmoji, formatDateFull } from '../lib/diary-utils';
import { diaryRepo, todayStr } from '../db/diary-repo';
import { IS_MOBILE } from '../lib/platform';
import type { Diary } from '../db/index';

const VIEWS: { key: 'calendar' | 'timeline' | 'tags'; label: string }[] = [
  { key: 'calendar', label: '日历' },
  { key: 'timeline', label: '时间线' },
  { key: 'tags', label: '标签' },
];

/** 隐私锁：应用会话内保持解锁（切走再回来不重复输入）——状态存于独立模块，避免 Sidebar 静态依赖本页破坏拆包 */
import { isDiaryUnlocked, setDiaryUnlocked as setDiaryUnlockState } from '../lib/diary-unlock';

export function DiaryPage() {
  const { diaries, loaded, load, view, setView, search, setSearch, moodFilter, setMoodFilter, yearFilter, setYearFilter, tagFilter, setTagFilter, clearFilters } = useDiaryStore();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const diaryAiEnabled = useSettingsStore((s) => s.diaryAiEnabled);
  const setDiaryAiEnabled = useSettingsStore((s) => s.setDiaryAiEnabled);
  const diarySharedWithCharacters = useSettingsStore((s) => s.diarySharedWithCharacters);
  const setDiarySharedWithCharacters = useSettingsStore((s) => s.setDiarySharedWithCharacters);
  const diaryPin = useSettingsStore((s) => s.diaryPin);
  const setDiaryPin = useSettingsStore((s) => s.setDiaryPin);
  const diaryReminderEnabled = useSettingsStore((s) => s.diaryReminderEnabled);
  const setDiaryReminderEnabled = useSettingsStore((s) => s.setDiaryReminderEnabled);
  const diaryReminderTime = useSettingsStore((s) => s.diaryReminderTime);
  const setDiaryReminderTime = useSettingsStore((s) => s.setDiaryReminderTime);
  const apiKey = useAuthStore((s) => s.apiKey);
  const trash = useDiaryStore((s) => s.trash);
  const restoreDiary = useDiaryStore((s) => s.restoreDiary);
  const purgeDiary = useDiaryStore((s) => s.purgeDiary);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [writingDate, setWritingDate] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showAutoGen, setShowAutoGen] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showYearReview, setShowYearReview] = useState(false);
  /** 回收站视图 */
  const [showTrash, setShowTrash] = useState(false);
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
    <div className="relative h-full flex flex-col bg-app">
      {/* 隐私锁门：设置过 PIN 且本会话未解锁 → 只显示解锁界面 */}
      {diaryPin && !unlocked ? (
        <DiaryLockScreen onUnlock={() => setUnlocked(true)} />
      ) : (
      <>
      {/* 头部（仅管理器视图显示；写日记/看某一天时由 DiaryChatPage 自己的头部接管） */}
      {!writingDate && (
      <div className="h-14 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 border-b border-line shrink-0">
        <span className="text-base font-bold bg-gradient-to-r from-gene-purple to-life-cyan bg-clip-text text-transparent mr-1 min-w-0 truncate">我的手账</span>

        {/* 回收站徽标（有内容时显示） */}
        {trash.length > 0 && (
          <button
            onClick={() => setShowTrash(!showTrash)}
            title="回收站"
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] transition-all shrink-0 ${
              showTrash ? 'bg-red-500/15 text-red-400' : 'bg-surface text-gray-400 hover:text-red-400'
            }`}
          >
            🗑 {trash.length}
          </button>
        )}

        <div className="flex-1 min-w-0" />

        {/* 导出 */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={exporting}
            title="导出日记"
            className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs bg-surface border border-line text-sub hover:border-life-cyan/40 hover:text-ink transition-colors disabled:opacity-40 flex items-center gap-1"
          >
            {exporting ? (
              <>
                <span className="animate-spin inline-block">⏳</span>
                <span className="hidden sm:inline">导出中…</span>
              </>
            ) : (
              <>
                <span>📤</span>
                <span className="hidden sm:inline">导出</span>
              </>
            )}
          </button>
          {showExportMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] py-1.5 glass-card rounded-xl shadow-xl">
                <div className="px-4 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-gray-400">当前筛选（{filtered.length} 篇）</div>
                {([['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['txt', '纯文本 (TXT)']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => doExport(k, 'all')} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors">
                    {label}
                  </button>
                ))}
                <div className="my-1 mx-3 h-px bg-line" />
                <div className="px-4 pb-1 text-[10px] uppercase tracking-wider text-gray-400">仅本月（{stats.thisMonth} 篇）</div>
                {([['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['txt', '纯文本 (TXT)']] as const).map(([k, label]) => (
                  <button key={`m-${k}`} onClick={() => doExport(k, 'month')} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors">
                    {label}
                  </button>
                ))}
                <div className="my-1 mx-3 h-px bg-line" />
                <button onClick={() => void doBackup()} disabled={exporting} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors disabled:opacity-40">
                  🗃️ 完整备份 (JSON)
                </button>
                <button onClick={() => void doExportMarkdown()} disabled={exporting} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors disabled:opacity-40">
                  📄 全量导出 (Markdown)
                </button>
                <button onClick={() => void doImport()} disabled={exporting} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors disabled:opacity-40">
                  📥 导入恢复
                </button>
              </div>
            </>
          )}
        </div>
        {exportMsg && <span className="text-xs text-life-cyan shrink-0 hidden sm:inline">{exportMsg}</span>}

        <button
          onClick={() => setShowAutoGen(true)}
          className="px-2.5 sm:px-3 py-2 rounded-lg text-sm text-gene-purple hover:bg-gene-purple/10 transition-colors shrink-0 flex items-center gap-1"
          title="AI 根据今天和各角色的聊天，自动写一篇日记"
        >
          🧠 <span className="hidden sm:inline">自动生成</span>
        </button>

        {/* 更多：低频操作收纳 */}
        <div className="relative shrink-0">
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`w-9 h-9 flex items-center justify-center rounded-lg text-lg transition-all ${
              moreOpen ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-400 hover:bg-surface hover:text-ink'
            }`}
            title="更多"
          >
            ⋯
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[190px] py-1.5 glass-card rounded-xl shadow-xl animate-fade-in">
                <button
                  onClick={() => { setShowReview(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  ✨ 本周回顾
                </button>
                <button
                  onClick={() => { setShowYearReview(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  🎇 年度回顾
                </button>
                <button
                  onClick={() => { setShowRecall(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  🧠 补记助手
                </button>
                <button
                  onClick={() => { setShowPersona(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  🧬 数字人格画像
                </button>
                <button
                  onClick={() => { setShowYearTable(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  📜 人生年表
                </button>
                <button
                  onClick={() => { setShowInsight(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  📊 情绪周期洞察
                </button>
                <div className="my-1 mx-3 h-px bg-line" />
                <button
                  onClick={() => { setDiaryAiEnabled(!diaryAiEnabled); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <span>✨ AI 辅助</span>
                  <span className={`text-[11px] ${diaryAiEnabled ? 'text-gene-purple' : 'text-gray-400'}`}>{diaryAiEnabled ? '开' : '关'}</span>
                </button>
                <button
                  onClick={() => { setDiarySharedWithCharacters(!diarySharedWithCharacters); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <span>🔓 角色可见</span>
                  <span className={`text-[11px] ${diarySharedWithCharacters ? 'text-life-cyan' : 'text-gray-400'}`}>{diarySharedWithCharacters ? '开' : '关'}</span>
                </button>
                <button
                  onClick={() => { setReminderModal(true); setMoreOpen(false); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <span>🔔 写日记提醒</span>
                  <span className={`text-[11px] ${diaryReminderEnabled ? 'text-gene-purple' : 'text-gray-400'}`}>{diaryReminderEnabled ? diaryReminderTime : '关'}</span>
                </button>
                <div className="my-1 mx-3 h-px bg-line" />
                <button
                  onClick={() => { setPinModal(true); setMoreOpen(false); }}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <span>{diaryPin ? '🔒 手账锁' : '🔓 设置手账锁'}</span>
                  <span className={`text-[11px] ${diaryPin ? 'text-life-cyan' : 'text-gray-400'}`}>{diaryPin ? '已上锁' : '未设置'}</span>
                </button>
                <button
                  onClick={() => { setShowTrash(true); setMoreOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400/80 hover:bg-red-500/10 transition-colors"
                >
                  🗑 回收站{trash.length > 0 ? ` (${trash.length})` : ''}
                </button>
              </div>
            </>
          )}
        </div>

        <button
          onClick={openNew}
          className="px-3.5 sm:px-4 py-2 rounded-lg text-sm font-medium text-white bg-gene-purple hover:bg-[#5B4BD4] shadow-[0_2px_12px_rgba(108,92,231,0.35)] transition-all shrink-0"
        >
          ＋ 写日记
        </button>
      </div>
      )}

      {writingDate ? (
        <DiaryChatPage date={writingDate} onBack={() => setWritingDate(null)} />
      ) : (
        <>
        {/* 左下角返回聊天（管理器视图；手机端底部已有「聊天」tab，隐藏以免冗余） */}
        {!IS_MOBILE && (
        <button
          onClick={() => setActiveView('chat')}
          title="返回聊天"
          className="absolute left-4 bottom-4 z-10 flex items-center gap-1.5 text-sm text-gray-400 hover:text-ink transition-colors"
        >
          ← 聊天
        </button>
        )}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 pb-20">        <div className="max-w-4xl mx-auto space-y-4">
          {/* 统计条（窄屏 2×2，宽屏 4 列） */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '总篇数', value: stats.total },
              { label: '连续记录', value: `${stats.streak} 天` },
              { label: '本月', value: stats.thisMonth },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-line bg-panel/60 px-4 py-3 text-center">
                <div className="text-xl font-bold tabular-nums text-ink">{s.value}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          {/* 心情分布 */}
            <div className="rounded-xl border border-line bg-panel/60 px-4 py-3">
              <div className="text-[11px] text-gray-500 mb-1.5">心情分布</div>
              <div className="flex items-end justify-between h-6 gap-1">
                {stats.moodDist.map((n, i) => (
                  <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                    <span className="text-[9px] text-gray-400 leading-none">{n || ''}</span>
                    <div
                      className="w-full rounded-t"
                      style={{ height: `${Math.max(4, (n / Math.max(1, Math.max(...stats.moodDist))) * 16)}px`, backgroundColor: moodColor(i + 1), opacity: n > 0 ? 0.85 : 0.15 }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 近 30 天心情曲线 */}
          <div className="rounded-xl border border-line bg-panel/60 px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-gray-500">近 30 天心情</span>
              <span className="text-[10px] text-gray-400">近 30 天心情曲线，点数据看日期</span>
            </div>
            <MoodTrendLine data={moodTrend.data} dates={moodTrend.dates} />
          </div>

          {/* 每日一忆：过去的今天 */}
          {memoryOfToday && (
            <button
              onClick={() => openEdit(memoryOfToday)}
              className="w-full text-left rounded-xl border border-dashed border-life-cyan/40 bg-life-cyan/5 px-4 py-3 hover:bg-life-cyan/10 hover:border-life-cyan/60 transition-all group"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">🕰️</span>
                <span className="text-xs font-medium text-life-cyan">每日一忆 · 过去的今天</span>
                <span className="text-[10px] text-gray-400 ml-auto group-hover:text-life-cyan transition-colors">重温 →</span>
              </div>
              <p className="text-sm text-sub line-clamp-2 whitespace-pre-wrap">
                {memoryOfToday.title ? `《${memoryOfToday.title}》` : ''} {memoryOfToday.date.slice(0, 4)} 年的今天你写道：{memoryOfToday.content.slice(0, 80)}
              </p>
            </button>
          )}

          {/* 工具栏 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[140px] sm:min-w-[200px] px-3 py-1.5 rounded-lg bg-surface border border-transparent focus-within:border-gene-purple/40 focus-within:shadow-[0_0_0_3px_rgba(108,92,231,0.10)] transition-all">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 shrink-0">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索日记…"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-gray-500 outline-none min-w-0"
              />
            </div>

            <div className="flex rounded-lg border border-line overflow-hidden">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`px-3 py-1.5 text-xs transition-colors ${view === v.key ? 'bg-gene-purple/15 text-gene-purple' : 'text-gray-500 hover:text-ink'}`}
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
            <div className="py-16 text-center text-gray-500">正在唤醒日记…</div>
          ) : search.trim() ? (
            /* 搜索模式：直接显示结果时间线，让搜索可见生效 */
            <div className="space-y-3">
              <p className="text-[11px] tracking-[0.2em] text-gray-500 uppercase">
                搜索「{search.trim()}」· 找到 {filtered.length} 篇
              </p>
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-gray-500">
                  <p className="text-3xl mb-2">🔍</p>
                  <p className="text-sm">没有找到匹配的日记</p>
                  <p className="text-xs text-gray-600 mt-1">换个关键词试试（可多词）</p>
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
                <p className="text-[11px] tracking-[0.2em] text-gray-500 uppercase">
                  {selectedDate ? formatDateFull(selectedDate) : '选中日期查看日记'}
                </p>
                {selectedDate && dayEntries.length === 0 && (
                  <div className="rounded-xl border border-dashed border-line py-8 text-center">
                    <p className="text-xs text-gray-500 mb-2">这一天还没有日记</p>
                    {selectedDate === todayStr() ? (
                      <button
                        onClick={() => setWritingDate(selectedDate)}
                        className="text-xs text-life-cyan hover:underline"
                      >
                        写一篇 →
                      </button>
                    ) : selectedDate < todayStr() ? (
                      <button
                        onClick={() => setWritingDate(selectedDate)}
                        className="text-xs text-life-cyan hover:underline"
                      >
                        补写一篇 →
                      </button>
                    ) : (
                      <p className="text-xs text-gray-600">还没到这一天</p>
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
                    className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-ink transition-colors"
                  >
                    ‹ 返回手账
                  </button>
                  <span className="w-px h-4 bg-line" />
                  <p className="text-sm font-semibold text-ink">🗑 回收站</p>
                </div>
                <p className="text-xs text-gray-500">删除的日记在这里保留 7 天，可恢复或彻底删除</p>
              </div>
              {trash.length === 0 ? (
                <div className="py-16 text-center text-gray-500">
                  <p className="text-3xl mb-2">🗑️</p>
                  <p className="text-sm">回收站是空的</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {trash.map((d) => (
                    <div key={d.id} className="rounded-xl border border-line bg-panel/60 p-4 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-ink truncate">{d.title || '无标题'}</span>
                          <span className="text-xs text-gray-400 shrink-0">{d.date}</span>
                        </div>
                        <p className="text-sm text-sub line-clamp-2 whitespace-pre-wrap">{d.content || '（空）'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => void restoreDiary(d.id)}
                          className="px-3 py-1.5 rounded-lg text-xs bg-life-cyan/10 text-life-cyan hover:bg-life-cyan/20 transition-colors"
                        >
                          ♻️ 恢复
                        </button>
                        <button
                          onClick={() => void purgeDiary(d.id)}
                          title="彻底删除（不可恢复）"
                          className="px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          🗑 删除
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
      <Modal open={reminderModal} onClose={() => setReminderModal(false)} title="🔔 每日写日记提醒" width="max-w-sm" closeOnBackdrop={false}>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500">到设定时间后，如果当天还没写过日记，会弹一条系统通知提醒你。每天最多一次。</p>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-sub">开启提醒</span>
            <button
              onClick={() => setDiaryReminderEnabled(!diaryReminderEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${diaryReminderEnabled ? 'bg-gene-purple' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${diaryReminderEnabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-sub">提醒时间</span>
            <input
              type="time"
              value={diaryReminderTime}
              onChange={(e) => setDiaryReminderTime(e.target.value)}
              className="bg-surface border border-line rounded-lg px-3 py-1.5 text-sm text-ink outline-none focus:border-gene-purple"
            />
          </label>
          <div className="flex justify-end">
            <button onClick={() => setReminderModal(false)} className="px-4 py-2 rounded-lg text-sm bg-gene-purple hover:bg-[#5B4BD4] text-white transition-all">
              完成
            </button>
          </div>
        </div>
      </Modal>
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
              className={`absolute -translate-x-1/2 text-[9px] leading-none whitespace-nowrap ${
                isToday ? 'text-gene-purple font-semibold' : 'text-gray-400'
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
