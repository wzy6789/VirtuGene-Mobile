/**
 * 天气感知（wttr.in 免费 API，无需 Key）：按城市拿"天气描述 + 温度"。
 * 带 1 小时缓存，失败静默返回空（不影响聊天主流程）。
 */
let cache: { city: string; text: string; at: number } | null = null;
const TTL = 60 * 60_000;

export async function getWeatherText(city: string): Promise<string> {
  const c = city.trim();
  if (!c) return '';
  if (cache && cache.city === c && Date.now() - cache.at < TTL) return cache.text;
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(c)}?format=j1&lang=zh`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const cur = data.current_condition?.[0];
    const desc = cur?.lang_zh?.[0]?.value ?? cur?.weatherDesc?.[0]?.value ?? '';
    const temp = cur?.temp_C ?? '';
    const text = [desc, temp ? `${temp}°C` : ''].filter(Boolean).join(' ');
    cache = { city: c, text, at: Date.now() };
    return text;
  } catch {
    return '';
  }
}
