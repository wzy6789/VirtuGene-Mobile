import { db, type Moment } from '../../db/index';
import { visibleToCharacter } from '../../db/moments-repo';

export interface RecallableMoment {
  moment: Moment;
  viewedAt: number;
}

/** 用户明确谈到动态时，当前可见权限优先于角色是否曾点赞或查看。 */
export function isDirectMomentQuestion(text: string): boolean {
  return /朋友圈|动态|我发的|刚发的|那张照片|那张图|发了张|晒的照片|配图/.test(text);
}

/** 私聊中请求角色替用户动态点赞；只在明确表达“给我点个赞”时触发。 */
export function isMomentLikeRequest(text: string): boolean {
  const asksForLike = /(点个赞|点一下赞|点赞|赞一下)/.test(text);
  return asksForLike && /(给我|帮我|替我|去|你|必须|一定|能不能|可以|拜托|求)/.test(text);
}

export function isForceMomentLikeRequest(text: string): boolean {
  return /(必须|一定|非要|就要|拜托|求你|真的帮我|务必)/.test(text);
}

export async function selectRecallableMoments(params: {
  userId: string;
  characterId: string;
  query?: string;
  excludeMomentIds?: string[];
}): Promise<RecallableMoment[]> {
  const explicit = isDirectMomentQuestion(params.query ?? '');
  const viewed = await db.momentViews.where('[userId+characterId]').equals([params.userId, params.characterId]).toArray();
  const viewedAt = new Map(viewed.map((row) => [row.momentId, row.viewedAt]));
  const excluded = new Set(explicit ? [] : params.excludeMomentIds ?? []);
  const candidates = explicit
    ? (await db.moments.where('userId').equals(params.userId).toArray()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60)
    : (await Promise.all(viewed.sort((a, b) => b.viewedAt - a.viewedAt).slice(0, 16).map((row) => db.moments.get(row.momentId))))
      .filter((row): row is Moment => Boolean(row));
  const visible = (await Promise.all(candidates.map(async (moment) => {
    // 私聊“我发的动态”只召回用户本人发布的内容；角色自己的朋友圈由动态页展示，
    // 不应在这里被误当成用户动态注入给另一个角色。
    if (moment.userId !== params.userId || moment.authorCharacterId || excluded.has(moment.id) || !(await visibleToCharacter(moment, params.characterId))) return undefined;
    return { moment, viewedAt: viewedAt.get(moment.id) ?? 0 };
  }))).filter((item): item is RecallableMoment => Boolean(item));
  const query = (params.query ?? '').replace(/朋友圈|动态|照片|图片|我发的|刚发|那条|那张|你觉得|怎么样/g, '').trim().toLowerCase();
  const terms = query.split(/[\s，。！？、]+/).filter((term) => term.length > 1);
  visible.sort((a, b) => {
    const score = (item: RecallableMoment) => terms.reduce((n, term) => n + (item.moment.text.toLowerCase().includes(term) ? 1 : 0), 0);
    return score(b) - score(a) || b.moment.createdAt - a.moment.createdAt;
  });
  return visible.slice(0, explicit ? 3 : 2);
}

export function buildMomentContext(items: RecallableMoment[], directQuestion = false): string {
  if (items.length === 0) return '';
  const lines = items.map(({ moment, viewedAt }) => {
    const date = new Date(moment.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `- ${date}：${moment.text || '（无配文）'}${moment.mediaIds.length ? `；附有 ${moment.mediaIds.length} 张图片，图片内容未知` : ''}${viewedAt ? '；你曾看过' : '；你当前有权限看到'}`;
  });
  return `\n\n[用户可见的朋友圈动态]\n${lines.join('\n')}\n${directQuestion ? '用户正问起动态。根据上面确实存在的文字回答；如果图片细节没有提供，不要猜测。不能声称自己已经点赞或评论，除非对话有真实记录。' : '仅在话题自然相关时提起，不要每次聊天都说朋友圈。'}`;
}
