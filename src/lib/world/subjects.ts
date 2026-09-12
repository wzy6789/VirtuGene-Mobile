/**
 * Living World 标识约定（5.0.0 Phase 1）
 *
 * 两件事必须从一开始就统一，否则多世界/多用户/导入恢复时必然踩坑：
 *
 * 1) **SubjectRef**：关系与世界事件的"主体"不再用裸字符串。
 *    - 用户：`u:<userId>`
 *    - 角色：`c:<characterId>`
 *    这样永远不会和真实的 characterId（例如 `gu-yue-na`）撞名，
 *    也不会出现"角色恰好叫 user"这种歧义。
 *
 * 2) **pairKey**：先按字典序排序，再用 `|` 组合。
 *    - 用户 ↔ 角色：`c:gu-yue-na|u:abc123`
 *    - 角色 ↔ 角色：`c:lin-jian|c:xing-yao`
 *    排序保证 A↔B 与 B↔A 得到同一个键。
 *
 * 3) **stableId**：派生数据（迁移回填、场景结算写入的事件等）使用
 *    "由幂等键算出的确定性 id"，因此重复执行不会产生重复行——
 *    幂等性由 id 结构保证，而不是靠事后去重。
 */

export const USER_REF_PREFIX = 'u:';
export const CHARACTER_REF_PREFIX = 'c:';

/** 用户主体引用：`u:<userId>` */
export function userRef(userId: string): string {
  return `${USER_REF_PREFIX}${userId}`;
}

/** 角色主体引用：`c:<characterId>` */
export function characterRef(characterId: string): string {
  return `${CHARACTER_REF_PREFIX}${characterId}`;
}

export function isUserRef(ref: string): boolean {
  return ref.startsWith(USER_REF_PREFIX);
}

export function isCharacterRef(ref: string): boolean {
  return ref.startsWith(CHARACTER_REF_PREFIX);
}

/** 取出角色 id；不是角色引用时返回 null（绝不猜） */
export function characterIdOf(ref: string): string | null {
  return isCharacterRef(ref) ? ref.slice(CHARACTER_REF_PREFIX.length) : null;
}

export function userIdOf(ref: string): string | null {
  return isUserRef(ref) ? ref.slice(USER_REF_PREFIX.length) : null;
}

/** 主体引用数组里所有角色 id（用于按 characterId 建索引/查询） */
export function characterIdsOf(subjects: string[]): string[] {
  const out: string[] = [];
  for (const ref of subjects) {
    const id = characterIdOf(ref);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** pairKey：先排序再拼，保证 A↔B 与 B↔A 一致 */
export function subjectPairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** 返回排序后的两个主体（subjectA 恒 ≤ subjectB） */
export function subjectPair(a: string, b: string): [string, string] {
  const sorted = [a, b].sort();
  return [sorted[0], sorted[1]];
}

/** 该 pairKey 涉及的全部主体 */
export function subjectsOfPairKey(pairKeyValue: string): string[] {
  return pairKeyValue.split('|');
}

/** 该 pairKey 是否包含指定角色 */
export function pairKeyHasCharacter(pairKeyValue: string, characterId: string): boolean {
  return subjectsOfPairKey(pairKeyValue).includes(characterRef(characterId));
}

// ---------------------------------------------------------------------------
// 确定性 id
// ---------------------------------------------------------------------------

/** FNV-1a 32 位 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** djb2 变体（第二个独立散列，降低碰撞概率） */
function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(hash, 33) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 由幂等键生成确定性 id：`<prefix>_<16 位十六进制>`。
 * 同一个 key 永远得到同一个 id ⇒ 重复迁移/重复结算只会覆盖同一行，不会新增重复。
 */
export function stableId(prefix: string, ...parts: string[]): string {
  const key = parts.join('\u0001');
  const h1 = fnv1a(key).toString(16).padStart(8, '0');
  const h2 = djb2(key).toString(16).padStart(8, '0');
  return `${prefix}_${h1}${h2}`;
}

/** worldEvents 的幂等键：userId + worldId + sourceType + sourceId */
export function worldEventIdempotencyKey(
  userId: string,
  worldId: string,
  sourceType: string,
  sourceId: string,
): string {
  return [userId, worldId, sourceType, sourceId].join('|');
}

export function derivedWorldEventId(
  userId: string,
  worldId: string,
  sourceType: string,
  sourceId: string,
): string {
  return stableId('we', worldEventIdempotencyKey(userId, worldId, sourceType, sourceId));
}

/** 默认世界 id（每用户一个；确定性生成，重复升级不会多建世界） */
export function defaultWorldId(userId: string): string {
  return stableId('world', userId, 'default');
}

export function defaultWorldName(username?: string): string {
  return username ? `${username} 的世界` : '我的世界';
}
