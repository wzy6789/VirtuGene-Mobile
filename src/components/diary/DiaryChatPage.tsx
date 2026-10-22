import { useFeedback } from '../../lib/feedback';
import { useAiAvailability } from '../settings/useAiAvailability';
import { avatarImageSrc } from '../../lib/avatar';
import { TagInput, DIARY_TAGS } from '../ui/PhysicalInteractions';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FilterSelect } from '../ui/FilterSelect';
import { SwipeBackView } from '../ui/SwipeBackView';
import { ExtractModal } from './ExtractModal';
import { DiaryView } from './DiaryView';
import { DiarySharingControl } from './DiarySharing';
import { useDiaryStore } from '../../store/diary-store';
import { useSettingsStore } from '../../store/settings-store';
import { useAuthStore } from '../../store/auth-store';
import { useChatStore } from '../../store/chat-store';
import { useUIStore } from '../../store/ui-store';
import { ipc } from '../../lib/ipc-client';
import { DIARY_MOODS, DIARY_WEATHERS, moodEmoji, moodColor, formatDateFull } from '../../lib/diary-utils';
import { diaryRepo, todayStr } from '../../db/diary-repo';
import type { Diary } from '../../db/index';
import { Icon } from '../ui/Icon';
import { FeedbackNotice } from '../ui/FeedbackNotice';

interface Props {
  date: string;
  onBack: () => void;
  diaryId?: string;
}

/**
 * 聊天式写日记：这一天=一篇日记，每段即发即存（追加式）。
 * 写完一段后，AI「灵魂」会回应一句简短的引导（可开关，不写入正文）。
 */
export function DiaryChatPage({ date, onBack, diaryId }: Props) {
  const owner = useAuthStore(s => s.userId);
  return <DiaryChatContent key={`${owner ?? 'signed-out'}:${date}:${diaryId ?? ''}`} date={date} onBack={onBack} diaryId={diaryId} />;
}

