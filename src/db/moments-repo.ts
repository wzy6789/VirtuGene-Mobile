import { db, type Character, type CharacterLifeEvent, type Moment, type MomentContact, type MomentMedia, type MomentNotification, type MomentPostPlan, type MomentReaction, type MomentView } from './index';
import { characterRepo } from './character-repo';
import { stateRepo } from './state-repo';
import { sendMessage } from '../lib/ai/deepseek';
import { hasAiGatewayAccess } from '../lib/ai/gateway';
import { useAuthStore } from '../store/auth-store';
import { buildCharacterMemoryContext } from '../lib/character-memory';
import { buildRelationshipToneContext } from '../lib/chat-context';
import { historyWindowCutoff, loadMomentsPreferences, type MomentPostFrequency } from '../lib/moments/preferences';
import { memorySourceTombstoneRepo } from './memory-source-tombstone-repo';
import { worldRepo } from './world-repo';
import { todoRepo } from './todo-repo';
import { containsPrivateMemoryEcho } from '../lib/memory-disclosure';

export type MomentAudience = {
  visibility: Moment['visibility'];
  characterIds?: string[];
};

type AutonomousPostTrigger = 'opening' | 'background';

function announceMomentsChanged(userId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('virtugene:moments-updated', { detail: { userId } }));
}

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
  // 评论比点赞更能让动态区有来有回；是否参与仍由性格、亲近程度和内容兴趣共同决定。
  const commentChance = Math.min(0.82, 0.32 + affinity * 0.9 + activity * 0.9 + interest * 0.75);
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
  const world = await worldRepo.ensureDefaultWorld(userId).catch(() => null);
  // The role may use their own cross-channel experience to choose warmth,
  // distance and conversational rhythm. This private context is never shared
  // with other characters and is reviewed before any public comment is saved.
  const recalled = await buildCharacterMemoryContext({
    userId,
    characterId: character.id,
    audience: [character.id],
    ...(world ? { worldId: world.id } : {}),
    topic: `朋友圈 ${moment.text} ${reply?.content ?? ''}`,
    // 角色可以用自己的私有经历判断语气与距离；来源集合由服务决定。
    mode: 'moments-comment',
    includePrivateCharacterLifeEvents: true,
    budget: 1800,
  });
  const personalTodos = await todoRepo.visibleOccurrencesForCharacter(userId, character.id, 3, true).catch(() => []);
  const characterState = await stateRepo.get(character.id, userId).catch(() => undefined);
  const relationshipTone = characterState
    ? buildRelationshipToneContext(characterState.affinity, characterState.mood, characterState.tierNames)
    : '';
  const privateContext = `${recalled.text}${personalTodos.length
    ? `\n\n【只分享给你的未完成事项，仅供调整语气，不要在公开评论中提起】\n${personalTodos.map(({ todo, occurrence }) => `- ${todo.title}${occurrence.dueDate !== '9999-12-31' ? `（${occurrence.dueDate}）` : ''}`).join('\n')}`
    : ''}`.trim();
  const publicInstruction = `你正在看朋友圈里一条由${postOwner}发布的动态。以你自己的性格留一句自然、有具体回应的评论，最多60个汉字；可以不赞同，不必总是夸赞或提问。不要写动作或旁白，不要假装看清图片细节。没有配文时只知道对方发了图片。只能评论当前动态和评论区里真实出现的内容。`;
  const prompt = `${character.systemPrompt}\n${publicInstruction}\n\n【你的个人经历，仅用于判断语气和关系距离】\n${privateContext}\n${relationshipTone ? `\n${relationshipTone}\n` : ''}不得复述、转述、影射或借评论透露这些私聊、日记、待办或个人生活信息；也不要说出关系等阶、情绪数值或系统状态。用户在当前评论区亲自写出的内容除外，但不得补充未公开细节。`;
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
  const result = await sendMessage({ apiKey: auth.apiKey ?? '', systemPrompt: prompt, message, history: [], character, temperature: 0.75 });
  const draft = result.content.split('---')[0]?.replace(/[\r\n]+/g, ' ').trim().slice(0, 100) || '';
  if (!draft) return undefined;
  if (privateContext && (!(await reviewPublicComment({ character, publicInstruction, privateContext, draft, message }))
    || containsPrivateMemoryEcho(draft, privateContext))) {
    const safeResult = await sendMessage({ apiKey: auth.apiKey ?? '', systemPrompt: `${character.systemPrompt}\n${publicInstruction}`, message, history: [], character, temperature: 0.75 });
    return safeResult.content.split('---')[0]?.replace(/[\r\n]+/g, ' ').trim().slice(0, 100) || undefined;
  }
  return draft;
}

