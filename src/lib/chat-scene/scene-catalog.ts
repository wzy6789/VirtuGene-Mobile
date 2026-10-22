/** Appearance metadata only: selecting a room never changes story location or persona. */
export const DEFAULT_SCENE_ID = 'orbital-observatory' as const;
export const SCENE_CATALOG = [
  { id:'polar-refuge', label:'极北之地 · 寒冬', style:'nature', mood:'cold', space:'home', description:'冰窗外是寒冬，这里留着一盏暖灯', readingPreset:'frost', effect:'snow' },
  { id:'orbital-observatory', label:'星域观景舱', style:'cosmic', mood:'quiet', space:'observatory', description:'隔着舷窗看星河，陪你坐一会儿', readingPreset:'midnight', effect:'starfield' },
  { id:'moonlit-bedroom', label:'月光卧室', style:'urban', mood:'warm', space:'home', description:'被角松软，床头灯还为你亮着', readingPreset:'hearth', effect:'bedroom-rain' },
  { id:'guofeng-tea-room', label:'竹窗茶室', style:'guofeng', mood:'quiet', space:'home', description:'竹帘半卷，留一盏茶的时间', readingPreset:'hearth', effect:'garden-rain' },
  { id:'urban-window-seat', label:'城市窗边', style:'urban', mood:'warm', space:'home', description:'窗外万家灯火，坐下来慢慢聊', readingPreset:'midnight', effect:'city-rain' },
  { id:'cafe-afternoon', label:'午后咖啡厅', style:'urban', mood:'warm', space:'cafe', description:'木香、暖阳与一杯热咖啡', readingPreset:'cafe', effect:'dust' },
  { id:'cafe-rain-night', label:'雨夜咖啡厅', style:'urban', mood:'lonely', space:'cafe', description:'窗外细雨，留一盏灯陪你', readingPreset:'cafe', effect:'rain' },
  { id:'snow-study', label:'雪夜书房', style:'nature', mood:'cold', space:'home', description:'雪落窗前，书页与茶仍温热', readingPreset:'frost', effect:'snow' },
  { id:'mist-coast', label:'雾海观景室', style:'nature', mood:'lonely', space:'coast', description:'远礁、雾海与安静的留白', readingPreset:'coast', effect:'mist' },
  { id:'hearth-cabin', label:'壁炉小屋', style:'nature', mood:'warm', space:'home', description:'炉火与木屋，收留一天的疲惫', readingPreset:'hearth', effect:'embers' },
  { id:'night-train', label:'夜行列车', style:'urban', mood:'quiet', space:'train', description:'夜雨掠过车窗，陪你慢慢聊', readingPreset:'midnight', effect:'train-rain' },
  { id:'home-bedroom', label:'暖灯卧室', style:'urban', mood:'quiet', space:'home', description:'柔软被褥、窗边细雨与床头灯', readingPreset:'hearth', effect:'bedroom-rain' },
  { id:'home-living', label:'晨光客厅', style:'urban', mood:'warm', space:'home', description:'窝进沙发，把日常慢慢说给你', readingPreset:'cafe', effect:'home-dust' },
] as const;
export type SceneId = typeof SCENE_CATALOG[number]['id'];
export type SceneReadingPreset = typeof SCENE_CATALOG[number]['readingPreset'];
export type SceneEffect = typeof SCENE_CATALOG[number]['effect'];
export function isSceneId(id:unknown):id is SceneId { return SCENE_CATALOG.some(scene=>scene.id===id); }
export function getSceneDescription(id:unknown) { return SCENE_CATALOG.find(scene=>scene.id===id)??SCENE_CATALOG.find(scene=>scene.id===DEFAULT_SCENE_ID)!; }
