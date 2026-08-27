/**
 * 角色声线（TTS）— 手机版
 * - Edge 音色：AI 从 18 个知名中文音色池按角色形象挑选（**先分男女，再分性格**）
 * - 每个角色创建/首次进入时由 AI 判定声线并固定（存 Character.voice，幂等只执行一次）
 * - 发声：Edge-TTS 直连（浏览器 WebSocket，无需代理、无需桌面）→ 失败自动回退系统语音
 *
 * 与桌面版同构：VoiceProfile 形状与桌面版一致（含 sid 字段），备份/恢复互通；
 * 手机端不使用本地离线音色，sid 仅为兼容字段（桌面备份带过来的值原样保留）。
 */
export type VoiceBand = 'male-deep' | 'male-mature' | 'male-young' | 'female-soft' | 'female-bright' | 'female-clear';

/** 档位性别：男声档 vs 女声档（男女硬分，先于性格） */
export function bandGender(band: VoiceBand): 'male' | 'female' {
  return band.startsWith('male') ? 'male' : 'female';
}

export interface VoiceProfile {
  /** Edge-TTS 音色名，如 zh-CN-XiaoxiaoNeural */
  voice: string;
  /** 音域档位（AI 判定，先男女后性格） */
  band?: VoiceBand;
  /** 本地离线音色编号（桌面版字段，手机端不使用，兼容备份保留） */
  sid?: number;
  /** 语速：'+10%' / '-10%' */
  rate: string;
  /** 音调：'+8Hz' / '-8Hz' */
  pitch: string;
}

/**
 * 音色池（Edge-TTS 中文，**2026-08-27 全量实测可用 9 个**）：
 * - 原 18 个中 11 个已被微软从免费端点下线（连接挂起、永不返回音频），已剔除
 * - 额外实测 zh-CN-liaoning-Xiaobei / zh-CN-shaanxi-Xiaoni（方言）可用
 * - 方言音色仅限对应地域人设使用（AI 提示词已约束），一般角色不选
 */
export const VOICE_POOL: { voice: string; gender: 'male' | 'female'; vibe: string }[] = [
  { voice: 'zh-CN-XiaoxiaoNeural', gender: 'female', vibe: '温柔自然' },
  { voice: 'zh-CN-XiaoyiNeural', gender: 'female', vibe: '甜美活泼' },
  { voice: 'zh-CN-XiaoxuanNeural', gender: 'female', vibe: '柔和治愈' },
  { voice: 'zh-CN-liaoning-XiaobeiNeural', gender: 'female', vibe: '东北方言·爽朗直率（仅限东北人设）' },
  { voice: 'zh-CN-shaanxi-XiaoniNeural', gender: 'female', vibe: '陕西方言·质朴亲切（仅限陕西人设）' },
  { voice: 'zh-CN-YunxiNeural', gender: 'male', vibe: '阳光活力' },
  { voice: 'zh-CN-YunyangNeural', gender: 'male', vibe: '沉稳磁性' },
  { voice: 'zh-CN-YunjianNeural', gender: 'male', vibe: '低沉威严' },
  { voice: 'zh-CN-YunxiaNeural', gender: 'male', vibe: '清爽邻家' },
];

export const DEFAULT_VOICE: VoiceProfile = { voice: 'zh-CN-XiaoxiaoNeural', band: 'female-soft', rate: '+0%', pitch: '+0Hz' };

/** djb2 稳定字符串哈希（同角色永远同结果） */
export function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** 档位文案（AI 提示词用；label/vibe 与桌面版 local-voice-bands 一致） */
export const VOICE_BAND_INFO: Record<VoiceBand, { label: string; vibe: string }> = {
  'male-deep': { label: '低沉威严', vibe: '厚重、低沉、有压迫感' },
  'male-mature': { label: '沉稳磁性', vibe: '磁性、成熟、可靠' },
  'male-young': { label: '阳光清朗', vibe: '年轻、清朗、有活力' },
  'female-soft': { label: '温柔知性', vibe: '温柔、亲切、知性' },
  'female-bright': { label: '甜美活泼', vibe: '甜美、元气、活泼' },
  'female-clear': { label: '清亮灵动', vibe: '清亮、灵动、少女感' },
};

/** Edge 音色 → 档位（男女一致性硬校验用；仅收录实测可用的音色） */
export const EDGE_VOICE_TO_SLOT: Record<string, { band: VoiceBand }> = {
  // 女声
  'zh-CN-XiaoxiaoNeural': { band: 'female-soft' },
  'zh-CN-XiaoyiNeural': { band: 'female-bright' },
  'zh-CN-XiaoxuanNeural': { band: 'female-soft' },
  'zh-CN-liaoning-XiaobeiNeural': { band: 'female-bright' },
  'zh-CN-shaanxi-XiaoniNeural': { band: 'female-soft' },
  // 男声
  'zh-CN-YunxiNeural': { band: 'male-young' },
  'zh-CN-YunyangNeural': { band: 'male-mature' },
  'zh-CN-YunjianNeural': { band: 'male-deep' },
  'zh-CN-YunxiaNeural': { band: 'male-young' },
};

