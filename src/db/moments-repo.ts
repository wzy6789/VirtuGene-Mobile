import { db, type Character, type Moment, type MomentContact, type MomentMedia, type MomentNotification, type MomentReaction, type MomentView } from './index';
import { characterRepo } from './character-repo';
import { stateRepo } from './state-repo';
import { sendMessage } from '../lib/ai/deepseek';
import { hasAiGatewayAccess } from '../lib/ai/gateway';
import { useAuthStore } from '../store/auth-store';
import { recallCharacterMemory } from '../lib/character-memory';

export type MomentAudience = {
  visibility: Moment['visibility'];
  characterIds?: string[];
};

export type MomentWithMedia = { moment: Moment; media: MomentMedia[] };

function contactId(userId: string, characterId: string): string {
  return `moment-contact:${userId}:${characterId}`;
}

function deterministicUnit(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  return (value >>> 0) / 4294967296;
}

/** 点赞和评论独立决定：角色可以只留评论，也可以只点赞或完全不互动。 */
export function planAutonomousMomentInteraction(momentId: string, character: Pick<Character, 'id' | 'proactivity' | 'tags'>, affinityValue: number, text: string): { like: boolean; comment: boolean } {
  const interest = text && (character.tags ?? []).some((tag) => tag.length > 1 && text.includes(tag)) ? 0.16 : 0;
  const affinity = Math.max(0, Math.min(0.28, affinityValue / 260));
  const activity = Math.max(0, Math.min(0.12, (character.proactivity ?? 0.5) * 0.12));
  const likeChance = 0.04 + affinity + activity + interest;
  const commentChance = Math.min(0.48, 0.12 + affinity * 0.7 + activity * 0.75 + interest * 0.8);
  return {
    like: deterministicUnit(`${momentId}:${character.id}:like`) < likeChance,
    comment: deterministicUnit(`${momentId}:${character.id}:comment`) < commentChance,
  };
}

async function generateComment(userId: string, character: Character, moment: Moment, reply?: MomentReaction): Promise<string | undefined> {
  const auth = useAuthStore.getState();
  if (auth.userId !== userId || (!auth.apiKey && !hasAiGatewayAccess())) return undefined;
  const postAuthor = moment.authorCharacterId ? await db.characters.get(moment.authorCharacterId) : undefined;
  const postOwner = postAuthor?.name ?? '用户';
  const recalled = await recallCharacterMemory({ userId, characterId: character.id, audience: moment.audienceCharacterIds, query: `朋友圈 ${moment.text} ${reply?.content ?? ''}`, sources: ['world', 'moment'], budget: 2200 });
  const prompt = `${character.systemPrompt}\n你正在看朋友圈里一条由${postOwner}发布的动态。以你自己的性格留一句自然、有具体回应的评论，最多60个汉字；可以不赞同，不必总是夸赞或提问。不要写动作或旁白，不要假装看清图片细节。没有配文时只知道对方发了图片。不要泄露私聊、日记或任何不在这条动态里的信息。`;
  const original = moment.text || `${postAuthor?.name ?? '用户'}发布了${moment.mediaIds.length}张图片，没有配文，图片内容未知。`;
  const thread = (await db.momentReactions.where('momentId').equals(moment.id)
    .filter(r => r.userId === userId && r.status === 'active' && r.type === 'comment').toArray())
    .sort((a,b) => a.createdAt-b.createdAt).slice(-12);
  const threadLines = await Promise.all(thread.map(async r => {
    const author = r.characterId ? (await db.characters.get(r.characterId))?.name ?? '角色' : '用户';
    const parent = r.replyToId ? await db.momentReactions.get(r.replyToId) : undefined;
    const validParent = parent?.userId === userId && parent.momentId === moment.id && parent.status === 'active' ? parent : undefined;
    const to = validParent ? (validParent.characterId ? (await db.characters.get(validParent.characterId))?.name ?? '角色' : '用户') : '';
    return `${author}${to ? `回复${to}` : ''}：${r.content ?? ''}`;
  }));
  const message = reply
    ? `原动态：${original}\n评论区真实对话：\n${threadLines.join('\n')}\n用户在评论区回复你：${reply.content}\n请继续这个评论区对话，只以你自己的身份回应。`
    : `原动态：${original}\n请写一句朋友圈评论。`;
  const result = await sendMessage({ apiKey: auth.apiKey ?? '', systemPrompt: `${prompt}\n${recalled.text}`, message, history: [], character, temperature: 0.75 });
  return result.content.split('---')[0]?.replace(/[\r\n]+/g, ' ').trim().slice(0, 100) || undefined;
}

