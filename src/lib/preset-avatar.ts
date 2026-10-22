/** Stable persisted identities; exact original portraits ship as local assets. */
const base = import.meta.env.BASE_URL || './';
const portraits: Record<string,string> = {
  'preset-avatar:preset-xiaoyan': base + 'assets/preset-avatars/preset-xiaoyan.jpg',
  'preset-avatar:preset-medusa': base + 'assets/preset-avatars/preset-medusa.jpg',
  'preset-avatar:preset-xiaowu': base + 'assets/preset-avatars/preset-xiaowu.jpg',
  'preset-avatar:preset-huoyuhao': base + 'assets/preset-avatars/preset-huoyuhao.jpg',
  'preset-avatar:preset-tangwutong': base + 'assets/preset-avatars/preset-tangwutong.jpg',
  'preset-avatar:preset-baixiuxiu': base + 'assets/preset-avatars/preset-baixiuxiu.jpg',
  'preset-avatar:preset-guyuena': base + 'assets/preset-avatars/preset-guyuena.jpg',
  'preset-avatar:preset-chengyan': base + 'assets/preset-avatars/preset-chengyan.jpg',
  'preset-avatar:preset-zhiwei': base + 'assets/preset-avatars/preset-zhiwei.jpg',
  'preset-avatar:preset-wenchuan': base + 'assets/preset-avatars/preset-wenchuan.jpg',
  'preset-avatar:preset-luxueqi': base + 'assets/preset-avatars/preset-luxueqi.jpg',
};

export function presetAvatarImage(avatar:string):string|undefined {
  return Object.prototype.hasOwnProperty.call(portraits,avatar) ? portraits[avatar] : undefined;
}
