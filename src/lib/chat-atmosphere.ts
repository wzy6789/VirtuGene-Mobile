import type { Character } from '../db';

export const CHAT_ATMOSPHERE_THEME_IDS = ['neutral', 'cool', 'warm', 'lively', 'calm', 'steady', 'mysterious'] as const;
export type ChatAtmosphereThemeId = typeof CHAT_ATMOSPHERE_THEME_IDS[number];
export type ChatAtmosphereMode = 'character' | 'manual';
export type ChatAtmosphereMotion = 'off' | 'gentle' | 'vivid';

/** Opaque reading surfaces are deliberate: atmosphere never lowers text contrast. */
export interface ChatAtmospherePalette {
  bg: string; panel: string; surface: string; surfaceStrong: string; ai: string;
  user: string; action: string; text: string; sub: string; accent: string; cyan: string;
  border: string; borderStrong: string; edge: string; glow: string; glowSecondary: string;
  highlight: string; shadow: string;
}

export interface ChatAtmosphereTheme {
  id: ChatAtmosphereThemeId;
  label: string;
  description: string;
  light: ChatAtmospherePalette;
  dark: ChatAtmospherePalette;
  /** Background life is slow and stationary; no per-message trigger. */
  motion: { periodMs: number };
}

/** Light palettes are independently tuned paper surfaces, not inverted dark colors. */
export const CHAT_ATMOSPHERE_THEMES: readonly ChatAtmosphereTheme[] = [
  {
    id: 'neutral', label: '中性陪伴', description: '柔和雾灰与微光，让对话自然成为中心。',
    light: { bg:'#f3f4f8',panel:'#fafbfe',surface:'#e9edf3',surfaceStrong:'#dfe5ee',ai:'#fafbfe',user:'#4e5888',action:'#515c91',text:'#252b3b',sub:'#566175',accent:'#535f95',cyan:'#286c75',border:'#d7dfeb',borderStrong:'#bac6da',edge:'rgba(57,73,105,.13)',glow:'#a5afd7',glowSecondary:'#aad1d1',highlight:'rgba(255,255,255,.85)',shadow:'rgba(35,47,77,.08)' },
    dark: { bg:'#101521',panel:'#1a2232',surface:'#242f42',surfaceStrong:'#303d53',ai:'#1a2232',user:'#3f4c80',action:'#4b5b98',text:'#edf1fa',sub:'#abb7cd',accent:'#b1bfee',cyan:'#9acdd3',border:'#303d53',borderStrong:'#50627e',edge:'rgba(170,191,224,.13)',glow:'#6c81c3',glowSecondary:'#509fa7',highlight:'rgba(221,234,255,.075)',shadow:'rgba(0,4,15,.2)' },
    motion: { periodMs:18000 },
  },
  {
    id: 'cool', label: '雾月', description: '雾紫与银灰，集中的柔光缓慢呼吸。',
    light: { bg:'#f2f1f7',panel:'#faf9fd',surface:'#eae7f2',surfaceStrong:'#dfdbea',ai:'#faf9fd',user:'#5c5184',action:'#63568d',text:'#2d293b',sub:'#625a72',accent:'#6a5795',cyan:'#386173',border:'#ddd8e9',borderStrong:'#c2b8d7',edge:'rgba(72,55,112,.13)',glow:'#bdaddb',glowSecondary:'#b7c9db',highlight:'rgba(255,255,255,.86)',shadow:'rgba(57,38,92,.08)' },
    dark: { bg:'#141321',panel:'#201e32',surface:'#2c2942',surfaceStrong:'#39344f',ai:'#201e32',user:'#4b3f74',action:'#60508e',text:'#f1eef9',sub:'#b7afcf',accent:'#c8b6f0',cyan:'#afd0df',border:'#38324e',borderStrong:'#5c5278',edge:'rgba(194,177,226,.13)',glow:'#9c82cf',glowSecondary:'#7b9bb7',highlight:'rgba(233,219,255,.075)',shadow:'rgba(7,2,20,.22)' },
    motion: { periodMs:20000 },
  },
  {
    id: 'warm', label: '暖杏', description: '暖杏与奶白，轻柔漫射的陪伴光感。',
    light: { bg:'#f7f3ee',panel:'#fdfaf6',surface:'#f0e8df',surfaceStrong:'#e7dbcd',ai:'#fdfaf6',user:'#885643',action:'#895941',text:'#3c3029',sub:'#6e5c4b',accent:'#855139',cyan:'#39675c',border:'#e6d9c9',borderStrong:'#ccb79f',edge:'rgba(114,78,45,.13)',glow:'#e9c6a6',glowSecondary:'#d5dabf',highlight:'rgba(255,255,255,.88)',shadow:'rgba(98,64,34,.075)' },
    dark: { bg:'#201814',panel:'#2d231d',surface:'#3b2e25',surfaceStrong:'#49382d',ai:'#2d231d',user:'#754838',action:'#8d543e',text:'#f8eee5',sub:'#ccb8a7',accent:'#e1b294',cyan:'#b3d0bf',border:'#49382e',borderStrong:'#725540',edge:'rgba(230,195,159,.13)',glow:'#bd8157',glowSecondary:'#829b75',highlight:'rgba(255,225,194,.07)',shadow:'rgba(14,5,0,.21)' },
    motion: { periodMs:18000 },
  },
  {
    id: 'lively', label: '桃霞', description: '浅桃与暖珊瑚，只在边缘留一点轻快。',
    light: { bg:'#f8f1f0',panel:'#fff9f7',surface:'#f3e5e3',surfaceStrong:'#ead6d2',ai:'#fff9f7',user:'#984d51',action:'#9c5052',text:'#3e2c30',sub:'#72565b',accent:'#94484b',cyan:'#266963',border:'#e7d3d3',borderStrong:'#d1aeae',edge:'rgba(131,67,77,.13)',glow:'#edaea4',glowSecondary:'#e6c8a0',highlight:'rgba(255,255,255,.87)',shadow:'rgba(119,54,63,.075)' },
    dark: { bg:'#21161b',panel:'#30202a',surface:'#402b36',surfaceStrong:'#513440',ai:'#30202a',user:'#7c3d50',action:'#994d5e',text:'#faedf1',sub:'#cdb0bd',accent:'#f0aab7',cyan:'#abd9cd',border:'#513442',borderStrong:'#775164',edge:'rgba(236,178,193,.13)',glow:'#d16f7c',glowSecondary:'#b8955e',highlight:'rgba(255,219,230,.075)',shadow:'rgba(18,0,8,.22)' },
    motion: { periodMs:18000 },
  },
  {
    id: 'calm', label: '澄空', description: '雾蓝与蓝灰，干净留白与稳定光感。',
    light: { bg:'#eef3f7',panel:'#f8fbfd',surface:'#e4edf4',surfaceStrong:'#d4e2ed',ai:'#f8fbfd',user:'#3d6486',action:'#416b8f',text:'#263542',sub:'#506477',accent:'#38618a',cyan:'#246671',border:'#d1dfeb',borderStrong:'#adc6db',edge:'rgba(42,83,116,.13)',glow:'#a8c9e3',glowSecondary:'#b7d6dc',highlight:'rgba(255,255,255,.87)',shadow:'rgba(29,67,100,.075)' },
    dark: { bg:'#101b25',panel:'#192a39',surface:'#223a4c',surfaceStrong:'#2d4a5e',ai:'#192a39',user:'#315c7e',action:'#366787',text:'#ebf3fa',sub:'#a9c0d1',accent:'#9dc5e9',cyan:'#9bd4db',border:'#2c465a',borderStrong:'#486b86',edge:'rgba(151,191,223,.14)',glow:'#5c9ac9',glowSecondary:'#60a5ad',highlight:'rgba(206,233,255,.07)',shadow:'rgba(0,9,20,.2)' },
    motion: { periodMs:20000 },
  },
  {
    id: 'steady', label: '松影', description: '灰绿与米灰，安静而有支撑的层次。',
    light: { bg:'#f0f3ee',panel:'#fafcf8',surface:'#e6ece3',surfaceStrong:'#d8e2d5',ai:'#fafcf8',user:'#4d6b56',action:'#53745d',text:'#2b382d',sub:'#546650',accent:'#44664b',cyan:'#30656e',border:'#d5e0d0',borderStrong:'#b5c9af',edge:'rgba(58,91,50,.13)',glow:'#b5cba9',glowSecondary:'#d8ccb6',highlight:'rgba(255,255,255,.85)',shadow:'rgba(48,78,42,.075)' },
    dark: { bg:'#142019',panel:'#203027',surface:'#2b4034',surfaceStrong:'#38513f',ai:'#203027',user:'#3c6248',action:'#477552',text:'#edf5eb',sub:'#b0c5ae',accent:'#b2d0a9',cyan:'#a2ccd0',border:'#354c3c',borderStrong:'#526f59',edge:'rgba(174,207,161,.13)',glow:'#719b69',glowSecondary:'#9b8967',highlight:'rgba(225,244,214,.07)',shadow:'rgba(0,13,3,.2)' },
    motion: { periodMs:20000 },
  },
  {
    id: 'mysterious', label: '夜岚', description: '灰靛与暗紫，边缘微光留出纵深。',
    light: { bg:'#f0f0f7',panel:'#f8f8fd',surface:'#e6e6f1',surfaceStrong:'#dadae9',ai:'#f8f8fd',user:'#545287',action:'#5b5691',text:'#2e2d42',sub:'#5e5b76',accent:'#61569b',cyan:'#386171',border:'#d9d8e9',borderStrong:'#bab7d3',edge:'rgba(64,56,119,.14)',glow:'#a9a4d6',glowSecondary:'#c7aed4',highlight:'rgba(255,255,255,.84)',shadow:'rgba(43,36,93,.085)' },
    dark: { bg:'#121120',panel:'#1d1b30',surface:'#29253f',surfaceStrong:'#37304f',ai:'#1d1b30',user:'#473972',action:'#594585',text:'#efedfa',sub:'#b7b0d0',accent:'#baadf1',cyan:'#a9c7df',border:'#342d4b',borderStrong:'#594d76',edge:'rgba(184,167,227,.14)',glow:'#7765b5',glowSecondary:'#8e638e',highlight:'rgba(225,215,255,.065)',shadow:'rgba(5,0,18,.24)' },
    motion: { periodMs:20000 },
  },
];