async function generateCharacterPost(userId: string, character: Character, source: string): Promise<string | undefined> {
  const auth = useAuthStore.getState();
  if (auth.userId !== userId || (!auth.apiKey && !hasAiGatewayAccess())) return undefined;
  const audience = (await characterRepo.getByCreator(userId)).map(c => c.id);
  const recalled = await recallCharacterMemory({userId, characterId: character.id, audience, query: source, sources:['world','moment'], budget:1600});
  const prompt = `${character.systemPrompt}\n你偶尔会发一条朋友圈。请把刚才这段经历化成一句像你本人会发的生活动态，最多80个汉字，可以有一点情绪或留白，但不要提到“AI”、提示词、系统，也不要泄露用户的私聊、日记、姓名、隐私或未公开信息。不要写动作脚本，不要加引号，不要带标题。`;
  const result = await sendMessage({
    apiKey: auth.apiKey ?? '',
    systemPrompt: `${prompt}\n${recalled.text}`,
    message: `刚才发生的片段：${source.slice(0, 700)}`,
    history: [],
    character,
    temperature: 0.82,
  });
  return result.content.split('---')[0]?.replace(/[\r\n]+/g, ' ').trim().slice(0, 120) || undefined;
}

async function listContactCharacters(userId: string): Promise<Character[]> {
  // 聊天列表中的角色就是朋友圈联系人；预设只有克隆进当前账号后才会进入这里。
  return characterRepo.getByCreator(userId);
}

async function isBlocked(userId: string, characterId: string): Promise<boolean> {
  const row = await db.momentContacts.get(contactId(userId, characterId));
  return row?.blocked === true;
}

export async function visibleToCharacter(moment: Moment, characterId: string): Promise<boolean> {
  if (moment.deleted || moment.visibility === 'private') return false;
  if (await isBlocked(moment.userId, characterId)) return false;
  return moment.audienceCharacterIds.includes(characterId);
}

