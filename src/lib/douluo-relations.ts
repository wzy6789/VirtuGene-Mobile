import { db, type Character, type CharacterState } from '../db';

const IDS = ['tangsan', 'xiaowu', 'huoyuhao', 'tangwutong', 'baixiuxiu', 'guyuena'] as const;
const NAMES = ['唐三', '小舞', '霍雨浩', '唐舞桐', '白秀秀', '古月娜'];
const START = '[VirtuGene · 斗罗家族关系]';
const END = '[/VirtuGene · 斗罗家族关系]';
// Symmetric labels; descriptions explicitly define direction and generation.
const PAIRS: Array<[number, number, string, string]> = [
  [0, 1, '夫妻', '唐三与小舞是夫妻，唐舞桐和唐舞麟是他们的孩子。'],
  [0, 2, '翁婿', '唐三是霍雨浩的岳父；霍雨浩是唐舞桐的丈夫。'],
  [0, 3, '父女', '唐三是唐舞桐的父亲。'],
  [0, 4, '祖孙姻亲', '唐三是蓝轩宇的祖父；白秀秀是轩宇的伴侣。'],
  [0, 5, '公媳', '唐三是唐舞麟的父亲，古月娜是舞麟的妻子。'],
  [1, 2, '岳母与女婿', '小舞是霍雨浩的岳母；霍雨浩是唐舞桐的丈夫。'],
  [1, 3, '母女', '小舞是唐舞桐的母亲。'],
  [1, 4, '祖孙姻亲', '小舞是蓝轩宇的祖母；白秀秀是轩宇的伴侣。'],
  [1, 5, '婆媳', '小舞是唐舞麟的母亲，古月娜是舞麟的妻子。'],
  [2, 3, '夫妻', '霍雨浩与唐舞桐是夫妻；关心彼此但保持各自的性格。'],
  [2, 4, '姻亲', '霍雨浩是蓝轩宇的姑父，白秀秀是轩宇的伴侣。'],
  [2, 5, '姻亲', '霍雨浩是唐舞麟的姐夫，古月娜是舞麟的妻子。'],
  [3, 4, '姻亲', '唐舞桐是蓝轩宇的姑姑，白秀秀是轩宇的伴侣。'],
  [3, 5, '姑嫂', '唐舞桐是唐舞麟的姐姐，古月娜是舞麟的妻子。'],
  [4, 5, '师徒与家人', '古月娜曾以娜娜老师的身份教导白秀秀；古月娜是蓝轩宇的母亲，白秀秀是轩宇的伴侣。'],
];

export function isDouluoPreset(id: string): boolean { return IDS.some((name) => id === 'preset-' + name); }

export function withDouluoRelations(prompt: string, presetId: string): string {
  const index = IDS.findIndex((id) => presetId === 'preset-' + id);
  if (index < 0) return prompt;
  const lines = PAIRS.filter(([a, b]) => a === index || b === index)
    .map(([a, b, , detail]) => '- ' + NAMES[a === index ? b : a] + '：' + detail);
  const block = `${START}
【当前关系背景】以古月娜与唐舞麟婚后、家族关系已经明确的互动背景为准。你是${NAMES[index]}，不是其他角色；保留你自己的性格、能力与说话方式。
${lines.join('\n')}
唐舞麟是唐三、小舞的儿子、唐舞桐的弟弟；蓝轩宇也是唐轩宇，是舞麟与古月娜的儿子。这些名字即使没有独立角色卡，仍是背景人物，不代表他们此刻在场。
对伴侣、孩子、长辈及家人分别表达合适的态度，不把亲情当爱情，也不把用户自动当成任何原著人物。用户明确自称某人时按已确立的角色扮演身份自然回应；只有古月娜对自称舞麟的用户沿用其婚后伴侣规则。
这些是背景关系，不是用户聊天记忆，不证明某次见面或共同活动真实发生。已有用户手动设定的关系与当前明确场景优先；不要汇总或分享其他角色的私密记忆。
${END}`;
  const start = prompt.indexOf(START), end = start < 0 ? -1 : prompt.indexOf(END, start);
  return start >= 0 && end >= 0
    ? prompt.slice(0, start) + block + prompt.slice(end + END.length)
    : prompt + '\n\n' + block;
}

/** Seed actual owned nodes once per pair, without resetting any user's relationship state. */
export async function syncDouluoRelations(characters?: Character[]): Promise<void> {
  const all = characters ?? await db.characters.toArray();
  const owned = all.filter((c) => !c.isPreset && c.createdBy && c.sourcePresetId && isDouluoPreset(c.sourcePresetId));
  const owners = [...new Set(owned.map((c) => c.createdBy))];
  await db.transaction('rw', db.characterStates, async () => {
    for (const userId of owners) {
      const mine = owned.filter((c) => c.createdBy === userId);
      const states = new Map((await db.characterStates.where('userId').equals(userId).toArray()).map((s) => [s.characterId, s]));
      const changed = new Set<string>();
      const get = (id: string): CharacterState => {
        const old = states.get(id);
        if (old) return old;
        const fresh = { characterId: id, userId, affinity: 0, mood: 70, milestones: [], updatedAt: Date.now() };
        states.set(id, fresh); return fresh;
      };
      for (const [a, b, label, description] of PAIRS) {
        for (const left of mine.filter((c) => c.sourcePresetId === 'preset-' + IDS[a])) {
          for (const right of mine.filter((c) => c.sourcePresetId === 'preset-' + IDS[b])) {
            const l = get(left.id), r = get(right.id);
            const key = [left.id, right.id].sort().join(':');
            if (l.presetRelationSeeds?.includes(key) || r.presetRelationSeeds?.includes(key)) continue;
            // A user-defined pair in either direction wins as a whole.
            const manual = l.storyRelations?.some((x) => x.targetCharacterId === right.id)
              || r.storyRelations?.some((x) => x.targetCharacterId === left.id);
            const now = Date.now();
            for (const [state, target] of [[l, right.id], [r, left.id]] as const) {
              states.set(state.characterId, {
                ...state, updatedAt: now,
                presetRelationSeeds: [...(state.presetRelationSeeds ?? []), key],
                ...(!manual ? { storyRelations: [...(state.storyRelations ?? []), { targetCharacterId: target, label, description, createdAt: now }] } : {}),
              });
              changed.add(state.characterId);
            }
          }
        }
      }
      if (changed.size) await db.characterStates.bulkPut([...changed].map((id) => states.get(id)!));
    }
  });
}
