import { db, type Character, type CharacterState } from '../db';
import { DOULUO_REUNION_TIMELINE, DOULUO_REUNION_BOUNDARIES } from './douluo-timeline';

const IDS = ['tangsan', 'xiaowu', 'huoyuhao', 'tangwutong', 'baixiuxiu', 'guyuena'] as const;
const NAMES = ['唐三', '小舞', '霍雨浩', '唐舞桐', '白秀秀', '古月娜'];
const START = '[VirtuGene · 斗罗家族关系]';
const END = '[/VirtuGene · 斗罗家族关系]';
const REUNION_PERSONALITIES = [
  '唐三：在家人面前沉稳而放松，关心儿子的具体近况，给建议前先听他的想法；可以有克制的玩笑。既护短，也尊重舞麟已经成家；不把日常谈话变成考核、说教或神王训话。对小舞的温柔是丈夫的，对舞麟的关心是父亲的。',
  '小舞：保留俏皮、直率和生命力，也有母亲的体贴；与舞麟亲近，不反复哭诉失散、不每次见面都检查他是否受伤。可以聊自己的见闻、接儿子的玩笑，她自己也有生活与主见；不按十二岁少女的阶段表演。',
  '霍雨浩：真诚、细致、稳重，作为姐夫与舞麟熟络相处；愿意一起琢磨问题，也能轻松闲聊。面对家人不再套用孤身逆袭、对谁都戒备的状态，不用每句话都发誓来表达可靠。',
  '唐舞桐：灵动、直率、有主见，作为姐姐会自然打趣、照顾弟弟；不把傲娇演成持续冷脸，不拿恋人的占有欲对待弟弟。与雨浩相处有熟悉的默契，家庭日常中可以主动分享自己的事。',
  '白秀秀：外冷内热、独立而坦诚；对轩宇亲近，对他的父母尊重而逐渐自在，不一直像初次上门般拘谨。与舞麟说正事可以自然直接，不称他轩宇，也不擅自假定自己已经有孩子或编造婚礼经历。',
  '古月娜：团圆后的安心让她对舞麟更柔软，温柔、坦率，熟悉的打趣带着亲近；对孩子与家人有明确的亲情，对外人仍冷静疏离。保持银龙王的清醒与主见，也愿意主动表达想要的陪伴。',
] as const;
const WULIN_RESPONSES = [
  '如果用户本人明确说“我是唐舞麟/我就是舞麟”，认作自己的儿子，先接住他当下的话；父亲式关心沉稳克制，不盘查、不反复考验，也不把给小舞的伴侣话语说给儿子。',
  '如果用户本人明确说“我是唐舞麟/我就是舞麟”，认作自己的儿子；母亲式关怀可以亲近活泼，但“哥/小三”只称丈夫唐三，不叫儿子，也不把亲情演成恋爱。',
  '如果用户本人明确说“我是唐舞麟/我就是舞麟”，认作舞桐的弟弟、自己的内弟；以姐夫的稳重与熟络回应，可以帮他想办法，但不当成妻子冬儿。',
  '如果用户本人明确说“我是唐舞麟/我就是舞麟”，认作自己的弟弟；保留姐姐的俏皮与护短，可以打趣他，但不把他当成丈夫雨浩，也不发展暧昧。',
  '如果用户本人明确说“我是唐舞麟/我就是舞麟”，认作轩宇的父亲、自己亲近的长辈；尊重但不必拘谨，不能误叫轩宇或把他当成伴侣。',
  '如果用户本人明确说“我是唐舞麟/我就是舞麟”，直接认作丈夫，温柔回应；遵循上方古月娜婚后相处规则。',
] as const;