async function reviewPublicComment(params: {
  character: Character;
  publicInstruction: string;
  privateContext: string;
  draft: string;
  message: string;
}): Promise<boolean> {
  const auth = useAuthStore.getState();
  try {
    const review = await sendMessage({
      apiKey: auth.apiKey ?? '',
      character: params.character,
      temperature: 0,
      structuredOutput: true,
      systemPrompt: '你是公开评论隐私审查器。判断评论是否泄露、复述或影射仅角色本人知道的具体私聊、日记、待办或生活经历。当前动态配文与评论串是公开依据；一般性格、语气、关系距离不算泄露。无法确定时返回 safe=false。只输出 JSON：{"safe":true} 或 {"safe":false}。',
      message: `公开依据：\n${params.publicInstruction}\n${params.message}\n\n仅角色本人知道的资料：\n${params.privateContext}\n\n待审评论：\n${params.draft}\n\n只判断是否泄露，输出 JSON。`,
      history: [],
    });
    const json = review.content.match(/\{[\s\S]*\}/)?.[0];
    return json ? (JSON.parse(json) as { safe?: boolean }).safe === true : false;
  } catch {
    // If review itself fails, caller retries from public-only context. Never
    // allow an unreviewed draft to cross the public boundary.
    return false;
  }
}

const LIFE_KINDS = ['routine', 'hobby', 'project', 'social', 'discovery', 'reflection'] as const;

interface GeneratedLifeBeat {
  kind: CharacterLifeEvent['kind'];
  title: string;
  summary: string;
  continueEventId?: string;
  completed: boolean;
  publish: boolean;
  postText: string;
}

function parseLifeBeat(content: string): GeneratedLifeBeat | undefined {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    const value = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    if (!LIFE_KINDS.includes(value.kind as typeof LIFE_KINDS[number])) return undefined;
    const title = typeof value.title === 'string' ? value.title.trim().slice(0, 36) : '';
    const summary = typeof value.summary === 'string' ? value.summary.trim().slice(0, 240) : '';
    const postText = typeof value.postText === 'string' ? value.postText.replace(/[\r\n]+/g, ' ').trim().slice(0, 140) : '';
    if (!title || !summary || typeof value.publish !== 'boolean') return undefined;
    return {
      kind: value.kind as GeneratedLifeBeat['kind'],
      title,
      summary,
      continueEventId: typeof value.continueEventId === 'string' ? value.continueEventId : undefined,
      completed: value.completed === true,
      publish: value.publish,
      postText,
    };
  } catch {
    return undefined;
  }
}

function mentionsUser(text: string): boolean {
  return /(用户|主人|你发的|你说的|你上次|等你|想你|给你|咱俩|我们俩|我们之间|和你一起|跟你一起)/.test(text);
}

function textSimilarity(a: string, b: string): number {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)));
  const x = grams(left);
  const y = grams(right);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const gram of x) if (y.has(gram)) shared += 1;
  return (2 * shared) / (x.size + y.size);
}

function localDayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localDayStart(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function postInterval(frequency: MomentPostFrequency, proactivity: number): number {
  const baseHours = frequency === 'active' ? 12 : frequency === 'quiet' ? 48 : 20;
  const activityFactor = 1.1 - Math.max(0, Math.min(1, proactivity)) * 0.2;
  return baseHours * activityFactor * 60 * 60 * 1000;
}

function dailyCharacterPostLimit(frequency: MomentPostFrequency): number {
  return frequency === 'active' ? 2 : 1;
}

async function generateCharacterLifeBeat(
  userId: string,
  character: Character,
  priorPublicEvents: CharacterLifeEvent[],
): Promise<GeneratedLifeBeat | undefined> {
  const auth = useAuthStore.getState();
  if (auth.userId !== userId || (!auth.apiKey && !hasAiGatewayAccess())) return undefined;
  const publicHistory = priorPublicEvents.slice(0, 6).map((event) => ({ id: event.id, threadId: event.threadId, kind: event.kind, title: event.title, summary: event.summary, occurredAt: event.occurredAt }));
  const profile = [
    `角色名：${character.name}`,
    `角色标签：${(character.tags ?? []).slice(0, 8).join('、') || '没有额外标签'}`,
    `签名：${character.signature && !mentionsUser(character.signature) ? character.signature : '无'}`,
    `口头习惯：${character.catchphrase && !mentionsUser(character.catchphrase) ? character.catchphrase : '无'}`,
    `主动程度：${Math.round(Math.max(0, Math.min(1, character.proactivity ?? 0.5)) * 100)}%`,
  ].join('\n');
  const prompt = [
    '你负责模拟一个持续生活的虚构角色。请生成一件今天发生在角色自己生活里的小事，并判断角色会不会把它发到朋友圈。',
    '角色生活必须独立于用户：本轮输入没有提供用户的聊天、日记、照片或私密资料，不能凭空提及用户、等待用户、想念用户或围绕用户发帖。也不能冒充真实世界里未经提供的事实。',
    '内容要贴合标签和签名，像角色自己的生活碎片；可以有喜剧、失败、发现、小进展或没做完的事，不要每次都温柔积极、感悟人生或用问题结尾。通常选择 publish=true，让这段真实生活自然出现在朋友圈；只有确实私密、过于平淡或不适合公开时才选择 false。',
    '如果延续既有生活线索，只能填下面 publicHistory 里真实存在的 event id；否则 continueEventId 设为 null。只可延续，不可改写既有事实。',
    '如果 publish=true，postText 写成自然朋友圈正文，1到2句、最多100个汉字，不加标题、标签、动作括号或解释；禁止直接称呼用户。',
    '仅输出 JSON：{"kind":"routine|hobby|project|social|discovery|reflection","title":"...","summary":"明确发生了什么","continueEventId":null,"completed":false,"publish":true,"postText":"..."}',
    `\n${profile}`,
    `\npublicHistory：${JSON.stringify(publicHistory)}`,
  ].join('\n');
  // sendMessage 的网关路径附带 character 对象。只传路由必需的模型选择，
  // 不把完整人设、头像、账号标识等资料额外发给生成端。
  const routingCharacter = character.model ? { model: character.model } : undefined;
  const result = await sendMessage({
    apiKey: auth.apiKey ?? '',
    systemPrompt: prompt,
    message: `当前本地时间：${new Date().toLocaleString('zh-CN')}。为角色写下一段独立生活进展；不需要与用户有关。`,
    history: [],
    character: routingCharacter,
    temperature: 0.9,
    structuredOutput: true,
  });
  return parseLifeBeat(result.content);
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
  // 「允许角色查看我的历史动态」：超出窗口的动态对角色不存在（本机偏好，默认不限制）
  const cutoff = historyWindowCutoff(moment.userId);
  if (cutoff > 0 && moment.createdAt < cutoff) return false;
  return moment.audienceCharacterIds.includes(characterId);
}

async function chooseCommentReplyCharacter(userId: string, moment: Moment, seed: string): Promise<string | undefined> {
  const contacts = await listContactCharacters(userId);
  const eligible = contacts.filter((character) => character.createdBy === userId
    && moment.audienceCharacterIds.includes(character.id));
  const scored = await Promise.all(eligible.map(async (character) => {
    if (!(await visibleToCharacter(moment, character.id))) return undefined;
    const state = await stateRepo.get(character.id, userId);
    const score = (state?.affinity ?? 0) + (character.proactivity ?? 0.5) * 20
      + deterministicUnit(`${seed}:${character.id}`) * 15;
    return { id: character.id, score };
  }));
  return scored.filter((item): item is { id: string; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)[0]?.id;
}

/** 朋友圈提醒只面向用户：自己的动态互动、以及角色直接回复用户评论。 */
async function filterUserDirectedNotifications(items: MomentNotification[]): Promise<MomentNotification[]> {
  if (!items.length) return [];
  const momentIds = [...new Set(items.map((item) => item.momentId))];
  const moments = await db.moments.bulkGet(momentIds);
  const momentById = new Map(moments.filter((item): item is Moment => Boolean(item)).map((item) => [item.id, item]));
  const replyNotices = items.filter((item) => item.type === 'comment' && item.id.startsWith('moment-notice:')
    && Boolean(momentById.get(item.momentId)?.authorCharacterId));
  const reactionIds = [...new Set(replyNotices.map((item) => item.id.slice('moment-notice:'.length)))];
  const reactions = await db.momentReactions.bulkGet(reactionIds);
  const reactionById = new Map(reactions.filter((item): item is MomentReaction => Boolean(item)).map((item) => [item.id, item]));
  const parentIds = [...new Set(reactions.flatMap((item) => item?.replyToId ? [item.replyToId] : []))];
  const parents = await db.momentReactions.bulkGet(parentIds);
  const parentById = new Map(parents.filter((item): item is MomentReaction => Boolean(item)).map((item) => [item.id, item]));

  return items.filter((item) => {
    const moment = momentById.get(item.momentId);
    if (!moment || moment.userId !== item.userId || moment.deleted) return false;
    if (!moment.authorCharacterId) return true;
    const reaction = reactionById.get(item.id.slice('moment-notice:'.length));
    if (item.type !== 'comment' || !item.id.startsWith('moment-notice:')
      || !reaction || reaction.userId !== item.userId || reaction.momentId !== moment.id
      || reaction.type !== 'comment' || reaction.status !== 'active' || !reaction.replyToId) return false;
    const parent = parentById.get(reaction.replyToId);
    return Boolean(parent && parent.userId === item.userId && parent.momentId === moment.id
      && parent.type === 'comment' && parent.status === 'active' && !parent.characterId);
  });
}

export const momentsRepo = {
  async contacts(userId: string): Promise<Character[]> {
    return listContactCharacters(userId);
  },

  async clearForUser(userId: string): Promise<void> {
    await db.transaction('rw', [db.moments, db.momentMedia, db.momentViews, db.momentReactions, db.momentContacts, db.momentJobs, db.momentNotifications, db.characterLifeEvents, db.momentPostPlans], async () => {
      await Promise.all([
        db.moments.where('userId').equals(userId).delete(),
        db.momentMedia.where('userId').equals(userId).delete(),
        db.momentViews.where('userId').equals(userId).delete(),
        db.momentReactions.where('userId').equals(userId).delete(),
        db.momentContacts.where('userId').equals(userId).delete(),
        db.momentJobs.where('userId').equals(userId).delete(),
        db.momentNotifications.where('userId').equals(userId).delete(),
        db.characterLifeEvents.where('userId').equals(userId).delete(),
        db.momentPostPlans.where('userId').equals(userId).delete(),
      ]);
    });
  },

  /** 删除好友时一并清理其主动生活、发帖计划及朋友圈身份，避免留下失效引用。 */
  async deleteCharacterData(userId: string, characterId: string): Promise<void> {
    const authored = await db.moments.where('userId').equals(userId).filter((item) => item.authorCharacterId === characterId).toArray();
    const authoredIds = new Set(authored.map((item) => item.id));
    await db.transaction('rw', [db.moments, db.momentMedia, db.momentViews, db.momentReactions, db.momentContacts, db.momentJobs, db.momentNotifications, db.characterLifeEvents, db.momentPostPlans], async () => {
      await db.momentJobs.where('userId').equals(userId).modify((job) => {
        if (job.characterId === characterId || authoredIds.has(job.momentId)) {
          job.status = 'cancelled';
          job.leaseUntil = undefined;
          job.updatedAt = Date.now();
        }
      });
      await db.momentReactions.where('userId').equals(userId).filter((row) => row.characterId === characterId || authoredIds.has(row.momentId)).delete();
      await db.momentViews.where('userId').equals(userId).filter((row) => row.characterId === characterId || authoredIds.has(row.momentId)).delete();
      await db.momentNotifications.where('userId').equals(userId).filter((row) => row.characterId === characterId || authoredIds.has(row.momentId)).delete();
      await db.momentMedia.where('userId').equals(userId).filter((row) => authoredIds.has(row.momentId)).delete();
      await db.moments.where('userId').equals(userId).filter((row) => row.authorCharacterId === characterId).delete();
      await db.momentContacts.delete(contactId(userId, characterId));
      await db.characterLifeEvents.where('[userId+characterId]').equals([userId, characterId]).delete();
      await db.momentPostPlans.where('[userId+characterId]').equals([userId, characterId]).delete();
    });
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

  /** 开屏分阶段调用，每次最多发布一条；后台检查每轮最多一条，并遵守更长的全局间隔。 */
  async processAutonomousPosts(
    userId: string,
    now = Date.now(),
    options: { trigger?: AutonomousPostTrigger; attemptBudget?: number; onAttempt?: () => void } = {},
  ): Promise<Moment | undefined> {
    const trigger = options.trigger ?? 'background';
    const attemptBudget = Math.max(1, Math.min(4, options.attemptBudget ?? (trigger === 'opening' ? 4 : 1)));
    const auth = useAuthStore.getState();
    if (auth.userId !== userId || (!auth.apiKey && !hasAiGatewayAccess())) return undefined;
    const preferences = loadMomentsPreferences(userId);
    if (!preferences.autonomousPostsEnabled) return undefined;

    const [contacts, moments, plans] = await Promise.all([
      listContactCharacters(userId),
      db.moments.where('userId').equals(userId).toArray(),
      db.momentPostPlans.where('userId').equals(userId).toArray(),
    ]);
    const authoredPosts = moments.filter((item) => !item.deleted && item.authorCharacterId);
    const todayStart = localDayStart(now);
    const dailyPosts = authoredPosts.filter((item) => item.createdAt >= todayStart);
    if (dailyPosts.length >= 5) return undefined;
    if (trigger !== 'opening' && authoredPosts.some((item) => now - item.createdAt < 90 * 60 * 1000)) return undefined;

    const dayKey = localDayKey(now);
    const candidates = contacts.flatMap((character) => {
      if (character.createdBy !== userId) return [];
      const mode = preferences.contactPostModes[character.id] ?? preferences.postFrequency;
      const characterDailyPosts = dailyPosts.filter((item) => item.authorCharacterId === character.id);
      if (characterDailyPosts.length >= dailyCharacterPostLimit(mode)) return [];
      const slot = characterDailyPosts.length;
      // Slot 0 保留旧版计划 ID，升级后当天已完成的计划仍然有效；活跃角色的第二个日更位使用独立 ID。
      const basePlanId = `moment-post-plan:${userId}:${character.id}:${dayKey}`;
      const planId = slot === 0 ? basePlanId : `${basePlanId}:${slot}`;
      const plan = plans.find((row) => row.id === planId);
      if (plan && (plan.status === 'published' || plan.status === 'quiet'
        || (plan.status === 'running' && (plan.leaseUntil ?? 0) > now)
        || (plan.status === 'failed' && (plan.attempts >= 2 || plan.availableAt > now)))) return [];
      const lastPost = authoredPosts.filter((item) => item.authorCharacterId === character.id)
        .reduce((latest, item) => Math.max(latest, item.createdAt), 0);
      if (lastPost && now - lastPost < postInterval(mode, character.proactivity ?? 0.5)) return [];
      return [{ character, planId, mode, slot }];
    });
    if (!candidates.length) return undefined;

    const lastPostByCharacter = new Map<string, number>();
    for (const item of authoredPosts) {
      if (item.authorCharacterId) lastPostByCharacter.set(item.authorCharacterId, Math.max(lastPostByCharacter.get(item.authorCharacterId) ?? 0, item.createdAt));
    }
    candidates.sort((a, b) => {
      const aInterval = postInterval(a.mode, a.character.proactivity ?? 0.5);
      const bInterval = postInterval(b.mode, b.character.proactivity ?? 0.5);
      const aOverdue = (now - (lastPostByCharacter.get(a.character.id) ?? 0)) / aInterval;
      const bOverdue = (now - (lastPostByCharacter.get(b.character.id) ?? 0)) / bInterval;
      return bOverdue - aOverdue || deterministicUnit(`${dayKey}:${a.character.id}`) - deterministicUnit(`${dayKey}:${b.character.id}`);
    });

    const { character, planId, mode, slot } = candidates[0];
    const claimed = await db.transaction('rw', [db.momentPostPlans, db.moments], async () => {
      const current = await db.momentPostPlans.get(planId);
      if (current && (current.status === 'published' || current.status === 'quiet'
        || (current.status === 'running' && (current.leaseUntil ?? 0) > now)
        || (current.status === 'failed' && (current.attempts >= 2 || current.availableAt > now)))) return false;
      if (useAuthStore.getState().userId !== userId) return false;
      const liveMoments = (await db.moments.where('userId').equals(userId).toArray())
        .filter((item) => !item.deleted && item.authorCharacterId);
      const liveDailyPosts = liveMoments.filter((item) => item.createdAt >= todayStart);
      const livePlans = await db.momentPostPlans.where('userId').equals(userId).toArray();
      const otherLeases = livePlans.filter((plan) => plan.id !== planId && plan.dayKey === dayKey
        && plan.status === 'running' && (plan.leaseUntil ?? 0) > now);
      if (liveDailyPosts.length + otherLeases.length >= 5) return false;
      const characterPostsToday = liveDailyPosts.filter((item) => item.authorCharacterId === character.id).length;
      const characterLeases = otherLeases.filter((plan) => plan.characterId === character.id).length;
      if (characterPostsToday + characterLeases >= dailyCharacterPostLimit(mode)
        || characterPostsToday + characterLeases !== slot) return false;
      const row: MomentPostPlan = {
        id: planId,
        userId,
        characterId: character.id,
        dayKey,
        status: 'running',
        attempts: (current?.attempts ?? 0) + 1,
        availableAt: now,
        leaseUntil: now + 120_000,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      await db.momentPostPlans.put(row);
      return true;
    });
    if (!claimed) return undefined;

    try {
      const lifeEvents = await db.characterLifeEvents.where('[userId+characterId]').equals([userId, character.id]).toArray();
      const priorPublicEvents = lifeEvents.filter((event) => event.visibility === 'shareable')
        .sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 8);
      options.onAttempt?.();
      const beat = await generateCharacterLifeBeat(userId, character, priorPublicEvents);
      if (!beat || mentionsUser(`${beat.title} ${beat.summary}`) || (beat.publish && (!beat.postText || mentionsUser(beat.postText)))) {
        throw new Error('moment:life-beat-invalid');
      }
      if (useAuthStore.getState().userId !== userId) throw new Error('moment:account-changed');
      if (!loadMomentsPreferences(userId).autonomousPostsEnabled) throw new Error('moment:posting-disabled');

      const validContinuation = beat.continueEventId
        ? priorPublicEvents.find((event) => event.id === beat.continueEventId)
        : undefined;
      const recentCharacterPosts = authoredPosts.filter((item) => item.authorCharacterId === character.id && now - item.createdAt < 30 * 24 * 60 * 60 * 1000);
      const repeatsRecentPost = recentCharacterPosts.some((item) => textSimilarity(item.text, beat.postText) >= 0.68);
      // 不再在模型已决定发布后额外掷一次低概率骰子；频率由计划和每日上限控制。
      const shouldPublish = beat.publish && !repeatsRecentPost;
      const eventId = crypto.randomUUID();
      const event: CharacterLifeEvent = {
        id: eventId,
        userId,
        characterId: character.id,
        threadId: validContinuation?.threadId ?? crypto.randomUUID(),
        ...(validContinuation ? { continuesFromId: validContinuation.id } : {}),
        kind: beat.kind,
        title: beat.title,
        summary: beat.summary,
        visibility: shouldPublish ? 'shareable' : 'private',
        status: beat.completed ? 'completed' : 'active',
        occurredAt: now,
        createdAt: now,
        updatedAt: now,
      };

      if (!shouldPublish) {
        await db.transaction('rw', [db.characterLifeEvents, db.momentPostPlans], async () => {
          const current = await db.momentPostPlans.get(planId);
          if (!current || current.status !== 'running' || useAuthStore.getState().userId !== userId) throw new Error('moment:plan-lost');
          await db.characterLifeEvents.put(event);
          await db.momentPostPlans.update(planId, { status: 'quiet', eventId, leaseUntil: undefined, updatedAt: Date.now() });
        });
        return trigger === 'opening' && attemptBudget > 1
          ? momentsRepo.processAutonomousPosts(userId, now, { ...options, trigger, attemptBudget: attemptBudget - 1 })
          : undefined;
      }

      const audienceIds = contacts.map((item) => item.id);
      const momentId = crypto.randomUUID();
      const moment: Moment = {
        id: momentId,
        userId,
        authorCharacterId: character.id,
        originType: 'autonomous',
        originEventIds: [eventId],
        lifeThreadId: event.threadId,
        text: beat.postText,
        visibility: 'all',
        audienceCharacterIds: audienceIds,
        visibilityRevision: 1,
        mediaIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await db.transaction('rw', [db.characterLifeEvents, db.moments, db.momentJobs, db.momentPostPlans], async () => {
        const current = await db.momentPostPlans.get(planId);
        if (!current || current.status !== 'running' || useAuthStore.getState().userId !== userId) throw new Error('moment:plan-lost');
        await db.characterLifeEvents.put(event);
        await db.moments.put(moment);
        for (const readerId of audienceIds.filter((id) => id !== character.id)) {
          const jobId = `moment-job:${moment.id}:${readerId}`;
          await db.momentJobs.put({
            id: jobId,
            userId,
            momentId: moment.id,
            characterId: readerId,
            type: 'react',
            status: 'queued',
            visibilityRevision: 1,
            attempts: 0,
            availableAt: now + Math.round(20_000 + deterministicUnit(`${moment.id}:${readerId}:delay`) * 70_000),
            createdAt: now,
            updatedAt: now,
          });
        }
        await db.momentPostPlans.update(planId, { status: 'published', eventId, momentId, leaseUntil: undefined, updatedAt: Date.now() });
      });
      announceMomentsChanged(userId);
      return moment;
    } catch {
      const current = await db.momentPostPlans.get(planId);
      if (current?.status === 'running') {
        await db.momentPostPlans.update(planId, {
          status: 'failed',
          availableAt: Date.now() + 60 * 60 * 1000,
          leaseUntil: undefined,
          updatedAt: Date.now(),
        });
      }
      return trigger === 'opening' && attemptBudget > 1
        ? momentsRepo.processAutonomousPosts(userId, now, { ...options, trigger, attemptBudget: attemptBudget - 1 })
        : undefined;
    }
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
    if (existing?.status === 'active') {
      const viewId = `moment-view:${moment.id}:${character.id}`;
      if (!(await db.momentViews.get(viewId))) {
        await db.momentViews.put({ id: viewId, userId, momentId: moment.id, characterId: character.id, viewedAt: Date.now() });
      }
      return { status: 'already', moment };
    }
    const state = await stateRepo.getOrCreate(character.id, userId);
    const affinity = Math.max(0, Math.min(1, (state.affinity ?? 0) / 100));
    const warmth = Math.max(0, Math.min(1, character.proactivity ?? 0.5));
    const willing = force || deterministicUnit(`${likeId}:willing`) < 0.35 + affinity * 0.35 + warmth * 0.2;
    if (!willing) return { status: 'declined', moment };
    const now = Date.now();
    await db.transaction('rw', [db.momentReactions, db.momentNotifications, db.momentViews], async () => {
      const latest = await db.momentReactions.get(likeId);
      const viewId = `moment-view:${moment.id}:${character.id}`;
      if (!(await db.momentViews.get(viewId))) {
        await db.momentViews.put({ id: viewId, userId, momentId: moment.id, characterId: character.id, viewedAt: now });
      }
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
    await db.transaction('rw', [db.moments, db.momentJobs, db.momentReactions, db.memorySourceTombstones], async () => {
      await memorySourceTombstoneRepo.record({
        userId,
        sourceType: 'moment',
        sourceId: momentId,
        sourceRevision: existing.visibilityRevision,
        status: 'withdrawn',
      });
      const oldReactions = await db.momentReactions.where('momentId').equals(momentId).filter((reaction) => reaction.userId === userId && reaction.status === 'active').toArray();
      for (const reaction of oldReactions) await memorySourceTombstoneRepo.record({
        userId,
        sourceType: 'momentReaction',
        sourceId: reaction.id,
        sourceRevision: reaction.updatedAt,
        status: 'withdrawn',
      });
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
    await db.transaction('rw', [db.moments, db.momentJobs, db.momentReactions, db.momentMedia, db.momentViews, db.momentNotifications, db.memorySourceTombstones], async () => {
      await memorySourceTombstoneRepo.record({
        userId,
        sourceType: 'moment',
        sourceId: momentId,
        sourceRevision: existing.visibilityRevision,
        status: 'deleted',
      });
      const oldReactions = await db.momentReactions.where('momentId').equals(momentId).filter((reaction) => reaction.userId === userId).toArray();
      for (const reaction of oldReactions) await memorySourceTombstoneRepo.record({
        userId,
        sourceType: 'momentReaction',
        sourceId: reaction.id,
        sourceRevision: reaction.updatedAt,
        status: 'deleted',
      });
      await db.moments.put({ ...existing, deleted: true, visibilityRevision: existing.visibilityRevision + 1, updatedAt: Date.now() });
      await db.momentJobs.where('momentId').equals(momentId).modify((job) => { job.status = 'cancelled'; job.updatedAt = Date.now(); });
      await db.momentReactions.where('momentId').equals(momentId).modify((reaction) => { reaction.status = 'deleted'; reaction.updatedAt = Date.now(); });
      // 图片仍由 momentMedia 单独保存，删除动态后可以安全清掉对应附件。
      await db.momentMedia.where('momentId').equals(momentId).delete();
      await db.momentViews.where('momentId').equals(momentId).delete();
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
      const updatedAt = Math.max(Date.now(), existing.updatedAt + 1);
      if (existing.status === 'active') {
        await memorySourceTombstoneRepo.record({ userId, sourceType: 'momentReaction', sourceId: existing.id, sourceRevision: existing.updatedAt, status: 'withdrawn' });
      }
      await db.momentReactions.put({ ...existing, status: existing.status === 'active' ? 'withdrawn' : 'active', updatedAt });
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
    const characterId = validTarget?.characterId ?? moment.authorCharacterId
      ?? await chooseCommentReplyCharacter(userId, moment, row.id);
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
    const id = contactId(userId, characterId);
    const existing = await db.momentContacts.get(id);
    // 保留同一行上的另一个开关：blocked 与 muted 是两个方向的设置，不能互相覆盖
    const row: MomentContact = {
      id, userId, characterId,
      ...(blocked ? { blocked: true } : {}),
      ...(existing?.muted ? { muted: true } : {}),
      updatedAt: Date.now(),
    };
    await db.momentContacts.put(row);
    if (blocked) {
      await db.momentJobs.where('characterId').equals(characterId).modify((job) => {
        if (job.userId === userId && job.status === 'queued') job.status = 'cancelled';
      });
    }
  },

  /** 不看他（她）的朋友圈：只过滤我这边的动态流，不影响对方能否看到我、能否互动 */
  async setMuted(userId: string, characterId: string, muted: boolean): Promise<void> {
    const id = contactId(userId, characterId);
    const existing = await db.momentContacts.get(id);
    const row: MomentContact = {
      id, userId, characterId,
      ...(existing?.blocked ? { blocked: true } : {}),
      ...(muted ? { muted: true } : {}),
      updatedAt: Date.now(),
    };
    await db.momentContacts.put(row);
  },

  async mutedCharacterIds(userId: string): Promise<string[]> {
    return (await db.momentContacts.where('userId').equals(userId).toArray())
      .filter((item) => item.muted === true)
      .map((item) => item.characterId);
  },

  /**
   * 删除自己的评论：只允许删"没有 characterId"的评论（角色评论不归用户处置），
   * 而且是软删（status='deleted'）——角色可能已经基于这条评论产生过记忆。
   */
  async deleteOwnComment(userId: string, reactionId: string): Promise<boolean> {
    const row = await db.momentReactions.get(reactionId);
    if (!row || row.userId !== userId || row.characterId || row.type !== 'comment' || row.status !== 'active') return false;
    await db.transaction('rw', [db.momentReactions, db.memorySourceTombstones], async () => {
      await memorySourceTombstoneRepo.record({ userId, sourceType: 'momentReaction', sourceId: row.id, sourceRevision: row.updatedAt, status: 'deleted' });
      await db.momentReactions.update(reactionId, { status: 'deleted', updatedAt: Date.now() });
    });
    return true;
  },

  /** 清空互动消息记录（不动动态与评论本身） */
  async clearNotifications(userId: string): Promise<void> {
    await db.momentNotifications.where('userId').equals(userId).delete();
  },

  async unreadNotifications(userId: string): Promise<MomentNotification[]> {
    const rows = (await db.momentNotifications.where('userId').equals(userId).toArray())
      .filter((item) => !item.read).sort((a, b) => b.createdAt - a.createdAt);
    return filterUserDirectedNotifications(rows);
  },

  async notifications(userId: string, limit = 30): Promise<MomentNotification[]> {
    const rows = (await db.momentNotifications.where('userId').equals(userId).toArray())
      .sort((a, b) => b.createdAt - a.createdAt);
    return (await filterUserDirectedNotifications(rows)).slice(0, Math.max(1, limit));
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
        const shouldComment = job.type === 'reply' || (job.type === 'react' && decision.comment && existingComments.length < 3 && recentOwnComments.length < 4);
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
            if (!latest.authorCharacterId) {
              await db.momentNotifications.put({ id: `moment-notice:like:${moment.id}:${character.id}`, userId, momentId: moment.id, characterId: character.id, type: 'like', preview: `${character.name} 点了赞`, read: false, createdAt: at });
            }
          }
          if (content) {
            const commentId = job.type === 'reply' ? `moment-comment:${job.replyToId}:${character.id}` : `moment-comment:${moment.id}:${character.id}`;
            const activePostComments = job.type === 'react'
              ? (await db.momentReactions.where('momentId').equals(moment.id).toArray()).filter((item) => item.userId === userId && item.type === 'comment' && item.status === 'active' && item.characterId)
              : [];
            const activeRecentComments = job.type === 'react'
              ? (await db.momentReactions.where('characterId').equals(character.id).toArray()).filter((item) => item.userId === userId && item.type === 'comment' && item.status === 'active' && item.createdAt > at - 86_400_000)
              : [];
            if (!(await db.momentReactions.get(commentId)) && (job.type === 'reply' || (activePostComments.length < 3 && activeRecentComments.length < 4))) {
              await db.momentReactions.put({ id: commentId, userId, momentId: moment.id, characterId: character.id, type: 'comment', content, ...(reply ? { replyToId: reply.id } : {}), status: 'active', createdAt: at, updatedAt: at });
              if (!latest.authorCharacterId || reply) {
                await db.momentNotifications.put({ id: `moment-notice:${commentId}`, userId, momentId: moment.id, characterId: character.id, type: 'comment', preview: `${character.name} ${reply ? '回复了你' : authorName ? `评论了${authorName}的动态` : '评论了你的动态'}：${content}`, read: false, createdAt: at });
              }
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
