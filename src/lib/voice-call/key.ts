import { hasSecretRecord, loadSecret } from '../api-key-storage';

/** Never confuse an unreadable saved secret with a rejected service credential. */
export async function loadMimoKey(): Promise<string | null> {
  try {
    const exists = hasSecretRecord('mimo-key');
    const value = await loadSecret('mimo-key');
    if (exists && value === null) throw new Error('voice:key_storage');
    return value;
  } catch { throw new Error('voice:key_storage'); }
}

/** Validate header-safe input without guessing a provider-specific key prefix. */
export function normalizedMimoKey(value: string | null): string | undefined {
  const key = value?.trim();
  // Internal spaces, line breaks, zero-width characters and pasted labels
  // must not turn a locally malformed header into an apparent network error.
  return key && /^[\x21-\x7e]+$/.test(key) ? key : undefined;
}
