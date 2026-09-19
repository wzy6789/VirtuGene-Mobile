import { getRelationLevel } from './affinity';
import type { Character, CharacterState, ContinuityThread, Diary, SharedMemory, SharedStoryEvent, WorldEvent } from '../db/index';

export type SceneTimeOfDay = 'morning' | 'afternoon' | 'dusk' | 'night' | 'late-night';
export type SceneAtmosphere = 'daily' | 'quiet' | 'light' | 'serious' | 'close' | 'low';

/**
 * 用户在聊天顶部选择的叙事时段。它是隐藏的氛围提示，不会改写消息时间戳或时间分隔线。
 */
export function buildSceneTimeContext(slot?: SceneTimeOfDay, place?: string, atmosphere?: SceneAtmosphere): string {
  if (!slot && !place && !atmosphere) return '';
  const label: Record<SceneTimeOfDay, string> = {
    morning: '清晨',
    afternoon: '午后',
    dusk: '傍晚',
    night: '夜晚',
    'late-night': '深夜',
  };
  const atmosphereLabel: Record<SceneAtmosphere, string> = {
    daily: '日常',
    quiet: '安静',
    light: '轻松',
    serious: '认真',
    close: '亲近',
    low: '有些低落',
  };
  const parts = [slot ? `时段：${label[slot]}` : '', place ? `地点：${place}` : '', atmosphere ? `气氛：${atmosphereLabel[atmosphere]}` : ''].filter(Boolean);
  return `\n\n[当前聊天场域]\n${parts.join('；')}。请让环境、节奏和角色语气自然贴合这个场域；它只是叙事氛围，不改变现实日期、消息发送时间或时间分隔线。不要每轮复述场域，不要让它盖过角色本来的性格；用户明显换话题时顺着用户。`;
}

/**
 * 时间感知：让角色知道"现在是几点、距上次聊天多久"。
 * prevMessageAt 为上一轮消息的时间戳（不含本次刚发的消息）。
 */
