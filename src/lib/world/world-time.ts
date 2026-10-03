/** Fictional scene time is authoritative. Device time only dates stored records. */
export function buildWorldTimeContext(timeLabel: string): string {
  return `【星域当前时间】${timeLabel.trim() || '尚未设定'}。这是用户设定的场景时间，优先于手机时间、现实日期与旧记录中的时间。对白、光线、作息和事件顺序都顺着此时间；不要用现实早晚问候覆盖它，不自行跳到另一天。历史记忆的日期只用于辨认旧事，不代表现在。只有用户改变或推进时间时才更新；时间不够具体时保持原设定，不猜测现实日期。`;
}

function countOf(text: string): number | undefined {
  if (/^\d+$/u.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text in digits) return digits[text];
  if (text.includes('十')) {
    const [tens, units] = text.split('十');
    if ((!tens || tens in digits) && (!units || units in digits)) return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
  }
  return undefined;
}

export function hourOfWorldTime(text: string): { hour: number; minute: number } | undefined {
  const matches = [...(text ?? '').matchAll(/(\d{1,2}|[一二两三四五六七八九十]{1,3})(?:[:：](\d{2})|[点时](?:(\d{1,2}|[一二三四五六七八九十]{1,3})分?|半)?)/gu)];
  const match = matches[matches.length - 1];
  if (match) {
    let hour = countOf(match[1]);
    const minute = match[2] ? Number(match[2]) : match[3] ? countOf(match[3]) : match[0].endsWith('半') ? 30 : 0;
    if (hour === undefined || minute === undefined) return undefined;
    const period = text.slice(Math.max(0, (match.index ?? 0) - 4), match.index);
    if (/下午|傍晚|晚上|夜晚/u.test(period) && hour < 12) hour += 12;
    if (/凌晨|深夜/u.test(period) && hour === 12) hour = 0;
    if (hour < 24 && minute < 60) return { hour, minute };
  }
  const periods: [RegExp, number][] = [[/凌晨|深夜/u, 1], [/早上|早晨|清晨/u, 7], [/上午/u, 9], [/中午/u, 12], [/下午/u, 15], [/黄昏|傍晚/u, 18], [/晚上|夜晚|夜里/u, 21]];
  const period = periods.find(([pattern]) => pattern.test(text));
  return period ? { hour: period[1], minute: 0 } : undefined;
}

/** Numeric offset is secondary metadata; unsupported fictional calendars remain intact. */
export function worldTimeOffset(text: string, currentOffset: number, anchor: number, currentLabel = ''): number {
  const date = /(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/u.exec(text);
  const base = new Date(anchor + currentOffset);
  const previousDate = /(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/u.exec(currentLabel);
  if (previousDate && currentOffset === 0) base.setFullYear(Number(previousDate[1]), Number(previousDate[2]) - 1, Number(previousDate[3]));
  const currentHour = hourOfWorldTime(currentLabel);
  if (currentHour && currentOffset === 0) base.setHours(currentHour.hour, currentHour.minute, 0, 0);
  if (date) base.setFullYear(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
  const relative = /(\d+|[一二两三四五六七八九十]{1,3})(?:个)?(天|日|周|星期|小时|分钟|月|年)(?:以?后|过去|之后)/u.exec(text);
  let days = /第二天|明天|次日/u.test(text) ? 1 : /后天/u.test(text) ? 2 : /下周/u.test(text) ? 7 : 0;
  let duration = 0;
  if (relative) {
    const count = countOf(relative[1]) ?? 0;
    if (/天|日/u.test(relative[2])) days = count;
    else if (/周|星期/u.test(relative[2])) days = count * 7;
    else if (relative[2] === '月') base.setMonth(base.getMonth() + count);
    else if (relative[2] === '年') base.setFullYear(base.getFullYear() + count);
    else duration = count * (relative[2] === '小时' ? 3_600_000 : 60_000);
  }
  base.setDate(base.getDate() + days);
  const targetHour = relative && /小时|分钟/u.test(relative[2]) ? undefined : hourOfWorldTime(text);
  if (targetHour) base.setHours(targetHour.hour, targetHour.minute, 0, 0);
  return base.getTime() + duration - anchor;
}

export function worldTimeChangeLabel(text: string, previous: string): string {
  const label = text.trim().replace(/^(?:请\s*)?(?:(?:把|将)?时间(?:设定|设置|设|改)?(?:为|是|到|至)|设定时间为|(?:现在|此刻)(?:是|为)|(?:现在|直接|快进|跳转|跳)?(?:到|至)|设为|改为)\s*/u, '').trim();
  if (!label) return previous;
  // Preserve the prior fictional setting when the user only advances by a duration.
  if (/^(?:\d+|[一二两三四五六七八九十]+)(?:个)?(?:天|日|周|星期|小时|分钟|月|年)(?:以?后|之后)$/u.test(label) || /^(?:过一会儿|稍后)$/u.test(label)) return `${previous} · ${label}`;
  return label;
}
