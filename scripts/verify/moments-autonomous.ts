import { db, type Character, type CharacterLifeEvent } from '../../src/db/index';
import { characterRepo } from '../../src/db/character-repo';
import { momentsRepo } from '../../src/db/moments-repo';
import { recallCharacterMemory } from '../../src/lib/character-memory';
import { collectSyncData } from '../../src/lib/sync';
import { loadMomentsPreferences, saveMomentsPreferences } from '../../src/lib/moments/preferences';
import { useAuthStore } from '../../src/store/auth-store';

const report = window.fetch.bind(window);
const checks: string[] = [];
const check = (label: string, condition: boolean, detail?: unknown) => {
  checks.push(`${condition ? 'ok  ' : 'FAIL '} ${label}${condition ? '' : ` :: ${JSON.stringify(detail)}`}`);
};
const unit = (seed: string) => {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  return (value >>> 0) / 4294967296;
};
const dayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const at = Date.now();
const userId = 'verify-autonomous-user';
const characterId = Array.from({ length: 100 }, (_, i) => `verify-autonomous-character-${i}`)
  .find((id) => unit(`moment-post-plan:${userId}:${id}:${dayKey(at)}:share`) < 0.86)!;
const secret = '私密标记XZ9472';
let responseText = JSON.stringify({
  kind: 'project', title: '修好了旧收音机', summary: '独自修好了旧收音机，听到了久违的节目',
  continueEventId: null, completed: false, publish: true, postText: '旧收音机终于响了，旋钮差点又被我拧坏。',
});
let queuedResponseTexts: string[] = [];
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/chat/completions')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body });
    const content = queuedResponseTexts.shift() ?? responseText;
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error(`Unexpected network request: ${url}`);
};

const character = (id: string): Character => ({
  id, name: '阿岚', avatar: '🌙', systemPrompt: '私聊人设', tags: ['修理', '夜晚'], isPreset: false,
  isCustom: true, published: false, createdBy: userId, createdAt: at,
  proactivity: 0.7, signature: '修旧东西的人', greeting: '',
});