function DiaryChatContent({ date, onBack, diaryId }: Props) {
  const getOrCreateForDate = useDiaryStore((s) => s.getOrCreateForDate);
  const updateDiary = useDiaryStore((s) => s.updateDiary);
  const deleteDiary = useDiaryStore((s) => s.deleteDiary);
  const feedback = useFeedback();
  const apiKey = useAuthStore((s) => s.apiKey) ?? '';
  const hasAiAccess = useAiAvailability();
  const diaryAiEnabled = useSettingsStore((s) => s.diaryAiEnabled);
  const characters = useChatStore((s) => s.characters);

  const [diary, setDiary] = useState<Diary | null>(null);
  const [input, setInput] = useState('');
  const [guides, setGuides] = useState<{ id: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  /** 当天 → 默认写作视图；归档日 → 默认正式日记视图（补写需主动点「💬 补写」） */
  const isPastInitial = date < todayStr();
  const [viewMode, setViewMode] = useState<'write' | 'diary'>(diaryId || isPastInitial ? 'diary' : 'write');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sending, setSending] = useState(false);
  const [composeOptionsOpen, setComposeOptionsOpen] = useState(false);
  const composeOptionsId = useId();
  const retrySaveButton = useRef<HTMLButtonElement>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const saveRevision = useRef(0);
  const pendingPatch = useRef<Partial<Diary>>({});
  const pendingInput = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [showNewHint, setShowNewHint] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 段落编辑：正在编辑的段落下标 + 草稿文本 */
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  /** 「把日记发给角色」弹窗 */
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCharId, setShareCharId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 同步的 diary 引用：patch/send 用它拿最新内容，避免同一帧连发时读到旧闭包 */
  const diaryRef = useRef<Diary | null>(null);
  diaryRef.current = diary;
  const stickRef = useRef(true);
  stickRef.current = stickToBottom;

  const load = useCallback(async () => {
    const owner = useAuthStore.getState().userId;
    const d = diaryId ? (await diaryRepo.getById(diaryId)) ?? null : await getOrCreateForDate(date);
    if (!mounted.current || !d || d.userId !== owner || d.deletedAt || useAuthStore.getState().userId !== owner) return;
    diaryRef.current = d;
    setDiary(d);
    // 自动标题：仅当天（写作中的今天）第一篇段落前 24 字；
    // 归档日只读，绝不改动其标题（用户可能故意留空）
    if (!diaryId && d && date >= todayStr() && !d.title.trim() && d.content.trim()) {
      const t = d.content.trim().split('\n')[0].slice(0, 24);
      if (t) await updateDiary(d.id, { title: t });
    }
    // AI 回信：翻旧日记（≥7 天）且还没有批注、且未尝试失败过 → 后台生成一条
    // aiNoteAt: 正数=生成时间；负数=上次生成失败（避免反复重试）；undefined=未尝试
    const noteAttempted = d && d.aiNoteAt != null;
    if (!diaryId && d && date < todayStr() && !d.aiNote && !noteAttempted && d.content.trim().length >= 20 && hasAiAccess) {
      const ageDays = Math.floor((Date.now() - new Date(`${date}T00:00:00`).getTime()) / 86400000);
      if (ageDays >= 7) {
        try {
          const r = await ipc.diary.assist({ apiKey, mode: 'note', text: d.content.slice(0, 800) });
          if (r.text && !r.error) {
            await updateDiary(d.id, { aiNote: r.text, aiNoteAt: Date.now() });
            if (diaryRef.current?.id === d.id) {
              diaryRef.current = { ...diaryRef.current, aiNote: r.text, aiNoteAt: Date.now() };
              setDiary({ ...diaryRef.current });
            }
          } else {
            // 生成失败：记一个失败时间戳，避免每次打开都重复请求
            await updateDiary(d.id, { aiNoteAt: -Date.now() });
            if (diaryRef.current?.id === d.id) {
              diaryRef.current = { ...diaryRef.current, aiNoteAt: -Date.now() };
              setDiary({ ...diaryRef.current });
            }
          }
        } catch {
          /* 批注失败不影响查看 */
        }
      }
    }
  }, [date, diaryId, getOrCreateForDate, updateDiary, apiKey, hasAiAccess]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 正文按空行拆成段落气泡（旧→新） */
  const segments = useMemo(() => {
    if (!diary) return [];
    return diary.content
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [diary]);

  const linkedChar = diary ? characters.find((c) => c.id === diary.characterId) : undefined;

  /** 过了当天 → 只读归档：只保留正式日记视图，不可修改 */
  const isPast = date < todayStr();

  // 自动滚底：仅在原本就贴着底部时跟随，避免打断上翻历史
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [segments.length, guides.length]);

  // 新内容到达但用户上翻时，显示「↓ 新内容」提示
  useEffect(() => {
    if (stickToBottom) return;
    setShowNewHint(true);
  }, [segments.length, guides.length, stickToBottom]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStickToBottom(atBottom);
    if (atBottom) setShowNewHint(false);
  };

  const scrollToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStickToBottom(true);
    setShowNewHint(false);
  };

  const patch = (p: Partial<Diary>): Promise<boolean> => {
    const cur = diaryRef.current;
    if (!cur || useAuthStore.getState().userId !== cur.userId) return Promise.resolve(false);
    // 同步更新 ref + state，保证同一帧内多次 patch/send 读到最新内容
    const next: Diary = { ...cur, ...p, updatedAt: Date.now() };
    diaryRef.current = next;
    setDiary(next);
    pendingPatch.current = { ...pendingPatch.current, ...p };
    const payload = { ...pendingPatch.current };
    const revision = ++saveRevision.current;
    setSaveState('saving');
    // Serialize writes; a newer snapshot also carries any earlier unsaved fields.
    const work = saveQueue.current.then(async () => {
      if (useAuthStore.getState().userId !== cur.userId) return false;
      try {
        await updateDiary(cur.id, payload);
        if (revision === saveRevision.current) {
          pendingPatch.current = {};
          if (mounted.current && useAuthStore.getState().userId === cur.userId) {
            setSavedAt(Date.now()); setSaveState('saved');
          }
        }
        return true;
      } catch {
        if (revision === saveRevision.current && mounted.current && useAuthStore.getState().userId === cur.userId) setSaveState('error');
        return false;
      }
    });
    saveQueue.current = work;
    return work;
  };

  const retrySave = async () => {
    const cur = diaryRef.current;
    if (!await patch({})) return;
    if (!mounted.current || !cur || useAuthStore.getState().userId !== cur.userId || diaryRef.current?.id !== cur.id) return;
    const text = pendingInput.current;
    if (text != null) setInput(current => current.trim() === text ? '' : current);
    pendingInput.current = null;
  };
  const requestBack = () => {
    if (saveState === 'error') { retrySaveButton.current?.focus(); retrySaveButton.current?.scrollIntoView({ block:'nearest' }); return; }
    if (saveState === 'saving') { feedback('还有记录未保存，请先完成保存或重试。', { tone:'error' }); return; }
    onBack();
  };

  const send = async () => {
    const text = input.trim();
    const cur = diaryRef.current;
    if (!text || !cur || sendingRef.current) return;
    sendingRef.current = true; setSending(true);
    if (saveState === 'error' && pendingInput.current === text) {
      try { await retrySave(); } finally { sendingRef.current = false; if (mounted.current) setSending(false); }
      return;
    }
    // 追加新段后段落索引错位 → 取消进行中的段落编辑
    setEditingIdx(null);
    setEditingText('');
    const newContent = cur.content.trim() ? cur.content.trim() + '\n\n' + text : text;
    // 标题：归档日补写只追加，绝不动标题；当天无标题时用首段前 24 字自动补
    const patchPayload: Partial<Diary> = { content: newContent };
    if (!isPast) {
      patchPayload.title = cur.title.trim() ? cur.title : text.slice(0, 24);
    }
    pendingInput.current = text;
    let written: boolean;
    try { written = await patch(patchPayload); }
    finally { sendingRef.current = false; if (mounted.current) setSending(false); }
    if (!written || !mounted.current || useAuthStore.getState().userId !== cur.userId || diaryRef.current?.id !== cur.id) return;
    setInput(current => current.trim() === text ? '' : current);
    pendingInput.current = null;

    // AI 灵魂引导（可开关，不写入正文；不阻塞正文发送——引导进行中跳过本次引导，避免并发乱序）
    if (diaryAiEnabled && hasAiAccess && !busy) {
      setBusy(true);
      try {
        const r = await ipc.diary.assist({ apiKey, mode: 'guide', text: newContent.slice(-800) });
        if (r.text && mounted.current && useAuthStore.getState().userId === cur.userId && diaryRef.current?.id === cur.id) {
          const guideText = r.text;
          setGuides((g) => [...g, { id: crypto.randomUUID(), text: guideText }]);
        }
      } catch {
        /* 引导失败不影响记录 */
      } finally {
        if (mounted.current && useAuthStore.getState().userId === cur.userId) setBusy(false);
      }
    }
  };

  const insertExtract = (text: string, replace?: boolean, tags?: string[], title?: string) => {
    const cur = diaryRef.current;
    if (!cur) return;
    setEditingIdx(null);
    setEditingText('');
    // 归档日只允许追加：即使 AI 建议"替换"也强制转为追加，绝不覆盖已有内容
    const effectiveReplace = replace && !isPast;
    if (effectiveReplace) {
      // 生成包含日记片段 → 直接替换为一段完整文章（不再保留对话式分段）
      patch({ content: text.trim(), tags: tags ?? cur.tags, ...(title ? { title } : {}) });
    } else {
      const mergedTags = tags ? [...new Set([...(cur.tags ?? []), ...tags])] : cur.tags;
      patch({
        content: cur.content.trim() ? cur.content.trim() + '\n\n' + text.trim() : text.trim(),
        tags: mergedTags,
        // 归档日不补标题；当天无标题时才允许 AI 建议标题
        ...((!isPast && !cur.title.trim() && title) ? { title } : {}),
      });
    }
    setExtractOpen(false);
  };

  /** 段落级编辑：修改 / 删除 / 移动单段（重建 content 后 patch） */
  const rebuildSegments = (next: string[]) => {
    const cleaned = next.map((s) => s.trim()).filter(Boolean);
    patch({ content: cleaned.join('\n\n') });
  };

  const saveSegmentEdit = () => {
    if (editingIdx == null) return;
    const next = [...segments];
    next[editingIdx] = editingText;
    rebuildSegments(next);
    setEditingIdx(null);
    setEditingText('');
  };

  const deleteSegment = (i: number) => {
    // 若正在编辑某段，删除后索引会错位 → 先取消编辑
    setEditingIdx(null);
    setEditingText('');
    rebuildSegments(segments.filter((_, idx) => idx !== i));
  };

  const moveSegment = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= segments.length) return;
    // 移动后索引错位 → 取消编辑
    setEditingIdx(null);
    setEditingText('');
    const next = [...segments];
    [next[i], next[j]] = [next[j], next[i]];
    rebuildSegments(next);
  };

  /** 把这一天的日记发给关联角色（注入到 TA 的会话并切过去） */
  const shareToCharacter = async () => {
    const cur = diaryRef.current;
    if (!cur || !shareCharId) return;
    const title = cur.title.trim() ? `《${cur.title.trim()}》` : '';
    const body =
      `（分享我的日记 ${cur.date}${title}）\n\n${cur.content.trim()}` +
      (cur.tags && cur.tags.length > 0 ? `\n\n标签：${cur.tags.map((t) => '#' + t).join(' ')}` : '');
    setShareOpen(false);
    // 等消息落库 + 切会话完成后再跳聊天视图，避免 ChatWindow 挂载时还没拿到 pendingDiarySend
    await useChatStore.getState().shareDiaryToCharacter(shareCharId, body);
    useUIStore.getState().setActiveView('chat');
  };

  /** 插图压缩：dataURL → canvas 缩放（最大边 1280）+ JPEG 0.82，减少 IndexedDB 占用；失败则保留原图 */
  const compressImage = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const MAX_EDGE = 1280;
            const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(dataUrl); return; }
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          } catch {
            resolve(dataUrl);
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch {
        resolve(dataUrl);
      }
    });
  };

  /** 插图：选择本地图片 → 压缩 → dataURL 存入 diary.images */
  const pickImages = async (files: FileList | null) => {
    const cur = diaryRef.current;
    if (!cur || !files) return;
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 9);
    if (list.length === 0) return;
    const read = (f: File) =>
      new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(f);
      });
    const results = await Promise.all(list.map(read));
    const raw = results.filter((u): u is string => !!u);
    if (raw.length === 0) return;
    // 并行压缩，全部完成后再一次性写入（避免逐张 patch 触发多次保存）
    const urls = await Promise.all(raw.map(compressImage));
    const next = [...(cur.images ?? []), ...urls].slice(0, 12);
    patch({ images: next });
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeImage = (idx: number) => {
    const cur = diaryRef.current;
    if (!cur) return;
    patch({ images: (cur.images ?? []).filter((_, i) => i !== idx) });
  };

  /** 单篇导出（日记视图的 📤；手机端 DOCX/PDF 不支持 → 提示，不静默） */
  const doExportSingle = async (fmt: 'txt' | 'docx' | 'pdf') => {
    const cur = diaryRef.current;
    if (!cur) return;
    setExportMenuOpen(false);
    setExporting(true);
    try {
      const entry = { title: cur.title || '无标题', date: cur.date, content: cur.content };
      let r: { ok?: boolean; error?: string } | undefined;
      if (fmt === 'txt') {
        r = await ipc.diary.exportTxt([entry]);
      } else if (fmt === 'docx') {
        r = await ipc.diary.exportDocx([entry]);
      } else {
        const html =
          '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
          '<style>body{font-family:"Noto Sans SC",sans-serif;color:#1A1A2E;padding:24px}'
          + '.title{font-size:20px;font-weight:700;margin-bottom:4px}.date{font-size:12px;color:#6B7280;margin-bottom:12px}'
          + '.content{font-size:14px;line-height:1.9;white-space:pre-wrap}</style></head><body>' +
          `<div class="title">${escapeHtml(entry.title)}</div><div class="date">${entry.date}</div><div class="content">${escapeHtml(entry.content)}</div>` +
          '</body></html>';
        r = await ipc.diary.exportPdf(html);
      }
      // 手机端不支持时返回 { ok:false, error } 不抛异常 → 弹出提示
      if (r && r.ok === false) {
        alert(r.error || '导出失败');
      }
    } catch {
      /* 忽略导出失败 */
    } finally {
      setExporting(false);
    }
  };


  if (!diary) {
    return <div className="vg-loading-skeleton p-4" role="status" aria-label="正在打开日记">{[0, 1, 2].map(i => <div className="vg-skeleton-card" key={i} aria-hidden="true"><i /><span><i /><i /><i /></span></div>)}</div>;
  }

  return (
    <SwipeBackView enabled onBack={requestBack} className="bg-app">
    <div className="vg-diary-writing-page h-full flex flex-col bg-app" data-save-state={saveState}>
      {/* 头部 */}
      <div className="vg-diary-header vg-diary-writing-header h-14 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 border-b border-line shrink-0">
        {isPast ? (
          <>
            <button onClick={requestBack} className="flex items-center gap-1.5 text-sm text-sub hover:text-ink transition-colors shrink-0">
              <Icon name="back" size={18} /> 返回手账
            </button>
            <span className="text-sm font-semibold text-ink truncate">{formatDateFull(date)}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-sub shrink-0 hidden sm:inline">已归档 · 可补写</span>

            {/* 写作 / 日记视图切换（归档日只允许追加，已有段落不可改） */}
            <button
              onClick={() => setViewMode(viewMode === 'write' ? 'diary' : 'write')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-all border border-line-strong text-sub hover:text-ink shrink-0"
            >
              <Icon name={viewMode === 'write' ? 'diary' : 'edit'} size={16} />{viewMode === 'write' ? '日记视图' : '补写'}
            </button>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-ink truncate">{formatDateFull(date)}</span>

            {/* 写作 / 日记视图切换 */}
            <button
              onClick={() => setViewMode(viewMode === 'write' ? 'diary' : 'write')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-all border border-line-strong text-sub hover:text-ink shrink-0"
            >
              <Icon name={viewMode === 'write' ? 'diary' : 'edit'} size={16} />{viewMode === 'write' ? '日记视图' : '回到写作'}
            </button>
          </>
        )}

        <div className="flex-1 min-w-0" />

        {/* 5.0：这一页谁能看到（仅自己 / 告诉某角色 / 加入共同世界）。
            与下面的「分享给角色」是两件事：分享=发一条消息；授权=TA 以后能知道并能提起它 */}
        {diary && (
          <DiarySharingControl
            diary={diary}
            compact={isPast}
            onChange={(next) => { diaryRef.current = next; setDiary(next); }}
          />
        )}

        {!isPast && (
          <>
            {/* 关联角色（自定义下拉，避免原生 select 白框） */}
        <div className="relative shrink-0">
          <button
            onClick={() => setRoleMenuOpen((v) => !v)}
            aria-label="日记关联角色"
            aria-haspopup="dialog"
            aria-expanded={roleMenuOpen}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface border border-line text-xs text-sub hover:text-ink transition-colors max-w-[130px] sm:max-w-[180px]"
          >
            {linkedChar ? (
              <span className="flex items-center gap-1.5 min-w-0">
                {avatarImageSrc(linkedChar.avatar) ? (
                  <img src={avatarImageSrc(linkedChar.avatar)} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
                ) : (
                  <span className="shrink-0">{linkedChar.avatar}</span>
                )}
                <span className="truncate">{linkedChar.name}</span>
              </span>
            ) : (
              '不关联角色'
            )}
            <Icon name="chevron" size={14} className="rotate-90 shrink-0" />
          </button>
          {roleMenuOpen && (
            <Modal open presentation="dialog" title="关联一位角色" width="max-w-sm" onClose={()=>setRoleMenuOpen(false)} canSnapshotOnExit={()=>false} panelClassName="vg-diary">
              <div className="max-h-[70vh] overflow-y-auto py-2">
                <button
                  onClick={() => { patch({ characterId: undefined }); setRoleMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                >
                  <Icon name="close" size={18} /> 不关联角色
                </button>
                {characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { patch({ characterId: c.id }); setRoleMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors"
                  >
                    {avatarImageSrc(c.avatar) ? (
                      <img src={avatarImageSrc(c.avatar)} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                    ) : (
                      <span className="shrink-0 text-base">{c.avatar}</span>
                    )}
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            </Modal>
          )}
        </div>
          </>
        )}

        {/* 删除（当天可删；归档日只允许删除、不可编辑） */}
        <button onClick={() => setShowDelete(true)} title="删除这一天" aria-label="删除这一天" className="vg-diary-icon px-2.5 py-1.5 rounded-lg text-sm text-sub hover:bg-red-500/10 hover:text-red-400 transition-colors shrink-0 flex items-center justify-center">
          <Icon name="trash" size={18} />
        </button>
      </div>

      {saveState === 'error' && <div className="vg-diary-save-error px-4 py-2"><FeedbackNotice tone="error" message="尚未保存，内容仍在。" /><button ref={retrySaveButton} type="button" className="vg-button vg-button-secondary mt-2" onClick={()=>void retrySave()}>重试保存</button></div>}

      {/* 写作模式：聊天气泡（当天可写；归档日只允许追加，已有段落不可改） */}
      {viewMode === 'write' ? (
      <>
      {/* 消息区 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5"
      >
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="flex justify-center">
            <span className="text-xs text-sub bg-panel px-3 py-0.5 rounded-full">{formatDateFull(date)}</span>
          </div>

          {segments.length === 0 && (
            <div className="text-center py-10">
              <Icon name="diary" size={32} className="mx-auto mb-3 text-[color:var(--vg-accent)]" />
              <p className="text-sm text-sub">写下今天想记住的事…</p>
              <p className="text-xs text-sub mt-1">每一段都会自动保存到今天的日记里</p>
            </div>
          )}

          {segments.map((seg, i) => (
            <div key={i} className="group relative flex flex-col items-end gap-2">
              {/* 段落操作：桌面悬停显示；手机端常显（触摸无 hover） */}
              {!isPast && (
                <div className="vg-diary-segment-tools flex items-center gap-0.5 px-1 py-0.5 rounded-lg sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" role="group" aria-label={`第${i + 1}段操作`}>
                  <button
                    onClick={() => { setEditingIdx(i); setEditingText(seg); }}
                    title="编辑这段"
                    className="vg-diary-icon w-6 h-6 flex items-center justify-center text-xs text-sub hover:text-gene-purple rounded transition-colors"
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    onClick={() => moveSegment(i, -1)}
                    disabled={i === 0}
                    title="上移"
                    className="vg-diary-icon w-6 h-6 flex items-center justify-center text-xs text-sub hover:text-gene-purple rounded transition-colors disabled:opacity-30"
                  >
                    <Icon name="back" size={16} className="rotate-90" />
                  </button>
                  <button
                    onClick={() => moveSegment(i, 1)}
                    disabled={i === segments.length - 1}
                    title="下移"
                    className="vg-diary-icon w-6 h-6 flex items-center justify-center text-xs text-sub hover:text-gene-purple rounded transition-colors disabled:opacity-30"
                  >
                    <Icon name="chevron" size={16} className="rotate-90" />
                  </button>
                  <button
                    onClick={() => deleteSegment(i)}
                    title="删除这段"
                    className="vg-diary-icon w-6 h-6 flex items-center justify-center text-xs text-sub hover:text-red-400 rounded transition-colors"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )}
              {editingIdx === i ? (
                <div className="vg-diary-segment-editor max-w-[85%] w-full rounded-2xl px-3 py-2.5">
                  <textarea
                    aria-label={`编辑第${i + 1}段`}
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={Math.max(2, Math.min(6, editingText.split('\n').length + 1))}
                    autoFocus
                    className="w-full resize-none bg-transparent text-sm text-ink leading-relaxed outline-none"
                  />
                  <div className="flex items-center justify-end gap-2 mt-1.5">
                    <button onClick={() => setEditingIdx(null)} className="px-3 py-1 rounded-lg text-xs text-sub hover:bg-surface transition-colors">取消</button>
                    <button
                      onClick={saveSegmentEdit}
                      disabled={!editingText.trim()}
                      className="vg-diary-save px-3 py-1 rounded-lg text-xs transition-colors disabled:opacity-40"
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <div className="vg-diary-segment max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md text-sm leading-relaxed whitespace-pre-wrap">
                  {seg}
                </div>
              )}
            </div>
          ))}

          {(diary.images ?? []).length > 0 && (
            <div className="flex justify-end">
              <div className="vg-diary-illustrations vg-diary-draft-images" data-count={(diary.images ?? []).length}>
                {(diary.images ?? []).map((img, idx) => (
                  <div key={idx} className="group/img">
                    <img src={img} alt={`日记插图 ${idx + 1}`} loading="lazy" decoding="async" />
                    {!isPast && (
                      <button
                        onClick={() => removeImage(idx)}
                        title="删除图片"
                        className="vg-diary-icon absolute top-1 right-1 flex sm:hidden w-6 h-6 items-center justify-center rounded-full bg-black/60 text-white text-xs hover:bg-red-500/80 transition-colors sm:group-hover/img:flex"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {guides.map((g) => (
            <div key={g.id} className="flex justify-start items-start gap-2 animate-message-in">
              <Icon name="spark" size={22} className="shrink-0 text-[color:var(--vg-cyan)]" />
              <div className="max-w-[78%] px-4 py-3 rounded-2xl rounded-bl-md bg-msgai text-msgaitxt text-sm leading-relaxed border-l-2 border-life-cyan">
                {g.text}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start items-center gap-2">
              <Icon name="spark" size={22} className="text-[color:var(--vg-cyan)]" />
              <span className="text-xs text-sub animate-pulse">正在聆听…</span>
            </div>
          )}
          </div>

          {/* 上翻历史时的新内容提示 */}
          {showNewHint && (
            <div className="sticky bottom-4 flex justify-center pointer-events-none">
              <button
                onClick={scrollToLatest}
                className="pointer-events-auto px-3 py-1.5 rounded-full glass-card text-xs text-life-cyan shadow-lg animate-fade-in"
              >
                ↓ 新内容
              </button>
            </div>
          )}
      </div>

      {/* 工具条：心情 + 标签 + AI */}
      <div className="vg-diary-compose-shell border-t border-line" data-options-open={composeOptionsOpen}>
        <div className="vg-diary-compose max-w-2xl mx-auto px-4 py-2 space-y-2">
          <button type="button" className="vg-diary-compose-toggle" aria-expanded={composeOptionsOpen} aria-controls={composeOptionsId} onClick={()=>setComposeOptionsOpen(open=>!open)}>心情、天气与标签<Icon name="chevron" size={16} /></button>
          <div id={composeOptionsId} className="vg-diary-compose-options space-y-2" data-expanded={composeOptionsOpen}>
          {/* 心情 + 标签 */}
          <div className="flex items-center gap-2 flex-wrap">
            {DIARY_MOODS.map((m) => (
              <button
                key={m.value}
                onClick={() => patch({ mood: m.value })}
                aria-pressed={diary.mood === m.value}
                aria-label={m.label}
                title={m.label}
                className={`vg-diary-icon w-8 h-8 rounded-full flex items-center justify-center text-base transition-all ${
                  diary.mood === m.value ? 'ring-2 ring-gene-purple/50 bg-surface' : 'opacity-60 hover:opacity-100 hover:bg-surface'
                }`}
              >
                {m.emoji}
              </button>
            ))}
            <span className="text-xs" style={{ color: moodColor(diary.mood) }}>
              {moodEmoji(diary.mood)} {DIARY_MOODS.find((m) => m.value === diary.mood)?.label}
            </span>

            {/* 天气（正式日记格式） */}
            <span className="w-px h-5 bg-line mx-1" />
            <div className="flex items-center gap-1">
              {DIARY_WEATHERS.map((w) => (
                <button
                  key={w.value}
                  onClick={() => patch({ weather: diary.weather === w.value ? undefined : w.value })}
                  aria-pressed={diary.weather === w.value}
                  aria-label={w.label}
                  title={w.label}
                  className={`vg-diary-icon w-8 h-8 rounded-full flex items-center justify-center text-base transition-all ${
                    diary.weather === w.value ? 'ring-2 ring-life-cyan/60 bg-surface' : 'opacity-60 hover:opacity-100 hover:bg-surface'
                  }`}
                >
                  {w.value}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            {/* 插图 */}
            <button
              onClick={() => fileRef.current?.click()}
              title="插入图片"
              className="px-2.5 py-1 rounded-full bg-surface border border-line text-xs text-sub hover:border-gene-purple/40 hover:text-ink transition-colors"
            >
              <span className="inline-flex items-center gap-1"><Icon name="image" size={16} /> 插图</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => pickImages(e.target.files)}
            />

            {/* 标签 */}
            <TagInput value={diary.tags ?? []} onChange={tags => patch({ tags })} suggestions={DIARY_TAGS} label="日记标签" placeholder="添加标签" />
          </div>

          {/* AI 辅助 */}
          {diaryAiEnabled && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-sub">AI</span>
              <button
                onClick={() => setExtractOpen(true)}
                disabled={busy}
                className="px-2.5 py-1 rounded-full bg-surface border border-line text-xs text-sub hover:border-gene-purple/40 hover:text-ink transition-colors disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1"><Icon name="spark" size={16} /> 生成日记草稿</span>
              </button>
              <span className="text-xs text-sub">结合角色对话或整理片段成日记，采纳可替换或追加</span>
            </div>
          )}

          </div>
          {/* 输入区 */}
          <div className="vg-diary-compose-input flex items-end gap-2 pb-2">
            <button
              onClick={requestBack}
              title="返回手账"
              className="shrink-0 px-2 py-2.5 text-sm text-sub hover:text-ink transition-colors"
            >
              <Icon name="back" size={20} />
            </button>
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <textarea
                aria-label="写下日记片段"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
                }}
                placeholder="写点什么…"
                rows={1}
                className="vg-text-field w-full resize-none px-4 py-2.5 text-sm"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-sub" role="status" aria-live="polite">
                  {saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '尚未保存' : savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '保存片段，留下此刻'}
                </span>
              </div>
            </div>
            <button
              onClick={() => void send()}
              aria-label="保存日记片段"
              disabled={!input.trim() || sending}
              className="vg-diary-save vg-diary-icon shrink-0 w-11 h-11 rounded-xl flex items-center justify-center disabled:opacity-30"
            >
              <Icon name="send" size={18} />
            </button>
          </div>
        </div>
      </div>
      </>
      ) : (
        /* 日记视图：正式日记格式 */
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <DiaryView diary={diary} />
          <div className="max-w-2xl mx-auto mt-6 space-y-3">
            <div className="flex items-center gap-3">
              <button onClick={requestBack} title="返回手账" className="vg-button vg-button-ghost shrink-0">
                <Icon name="back" size={18} /> 手账
              </button>
              <button
                onClick={() => setViewMode('write')}
                className="vg-button vg-button-primary flex-1"
              >
                <Icon name="edit" size={18} /> {isPast ? '补写这一天' : '继续写'}
              </button>
            </div>
            {isPast && <p className="text-xs leading-relaxed text-sub">这一天已归档。补写只追加新段落，已有内容保持原样。</p>}
            <div className="flex flex-wrap gap-2">
            {/* 发给角色（聊天主界面：让 TA 看看你的一天） */}
            <button
              onClick={() => { setShareCharId(diary.characterId ?? ''); setShareOpen(true); }}
              disabled={characters.length === 0}
              title={characters.length === 0 ? '还没有角色，先去基因实验室培育一个' : '把这一天发给角色聊聊'}
              className="vg-button vg-button-secondary flex-1 whitespace-nowrap disabled:opacity-40"
            >
              <Icon name="send" size={18} /> 发给角色
            </button>
            {/* 单篇导出 */}
              <button
                onClick={() => setExportMenuOpen((v) => !v)}
                title="导出这一天"
                aria-haspopup="dialog"
                aria-expanded={exportMenuOpen}
                className="vg-button vg-button-secondary flex-1 whitespace-nowrap"
              >
                <Icon name="download" size={18} /> 导出这一天
              </button>
              {exportMenuOpen && (
                <Modal open presentation="dialog" title="导出这一天" width="max-w-sm" onClose={()=>setExportMenuOpen(false)} canSnapshotOnExit={()=>false} panelClassName="vg-diary">
                  <div className="py-2">
                    {([['pdf', '导出 PDF'], ['docx', '导出 Word'], ['txt', '导出文本']] as const).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => void doExportSingle(k)}
                        disabled={exporting}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-sub hover:bg-surface transition-colors disabled:opacity-40"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Modal>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      <Modal presentation="dialog" open={showDelete} onClose={() => setShowDelete(false)} width="max-w-sm" closeOnBackdrop={false}>
        <div className="vg-delete-confirmation m-5">
          <p className="text-sm text-sub mb-2">删除这一天（{formatDateFull(date)}）的日记？</p>
          <p className="text-xs text-sub mb-6">日记会移入回收站，7 天内可以恢复。</p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowDelete(false)} className="px-4 py-2 rounded-lg text-sm text-sub hover:bg-surface transition-colors">取消</button>
            <button
              onClick={() => {
                void deleteDiary(diary.id).then(() => { if (useAuthStore.getState().userId !== diary.userId) return; feedback('日记已移入回收站，7 天内可以恢复', { tone: 'success' }); setShowDelete(false); onBack(); }).catch(() => feedback('日记未能删除，内容已保留', { tone: 'error' }));
              }}
              className="px-4 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              确认删除
            </button>
          </div>
        </div>
      </Modal>

      {/* AI 生成日记草稿弹窗 */}
      <ExtractModal
        open={extractOpen}
        onClose={() => setExtractOpen(false)}
        characterId={diary.characterId}
        characterName={linkedChar?.name}
        diaryContent={diary.content}
        appendOnly={isPast}
        onInsert={insertExtract}
      />

      {/* 把这一天发给角色 */}
      <Modal presentation="dialog" open={shareOpen} onClose={() => setShareOpen(false)} title="分享日记" width="max-w-sm" closeOnBackdrop={false}>
        <div className="p-6">
          <p className="text-sm text-sub mb-1">把这一天发给角色</p>
          <p className="text-xs text-sub mb-4">会以你的身份把这篇日记发到 TA 的会话里，TA 会回应你的一天。</p>
          <FilterSelect
            value={shareCharId}
            onChange={setShareCharId}
            placeholder="选择角色…"
            options={characters.map((c) => ({ value: c.id, label: `${c.avatar} ${c.name}` }))}
            className="w-full"
            buttonClassName="flex items-center gap-1.5 w-full px-3 py-2 rounded-lg bg-surface border border-line text-sm text-ink hover:border-gene-purple/40 transition-colors"
          />
          <div className="flex gap-3 justify-end mt-5">
            <button onClick={() => setShareOpen(false)} className="px-4 py-2 rounded-lg text-sm text-sub hover:bg-surface transition-colors">取消</button>
            <button
              onClick={() => void shareToCharacter()}
              disabled={!shareCharId}
              className="px-4 py-2 rounded-lg text-sm bg-gene-purple hover:bg-[#5B4BD4] text-white transition-all disabled:opacity-40"
            >
              💌 发给 TA
            </button>
          </div>
        </div>
      </Modal>
    </div>
    </SwipeBackView>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
