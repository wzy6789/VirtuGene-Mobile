/**
 * 可见性闸门（5.0 隐私边界：唯一实现）
 *
 * 三态语义（§24 / `WorldVisibility`）：
 * - `private`  只有用户自己 —— **永远不返回给任何角色**
 * - `selected` 只有 `visibleTo` 里的角色
 * - `world`    世界内角色都可以知道
 *
 * 为什么必须收敛成一个函数（2b-2 审核指出的缺陷）：
 * 之前 `sharedMemories` / `worldEvents` / `diaries` 各自内联了一份可见性判断，
 * 而 `sharedMemoryRepo.listRelevant` 更进一步把"是否可见"当成了**排序加分项**——
 * 于是"对这个角色不可见"的记忆仍然可能被排进返回结果。
 * 一旦上下文编译器用它召回记忆，就会把不该给这个角色看的记忆送进 Prompt。
 *
 * 因此这里定死两条规则，所有"给角色看"的查询都必须走这两个函数：
 * 1. 可见性是**过滤条件**，不是评分项；
 * 2. **空角色列表 ⇒ 一律不可见**（`Array.prototype.every` 对空数组恒真，
 *    直接拿它当闸门会在"没有指定角色"时把 private 数据放出去）。
 */

/** 只依赖这两个字段，因此三张表（记忆/世界事件/日记）都能复用 */
export interface VisibilitySubject {
  visibility?: 'private' | 'selected' | 'world';
  visibleTo?: string[];
}

/** 这个角色是否**被允许知道**这条内容（没标注可见性 ⇒ 按最保守的 private 处理） */
export function isVisibleToCharacter(subject: VisibilitySubject, characterId: string): boolean {
  if (!characterId) return false;
  if (subject.visibility === 'world') return true;
  if (subject.visibility === 'selected') return (subject.visibleTo ?? []).includes(characterId);
  return false;
}

/**
 * **在场的每一个角色**是否都被允许知道（多人/群聊场景）。
 * 只要有一个角色不在 `visibleTo` 里就返回 false——宁可少召回，不可多泄漏。
 * 空列表一律 false（见文件头第 2 条）。
 */
export function isVisibleToEveryCharacter(subject: VisibilitySubject, characterIds: string[]): boolean {
  if (characterIds.length === 0) return false;
  return characterIds.every((id) => isVisibleToCharacter(subject, id));
}
