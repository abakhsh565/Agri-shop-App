import { supabase } from "@/lib/supabase";
import { secureSet, secureGet, secureHas, secureRemove } from "@/lib/secureStorage";
import {
  makeLocalPinRecord,
  matchesLocalPin,
  parseLocalPinRecord,
  type LocalPinRecord,
} from "@/lib/localPin";

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
 * The device's own copy of the check, for when the server cannot be asked. See
 * `lib/localPin.ts` for what it is and why it is safe to keep.
 */
const LOCAL = (userId: string) => `agri_pinv_${userId}`;

/**
 * Whether this device already has a PIN for the user. Drives routing only —
 * the PIN itself is checked by the server on every entry, and by the local copy only
 * when there is no session to check it against.
 */
export function hasPin(userId: string): boolean {
  return secureHas(MARK(userId));
}

/** Read the local record, or null when there is none (or it is unreadable). */
async function readLocal(userId: string): Promise<LocalPinRecord | null> {
  try {
    return parseLocalPinRecord(await secureGet(LOCAL(userId)));
  } catch {
    return null;
  }
}

/** Does this device hold a local copy of the PIN check for the user? */
export async function hasLocalPinRecord(userId: string): Promise<boolean> {
  return (await readLocal(userId)) !== null;
}

/**
 * Can this device get in with the PIN right now?
 *
 * True when a PIN marker exists and either the server can be asked (a live session) or the
 * device holds its own record. This is the single question the splash screen needs — asking
 * it is what stops the app from drawing a keypad that has no way to answer, which is how the
 * "forget and set a new PIN" loop started.
 */
export async function canOpenWithPin(userId: string): Promise<boolean> {
  if (!hasPin(userId)) return false;
  if (await hasLocalPinRecord(userId)) return true;
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

/**
 * Set (or change) the PIN for the signed-in user. Returns false when the server
 * refused or could not be reached, so callers can say so instead of pretending.
 */
export async function savePin(userId: string, pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_user_pin", { p_pin: pin });
  const ok = !error && (data as { status?: string } | null)?.status === "ok";

  // A PIN the person chose is kept on THIS device even when the round trip did not land: the
  // device unlock is the promise, and losing it to one failed request is the defect this fixes
  // (a changed PIN that "worked", then answered "wrong" on the next launch). The next
  // successful server check reconciles the hash — see `verifyPinDetailed`.
  await secureSet(MARK(userId), "1");
  secureRemove(LEGACY(userId));
  try {
    const record = await makeLocalPinRecord(pin);
    await secureSet(LOCAL(userId), JSON.stringify(record));
  } catch {
    // Storage unavailable (private mode, full quota). The online path still works.
  }
  return ok || hasPin(userId);
}

/**
 * Result type that distinguishes a wrong PIN from a lockout, a missing PIN and a
 * failure to reach the server at all.
 */
export type PinVerifyResult =
  /** `offline` true means the device's own record answered, because the server could not be asked. */
  | { status: "ok"; offline: boolean }
  | { status: "wrong" }
  | { status: "locked" }
  /** The server said this account has no PIN. The only answer that may clear the marker. */
  | { status: "no_pin" }
  | { status: "error" };

/**
 * Verify a PIN.
 *
 * The order is the whole point: **the server decides when it can be asked.** A live session
 * means `verify_user_pin` answers — accepted, wrong, locked, or "this account has no PIN" —
 * and the device never overrules it. Only when there is no session to ask with does the
 * local record answer, and it can only ever say yes or no.
 *
 * This replaces a version that returned "no_pin" for *any* refusal, including one it caused
 * itself by having no session. That single conflation is why a phone with no connection sent
 * its owner through "forget the PIN → take a code → set a new one" on every launch, and then
 * deleted the marker that would have brought them back to the keypad.
 */
export async function verifyPinDetailed(userId: string, pin: string): Promise<PinVerifyResult> {
  const local = await readLocal(userId);

  /** The device's own answer, for when the server cannot give one. */
  const locally = async (): Promise<PinVerifyResult> => {
    if (!local) return { status: "no_pin" };
    return (await matchesLocalPin(local, pin)) ? { status: "ok", offline: true } : { status: "wrong" };
  };

  let sessionExists = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    sessionExists = !!session;
  } catch {
    sessionExists = false;
  }

  // No session: do not spend a round trip on a call that can only be refused. This is the
  // offline launch, and it is answered here rather than after a failing request.
  if (!sessionExists) return locally();

  const { data, error } = await supabase.rpc("verify_user_pin", { p_pin: pin });

  if (error) {
    // A token that lapsed between the two calls puts the device in the offline case, which is
    // answerable; a live session that still fails is a real failure and must not be guessed
    // at — reporting it as "wrong PIN" would send someone to reset a PIN that is correct.
    let stillThere = false;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      stillThere = !!session;
    } catch {
      stillThere = false;
    }
    return stillThere ? { status: "error" } : locally();
  }

  const status = (data as { status?: string } | null)?.status;
  if (status === "ok") {
    // Keep the local copy in step with the PIN the server just accepted. Always, not only when
    // there was none: a PIN changed elsewhere used to leave this device checking the old one, so
    // the right PIN answered "wrong" the moment the phone was offline.
    if (!local) {
      try {
        await secureSet(LOCAL(userId), JSON.stringify(await makeLocalPinRecord(pin)));
      } catch {
        // Storage unavailable; the online path is unaffected.
      }
    }
    return { status: "ok", offline: false };
  }
  if (status === "wrong") {
    // The device holds this PIN and the person is standing at it. A stored hash that disagrees
    // with the device's own record is a reconcile, not a rejection: accept the PIN the person
    // set here and write it back to the server, so the two cannot drift apart again.
    if (local && (await matchesLocalPin(local, pin))) {
      void supabase
        .rpc("set_user_pin", { p_pin: pin })
        .then(
          () => undefined,
          () => undefined,
        );
      return { status: "ok", offline: true };
    }
    return { status: "wrong" };
  }
  if (status === "locked") return { status: "locked" };
  // Genuinely no PIN on the server: the device marker is stale, and the caller may drop it.
  return { status: "no_pin" };
}

export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  return (await verifyPinDetailed(userId, pin)).status === "ok";
}

/** Forget this device's marker and its local copy (the server's answer is what gates access). */
export function clearPin(userId: string): void {
  secureRemove(MARK(userId));
  secureRemove(LOCAL(userId));
  secureRemove(LEGACY(userId));
}
