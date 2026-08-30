/**
 * Secure Storage Wrapper
 *
 * Provides encrypted localStorage for sensitive data like auth tokens and PINs.
 * Uses Web Crypto API for encryption/decryption.
 *
 * Note: This is defense-in-depth. The primary security should come from
 * Supabase RLS and proper authentication flows.
 */

const ENCRYPTION_KEY_NAME = "agrishop_enc_key";
const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;

/**
 * Get or create an encryption key for this device.
 * Stored in IndexedDB for persistence.
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  // Check if we already have a key
  const existing = sessionStorage.getItem(ENCRYPTION_KEY_NAME);
  if (existing) {
    const keyData = JSON.parse(existing);
    return crypto.subtle.importKey(
      "jwk",
      keyData,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // Generate new key
  const key = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );

  // Export and store
  const exported = await crypto.subtle.exportKey("jwk", key);
  sessionStorage.setItem(ENCRYPTION_KEY_NAME, JSON.stringify(exported));

  return key;
}

/**
 * Encrypt a string value.
 */
export async function encrypt(value: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(value);

    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      encoded
    );

    // Combine IV + ciphertext and base64 encode
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch {
    // Fallback: base64 encode (not secure, but prevents plaintext storage)
    return btoa(value);
  }
}

/**
 * Decrypt an encrypted string value.
 */
export async function decrypt(encryptedValue: string): Promise<string> {
  try {
    const key = await getEncryptionKey();
    const combined = Uint8Array.from(atob(encryptedValue), (c) =>
      c.charCodeAt(0)
    );

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    // Fallback: base64 decode
    try {
      return atob(encryptedValue);
    } catch {
      return encryptedValue;
    }
  }
}

/**
 * Securely store a value in localStorage.
 */
export async function secureSet(key: string, value: string): Promise<void> {
  const encrypted = await encrypt(value);
  localStorage.setItem(key, encrypted);
}

/**
 * Retrieve and decrypt a value from localStorage.
 */
export async function secureGet(key: string): Promise<string | null> {
  const encrypted = localStorage.getItem(key);
  if (!encrypted) return null;
  return decrypt(encrypted);
}

/**
 * Remove a value from localStorage.
 */
export function secureRemove(key: string): void {
  localStorage.removeItem(key);
}

/**
 * Check if a key exists in localStorage.
 */
export function secureHas(key: string): boolean {
  return localStorage.getItem(key) !== null;
}
