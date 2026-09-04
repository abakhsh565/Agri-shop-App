import { secureSet, secureGet, secureRemove, secureHas } from "@/lib/secureStorage";

// Device-level quick-unlock PIN.
//
// The authoritative sign-in is Supabase phone OTP (see lib/auth.ts). The PIN is
// only a convenience lock for re-entry on THIS device, so it lives in
// localStorage — never sent to the server. We still avoid storing it in the
// clear: we keep a SHA-256 digest of `userId:pin`. (A future migration can move
// to a server-side Argon2id hash; this keeps the device lock working today
// without any mock users.)

const KEY = (userId: string) => `agri_pin_${userId}`;

async function digest(userId: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function savePin(userId: string, pin: string): Promise<void> {
  await secureSet(KEY(userId), await digest(userId, pin));
}

export function hasPin(userId: string): boolean {
  return secureHas(KEY(userId));
}

/**
 * Result type that distinguishes between "no PIN set" and "decryption error".
 */
export type PinVerifyResult =
  | { status: "ok" }
  | { status: "wrong" }
  | { status: "no_pin" }
  | { status: "error" };

export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  const stored = await secureGet(KEY(userId));
  if (!stored) return false;
  return stored === (await digest(userId, pin));
}

/**
 * Verify PIN with detailed result — distinguishes wrong PIN from storage errors.
 */
export async function verifyPinDetailed(userId: string, pin: string): Promise<PinVerifyResult> {
  try {
    const stored = await secureGet(KEY(userId));
    if (!stored) return { status: "no_pin" };
    const matches = stored === (await digest(userId, pin));
    return matches ? { status: "ok" } : { status: "wrong" };
  } catch {
    // Decryption/storage failure — NOT a wrong PIN
    return { status: "error" };
  }
}

export function clearPin(userId: string): void {
  secureRemove(KEY(userId));
}
