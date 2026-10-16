import type { User } from "@/types";
import { canOpenWithPin } from "@/lib/pinLock";
import { lastUsedProfile, pinAllowedOnThisDevice } from "@/lib/loginWindow";

/**
 * Which door this device gets: the PIN/thumb sheet, or the phone-and-code screen.
 *
 * WHY THIS IS ONE FUNCTION. The rule about a returning person already lived in the launch screen,
 * and only there. So signing out dropped the person on the phone field — the one screen the rule
 * exists to avoid — even though the device was perfectly able to open with the PIN, and the launch
 * after that would have drawn the keypad anyway. Two places making the same decision separately is
 * how one of them ends up making it differently.
 *
 * The decision itself is unchanged, and it is deliberately conservative — the keypad is drawn only
 * when the device can actually answer it AND the number was confirmed within the month
 * (`lib/loginWindow.ts`):
 *
 *   • the device remembers the last profile it served, and
 *   • that profile's number was confirmed by a code within the window, and
 *   • this device holds its own copy of the PIN check, or a session it can ask with.
 *
 * Anything else is the phone screen, which is the honest answer: nothing here can prove who this
 * is.
 */
export type EntryDoor =
  | { door: "pin"; user: User }
  | { door: "phone" };

/** The remembered account, when the PIN may stand in for the number. */
export async function entryDoor(): Promise<EntryDoor> {
  const last = await lastUsedProfile();
  if (!last) return { door: "phone" };
  if (!(await pinAllowedOnThisDevice(last.user.id))) return { door: "phone" };
  if (!(await canOpenWithPin(last.user.id))) return { door: "phone" };
  // `permissions` are deliberately not part of the remembered profile: they are re-read from the
  // server the moment a session exists (see lib/loginWindow.ts). The keypad screen only greets
  // the person and asks for the PIN, and the entry after it is a real sign-in.
  return { door: "pin", user: last.user as User };
}