async function run(): Promise<void> {
  await db.delete();
  await db.open();
  useAuthStore.getState().login(userId, '验收账号', 'sk-fake', '');
  saveMomentsPreferences(userId, { ...loadMomentsPreferences(userId), postFrequency: 'active' });
  await characterRepo.create(character(characterId));
  await momentsRepo.create(userId, secret, { visibility: 'private' });

  const simultaneous = await Promise.all([
    momentsRepo.processAutonomousPosts(userId, at),
    momentsRepo.processAutonomousPosts(userId, at),
  ]);
  const created = simultaneous.find(Boolean);
  const event = (await db.characterLifeEvents.where('userId').equals(userId).toArray())[0];
  const plan = (await db.momentPostPlans.where('userId').equals(userId).toArray())[0];
  check('主动发帖写入一条角色动态', Boolean(created?.authorCharacterId === characterId && created?.originType === 'autonomous'));
  check('同一事务写入生活事件和已发布计划', Boolean(event && plan?.status === 'published' && plan.eventId === event.id && plan.momentId === created?.id));
  check('结构化生成只调用一次模型', calls.length === 1, calls.length);
  const sent = JSON.stringify(calls[0]?.body ?? {});
  check('请求明确要求 JSON，不附加私聊规则', sent.includes('json_object') && !sent.includes('这是 VirtuGene 的手机私聊'), sent.slice(0, 700));
  check('私密动态没有进入生成请求', !sent.includes(secret));
  check('并发和重复触发都不重复发布或调用模型', simultaneous.filter(Boolean).length === 1
    && (await momentsRepo.processAutonomousPosts(userId, at)) === undefined
    && calls.length === 1 && (await db.moments.where('userId').equals(userId).count()) === 2);

  const privateLife: CharacterLifeEvent = {
    id: 'private-life', userId, characterId, threadId: 'private-thread', kind: 'reflection',
    title: '独处', summary: '秘密生活片段QW82', visibility: 'private', status: 'active',
    occurredAt: at + 1, createdAt: at + 1, updatedAt: at + 1,
  };
  await db.characterLifeEvents.put(privateLife);
  const own = await recallCharacterMemory({ userId, characterId, sources: ['moment'], query: '独处', includePrivateCharacterLifeEvents: true });
  const publicOnly = await recallCharacterMemory({ userId, characterId, sources: ['moment'], query: '独处' });
  check('私聊能召回角色自己的私密生活', own.text.includes(privateLife.summary));
  check('公开与跨角色召回不包含私密生活', !publicOnly.text.includes(privateLife.summary));
  const exportData = await collectSyncData(userId);
  check('备份包含新生活和计划数据', (exportData.characterLifeEvents ?? []).length === 2 && (exportData.momentPostPlans ?? []).length === 1);

  saveMomentsPreferences(userId, { ...loadMomentsPreferences(userId), autonomousPostsEnabled: false });
  check('关闭主动分享后不再调用模型', (await momentsRepo.processAutonomousPosts(userId, at + 3 * 86400000)) === undefined && calls.length === 1);
  saveMomentsPreferences(userId, { ...loadMomentsPreferences(userId), autonomousPostsEnabled: true });
  useAuthStore.getState().login('another-account', '另一个账号', 'sk-fake', '');
  check('账号切换后不能替旧账号发帖', (await momentsRepo.processAutonomousPosts(userId, at + 3 * 86400000)) === undefined && calls.length === 1);
  useAuthStore.getState().login(userId, '验收账号', 'sk-fake', '');

  await momentsRepo.deleteCharacterData(userId, characterId);
  check('删除角色后动态、生活、计划与互动任务一并清理',
    (await db.characterLifeEvents.where('userId').equals(userId).count()) === 0
    && (await db.momentPostPlans.where('userId').equals(userId).count()) === 0
    && (await db.moments.where('userId').equals(userId).filter((item) => item.authorCharacterId === characterId).count()) === 0
    && (await db.momentJobs.where('userId').equals(userId).filter((job) => job.status !== 'cancelled').count()) === 0);

  const failureUser = 'verify-autonomous-failure';
  useAuthStore.getState().login(failureUser, '失败账号', 'sk-fake', '');
  await characterRepo.create({ ...character('verify-autonomous-bad-model'), createdBy: failureUser });
  responseText = '这次不是结构化结果';
  const failed = await momentsRepo.processAutonomousPosts(failureUser, at);
  check('模型未返回可用 JSON 时没有伪造动态或生活事件', failed === undefined
    && (await db.moments.where('userId').equals(failureUser).count()) === 0
    && (await db.characterLifeEvents.where('userId').equals(failureUser).count()) === 0
    && (await db.momentPostPlans.where('userId').equals(failureUser).first())?.status === 'failed');

  // Public comments may use the character's own experience for tone, but the
  // published text must pass a private-memory disclosure review. Unsafe drafts
  // are regenerated from public-only context.
  useAuthStore.getState().login(userId, '验收账号', 'sk-fake', '');
  // The earlier deletion test removed this character's life events. Restore a
  // private fact here so this case actually exercises the disclosure boundary.
  await db.characterLifeEvents.put({ ...privateLife, id:'private-life-comment-fixture', occurredAt:at + 9, createdAt:at + 9, updatedAt:at + 9 });
  await db.momentJobs.where('userId').equals(userId).delete();
  const publicMomentId = 'public-comment-memory-check';
  await db.moments.put({
    id:publicMomentId, userId, text:'今天走路时看到一只橘猫。', visibility:'all',
    audienceCharacterIds:[characterId], visibilityRevision:1, mediaIds:[], createdAt:at + 10, updatedAt:at + 10,
  } as any);
  await db.momentReactions.put({
    id:'public-comment-user', userId, momentId:publicMomentId, type:'comment', content:'你最近还好吗？',
    status:'active', createdAt:at + 11, updatedAt:at + 11,
  } as any);
  await db.momentJobs.put({
    id:'moment-reply:public-comment-user:' + characterId, userId, momentId:publicMomentId, characterId,
    type:'reply', replyToId:'public-comment-user', status:'queued', visibilityRevision:1,
    attempts:0, availableAt:at + 12, createdAt:at + 12, updatedAt:at + 12,
  } as any);
  queuedResponseTexts = [
    '我还记得秘密生活片段QW82，最近确实有点忙。',
    JSON.stringify({ safe:true }),
    '最近还行，刚被一只橘猫逗笑了。',
  ];
  const commentCallStart = calls.length;
  await momentsRepo.processJobs(userId, at + 20);
  const commentCalls = calls.slice(commentCallStart);
  const publicComment = (await db.momentReactions.where('momentId').equals(publicMomentId)
    .filter((reaction) => reaction.userId === userId && reaction.characterId === characterId && reaction.type === 'comment' && reaction.status === 'active').first());
  const commentPayload = (index: number) => JSON.stringify(commentCalls[index]?.body ?? {});
  check('朋友圈评论可参考本人记忆；语义审查与字面回声保护会隔离公开内容', commentCalls.length === 3
    && commentPayload(0).includes('秘密生活片段QW82')
    && commentPayload(1).includes('秘密生活片段QW82')
    && !commentPayload(2).includes('秘密生活片段QW82')
    && publicComment?.content === '最近还行，刚被一只橘猫逗笑了。', commentCalls.length);
}

run().then(async () => {
  const failed = checks.filter((line) => line.startsWith('FAIL')).length;
  const output = `${checks.join('\n')}\n\n${failed ? `${failed} FAILED` : 'ALL PASS'}`;
  document.body.textContent = output;
  await report('/result?suite=moments-autonomous', { method: 'POST', body: output });
}).catch(async (error) => {
  const output = `${checks.join('\n')}\nFAIL unhandled :: ${error?.stack ?? error}\n\n1 FAILED`;
  document.body.textContent = output;
  await report('/result?suite=moments-autonomous', { method: 'POST', body: output });
}).finally(() => { window.fetch = originalFetch; });