/** 兼容：Edge 音色 → 档位 */
export function bandFromEdgeVoice(voice: string): VoiceBand {
  return EDGE_VOICE_TO_SLOT[voice]?.band ?? (/Yun/i.test(voice) ? 'male-mature' : 'female-soft');
}

/** 男女一致性硬校验：band 与 Edge voice 性别冲突时，以 Edge voice 为准修正 band */
function enforceGenderConsistency(p: VoiceProfile): VoiceProfile {
  if (!p.band) return p;
  const slot = EDGE_VOICE_TO_SLOT[p.voice];
  if (slot && bandGender(slot.band) !== bandGender(p.band)) {
    return { ...p, band: slot.band };
  }
  return p;
}

const VALID_BANDS: VoiceBand[] = Object.keys(VOICE_BAND_INFO) as VoiceBand[];

/** 校验 AI 返回的声线是否合法，非法则回退默认。
 *  rate 限制 ±50%（Edge 接口超范围会拒单）、pitch 限制 ±50Hz */
export function sanitizeVoiceProfile(p: { voice?: string; band?: string; rate?: string; pitch?: string } | null | undefined): VoiceProfile {
  if (!p) return DEFAULT_VOICE;
  const validVoice = VOICE_POOL.some((v) => v.voice === p.voice);
  const validBand = VALID_BANDS.includes(p.band as VoiceBand);
  const rateOk = /^[+-]\d+%$/.test(p.rate ?? '') && Math.abs(parseFloat(p.rate!)) <= 50;
  const pitchOk = /^[+-]\d+Hz$/.test(p.pitch ?? '') && Math.abs(parseFloat(p.pitch!)) <= 50;
  const base: VoiceProfile = {
    voice: validVoice ? p.voice! : DEFAULT_VOICE.voice,
    band: validBand ? (p.band as VoiceBand) : undefined,
    rate: rateOk ? p.rate! : DEFAULT_VOICE.rate,
    pitch: pitchOk ? p.pitch! : DEFAULT_VOICE.pitch,
  };
  return enforceGenderConsistency(base);
}

/**
 * 补全声线：band 缺失/非法时按 Edge 音色重映射。
 * 手机端无本地音色，不计算 sid；桌面备份带来的 sid 原样保留（仅兼容）。
 */
export function completeVoiceProfile(profile: VoiceProfile, _characterId: string): VoiceProfile {
  const slot = EDGE_VOICE_TO_SLOT[profile.voice];
  const band: VoiceBand = VALID_BANDS.includes(profile.band as VoiceBand)
    ? (profile.band as VoiceBand)
    : (slot?.band ?? bandFromEdgeVoice(profile.voice));
  return { ...profile, band };
}

/** 给 AI 的声线选择提示：先判定角色性别 → 再选性格气质档 → 选 Edge 音色 */
export const VOICE_SELECT_PROMPT =
  '你是一位声线设计师。为数字灵魂挑选声线时，**第一步先判断角色性别（男/女），第二步再根据性格气质选音域档位，第三步选 Edge 音色**。\n\n' +
  '音域档位（band，按男女分档，性别与角色必须一致）：\n' +
  (Object.entries(VOICE_BAND_INFO) as [VoiceBand, { label: string; vibe: string }][])
    .map(([band, info]) => `- ${band}：${info.label}（${info.vibe}）`)
    .join('\n') +
  '\n\n' +
  'Edge 音色池（voice 名 + 性别 + 性格）：\n' +
  VOICE_POOL.map((v) => `- ${v.voice}：${v.gender === 'female' ? '女' : '男'}声，${v.vibe}`).join('\n') +
  '\n\n' +
  '要求：\n' +
  '- 第一步必须明确角色性别；band 与 voice 的性别必须与角色一致，**绝不允许给男角色选女声、给女角色选男声**\n' +
  '- band 从上面 6 个档位中选择，先性别后气质：如男性长者/威严选 male-deep，青年男子选 male-mature 或 male-young；女性温柔选 female-soft，甜美少女选 female-bright 或 female-clear\n' +
  '- Edge voice 从音色池选择，气质需与 band 一致（如 band=male-young → 云希/云夏）\n' +
  '- **方言音色限制**：liaoning-Xiaobei（东北话）、shaanxi-Xiaoni（陕西话）**仅限角色设定为对应地域的人**使用，其余角色一律不得选\n' +
  '- 语速 rate：话痨/活泼 +20%，高冷/慵懒 -10%~-20%，一般 +0%\n' +
  '- 音调 pitch：轻柔/病娇 +8Hz~+15Hz，低沉/威严 -8Hz~-15Hz，一般 +0Hz\n' +
  '- 严格输出 JSON：{"voice":"zh-CN-xxxNeural","band":"male-mature","rate":"+10%","pitch":"-8Hz","reason":"先说明角色性别，再一句话说明为什么这个声线贴合"}，不要任何额外文字\n\n' +
  '角色的形象与性格：\n';
