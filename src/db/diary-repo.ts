import { db, type Diary } from './index';

export interface DiaryInput {
  userId: string;
  date: string;
  title: string;
  content: string;
  mood: number;
  tags: string[];
  characterId?: string;
}

export const diaryRepo = {
  /** 活跃日记（不含回收站），按日期倒序 */
  async getByUser(userId: string): Promise<Diary[]> {
    return db.diaries
      .where('userId')
      .equals(userId)
      .filter((d) => !d.deletedAt)
      .sortBy('date')
      .then((arr) => arr.reverse());
  },

  /** 回收站日记（软删除的），按删除时间倒序 */
  async getTrash(userId: string): Promise<Diary[]> {
    return db.diaries
      .where('userId')
      .equals(userId)
      .filter((d) => !!d.deletedAt)
      .sortBy('deletedAt')
      .then((arr) => arr.reverse());
  },

  /** 全部日记（含回收站），用于完整备份 */
  async getAllForBackup(userId: string): Promise<Diary[]> {
    return db.diaries.where('userId').equals(userId).toArray();
  },

  async getByDate(userId: string, date: string): Promise<Diary[]> {
    return db.diaries
      .where('[userId+date]')
      .equals([userId, date])
      .filter((d) => !d.deletedAt)
      .sortBy('createdAt');
  },

  async getById(id: string): Promise<Diary | undefined> {
    return db.diaries.get(id);
  },

  async create(input: DiaryInput): Promise<string> {
    const now = Date.now();
    const diary: Diary = {
      id: crypto.randomUUID(),
      userId: input.userId,
      date: input.date,
      title: input.title,
      content: input.content,
      mood: input.mood,
      tags: input.tags ?? [],
      ...(input.characterId ? { characterId: input.characterId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await db.diaries.add(diary);
    return diary.id;
  },

  async update(id: string, patch: Partial<Omit<Diary, 'id' | 'userId' | 'createdAt'>>): Promise<number> {
    // 剔除 undefined（避免 Dexie 对 undefined 值的行为差异；null 则原样保存）
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) clean[k] = v;
    }
    return db.diaries.update(id, { ...clean, updatedAt: Date.now() } as Partial<Diary>);
  },

  /** 软删除：移入回收站（可恢复） */
  async softDelete(id: string): Promise<void> {
    await db.diaries.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
  },

  /** 从回收站恢复：必须真正删掉 deletedAt 字段（update 会剔除 undefined，需先取出再写回） */
  async restore(id: string): Promise<void> {
    const d = await db.diaries.get(id);
    if (!d) return;
    const { deletedAt: _gone, ...rest } = d as Diary & { deletedAt?: number };
    await db.diaries.put({ ...rest, updatedAt: Date.now() } as Diary);
  },

  /** 彻底删除（回收站内） */
  async purge(id: string): Promise<void> {
    await db.diaries.delete(id);
  },

  /** 清理回收站中超过 7 天的日记（幂等） */
  async purgeExpired(userId: string): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const trash = await db.diaries.where('userId').equals(userId).filter((d) => !!d.deletedAt && d.deletedAt! < cutoff).toArray();
    await db.diaries.bulkDelete(trash.map((d) => d.id));
  },

  /**
   * 导入恢复：按「日期去重」策略写入——用户已有该日期的日记则跳过，否则新建。
   * 返回 { imported, skipped }。
   */
  async importBackup(userId: string, items: { date: string; title?: string; content?: string; mood?: number; tags?: string[]; weather?: string; characterId?: string; images?: string[]; aiNote?: string; aiNoteAt?: number }[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;
    for (const it of items) {
      if (!it.date) continue;
      const existing = await db.diaries.where('[userId+date]').equals([userId, it.date]).filter((d) => !d.deletedAt).count();
      if (existing > 0) { skipped++; continue; }
      await this.create({
        userId,
        date: it.date,
        title: it.title ?? '',
        content: it.content ?? '',
        mood: it.mood ?? 3,
        tags: it.tags ?? [],
        characterId: it.characterId,
      }).then(async (id) => {
        const extra: Partial<Diary> = {};
        if (it.images && it.images.length > 0) extra.images = it.images;
        if (it.weather) extra.weather = it.weather;
        if (it.aiNote) extra.aiNote = it.aiNote;
        if (it.aiNoteAt) extra.aiNoteAt = it.aiNoteAt;
        if (Object.keys(extra).length > 0) {
          await this.update(id, extra);
        }
      });
      imported++;
    }
    return { imported, skipped };
  },

  async deleteById(id: string): Promise<void> {
    await db.diaries.delete(id);
  },

  async countByUser(userId: string): Promise<number> {
    return db.diaries.where('userId').equals(userId).filter((d) => !d.deletedAt).count();
  },

  /**
   * 旧数据迁移：早期版本允许同一天写多篇，现为「一天一篇」。
   * 把同一天的日记合并成一篇（段落拼接、标签并集、心情取均值），删除多余记录。幂等。
   */
  async mergeDuplicateDates(userId: string): Promise<Diary[]> {
    const all = await db.diaries.where('userId').equals(userId).filter((d) => !d.deletedAt).toArray();
    const byDate = new Map<string, Diary[]>();
    for (const d of all) {
      const list = byDate.get(d.date);
      if (list) list.push(d);
      else byDate.set(d.date, [d]);
    }
    const out: Diary[] = [];
    for (const [, list] of byDate) {
      if (list.length === 1) {
        out.push(list[0]);
        continue;
      }
      const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
      const first = sorted[0];
      const content = sorted.map((d) => d.content.trim()).filter(Boolean).join('\n\n');
      const tags = [...new Set(sorted.flatMap((d) => d.tags ?? []))];
      const mood = Math.round(sorted.reduce((s, d) => s + (d.mood ?? 3), 0) / sorted.length);
      const title = first.title || sorted.map((d) => d.title).find((t) => t && t.trim()) || '';
      const images = [...new Set(sorted.flatMap((d) => d.images ?? []))];
      // 合并时保留 AI 批注（取任意一条非空批注）
      const aiNote = sorted.find((d) => d.aiNote)?.aiNote;
      const aiNoteAt = sorted.find((d) => d.aiNoteAt)?.aiNoteAt;
      await this.update(first.id, { content, tags, mood, title, images, ...(aiNote ? { aiNote, ...(aiNoteAt ? { aiNoteAt } : {}) } : {}) });
      for (const d of sorted.slice(1)) {
        await this.deleteById(d.id);
      }
      out.push({ ...first, content, tags, mood, title, images, ...(aiNote ? { aiNote, ...(aiNoteAt ? { aiNoteAt } : {}) } : {}) });
    }
    return out;
  },
};

/** 本地日期 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
