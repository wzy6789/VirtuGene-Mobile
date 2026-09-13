/**
 * World Facts：世界设定的自然语言层（5.0.0 Living World §31 / §32 / §33 / §101）
 *
 * "世界设定"页不做复杂表单：顶部就是一句话输入框
 * （"告诉我这个世界是什么样的……"），用户说什么就是什么。
 *
 * 这里解决一个**必须由程序解决**的问题：**改设定**。
 * 用户说"这里以后一直是秋天"，世界记下一条规则；后来说"改一下，这个世界其实存在魔法"，
 * 那么旧的"这里没有魔法"必须**被替换**，而不是留下两条互相冲突的 Canon。
 *
 * 冲突判定分两条路：
 * 1. 模型提出 `replaces`（原样抄写被替换的那条）⇒ 程序按**原文精确匹配**后停用旧设定
 * 2. 确定性兜底：两条规则共享一个实词、且**恰好只有一条含否定** ⇒ 判定为冲突，停用较旧的一条
 *
 * 两条路都只做"停用"（`active=false`），**从不删除**：
 * 用户可以在设定页看到它、随时重新启用。世界的历史不该被静默抹掉。
 */
import type { WorldFact, WorldFactCategory } from '../../db/index';
import { worldFactRepo } from '../../db/world-fact-repo';

export const WORLD_FACT_CATEGORY_LABEL: Record<WorldFactCategory, string> = {
  rule: '世界的规则',
  location: '地点',
  atmosphere: '氛围',
  history: '过往',
  shared_knowledge: '你们之间的共识',
  character_fact: '角色的事实',
  custom: '其它设定',
};

/** 判定冲突时要忽略的泛用词（否则"这个世界""这里"会让任何两条规则都算冲突） */
const GENERIC_TERMS = new Set([
  '这个', '那个', '这里', '那里', '世界', '以后', '永远', '一直', '现在', '我们', '你们', '他们',
  '一个', '时候', '什么', '地方', '城市', '其实', '真的', '可以', '就是', '还是', '因为', '所以',
]);

const NEGATION = /(不|没|无|别|莫|非)/;

/** 取出可用于冲突判定的实词（2 字滑窗，去掉泛用词） */
export function contentTerms(text: string): string[] {
  const clean = (text ?? '').replace(/[，。！？、；：""''《》（）()\[\]{}?!.,;:"'\s]/g, '');
  const terms: string[] = [];
  for (let i = 0; i + 2 <= clean.length; i += 1) {
    const term = clean.slice(i, i + 2);
    if (GENERIC_TERMS.has(term)) continue;
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

/**
 * 两条设定是否互相冲突：共享实词 + 恰好一条含否定。
 * 刻意保守：宁可漏判（交给模型提 replaces），也不误停用用户真正想要的设定。
 */
export function contradictsRule(a: string, b: string): boolean {
  const negA = NEGATION.test(a);
  const negB = NEGATION.test(b);
  if (negA === negB) return false;
  const termsA = new Set(contentTerms(a));
  return contentTerms(b).some((term) => termsA.has(term));
}

export interface ReconcileResult {
  /** 被停用的旧设定 id（撤销时要恢复它们，因此必须如实返回） */
  deactivated: string[];
}

/**
 * 写入一条新的长期设定，并处理与既有设定之间的冲突。
 * `replaces` 是模型给出的"被替换掉的那一条"原文（可空）。
 */
export async function upsertWorldFactWithReconcile(params: {
  userId: string;
  worldId: string;
  category: WorldFactCategory;
  content: string;
  visibility?: WorldFact['visibility'];
  visibleTo?: string[];
  sourceType: string;
  sourceId: string;
  data?: Record<string, unknown>;
  /** 模型提出的"被替换的旧设定原文"（程序会按原文精确匹配） */
  replaces?: string;
}): Promise<{ factId: string; deactivated: string[] }> {
  const content = params.content.trim();
  const deactivated: string[] = [];

  // 1) 模型明确说了替换谁：按**原文精确匹配**（绝不模糊匹配）
  if (params.replaces?.trim()) {
    const target = params.replaces.trim();
    const candidates = await worldFactRepo.listByWorld(params.worldId, { activeOnly: true });
    const hit = candidates.find((f) => f.content === target || f.content.includes(target) || target.includes(f.content));
    if (hit && hit.content !== content) {
      await worldFactRepo.setActive(hit.id, false);
      deactivated.push(hit.id);
    }
  }

  // 2) 确定性兜底：同类别里与新设定共享实词且否定状态相反的旧规则 ⇒ 停用
  const sameCategory = await worldFactRepo.listByWorld(params.worldId, { category: params.category, activeOnly: true });
  for (const existing of sameCategory) {
    if (existing.content === content) continue;
    if (deactivated.includes(existing.id)) continue;
    if (contradictsRule(existing.content, content)) {
      await worldFactRepo.setActive(existing.id, false);
      deactivated.push(existing.id);
    }
  }

  const factId = await worldFactRepo.upsert({
    userId: params.userId,
    worldId: params.worldId,
    category: params.category,
    content,
    ...(params.visibility ? { visibility: params.visibility } : {}),
    ...(params.visibleTo ? { visibleTo: params.visibleTo } : {}),
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    ...(params.data ? { data: params.data } : {}),
  });
  return { factId, deactivated };
}

/**
 * 世界设定页的确定性录入（§32）。
 * 页面上的"解析成 rule / location / character_fact"由 Intent Interpreter 完成；
 * 这里只是**不依赖模型**的兜底：把一句话按最明显的特征归到某个类别。
 */
export function guessFactCategory(text: string): WorldFactCategory {
  const t = text.trim();
  if (/(规则|不能|不许|禁止|没有|不会|只能)/.test(t)) return 'rule';
  if (/(住在|位于|城市|小镇|村子|公寓|海边|山上|街|路|学校|店)/.test(t)) return 'location';
  if (/(气氛|感觉|总是|永远.*(安静|热闹|冷|暖))/.test(t)) return 'atmosphere';
  if (/(以前|过去|曾经|历史上)/.test(t)) return 'history';
  if (/(我们说好|约定|共识|大家都知道)/.test(t)) return 'shared_knowledge';
  return 'custom';
}

/** 世界设定页读取（全部，含已暂停的） */
export async function listWorldSettings(worldId: string): Promise<WorldFact[]> {
  return worldFactRepo.listByWorld(worldId);
}

/** 用户在设定页里编辑一条（改文案就是改这一行，不会产生第二条） */
export async function editWorldSetting(id: string, content: string): Promise<WorldFact | undefined> {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  return worldFactRepo.update(id, { content: trimmed.slice(0, 400) });
}

export async function removeWorldSetting(id: string): Promise<void> {
  await worldFactRepo.remove(id);
}

/** 暂停 / 恢复一条设定（用户可"先不用它"，而不是删掉） */
export async function toggleWorldSetting(id: string, active: boolean): Promise<void> {
  await worldFactRepo.setActive(id, active);
}

/** 设定页分组（保持分类顺序稳定，便于 UI 渲染） */
export function groupSettings(facts: WorldFact[]): { category: WorldFactCategory; label: string; items: WorldFact[] }[] {
  const order: WorldFactCategory[] = ['rule', 'location', 'atmosphere', 'history', 'shared_knowledge', 'character_fact', 'custom'];
  return order
    .map((category) => ({
      category,
      label: WORLD_FACT_CATEGORY_LABEL[category],
      items: facts.filter((f) => f.category === category),
    }))
    .filter((group) => group.items.length > 0);
}
