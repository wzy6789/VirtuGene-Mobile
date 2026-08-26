/**
 * PBKDF2 password hashing + AES-GCM API Key encryption.
 * All keys stay local — never transmitted.
 */

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBuffer(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PBKDF2 one-way hash for login passwords. */
export async function hashPassword(
  password: string,
  salt?: Uint8Array<ArrayBuffer>
): Promise<{ hash: string; salt: string }> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: s, iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return {
    hash: bufferToBase64(bits),
    salt: bufferToBase64(s),
  };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  const salt = base64ToBuffer(storedSalt);
  const { hash } = await hashPassword(password, salt);
  return hash === storedHash;
}

/** Derive an AES-GCM encryption key from the user's login password. */
async function deriveEncryptionKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt API Key with AES-GCM, keyed by user password. */
export async function encryptApiKey(
  apiKey: string,
  password: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<{ iv: string; ciphertext: string }> {
  const encKey = await deriveEncryptionKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(apiKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encKey,
    encoded
  );
  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(ciphertext),
  };
}

/** Decrypt API Key using the user's login password. */
export async function decryptApiKey(
  iv: string,
  ciphertext: string,
  password: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<string> {
  const encKey = await deriveEncryptionKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBuffer(iv) },
    encKey,
    base64ToBuffer(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}
