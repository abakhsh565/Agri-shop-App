import { secureSet, secureGet, secureRemove } from "@/lib/secureStorage";
import type { User } from "@/types";

/**
 * How long the PIN may stand in for a phone code, and which account this phone last used.
 *
 * THE RULE (the shop owner's, in their words): once a number has been confirmed by a code,
 * coming back after an hour, a week, or up to a month should open with the PIN — never
 * another code. A month is where that stops: from then on the number itself has to be
 * confirmed again, because a phone that has sat in a drawer for two months is not evidence
 * that the same person is holding it.
 *
 * So the clock is anchored on ONE event — the last accepted code — and nothing else moves
 * it. Not the PIN being used, not the app being closed, not signing out: those are the same
 * person on the same phone, which is exactly what the PIN already answers. Only a new code
 * (or a deliberate reset) restarts the window.
 *
 * Two facts are kept on the device, both encrypted at rest through `secureStorage`:
 *
 *   • when this account's number was last confirmed, per account id;
 *   • the last account used on this phone, so a launch after sign-out or a restart knows
 *     which profile the PIN is for instead of asking for a number again.
 *
 * Neither is a credential. The server still verifies the PIN and still decides every read
 * and write; these two records decide only which door to draw and how recently the person
 * behind it proved they hold the phone.
 */

/** The three stretches the owner named, and the wall they end at. */
export const PIN_HOUR_MS = 60 * 60 * 1000;
export const PIN_WEEK_MS = 7 * 24 * PIN_HOUR_MS;
export const PIN_MONTH_MS = 30 * 24 * PIN_HOUR_MS;

/** How fresh the last confirmed number still is. `never` = nothing was ever recorded here. */
export type PinWindow = "hour" | "week" | "month" | "expired" | "never";

const VERIFIED = (userId: string) => `agri_phone_verified_${userId}`;
const LAST_PROFILE = "agri_last_profile";

/**
 * How fresh is this verification? Pure so the boundaries can be held to account by a test
 * rather than re-derived on every screen.
 */
export function pinWindowFor(verifiedAt: Date | null | undefined, now: Date = new Date()): PinWindow {
  if (!verifiedAt) return "never";
  const age = now.getTime() - verifiedAt.getTime();
  // A clock that moved backwards (a phone with a wrong date, or a restored backup) must not
  // be read as "a month has passed" — treat it as the freshest state instead of expiring a
  // working PIN. The alternative is a person being asked for a code because their phone says
  // 2019.
  if (age < 0) return "hour";
  if (age < PIN_HOUR_MS) return "hour";
  if (age < PIN_WEEK_MS) return "week";
  if (age < PIN_MONTH_MS) return "month";
  return "expired";
}

/** May the PIN open this account, or is a code required first? */
export function pinWindowAllowed(window: PinWindow): boolean {
  return window === "hour" || window === "week" || window === "month";
}

/** Record that this account's number was confirmed by a code, now. */
export async function markPhoneVerified(userId: string, at: Date = new Date()): Promise<void> {
  try {
    await secureSet(VERIFIED(userId), at.toISOString());
  } catch {
    // Storage unavailable (private mode, full quota). The window is then unknown, which
    // asks for a code next launch — annoying, never unsafe.
  }
}

/** When this account's number was last confirmed on this phone, if it is recorded. */
export async function phoneVerifiedAt(userId: string): Promise<Date | null> {
  try {
    const raw = await secureGet(VERIFIED(userId));
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

/** Is the PIN still enough for this account, or must the number be confirmed again? */
export async function pinAllowedOnThisDevice(userId: string, now: Date = new Date()): Promise<boolean> {
  return pinWindowAllowed(pinWindowFor(await phoneVerifiedAt(userId), now));
}

/** Forget this account's window (account deleted, or the number was reset). */
export function forgetPhoneVerification(userId: string): void {
  secureRemove(VERIFIED(userId));
}

/** What this device remembers about the account it last served. */
export interface LastProfile {
  user: Omit<User, "permissions">;
  /** When it was signed in here — the record belongs to one attempt, not forever. */
  at: string;
}

/**
 * Remember the account in use, so a later launch knows which profile the PIN is for.
 *
 * Permissions are deliberately not part of the snapshot: they are the caller's rights in a
 * shop, and rights change (a role is edited, an invite is accepted, a membership is
 * suspended). They are re-read from the server on every entry; a remembered list would be a
 * stale claim about what someone may do.
 */
export async function rememberLastProfile(user: User): Promise<void> {
  const { permissions: _unused, ...rest } = user;
  try {
    await secureSet(LAST_PROFILE, JSON.stringify({ user: rest, at: new Date().toISOString() } as LastProfile));
  } catch {
    // Storage unavailable: the next launch asks for a number instead of drawing a keypad.
  }
}

/** Read the remembered account, tolerating anything malformed or from an older shape. */
export async function lastUsedProfile(): Promise<LastProfile | null> {
  try {
    const raw = await secureGet(LAST_PROFILE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastProfile>;
    const user = parsed?.user;
    if (!user || typeof user.id !== "string" || typeof user.phone !== "string" || typeof user.name !== "string") {
      return null;
    }
    return { user, at: typeof parsed.at === "string" ? parsed.at : "" };
  } catch {
    return null;
  }
}

/**
 * Forget the remembered account.
 *
 * Called when the account is erased — the one moment the record is a lie — and NOT on sign
 * out: being able to open with the PIN after signing out is the whole rule above.
 */
export function forgetLastProfile(): void {
  secureRemove(LAST_PROFILE);
}