export const momentsRepo = {
  async contacts(userId: string): Promise<Character[]> {
    return listContactCharacters(userId);
  },

  async contactSettings(userId: string): Promise<MomentContact[]> {
    return db.momentContacts.where('userId').equals(userId).toArray();
  },

  async list(userId: string, limit = 100): Promise<MomentWithMedia[]> {
    const rows = (await db.moments.where('userId').equals(userId).toArray())
      .filter((item) => !item.deleted)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
    const media = (await db.momentMedia.bulkGet(rows.flatMap((moment) => moment.mediaIds)))
      .filter((item): item is MomentMedia => Boolean(item && item.userId === userId));
    return rows.map((moment) => ({
      moment,
      media: media.filter((item) => item.momentId === moment.id).sort((a, b) => a.order - b.order),
    }));
  },

  async create(userId: string, text: string, audience: MomentAudience, images: Omit<MomentMedia, 'id' | 'userId' | 'momentId' | 'createdAt'>[] = []): Promise<Moment> {
    const body = text.trim().slice(0, 2000);
    if (!body && images.length === 0) throw new Error('moment:empty');
    const contacts = await listContactCharacters(userId);
    const allIds = contacts.map((character) => character.id);
    const selected = [...new Set((audience.characterIds ?? []).filter((id) => allIds.includes(id)))];
    const audienceIds = audience.visibility === 'private'
      ? []
      : audience.visibility === 'selected'
        ? selected
        : audience.visibility === 'excluded'
          ? allIds.filter((id) => !selected.includes(id))
          : allIds;
    const id = crypto.randomUUID();
    const now = Date.now();
    const mediaIds = images.map(() => crypto.randomUUID());
    const moment: Moment = {
      id,
      userId,
      text: body,
      visibility: audience.visibility,
      audienceCharacterIds: audienceIds,
      visibilityRevision: 1,
      mediaIds,
      createdAt: now,
      updatedAt: now,
    };
    await db.transaction('rw', [db.moments, db.momentMedia, db.momentJobs], async () => {
      await db.moments.put(moment);
      for (let i = 0; i < images.length; i += 1) {
        await db.momentMedia.put({
          ...images[i],
          id: mediaIds[i],
          userId,
          momentId: id,
          createdAt: now,
        });
      }
      for (const characterId of audienceIds) {
        const delay = Math.round(20_000 + deterministicUnit(`${id}:${characterId}:delay`) * 150_000);
        await db.momentJobs.put({
          id: `moment-job:${id}:${characterId}`,
          userId,
          momentId: id,
          characterId,
          type: 'react',
          status: 'queued',
          visibilityRevision: moment.visibilityRevision,
          attempts: 0,
          availableAt: now + delay,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    return moment;
  },

  /** 角色偶尔发布一条自己的动态。机会按天固定，避免刷新页面重复抽签。 */
  async maybeCharacterPost(userId: string, character: Character, source: string, sessionId = ''): Promise<Moment | undefined> {
    if (character.createdBy !== userId || source.trim().length < 24) return undefined;
    const now = Date.now();
    const recent = await db.moments.where('userId').equals(userId).toArray();
    if (recent.some((item) => item.authorCharacterId === character.id && now - item.createdAt < 72 * 60 * 60 * 1000)) return undefined;
    if (recent.some((item) => item.authorCharacterId && now - item.createdAt < 24 * 60 * 60 * 1000)) return undefined;
    const day = Math.floor(now / 86400000);
    const chance = Math.min(0.2, 0.035 + Math.max(0, Math.min(1, character.proactivity ?? 0.5)) * 0.12);
    if (deterministicUnit(`moment-post:${character.id}:${day}:${sessionId}`) >= chance) return undefined;
    const text = await generateCharacterPost(userId, character, source);
    if (!text) return undefined;
    const contacts = await listContactCharacters(userId);
    const audienceIds = contacts.map((item) => item.id);
    const id = crypto.randomUUID();
    const moment: Moment = {
      id,
      userId,
      authorCharacterId: character.id,
      text,
      visibility: 'all',
      audienceCharacterIds: audienceIds,
      visibilityRevision: 1,
      mediaIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.transaction('rw', [db.moments, db.momentJobs], async () => {
      await db.moments.put(moment);
      for (const characterId of audienceIds.filter((id) => id !== character.id)) {
        await db.momentJobs.put({
          id: `moment-job:${id}:${characterId}`,
          userId,
          momentId: id,
          characterId,
          type: 'react',
          status: 'queued',
          visibilityRevision: 1,
          attempts: 0,
          availableAt: now + Math.round(30_000 + deterministicUnit(`${id}:${characterId}:delay`) * 180_000),
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    return moment;
  },

  /** 私聊中明确请求角色点赞；所有分支都返回真实状态，聊天层据此组织回应。 */
  async requestCharacterLike(userId: string, character: Character, force = false, momentId?: string): Promise<{
    status: 'liked' | 'already' | 'declined' | 'unavailable';
    moment?: Moment;
  }> {
    const rows = await db.moments.where('userId').equals(userId).toArray();
    const candidates = rows
      .filter((item) => !item.deleted && !item.authorCharacterId && (!momentId || item.id === momentId))
      .sort((a, b) => b.createdAt - a.createdAt);
    const moment = candidates.find((item) => item.audienceCharacterIds.includes(character.id) && item.visibility !== 'private');
    if (!moment || !(await visibleToCharacter(moment, character.id))) return { status: 'unavailable' };
    const likeId = `moment-like:${moment.id}:${character.id}`;
    const existing = await db.momentReactions.get(likeId);
    if (existing?.status === 'active') return { status: 'already', moment };
    const state = await stateRepo.getOrCreate(character.id, userId);
    const affinity = Math.max(0, Math.min(1, (state.affinity ?? 0) / 100));
    const warmth = Math.max(0, Math.min(1, character.proactivity ?? 0.5));
    const willing = force || deterministicUnit(`${likeId}:willing`) < 0.35 + affinity * 0.35 + warmth * 0.2;
    if (!willing) return { status: 'declined', moment };
    const now = Date.now();
    await db.transaction('rw', [db.momentReactions, db.momentNotifications], async () => {
      const latest = await db.momentReactions.get(likeId);
      if (latest?.status === 'active') return;
      await db.momentReactions.put({ id: likeId, userId, momentId: moment.id, characterId: character.id, type: 'like', status: 'active', createdAt: latest?.createdAt ?? now, updatedAt: now });
      await db.momentNotifications.put({ id: `moment-notice:like:${moment.id}:${character.id}`, userId, momentId: moment.id, characterId: character.id, type: 'like', preview: `${character.name} 点了赞`, read: false, createdAt: now });
    });
    return { status: 'liked', moment };
  },

  async updateAudience(userId: string, momentId: string, audience: MomentAudience): Promise<void> {
    const existing = await db.moments.get(momentId);
    if (!existing || existing.userId !== userId || existing.deleted) return;
    const contacts = await listContactCharacters(userId);
    const allIds = contacts.map((character) => character.id);
    const selected = [...new Set((audience.characterIds ?? []).filter((id) => allIds.includes(id)))];
    const audienceIds = audience.visibility === 'private'
      ? []
      : audience.visibility === 'selected'
        ? selected
        : audience.visibility === 'excluded'
          ? allIds.filter((id) => !selected.includes(id))
          : allIds;
    const next: Moment = { ...existing, visibility: audience.visibility, audienceCharacterIds: audienceIds, visibilityRevision: existing.visibilityRevision + 1, updatedAt: Date.now() };
    await db.transaction('rw', [db.moments, db.momentJobs], async () => {
      await db.moments.put(next);
      await db.momentJobs.where('momentId').equals(momentId).modify((job) => {
        if (job.status === 'queued' || job.status === 'running') {
          if (!audienceIds.includes(job.characterId)) job.status = 'cancelled';
          else job.visibilityRevision = next.visibilityRevision;
          job.updatedAt = Date.now();
        }
      });
      for (const characterId of audienceIds.filter((id) => !existing.audienceCharacterIds.includes(id))) {
        const id = `moment-job:${momentId}:${characterId}`;
        const prior = await db.momentJobs.get(id);
        if (prior?.status === 'done') continue;
        await db.momentJobs.put({ id, userId, momentId, characterId, type: 'react', status: 'queued',
          visibilityRevision: next.visibilityRevision, attempts: 0, availableAt: Date.now() + 30_000,
          createdAt: prior?.createdAt ?? Date.now(), updatedAt: Date.now() });
      }
    });
  },

  async remove(userId: string, momentId: string): Promise<void> {
    const existing = await db.moments.get(momentId);
    if (!existing || existing.userId !== userId) return;
    await db.transaction('rw', [db.moments, db.momentJobs, db.momentReactions, db.momentMedia, db.momentNotifications], async () => {
      await db.moments.put({ ...existing, deleted: true, visibilityRevision: existing.visibilityRevision + 1, updatedAt: Date.now() });
      await db.momentJobs.where('momentId').equals(momentId).modify((job) => { job.status = 'cancelled'; job.updatedAt = Date.now(); });
      await db.momentReactions.where('momentId').equals(momentId).modify((reaction) => { reaction.status = 'deleted'; reaction.updatedAt = Date.now(); });
      // 图片仍由 momentMedia 单独保存，删除动态后可以安全清掉对应附件。
      await db.momentMedia.where('momentId').equals(momentId).delete();
      await db.momentNotifications.where('momentId').equals(momentId).delete();
    });
  },

  async media(momentId: string, userId: string): Promise<MomentMedia[]> {
    return (await db.momentMedia.where('momentId').equals(momentId).toArray())
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.order - b.order);
  },

  async reactions(momentId: string, userId: string): Promise<MomentReaction[]> {
    return (await db.momentReactions.where('momentId').equals(momentId).toArray())
      .filter((item) => item.userId === userId && item.status === 'active')
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async toggleLike(userId: string, momentId: string): Promise<void> {
    const moment = await db.moments.get(momentId);
    if (!moment || moment.userId !== userId || moment.deleted) return;
    const existing = (await db.momentReactions.where('momentId').equals(momentId).toArray())
      .find((item) => item.userId === userId && item.characterId === undefined && item.type === 'like');
    if (existing) {
      await db.momentReactions.put({ ...existing, status: existing.status === 'active' ? 'withdrawn' : 'active', updatedAt: Date.now() });
    } else {
      const now = Date.now();
      await db.momentReactions.put({ id: crypto.randomUUID(), userId, momentId, type: 'like', status: 'active', createdAt: now, updatedAt: now });
    }
  },

  async addComment(userId: string, momentId: string, content: string, replyToId?: string): Promise<MomentReaction | undefined> {
    const moment = await db.moments.get(momentId);
    const body = content.trim().slice(0, 100);
    if (!moment || moment.userId !== userId || moment.deleted || !body) return undefined;
    const now = Date.now();
    const target = replyToId ? await db.momentReactions.get(replyToId) : undefined;
    const validTarget = target?.userId === userId && target.momentId === momentId && target.status === 'active' && target.type === 'comment' ? target : undefined;
    const row: MomentReaction = { id: crypto.randomUUID(), userId, momentId, type: 'comment', content: body, status: 'active', ...(validTarget ? { replyToId: validTarget.id } : {}), createdAt: now, updatedAt: now };
    const characterId = validTarget ? validTarget.characterId ?? moment.authorCharacterId : moment.authorCharacterId;
    const canReply = characterId ? await visibleToCharacter(moment, characterId) : false;
    await db.transaction('rw', [db.momentReactions, db.momentJobs], async () => {
      await db.momentReactions.put(row);
      if (characterId && canReply) {
        await db.momentJobs.put({
          id: `moment-reply:${row.id}:${characterId}`, userId, momentId, characterId, type: 'reply', replyToId: row.id,
          status: 'queued', visibilityRevision: moment.visibilityRevision, attempts: 0,
          availableAt: now + 15_000, createdAt: now, updatedAt: now,
        });
      }
    });
    return row;
  },

  async block(userId: string, characterId: string, blocked: boolean): Promise<void> {
    const row: MomentContact = { id: contactId(userId, characterId), userId, characterId, blocked, updatedAt: Date.now() };
    await db.momentContacts.put(row);
    if (blocked) {
      await db.momentJobs.where('characterId').equals(characterId).modify((job) => {
        if (job.userId === userId && job.status === 'queued') job.status = 'cancelled';
      });
    }
  },

  async unreadNotifications(userId: string): Promise<MomentNotification[]> {
    return (await db.momentNotifications.where('userId').equals(userId).toArray())
      .filter((item) => !item.read).sort((a, b) => b.createdAt - a.createdAt);
  },

  async notifications(userId: string, limit = 30): Promise<MomentNotification[]> {
    return (await db.momentNotifications.where('userId').equals(userId).toArray())
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(1, limit));
  },

  async markNotificationsRead(userId: string): Promise<void> {
    await db.momentNotifications.where('userId').equals(userId).modify({ read: true });
  },

  /** 前台恢复时处理到期任务。随机阈值固定，刷新不会重新抽签，也允许整条动态无人互动。 */
  async processJobs(userId: string, now = Date.now(), writeComment: typeof generateComment = generateComment): Promise<void> {
    const jobs = (await db.momentJobs.where('userId').equals(userId).toArray())
      .filter((job) => (job.status === 'queued' && job.availableAt <= now)
        || (job.status === 'running' && (job.leaseUntil ?? 0) <= now))
      .sort((a, b) => a.availableAt - b.availableAt)
      .slice(0, 3);
    for (const job of jobs) {
      const claim = await db.transaction('rw', db.momentJobs, async () => {
        const current = await db.momentJobs.get(job.id);
        if (!current || current.userId !== userId || !((current.status === 'queued' && current.availableAt <= now)
          || (current.status === 'running' && (current.leaseUntil ?? 0) <= now))) return false;
        await db.momentJobs.update(job.id, { status: 'running', leaseUntil: now + 120_000, attempts: current.attempts + 1, updatedAt: Date.now() });
        return true;
      });
      if (!claim) continue;
      try {
        const moment = await db.moments.get(job.momentId);
        const character = await characterRepo.getById(job.characterId);
        if (!moment || moment.userId !== userId || moment.deleted || !character || character.createdBy !== userId
          || moment.visibilityRevision !== job.visibilityRevision || !(await visibleToCharacter(moment, job.characterId))) {
          await db.momentJobs.update(job.id, { status: 'cancelled', updatedAt: Date.now() });
          continue;
        }
        const state = await stateRepo.getOrCreate(character.id, userId);
        const decision = planAutonomousMomentInteraction(moment.id, character, state.affinity ?? 0, moment.text);
        const like = job.type === 'react' && decision.like;
        const possibleReply = job.type === 'reply' && job.replyToId ? await db.momentReactions.get(job.replyToId) : undefined;
        const reply = possibleReply?.userId === userId && possibleReply.momentId === moment.id
          && possibleReply.type === 'comment' && possibleReply.status === 'active' && !possibleReply.characterId ? possibleReply : undefined;
        if (job.type === 'reply' && !reply) {
          await db.momentJobs.update(job.id, { status: 'cancelled', leaseUntil: undefined, updatedAt: Date.now() });
          continue;
        }
        const existingComments = job.type === 'react'
          ? (await db.momentReactions.where('momentId').equals(moment.id).toArray()).filter((item) => item.userId === userId && item.type === 'comment' && item.status === 'active' && item.characterId)
          : [];
        const recentOwnComments = job.type === 'react' && decision.comment
          ? (await db.momentReactions.where('characterId').equals(character.id).toArray()).filter((item) => item.userId === userId && item.type === 'comment' && item.status === 'active' && item.createdAt > now - 86_400_000)
          : [];
        const shouldComment = job.type === 'reply' || (job.type === 'react' && decision.comment && existingComments.length < 2 && recentOwnComments.length < 2);
        let content: string | undefined;
        if (shouldComment) {
          try { content = await writeComment(userId, character, moment, reply); }
          catch { /* 模型不可用时不冒充角色写固定评论，点赞仍可独立完成。 */ }
        }
        const authorName = moment.authorCharacterId ? (await db.characters.get(moment.authorCharacterId))?.name : undefined;
        await db.transaction('rw', [db.moments, db.momentContacts, db.momentViews, db.momentReactions, db.momentNotifications, db.momentJobs], async () => {
          const latest = await db.moments.get(moment.id);
          const blocked = await db.momentContacts.get(contactId(userId, character.id));
          const currentJob = await db.momentJobs.get(job.id);
          if (!latest || latest.deleted || latest.userId !== userId || latest.visibilityRevision !== job.visibilityRevision
            || !latest.audienceCharacterIds.includes(character.id) || blocked?.blocked || currentJob?.status !== 'running'
            || useAuthStore.getState().userId !== userId) {
            await db.momentJobs.update(job.id, { status: 'cancelled', leaseUntil: undefined, updatedAt: Date.now() });
            return;
          }
          const at = Date.now();
          const viewId = `moment-view:${moment.id}:${character.id}`;
          if (!(await db.momentViews.get(viewId))) {
            const view: MomentView = { id: viewId, userId, momentId: moment.id, characterId: character.id, viewedAt: at };
            await db.momentViews.put(view);
          }
          if (like && !(await db.momentReactions.get(`moment-like:${moment.id}:${character.id}`))) {
            await db.momentReactions.put({ id: `moment-like:${moment.id}:${character.id}`, userId, momentId: moment.id, characterId: character.id, type: 'like', status: 'active', createdAt: at, updatedAt: at });
            await db.momentNotifications.put({ id: `moment-notice:like:${moment.id}:${character.id}`, userId, momentId: moment.id, characterId: character.id, type: 'like', preview: `${character.name} 点了赞`, read: false, createdAt: at });
          }
          if (content) {
            const commentId = job.type === 'reply' ? `moment-comment:${job.replyToId}:${character.id}` : `moment-comment:${moment.id}:${character.id}`;
            const activePostComments = job.type === 'react'
              ? (await db.momentReactions.where('momentId').equals(moment.id).toArray()).filter((item) => item.userId === userId && item.type === 'comment' && item.status === 'active' && item.characterId)
              : [];
            const activeRecentComments = job.type === 'react'
              ? (await db.momentReactions.where('characterId').equals(character.id).toArray()).filter((item) => item.userId === userId && item.type === 'comment' && item.status === 'active' && item.createdAt > at - 86_400_000)
              : [];
            if (!(await db.momentReactions.get(commentId)) && (job.type === 'reply' || (activePostComments.length < 2 && activeRecentComments.length < 2))) {
              await db.momentReactions.put({ id: commentId, userId, momentId: moment.id, characterId: character.id, type: 'comment', content, ...(reply ? { replyToId: reply.id } : {}), status: 'active', createdAt: at, updatedAt: at });
              await db.momentNotifications.put({ id: `moment-notice:${commentId}`, userId, momentId: moment.id, characterId: character.id, type: 'comment', preview: `${character.name} ${reply ? '回复了你' : authorName ? `评论了${authorName}的动态` : '评论了你的动态'}：${content}`, read: false, createdAt: at });
            }
          }
          const retryComment = shouldComment && !content && currentJob.attempts < 2;
          await db.momentJobs.update(job.id, retryComment
            ? { status: 'queued', availableAt: at + 90_000, leaseUntil: undefined, updatedAt: at }
            : { status: content || !shouldComment ? 'done' : 'failed', leaseUntil: undefined, updatedAt: at });
        });
      } catch {
        await db.momentJobs.update(job.id, { status: 'failed', leaseUntil: undefined, lastError: 'interaction:failed', updatedAt: Date.now() });
      }
    }
  },
};
