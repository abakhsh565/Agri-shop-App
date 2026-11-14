import { chooseBusiness, getMyBusinesses, resumeSession } from "@/lib/auth";
import type { User } from "@/types";

/**
 * The shop this account works in, opened without asking.
 *
 * WHY THIS REPLACES THE CHOOSER (owner's instruction, 2026-11-14). A phone number answers for
 * exactly one membership in this product, so "Where do you want to work?" offered a decision that
 * had only one possible answer — and it charged for it: its button went through the demo-credential
 * resume path, which a real SMS build does not have, so a signed-in owner read "That business could
 * not be opened" while their own shop sat right there on the screen. Signing in now lands in the
 * shop the server already points at (`isCurrent`), or the account's only active one.
 *
 * A multi-shop account still resolves deterministically: the server's current shop first, then the
 * first active membership — the same order the chooser used, minus the tap.
 */
export async function openWorkspace(user: User): Promise<{ ok: true; user: User } | { ok: false }> {
  let shops;
  try {
    shops = (await getMyBusinesses()).filter((shop) => shop.membershipStatus === "active");
  } catch {
    // The list could not be read: the profile already in hand is the honest answer, and the shop
    // screens report their own access errors rather than a wall at the door.
    return { ok: true, user };
  }

  const target = shops.find((shop) => shop.isCurrent) ?? shops[0];
  if (!target) return { ok: false };

  if (!target.isCurrent) {
    const chosen = await chooseBusiness(target.shopId).catch(() => ({ ok: false }));
    if (!chosen.ok) return { ok: false };
  }

  const resumed = await resumeSession(user);
  if (resumed.status === "ok") return { ok: true, user: resumed.user };
  // "Offline" is not a verdict about access: the session is live and the cached profile is what
  // the shop already had. Anything the server actually refused is a refusal.
  if (resumed.status === "offline") return { ok: true, user };
  return { ok: false };
}
