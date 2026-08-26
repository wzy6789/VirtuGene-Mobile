import { create } from 'zustand';
import { db } from '../db/index';
import { diaryRepo } from '../db/diary-repo';
import { useAuthStore } from './auth-store';
import type { Diary } from '../db/index';

export type DiaryView = 'calendar' | 'timeline' | 'tags';

interface DiaryState {
  diaries: Diary[];
  trash: Diary[];
  loaded: boolean;
  view: DiaryView;
  search: string;
  moodFilter: number | null;
  yearFilter: string | null;
  tagFilter: string | null;

  load: () => Promise<void>;
  createDiary: (input: {
    date: string;
    title: string;
    content: string;
    mood: number;
    tags: string[];
    characterId?: string;
  }) => Promise<Diary | null>;
  /** 聊天式书写：取指定日期那篇日记，不存在则创建（一天一篇，追加式） */
  getOrCreateForDate: (date: string) => Promise<Diary | null>;
  updateDiary: (id: string, patch: Partial<Diary>) => Promise<void>;
  /** 软删除：移入回收站（可恢复） */
  deleteDiary: (id: string) => Promise<void>;
  /** 从回收站恢复 */
  restoreDiary: (id: string) => Promise<void>;
  /** 回收站内彻底删除 */
  purgeDiary: (id: string) => Promise<void>;
  /** 登出/切换账号时清空内存数据，避免下个账号看到上一个账号的日记闪烁 */
  reset: () => void;
  setView: (view: DiaryView) => void;
  setSearch: (s: string) => void;
  setMoodFilter: (m: number | null) => void;
  setYearFilter: (y: string | null) => void;
  setTagFilter: (t: string | null) => void;
  clearFilters: () => void;
}

/** 新用户默认欢迎日记（幂等：只有用户从未写过任何日记（含回收站）时才创建） */
async function ensureWelcomeDiary(userId: string): Promise<Diary | null> {
  // 用未过滤的原始计数：只要写过（哪怕已删除进回收站）就不再创建欢迎日记
  const rawCount = await db.diaries.where('userId').equals(userId).count();
  if (rawCount > 0) return null;
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const id = await diaryRepo.create({
    userId,
    date: `${d.getFullYear()}-${mm}-${dd}`,
    title: '我的第一篇日记',
    content:
      '欢迎来到你的日记世界 📓\n\n这里只属于你：写写今天的心情、记下想记住的事，也可以让 AI 帮你润色或续写。\n\n把每一天的思绪收进基因序列里，日后翻看，都是灵魂的印记。',
    mood: 3,
    tags: ['第一篇'],
  });
  return (await diaryRepo.getById(id)) ?? null;
}

export const useDiaryStore = create<DiaryState>((set, get) => ({
  diaries: [],
  trash: [],
  loaded: false,
  view: 'calendar',
  search: '',
  moodFilter: null,
  yearFilter: null,
  tagFilter: null,

  load: async () => {
    const userId = useAuthStore.getState().userId ?? '';
    if (!userId) return;
    // 回收站清理：超过 7 天的软删除日记彻底清除（幂等）
    await diaryRepo.purgeExpired(userId);
    let diaries = await diaryRepo.getByUser(userId);
    // 旧数据迁移：同一天多篇 → 合并成一篇（幂等）
    if (diaries.some((d, i, arr) => arr.findIndex((x) => x.date === d.date) !== i)) {
      diaries = await diaryRepo.mergeDuplicateDates(userId);
    }
    if (diaries.length === 0) {
      const welcome = await ensureWelcomeDiary(userId);
      if (welcome) diaries = [welcome, ...diaries];
    }
    const trash = await diaryRepo.getTrash(userId);
    set({ diaries, trash, loaded: true });
  },

  createDiary: async (input) => {
    const userId = useAuthStore.getState().userId ?? '';
    if (!userId) return null;
    const id = await diaryRepo.create({ userId, ...input });
    const created = await diaryRepo.getById(id);
    if (created) {
      set((s) => ({ diaries: [created, ...s.diaries] }));
    }
    return created ?? null;
  },

  getOrCreateForDate: async (date) => {
    const userId = useAuthStore.getState().userId ?? '';
    if (!userId) return null;
    const existing = await diaryRepo.getByDate(userId, date);
    if (existing.length > 0) {
      const d = existing[0];
      if (!get().diaries.some((x) => x.id === d.id)) {
        set((s) => ({ diaries: [d, ...s.diaries] }));
      }
      return d;
    }
    return get().createDiary({ date, title: '', content: '', mood: 3, tags: [] });
  },

  updateDiary: async (id, patch) => {
    await diaryRepo.update(id, patch);
    set((s) => ({
      diaries: s.diaries.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)),
    }));
  },

  deleteDiary: async (id) => {
    await diaryRepo.softDelete(id);
    const removed = get().diaries.find((d) => d.id === id);
    set((s) => ({
      diaries: s.diaries.filter((d) => d.id !== id),
      trash: removed ? [removed, ...s.trash] : s.trash,
    }));
  },

  restoreDiary: async (id) => {
    await diaryRepo.restore(id);
    const restored = get().trash.find((d) => d.id === id);
    if (!restored) { await get().load(); return; }
    const clean = { ...restored } as Diary;
    delete (clean as Partial<Diary>).deletedAt;
    // 按日期倒序插回正确位置
    const diaries = [...get().diaries, clean].sort((a, b) => b.date.localeCompare(a.date));
    set((s) => ({
      trash: s.trash.filter((d) => d.id !== id),
      diaries,
    }));
  },

  purgeDiary: async (id) => {
    await diaryRepo.purge(id);
    set((s) => ({ trash: s.trash.filter((d) => d.id !== id) }));
  },

  setView: (view) => set({ view }),
  setSearch: (search) => set({ search }),
  setMoodFilter: (moodFilter) => set({ moodFilter }),
  setYearFilter: (yearFilter) => set({ yearFilter }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  clearFilters: () => set({ search: '', moodFilter: null, yearFilter: null, tagFilter: null }),
  reset: () => set({ diaries: [], trash: [], loaded: false, search: '', moodFilter: null, yearFilter: null, tagFilter: null }),
}));
