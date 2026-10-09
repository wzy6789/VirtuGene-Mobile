// Source attribution survives compression: saying something is not proof it happened.
export const MEMORY_SOURCE_POLICY = '来源规则：用户原话、角色原话和旧摘要分别记录。角色说过的往事、近况或行动只能记为“角色曾说（未经独立核实）”，不能升级成共同经历或已发生事实；承诺记为承诺，不记为已经完成。用户转述、引用、假设及创作保留其语境。旧摘要不是新增证据，未标来源的旧细节保持待核实，不自动确认。用户明确更正覆盖旧说法；保留当下表达的喜欢、态度与约定，不因未核实而删除正常对话。';

export function memorySpeaker(role, userAuthored = true) {
  if (role === 'assistant') return '角色曾说（未经独立核实，不作为经历或行动已发生的证据）';
  if (role === 'user' && userAuthored === false) return '助理代拟（不是用户原话，不作为独立事实证据）';
  return role === 'user' ? '用户原话' : '其他上下文（不是用户原话）';
}