const byId = new Map(CHAT_ATMOSPHERE_THEMES.map(theme => [theme.id, theme]));
export function isChatAtmosphereThemeId(value: unknown): value is ChatAtmosphereThemeId {
  return typeof value === 'string' && byId.has(value as ChatAtmosphereThemeId);
}
export function getChatAtmosphereTheme(id: ChatAtmosphereThemeId): ChatAtmosphereTheme {
  return byId.get(id) ?? byId.get('neutral')!;
}

export type CharacterAtmosphereSource = Pick<Character, 'tags' | 'systemPrompt' | 'secretaryPersonality'> & { personality?: string };
export interface CharacterAtmosphereResolution {
  primary: ChatAtmosphereThemeId;
  secondary?: ChatAtmosphereThemeId;
  source: 'character' | 'neutral';
}
const traits: Record<Exclude<ChatAtmosphereThemeId, 'neutral'>, readonly string[]> = {
  cool: ['清冷','克制','冷静克制','冷淡','寡言','高冷','外冷内热','内敛','冷傲'],
  warm: ['温柔','亲近','体贴','善解人意','柔和','细腻','温暖','柔软','温和','gentle'],
  lively: ['活泼','外向','开朗','热情','俏皮','幽默','调皮','乐天','阳光','energetic','playful'],
  calm: ['理性','沉静','逻辑','严谨','冷静','理智','专业','客观','沉着','professional'],
  steady: ['稳重','可靠','踏实','沉稳','耐心','务实','坚毅','负责','成熟','忠诚'],
  mysterious: ['神秘','疏离','深沉','隐秘','莫测','若即若离','孤傲','难以捉摸'],
};
const traitIds = Object.keys(traits) as Exclude<ChatAtmosphereThemeId, 'neutral'>[];
const secretaryDefault: Partial<Record<NonNullable<Character['secretaryPersonality']>, ChatAtmosphereThemeId>> = {
  gentle:'warm',energetic:'lively',playful:'lively',professional:'calm',
};

