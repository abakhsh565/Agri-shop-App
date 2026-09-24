import { supabase } from "@/lib/supabase";
import { secureSet, secureHas, secureRemove } from "@/lib/secureStorage";

// The PIN is the everyday way back into the app on a device that is already known.
//
// It is verified by the database against a bcrypt hash (migration 0148:
// set_user_pin / verify_user_pin), never on the device: a saltless local digest of a
// 4-digit secret proved nothing and was a lookup table away from the PIN itself. The
// OTP stays what it always was — identity verification, onboarding and recovery.
//
// All this file keeps locally is a marker saying "a PIN has been set on this device".
// That marker contains no secret; it exists so SplashPage can decide which door to
// show without waiting on the network.

/** Non-secret marker: "this device has a PIN for this user". */
const MARK = (userId: string) => `agri_pin_set_${userId}`;

/** Pre-0148 device digest (a SHA-256 of userId:pin). Removed wherever it is seen. */
const LEGACY = (userId: string) => `agri_pin_${userId}`;

/**
 * Whether this device already has a PIN for the user. Drives routing only —
 * the PIN itself is checked by the server on every entry.
 */
export function hasPin(userId: string): boolean {
  return secureHas(MARK(userId));
}

/**
 * Set (or change) the PIN for the signed-in user. Returns false when the server
 * refused or could not be reached, so callers can say so instead of pretending.
 */
export async function savePin(userId: string, pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_user_pin", { p_pin: pin });
  const ok = !error && (data as { status?: string } | null)?.status === "ok";
  if (ok) {
    await secureSet(MARK(userId), "1");
    secureRemove(LEGACY(userId));
  }
  return ok;
}

/**
 * Result type that distinguishes a wrong PIN from a lockout, a missing PIN and a
 * failure to reach the server at all.
 */
export type PinVerifyResult =
  | { status: "ok" }
  | { status: "wrong" }
  | { status: "locked" }
  | { status: "no_pin" }
  | { status: "error" };

/**
 * Verify against the server. `no_pin` also covers an expired session (the server
 * answers "unauthorized"): both mean the same thing to the person standing there —
 * prove identity by code, then set a PIN.
 */
export async function verifyPinDetailed(userId: string, pin: string): Promise<PinVerifyResult> {
  try {
    const { data, error } = await supabase.rpc("verify_user_pin", { p_pin: pin });
    if (error) return { status: "error" };
    const status = (data as { status?: string } | null)?.status;
    if (status === "ok") return { status: "ok" };
    if (status === "wrong") return { status: "wrong" };
    if (status === "locked") return { status: "locked" };
    return { status: "no_pin" };
  } catch {
    return { status: "error" };
  }
}

export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  return (await verifyPinDetailed(userId, pin)).status === "ok";
}

/** Forget this device's marker (the server hash is what actually gates access). */
export function clearPin(userId: string): void {
  secureRemove(MARK(userId));
  secureRemove(LEGACY(userId));
}
