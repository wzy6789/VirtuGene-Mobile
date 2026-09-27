/** Chat records remain in the creation draft; only reviewed style is persisted. */
export interface ChatStyleProfile { rules: string; examples: string[] }
export interface ChatRecord { speaker: string; text: string }
export const STYLE_MARKER = '[从聊天学习的表达]';
export function parseChatRecords(raw: string): ChatRecord[] {
  const records: ChatRecord[] = [];
  let pendingSpeaker = '';
  let startsMessage = false;
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const text = line.trim();
    if (!text) continue;
    // QQ exported headers: date, time, nickname (numeric account optional).
    const header = text.match(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)(?:\(\d+\))?$/);
    if (header) { pendingSpeaker = header[1].trim(); startsMessage = true; continue; }
    const labeled = text.match(/^([^:：\n]{1,40})[:：]\s*(.+)$/);
    if (labeled && !/^\d+$/.test(labeled[1])) {
      pendingSpeaker = labeled[1].trim();
      records.push({ speaker: pendingSpeaker, text: labeled[2].trim() });
      startsMessage = false;
    } else if (pendingSpeaker) {
      const last = records[records.length - 1];
      if (last?.speaker === pendingSpeaker && !startsMessage) last.text += '\n' + text;
      else records.push({ speaker: pendingSpeaker, text });
      startsMessage = false;
    }
  }
  return records.filter(r => r.text && !/^\[(图片|语音|视频|文件)\]$/.test(r.text)).slice(0, 2000);
}
export function mergeChatRecords(a: ChatRecord[], b: ChatRecord[]): ChatRecord[] {
  let overlap = Math.min(a.length, b.length);
  while (overlap && !a.slice(-overlap).every((r, i) => r.speaker === b[i].speaker && r.text === b[i].text)) overlap--;
  return [...a, ...b.slice(overlap)];
}
export function normalizeStyle(value: unknown): ChatStyleProfile {
  const v = value as Partial<ChatStyleProfile> | null;
  if (!v || typeof v.rules !== 'string' || !v.rules.trim()) throw Error('没有提炼出可用的说话方式，请核对记录后重试。');
  return { rules: v.rules.trim().slice(0, 2200), examples: Array.isArray(v.examples)
    ? v.examples.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 6).map(x => x.trim().slice(0, 180)) : [] };
}
export function stylePrompt(style?: ChatStyleProfile): string {
  if (!style?.rules.trim()) return '';
  return `${STYLE_MARKER}\n以下仅是表达参考，不改变人物身份与边界，不代表你拥有原记录中人物的经历。不要机械重复示例。\n${style.rules}\n${style.examples.map(x => `表达示例：${x}`).join('\n')}`;
}
export function stripLearnedStyle(prompt: string): string {
  const start = prompt.indexOf(STYLE_MARKER);
  return start < 0 ? prompt : prompt.slice(0, start).trimEnd();
}
export function sampleChatRecords(records: ChatRecord[], target: string): string {
  const own = records.filter(r => r.speaker === target);
  if (own.length < 5) throw Error('至少需要学习对象的 5 条文字消息；建议准备 20–50 条。');
  // Evenly sample rather than letting the last topic define the whole style.
  const selected = own.length > 100 ? Array.from({length: 100}, (_, i) => own[Math.floor(i * (own.length - 1) / 99)]) : own;
  return selected.map(r => r.text.slice(0, 700)).join('\n---\n').slice(0, 18000);
}
