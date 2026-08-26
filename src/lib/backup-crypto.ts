/**
 * 数据备份加密（独立于登录密码）：
 * - 用户设置/输入一个「备份密码」，PBKDF2 派生 AES-GCM 密钥
 * - 备份文件整体加密：只有输对密码才能解密恢复
 * - 与登录密码解耦：备份密码可以不同于登录密码，更灵活
 */

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuffer(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface EncryptedBackup {
  v: 1;
  /** 随机盐（base64） */
  salt: string;
  /** AES-GCM IV（base64） */
  iv: string;
  /** 密文（base64），内容为备份 JSON 的 UTF-8 字节 */
  data: string;
}

/** 用备份密码加密明文 JSON → 加密载荷 */
export async function encryptBackup(plainJson: string, password: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plainJson),
  );
  return { v: 1, salt: bufferToBase64(salt), iv: bufferToBase64(iv), data: bufferToBase64(ciphertext) };
}

/** 用备份密码解密加密载荷 → 明文 JSON；密码错误抛异常 */
export async function decryptBackup(payload: EncryptedBackup, password: string): Promise<string> {
  const key = await deriveKey(password, base64ToBuffer(payload.salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBuffer(payload.iv) },
    key,
    base64ToBuffer(payload.data),
  );
  return new TextDecoder().decode(decrypted);
}
