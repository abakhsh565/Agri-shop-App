import { APP_SCHEME } from "@/lib/appInvite";

/**
 * An invitation arriving as a link, turned into a route.
 *
 * Two shapes reach this app, and they carry the same claim:
 *
 *   https://<host>/login?phone=…&shop=…    an Android App Link
 *   agrishop://login?phone=…&shop=…        the app's own scheme
 *
 * The https form is the one to prefer — messaging apps linkify it, so the invitee can
 * genuinely tap it — but it only works once the app is served from a real address AND the
 * domain publishes `.well-known/assetlinks.json`, which is what lets Android verify that this
 * app is allowed to open that domain. Until both exist, the custom scheme is the only link
 * that can actually reach the app on a phone, and it needs no domain and no hosting.
 *
 * A NOTE ON TRUST. The https form is not host-checked here, and that is deliberate rather
 * than an omission: Android only hands an https intent to this app when the domain has
 * verified it against `assetlinks.json`. By the time a URL reaches this function the
 * platform has already decided the host belongs to us. Nothing in the link is treated as
 * authority either way — the shop and the number are checked against the database
 * (`resolve_invite`) before a code is spent, so a forged link can only pre-fill a screen.
 */
export interface InviteLinkTarget {
  /** Route inside the app, e.g. `/login`. */
  path: string;
  /** The invited number, normalized by the screen that consumes it. Empty when absent. */
  phone: string;
  /** The shop that invited them. Empty when absent. */
  shop: string;
}

export function parseInviteLink(rawUrl: string): InviteLinkTarget | null {
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // Malformed input is not an invitation. Guessing at it would open sign-in with
    // half-read parameters, which is worse than ignoring the link.
    return null;
  }

  const isCustomScheme = url.protocol === `${APP_SCHEME}:`;
  if (isCustomScheme) {
    // `agrishop://login?…` — with a custom scheme the ROUTE lands in `hostname`, so
    // `new URL` reads "login" as a host and leaves the pathname empty.
    if (!url.hostname) return null;
  }

  const phone = url.searchParams.get("phone") ?? "";
  const shop = url.searchParams.get("shop") ?? "";

  // A link carrying neither a number nor a shop says nothing about who is invited, so
  // there is nothing to pre-fill. Opening sign-in for it would be a worse answer than
  // leaving the invitee on the screen they are already looking at.
  if (!phone && !shop) return null;

  const path = isCustomScheme ? `/${url.hostname}${url.pathname}` : url.pathname;
  return { path: path || "/login", phone, shop };
}

/** The query string to hand the sign-in screen, built from what the link actually carried. */
export function inviteSearchParams(target: InviteLinkTarget): string {
  const params = new URLSearchParams();
  if (target.phone) params.set("phone", target.phone);
  if (target.shop) params.set("shop", target.shop);
  return params.toString();
}