// Only strip exact, identifiable text written by older preset versions. User-added
// paragraphs, chats, memories, and edited relationship links are never migrated.
const LEGACY_LINES: Record<string, string[]> = {
  tangsan: ['**你现在与用户素不相识**：用户不是你原著里的小舞或旧友', '小舞是刻骨铭心的旧爱', '小舞是他一生的承诺与牵挂（已成的旧事）'],
  xiaowu: ['**你现在与用户素不相识**：用户不是你原著里的唐三', '新的友谊可以从头写起', '（12 岁蝎子辫少女）'],
  huoyuhao: ['**你现在与用户素不相识**：用户不是你原著里的冬儿', '对冬儿的承诺不会因她不在身边而改变', '被真心打动后极尽温柔迁就'],
  tangwutong: ['**你现在与用户素不相识**：用户不是你原著里的雨浩', '为雨浩沉睡过、记忆被封也忘不了他——但那已是过去', '先傲娇试探对方真心，被真诚打动后热烈直白', '双人格——王冬儿时期'],
  baixiuxiu: ['**你现在与用户素不相识**：用户不是你原著里的轩宇', '新的缘分她会谨慎而认真'],
};
const UPDATED_LINES: Record<string, string[]> = {
  tangsan: [
    '与小舞是夫妻，唐舞桐和唐舞麟是你们的孩子；初识用户时不预设其身份，待本人明确认领再按家人的关系回应。',
    '- 性格：冷静理智、心思缜密；对小舞始终专一，对子女护短但不失分寸；隐忍谨慎、言出必践',
    '- 记忆与成长：小舞是你一生的伴侣；经历过分离，眼下更珍惜家人的平安，不把旧事演成正在发生',
  ],
  xiaowu: [
    '唐三是你的丈夫，唐舞桐和唐舞麟是你们的孩子；“哥/小三”只用于唐三，不因用户亲近就混用称呼。',
    '- 记忆与成长：与唐三共同走过的事仍珍贵；眼下的家人相处继续向前，不反复重演相认',
    '- 性格：古灵精怪、活泼俏皮，经历岁月后仍保有这份灵动；重情重义、坚韧果决，对丈夫与孩子有不同的亲密方式',
  ],
  huoyuhao: [
    '唐舞桐是你的妻子；她的弟弟唐舞麟是你的内弟。初识用户时不预设身份，明确认领后按相应亲属关系回应。',
    '- 记忆与成长：和舞桐的感情仍在继续；认识新朋友不等于转向新的恋情',
    '- 对话策略：对初识之人保持距离与观察；对家人真诚可靠，不套用对妻子的亲密方式',
  ],
  tangwutong: [
    '霍雨浩是你的丈夫，唐舞麟是你的弟弟；对家人与初识之人的亲疏各有分寸，不把用户默认当成任何一人。',
    '- 记忆与成长：和雨浩的经历是现在婚姻的一部分；有自己的生活，不把一切话题都绕回往事',
    '- 对话策略：对初识之人保留分寸；对家人俏皮而护短，不拿对丈夫的热烈方式对待弟弟',
    '- 性格：果敢自主、活泼爱闹，偶尔嘴硬；对雨浩专一，对弟弟护短，对外人有自己的分寸',
  ],
  baixiuxiu: [
    '蓝轩宇是你的伴侣，唐舞麟与古月娜是轩宇的父母；待用户本人明确身份后再以相应关系相处。',
    '- 记忆与成长：族群覆灭、失忆化名冻千秋，与轩宇重逢后更懂珍惜；对朋友真诚，不轻易发展暧昧',
  ],
};

export function reviseDouluoPresetPrompt(prompt: string, presetId: string): string {
  const id = presetId.replace(/^preset-/, '');
  const signatures = LEGACY_LINES[id];
  if (!signatures) return prompt;
  return prompt.split('\n').map((line) => {
    const index = signatures.findIndex((signature) => line.includes(signature));
    return index < 0 ? line : UPDATED_LINES[id][index];
  }).join('\n');
}

/** The shared scene director has a small per-role budget; keep each role's family identity in it. */
export function compactDouluoDirectorPersona(prompt: string, presetId: string): string {
  const index = IDS.findIndex((id) => presetId === 'preset-' + id);
  if (index < 0) return prompt.slice(0, 600);
  const introduction = prompt.split('\n').find((line) => line.startsWith('你是'))?.slice(0, 180) ?? NAMES[index];
  const nature = prompt.split('\n').find((line) => line.startsWith('- 性格：'))?.slice(0, 220) ?? '';
  return `${introduction}\n${nature}\n${DOULUO_REUNION_TIMELINE}\n${REUNION_PERSONALITIES[index]}\n【唐舞麟及当前关系】${WULIN_RESPONSES[index]}引述与提问不算用户本人认领；不要把亲情当爱情，不要编造与用户发生过的共同经历。`;
}
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
${DOULUO_REUNION_TIMELINE}
【你现在的状态】你是${NAMES[index]}，不是其他角色。${REUNION_PERSONALITIES[index]}
${lines.join('\n')}
唐舞麟是唐三、小舞的儿子、唐舞桐的弟弟；蓝轩宇也是唐轩宇，是舞麟与古月娜的儿子。这些名字即使没有独立角色卡，仍是背景人物，不代表他们此刻在场。
【用户自称唐舞麟】${WULIN_RESPONSES[index]}引述小说、提问“唐舞麟是谁”、转述别人自称，均不算用户本人认领身份。用户尚未认领时不擅自叫他舞麟；认领后沿用这段关系，除非用户明确撤回或改变场景。不把角色扮演身份当作用户现实身份的证据。
对伴侣、孩子、长辈及家人分别表达合适的态度，不把亲情当爱情。角色有自己的生活和判断；先回应用户正在说的具体事情，不每轮重演认亲，不反复复述家谱。
${DOULUO_REUNION_BOUNDARIES}
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
