/**
 * The device's own copy of the PIN check — for the launch where there is no server to ask.
 *
 * The PIN is normally verified by the database against a bcrypt hash (0148), and that stays
 * the authority whenever the server can be reached. But a shop phone is offline constantly,
 * and it is opened for months at a time: routing every launch through a network call meant
 * that a device with no connection could not open with the PIN it had — the keypad was shown,
 * the server could not be asked, the answer was read as "this account has no PIN", and the
 * only way in was to forget the PIN, take a code, and set a new one. Every single time.
 *
 * So a second, local check is kept. It is deliberately hard to attack offline:
 *
 *   • PBKDF2-HMAC-SHA256, 210,000 iterations — a slow KDF, not a digest. A four-digit secret
 *     has 10,000 possibilities; at this cost, trying all of them on the device takes long
 *     enough to be pointless, and the cost is paid per guess, not once.
 *   • A fresh 16-byte random salt per device and per user, so two phones holding the same PIN
 *     hold different records and a precomputed table is worthless.
 *   • Stored through `secureStorage`, which encrypts it at rest under a device key.
 *   • It is only ever a FALLBACK. When the server answers, the server decides — including
 *     saying "wrong", which the local copy never overrules.
 *
 * Nothing here is a secret in the sense of unlocking data: the database, RLS and the session
 * token remain the only things that grant access to the shop's rows. This decides one
 * question — "is this the person the phone belongs to?" — while the phone cannot ask.
 */

/** How the record is shaped on disk. `v` allows a future change of parameters. */
export interface LocalPinRecord {
  v: 1;
  /** base64 of the random salt. */
  salt: string;
  /** Iteration count, stored so an old record can still be checked after a change. */
  iter: number;
  /** base64 of the derived bits. */
  hash: string;
}

/**
 * Cost of one guess. 210,000 is the OWASP figure for PBKDF2-HMAC-SHA256 and lands in the
 * low hundreds of milliseconds on a phone — invisible on the one unlock a day that matters,
 * painful for the 10,000 guesses an attacker would need.
 */
export const LOCAL_PIN_ITERATIONS = 210_000;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The slow part: PIN + salt → 32 bytes. */
async function derive(pin: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: iter, hash: "SHA-256" },
    key,
    256
  );
  return new Uint8Array(bits);
}

/** Build the record for a PIN the server has just accepted. */
export async function makeLocalPinRecord(pin: string): Promise<LocalPinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, LOCAL_PIN_ITERATIONS);
  return { v: 1, salt: toBase64(salt), iter: LOCAL_PIN_ITERATIONS, hash: toBase64(hash) };
}

/** Constant-time-ish compare: does not stop at the first differing byte. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Does this PIN match the record? Never throws — a bad record is "no". */
export async function matchesLocalPin(record: LocalPinRecord, pin: string): Promise<boolean> {
  try {
    const expected = fromBase64(record.hash);
    const actual = await derive(pin, fromBase64(record.salt), record.iter);
    return equal(expected, actual);
  } catch {
    return false;
  }
}

/** Read a stored record, tolerating anything malformed. */
export function parseLocalPinRecord(raw: string | null): LocalPinRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalPinRecord>;
    if (
      parsed?.v !== 1 ||
      typeof parsed.salt !== "string" ||
      typeof parsed.hash !== "string" ||
      typeof parsed.iter !== "number" ||
      parsed.iter < 1000
    ) {
      return null;
    }
    return parsed as LocalPinRecord;
  } catch {
    return null;
  }
}
