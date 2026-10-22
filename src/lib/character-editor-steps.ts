export const CHARACTER_CREATE_STEPS = [
  { label: '身份', title: '先认识 TA', description: '从一个名字与一张头像开始。' },
  { label: '性格', title: '塑造 TA 的性格', description: '写下性格、来历，或从细节慢慢展开。' },
  { label: '表达', title: '找到 TA 的说话方式', description: '语气可以鲜明，边界也由你决定。' },
  { label: '关系', title: '你们会怎样相处', description: '从初次相识开始，或带着你设定的过去。' },
  { label: '相遇', title: '准备好相遇了吗', description: '预览当前设定，准备好后再保存。' },
] as const;

/** Existing four-step drafts retain their semantic destination. */
export function migrateCharacterCreateStep(step: number, version: number): number {
  return version === 1 ? [0, 3, 1, 4][step] : step;
}