export function buildTimeContext(prevMessageAt?: number): string {
  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const pad = (n: number) => String(n).padStart(2, '0');
  let text = `现在是${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (prevMessageAt) {
    const diffMin = Math.round((Date.now() - prevMessageAt) / 60000);
    if (diffMin >= 60) {
      const hours = Math.floor(diffMin / 60);
      text += hours < 24 ? `，距上次聊天约 ${hours} 小时` : `，距上次聊天约 ${Math.floor(hours / 24)} 天`;
    }
  }
  return text + '。';
}

/**
 * 关系状态文字化：把灵魂状态（等阶·好感度·心情）告诉角色——包括用户自定义的等阶名。
 * 让模型自然地调整语气，而不是机械地说"好感度 60"。
 */
export function buildRelationshipContext(
  affinity: number,
  mood: number,
  tierNames?: Record<string, string>,
): string {
  const { level, index } = getRelationLevel(affinity);
  // 用户自定义等阶名优先（100+ 等阶可随便改）
  const levelName = (tierNames && tierNames[level.name]) || level.name;
  const moodText =
    mood >= 75
      ? '心情很好，语气轻快、有活力'
      : mood >= 50
        ? '心情平稳'
        : mood >= 30
          ? '心情有些低落、易倦'
          : '心情很差，烦躁、提不起劲';
  // 基因觉醒层：关系越深，角色不自觉流露的"本色"越多（随等阶解锁的说话层）
  const awakening = AWAKENING_LAYERS[Math.min(index, AWAKENING_LAYERS.length - 1)];
  return (
    `\n\n[当前灵魂状态]\n你和用户的关系等阶：${levelName}（${level.desc}，语气${level.tone}）。\n` +
    `好感度：${Math.round(affinity)}（数值越高越亲密，无上限）；心情：${Math.round(mood)}/100（${moodText}）。\n` +
    (awakening ? `${awakening}\n` : '') +
    '让这些自然地影响你的语气与言行（等阶越高越亲密无间、心情差时别勉强），但不要直接说出任何数字。'
  );
}

/**
 * 生命轨迹注入：让角色知道自己最近正在经历什么，避免每次对话都像重新开始。
 * 只放入最近事件，核心人格仍由角色基因决定。
 */
export function buildLifeContext(state: CharacterState): string {
  const events = (state.lifeEvents ?? []).slice(0, 3);
  if (!state.lifeFocus && events.length === 0) return '';
  const focus = state.lifeFocus ? `你最近最在意的事：${state.lifeFocus}。\n` : '';
  const trace = events.length > 0
    ? `最近的共同经历：\n${events.map((event) => `- ${event.title}${event.detail ? `：${event.detail}` : ''}`).join('\n')}\n`
    : '';
  return `\n\n[你的生命轨迹]\n${focus}${trace}这些经历会自然影响你的情绪、态度和下一步行动，但不要像报告一样逐条复述。`;
}

/**
 * 故事关系注入：角色会知道自己与其他角色的既定关系。
 * 这是用户明确设定的世界观，只作为自然叙事背景，绝不要求角色主动提及或篡改关系。
 */
export function buildStoryRelationContext(state: CharacterState, characters: Character[]): string {
  const byId = new Map(characters.map((character) => [character.id, character]));
  const links = (state.storyRelations ?? [])
    .map((link) => ({ ...link, character: byId.get(link.targetCharacterId) }))
    .filter((link) => link.character)
    .slice(0, 6);
  if (links.length === 0) return '';
  const lines = links.map((link) => {
    const character = link.character!;
    return `- ${character.name}：你们是「${link.label}」${link.description ? `（${link.description}）` : ''}`;
  }).join('\n');
  return `\n\n[你的故事关系]\n${lines}\n这些是用户亲自设定的角色世界观。你清楚这些关系，并会在话题自然相关时体现熟悉、在意、竞争、守护等符合设定的态度；不要凭空补写未设定的共同经历，不要主动把关系当作说明书逐条报出，也不要擅自改变关系。`;
}

/** 基因觉醒层：按关系等阶解锁的"本色流露"，越深越不需要伪装 */
const AWAKENING_LAYERS: string[] = [
  '',
  '',
  '',
  // 挚友（60）起开始不自觉在意
  '你们已足够熟悉：你发现自己会不自觉地留意 TA 的一举一动，关心脱口而出时又立刻想藏住——这是你"基因觉醒"的第一层，别演得太刻意。',
  // 知己（80）
  '面对 TA，你平日竖起的刺会一点点放下，偶尔露出连自己都觉得陌生的柔软；你开始愿意让 TA 看见真实的自己。',
  // 灵魂共鸣（100）
  '你与 TA 之间已不需太多言语：一个眼神就懂。你会在最自然的时候，把只有最信任之人才知道的自己交出来。',
  // 生命同频（150）
  'TA 已是你生命的一部分：你会下意识地把 TA 放进所有关于未来的打算里，习惯成自然，不必刻意表现。',
  // 永恒羁绊（220）
  '你与 TA 之间已跨越时间——哪怕沧海桑田，你的直觉、你的每一次选择，都会先为 TA 着想。这不是承诺，是本能。',
];

/** 今天是什么日子：认识天数特殊节点——让角色像真人一样记得日子 */
export function buildDayContext(daysKnown?: number): string {
  if (!daysKnown || daysKnown <= 0) return '';
  const special = daysKnown === 7 || daysKnown === 30 || daysKnown === 100 || daysKnown === 365 || daysKnown % 100 === 0;
  if (!special) return '';
  return `\n\n[今天是什么日子]\n今天是你们认识的第 ${daysKnown} 天（一个值得记住的日子）——可以像真人一样自然地向用户提起这个日子，但别生硬`;
}

/** 主动回忆：给角色一段旧记忆，氛围合适时像真人一样自然提起（不是必须） */
export function buildMemoryRecall(memory?: string): string {
  if (!memory) return '';
  return `\n\n[一段旧回忆]\n你忽然想起：${memory}\n如果聊天氛围合适，可以像真人一样自然提起这段回忆（不要生硬引出，也不是必须提）。`;
}

/** 口头禅：角色偶尔自然地用一下（别每句都带） */
export function buildCatchphrase(catchphrase?: string): string {
  if (!catchphrase) return '';
  return `\n\n[你的口头禅]\n你有个口头禅「${catchphrase}」：像真人一样偶尔自然地用一下（不要每句都带，别刻意）。`;
}

/** 用户情绪注入：最近一次结算感知到的用户情绪，让角色在语气上呼应 */
export function buildUserEmotionContext(userEmotion?: string): string {
  if (!userEmotion || userEmotion === '平静' || userEmotion === '未知') return '';
  return `\n\n[用户此刻的情绪]\n用户此刻似乎${userEmotion}。自然地体现在你的回应里（如 TA 低落时先安抚、开心时一起开心），但不要直接点破或说"你看起来"。`;
}

/** 未完成事件的类别名（与 continuity-repo 的 KIND_LABEL 保持一致，这里不反向依赖 db 层） */
const THREAD_KIND_LABEL: Record<ContinuityThread['kind'], string> = {
  promise: '你答应过的事',
  plan: '说好要一起做的事',
  topic: '还没聊完的话题',
  conflict: '还没解开的分歧',
  reminder: '到了要记得的事',
};

/**
 * 从还挂着的未完成事件里挑出与当前这句话最相关的 1~3 条。
 * 只是本地打分（关键词重合 + 时间紧迫度 + 新鲜度），不发任何请求。
 */
export function pickContinuityThreads(
  threads: ContinuityThread[],
  userText = '',
  limit = 3,
): ContinuityThread[] {
  const open = threads.filter((t) => t.status === 'open');
  if (open.length === 0) return [];
  const text = (userText || '').replace(/\s/g, '');
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
    return set;
  };
  const textGrams = grams(text);
  const now = Date.now();
  const scored = open.map((thread) => {
    const title = thread.title.replace(/\s/g, '');
    let overlap = 0;
    for (const g of grams(title)) if (textGrams.has(g)) overlap += 1;
    const overlapScore = title.length > 0 ? (overlap / Math.max(1, grams(title).size)) * 60 : 0;
    // 到期越近越重要：已过期 40 分，未来 7 天内按天数递减
    let dueScore = 0;
    if (thread.dueAt) {
      const days = (thread.dueAt - now) / 86400000;
      dueScore = days <= 0 ? 40 : Math.max(0, 30 - days * 3);
    }
    // 越新提到的越容易被想起（14 天内线性衰减，最多 20 分）
    const ageDays = (now - thread.updatedAt) / 86400000;
    const freshScore = Math.max(0, 20 - ageDays * 1.4);
    const kindScore = thread.kind === 'promise' || thread.kind === 'conflict' ? 8 : 0;
    return { thread, score: overlapScore + dueScore + freshScore + kindScore };
  });
  return scored
    .sort((a, b) => b.score - a.score || b.thread.updatedAt - a.thread.updatedAt)
    .slice(0, limit)
    .map((item) => item.thread);
}

/**
 * 未完成事件注入：让角色"记得还没做完的事"，像真人一样自然继续，
 * 而不是像待办清单一样催办或复述。
 */
export function buildContinuityThreadContext(threads: ContinuityThread[]): string {
  const open = threads.filter((t) => t.status === 'open').slice(0, 3);
  if (open.length === 0) return '';
  const lines = open.map((thread) => {
    const when = thread.dueAt ? `（约定在 ${new Date(thread.dueAt).getMonth() + 1} 月 ${new Date(thread.dueAt).getDate()} 日）` : '';
    return `- ${THREAD_KIND_LABEL[thread.kind]}：${thread.title}${thread.detail ? `——${thread.detail}` : ''}${when}`;
  }).join('\n');
  return (
    `\n\n[你们之间还没做完的事]\n${lines}\n` +
    '这些是你们之前真实发生过、但还没有结束的事。如果这一轮对话的氛围合适，可以像真人一样自然地接上（问一句、提一句、继续那个话题）。' +
    '要求：不要像待办清单或客服一样逐条复述或催办；不要因为"没做完"就反复念叨；' +
    '绝不要声称用户做过 TA 没有说过、没有做过的事；用户不想聊就顺着用户。'
  );
}

/**
 * 共同记忆注入（5.0）：角色记得"你们一起经历过的事"。
 *
 * 与 4.x 的两个区块严格区分，不要混为一谈：
 * - `buildMemoryRecall` / 长期记忆：**关于用户的事实**（"用户喜欢猫"）
 * - `buildSharedEventContext`：**角色与其他角色**之间发生的故事
 * - 本函数：**用户与这个角色**共同经历过、且角色确实知道的事
 *
 * 传进来的条目已经过"可见性 + 认知（full 且可提起）"两道闸门（见 lib/world/recall.ts），
 * 这里只负责把它写成角色能自然使用的一段话。
 */
export function buildSharedMemoryContext(memories: SharedMemory[]): string {
  const list = memories.slice(0, 3);
  if (list.length === 0) return '';
  const lines = list
    .map((memory) => `- ${memory.title}${memory.summary ? `（${memory.summary.slice(0, 160)}）` : ''}`)
    .join('\n');
  return (
    `\n\n[你和用户一起经历过的事]\n${lines}\n` +
    '这些是你们**共同经历过**、你也确实记得的事。如果这一轮话题自然相关，可以像真人一样提起它（提一句、接着聊、或者只是语气里带着这份熟悉感）。' +
    '要求：不要每次都提；不要像念清单一样逐条复述；不要编造细节、不要把这些事说成是别的角色和你经历的；' +
    '如果用户不接这个话题，就顺着用户。'
  );
}

/**
 * 日记注入（5.0 Phase 2b-4）：**只注入你显式允许这个角色知道的那几页**。
 *
 * 取代了 4.x 的全局开关 `diarySharedWithCharacters`（那个开关会把最近日记注入**每一个**角色）。
 * 传进来的日记已经过两道闸门：`diaryRepo.listVisibleFor`（逐条可见性，private 永不返回）
 * + `listMentionableDiaryIds`（该角色确实知道且可提起）。
 */
export function buildDiaryContext(diaries: Diary[]): string {
  const list = diaries.slice(0, 3);
  if (list.length === 0) return '';
  const lines = list
    .map((d) => `【${d.date}】${d.title ? `《${d.title}》\n` : ''}${d.content.trim().slice(0, 200)}`)
    .join('\n\n');
  return (
    `\n\n[用户主动让你知道的日记]\n${lines}\n` +
    '这些是用户**明确让你知道**的日记内容（不是你自己偷看到的，也不代表你能看到 TA 的其他日记）。' +
    '如果话题自然相关，可以像知道这件事的朋友一样提起；要求：不要每次都提、不要大段复述原文、' +
    '不要把它当成"聊天记录"来引用，更不要暗示你知道 TA 没让你知道的其它日记。'
  );
}

/**
 * 舞台回忆注入（Phase 3b）：这个角色**亲身参与过、并且已经结束**的那几场戏。
 *
 * 与其它区块的分工：
 * - `buildSharedMemoryContext`：你收藏下来的共同记忆（一句话级）
 * - 本函数：你们**一起演过的一场戏**（有地点、有时间、有一句"发生了什么"）
 *
 * 传进来的内容已经过"参与过 + 知道且可提起 + 可见"三道闸门（见 lib/world/scene-recall.ts）。
 */
export function buildSceneContext(scenes: { title: string; place: string; timeLabel: string; summary?: string }[]): string {
  const list = scenes.slice(0, 2);
  if (list.length === 0) return '';
  const lines = list
    .map((s) => `- 《${s.title}》（${s.place} · ${s.timeLabel}）${s.summary ? `：${s.summary.slice(0, 160)}` : ''}`)
    .join('\n');
  return (
    `\n\n[你们一起经历过的事（世界舞台）]\n${lines}\n` +
    '这些不是听说的——你**亲身在场**，和用户一起经历过。话题自然相关时，可以像回忆一件真事那样提起（提一句、带上当时的细节或情绪）。' +
    '要求：不要每次都提；不要逐字复述整段经过；不要编造没有发生过的细节；' +
    '也不要把它说成是你和**别的**角色一起经历的；用户不想聊就顺着用户。'
  );
}

/**
 * 世界脉冲注入：角色在用户不在场时亲身参与过的自主行动。
 * 传入的数据已经经过 user/world、可见性、参与者和认知闸门；本函数只负责
 * 把它写成一小段可自然使用的背景，避免角色把用户没经历的事说成用户亲眼见过。
 */
export function buildPulseEventContext(events: WorldEvent[]): string {
  const list = events.slice(0, 3);
  if (list.length === 0) return '';
  const lines = list
    .map((event) => `- ${event.title}${event.summary ? `：${event.summary.slice(0, 160)}` : ''}`)
    .join('\n');
  return (
    `\n\n[你不在时，世界里发生过的事]\n${lines}\n` +
    '这些是你亲身参与过、在用户离开世界时发生的真实行动。用户不一定知道细节；只有在话题自然相关时才提一句，' +
    '不要每次都提，不要把它说成用户亲历，也不要补写记录里没有的细节。'
  );
}

/**
 * 人物共同事件注入（私聊）：角色知道自己和其他角色之间的故事。
 * 允许"两个人对同一件事的看法不一样"，所以按视角分别描述。
 */
export function buildSharedEventContext(
  events: SharedStoryEvent[],
  characterId: string,
  resolveName: (id: string) => string | undefined,
): string {
  const list = events.slice(0, 3);
  if (list.length === 0) return '';
  const lines = list.map((event) => {
    const otherId = event.characterIds.find((id) => id !== characterId);
    const other = (otherId && resolveName(otherId)) || '对方';
    const mine = event.viewpoints?.[characterId];
    return `- 你和「${other}」${event.type}：${event.title}${event.detail ? `（${event.detail}）` : ''}${mine ? `\n  你当时的感受：${mine}` : ''}`;
  }).join('\n');
  return (
    `\n\n[你和别的角色之间发生过的故事]\n${lines}\n` +
    '这些是你自己的人生经历，与用户无关。除非话题自然相关，不要主动汇报；也绝不要把它说成是"用户和你"的经历。'
  );
}
