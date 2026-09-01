/**
 * 角色主动发图（P1）：用 SiliconFlow 图像生成 API（与语音转文字共用硅基 Key）。
 * 无 Key / 调用失败 / 图片转 dataURL 失败 → 静默返回 null（不影响聊天主流程）。
 */
import { loadSecret } from '../api-key-storage';
import { CLOUD_ASR_KEY_NAME } from '../cloud-asr';

export async function generateCharacterImage(prompt: string): Promise<string | null> {
  try {
    const key = await loadSecret(CLOUD_ASR_KEY_NAME);
    if (!key) return null;
    const res = await fetch('https://api.siliconflow.cn/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-schnell',
        prompt: prompt.slice(0, 500),
        image_size: '512x512',
        batch_size: 1,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const url: string | undefined = data.images?.[0]?.url ?? data.data?.[0]?.url;
    if (!url) return null;
    // 把远端图片转成 dataURL（存库用）；跨域失败则放弃
    return await urlToDataUrl(url);
  } catch {
    return null;
  }
}

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
