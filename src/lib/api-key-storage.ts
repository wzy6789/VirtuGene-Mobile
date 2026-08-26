/**
 * 设备级 API Key 加密存储（「记住登录」用）：
 * - API Key 不明文落 localStorage；用设备随机密钥 AES-GCM 加密后持久化
 * - 同一台设备可解密恢复（微信/QQ 式"记住登录"）；清数据/换设备后需重新登录
 * - 密钥存在 localStorage（设备专属），跨设备不共享
 */

const KEY_STORAGE = 'virtugene-device-key';
const ENC_STORAGE = 'virtugene-api-key-enc';

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function b64ToBuf(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

/** 获取或创建设备密钥（存 localStorage） */
async function getDeviceKey(): Promise<CryptoKey> {
  const raw = localStorage.getItem(KEY_STORAGE);
  if (raw) {
    return crypto.subtle.importKey('raw', b64ToBuf(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(KEY_STORAGE, bufToB64(keyBytes));
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** 加密 API Key 并持久化（"记住登录"） */
export async function persistApiKey(apiKey: string): Promise<void> {
  try {
    const key = await getDeviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey));
    const payload = JSON.stringify({ iv: bufToB64(iv), data: bufToB64(enc) });
    localStorage.setItem(ENC_STORAGE, payload);
  } catch {
    /* 加密失败则忽略（下次需重新输入 Key） */
  }
}

/** 读取并解密持久化的 API Key；不存在或失败返回 null */
export async function loadPersistedApiKey(): Promise<string | null> {
  try {
    const raw = localStorage.getItem(ENC_STORAGE);
    if (!raw) return null;
    const { iv, data } = JSON.parse(raw);
    const key = await getDeviceKey();
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(iv) }, key, b64ToBuf(data));
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}

/** 清除持久化的 API Key（登出时调用） */
export function clearPersistedApiKey(): void {
  localStorage.removeItem(ENC_STORAGE);
}