/** Mapping is local, conservative and deterministic. Names, avatars, chat history
 * and transient emotion are never input. We use authored traits, not identity lore. */
export function resolveCharacterAtmosphere(character?: Partial<CharacterAtmosphereSource> | null): CharacterAtmosphereResolution {
  if (!character) return { primary:'neutral',source:'neutral' };
  const scores = new Map(traitIds.map(id => [id, 0]));
  const score = (raw: string, weight: number) => {
    const value = raw.toLowerCase().slice(0, 1200);
    for (const id of traitIds) {
      // Multiple synonyms of the same trait in one line do not multiply its vote.
      const matches = traits[id].some(word => {
        let at = value.indexOf(word);
        while (at !== -1) {
          const before = value.slice(Math.max(0, at - 8), at);
          if (!/(?:不是|并非|不再|不要|避免|不|非|没有|not\s|never\s)[^，。；、:：!?！？]{0,4}$/i.test(before)) return true;
          at = value.indexOf(word, at + word.length);
        }
        return false;
      });
      if (matches) scores.set(id, scores.get(id)! + weight);
    }
  };
  (character.tags ?? []).filter((tag): tag is string => typeof tag === 'string').slice(0, 20).forEach(tag => score(tag, 3));
  if (typeof character.personality === 'string') score(character.personality, 4);
  const secretary = character.secretaryPersonality && secretaryDefault[character.secretaryPersonality];
  if (secretary && secretary !== 'neutral') scores.set(secretary, scores.get(secretary as typeof traitIds[number])! + 4);
  if (typeof character.systemPrompt === 'string') {
    // Explicit personality/expression fields only. Story characters mentioned in
    // other sections, sample dialogue and temporary reactions cannot tint the room.
    const lines = character.systemPrompt.slice(0, 12000).split(/\n/).slice(0, 100);
    for (const line of lines) {
      const authored = line.match(/^(?:\s*[-*•·\d.)、]+\s*)?(?:性格(?:特点|底色|特征)?|人格|气质|说话风格|personality|temperament)\s*[:：]\s*(.+)$/i);
      if (authored) score(authored[1], 2);
    }
  }
  const ranked = traitIds.map(id => ({ id, score:scores.get(id)! })).sort((a,b) => b.score-a.score);
  if (ranked[0].score < 2) return { primary:'neutral',source:'neutral' };
  const secondary = ranked[1].score >= 2 && ranked[1].score >= ranked[0].score * .5 ? ranked[1].id : undefined;
  return { primary:ranked[0].id,...(secondary ? { secondary } : {}),source:'character' };
}

/** One palette source supplies both CSS modes; root.dark selects aliases without
 * a React theme subscription or a frame of the previous character's colors. */
export function getChatAtmosphereVariables(primary: ChatAtmosphereThemeId, secondary?: ChatAtmosphereThemeId): Record<`--${string}`, string> {
  const theme = getChatAtmosphereTheme(primary), companion = secondary ? getChatAtmosphereTheme(secondary) : undefined;
  const vars: Record<`--${string}`, string> = {};
  for (const mode of ['light','dark'] as const) {
    for (const [name,value] of Object.entries(theme[mode])) {
      vars[`--chat-${mode}-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`] = value;
    }
    if (companion) vars[`--chat-${mode}-glow-secondary`] = companion[mode].glow;
  }
  vars['--chat-motion-period'] = `${theme.motion.periodMs}ms`;
  return vars;
}
