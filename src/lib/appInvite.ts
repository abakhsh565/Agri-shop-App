import type { TranslateFn } from "./i18n";
import { normalizePhone } from "./auth";
import { DEMO_OTP_CODE, isDemoOtpMode } from "./authMode";

/**
 * The invitation an owner shares with a new employee.
 *
 * Why this exists: adding an employee issues a *pending* invitation (migration
 * 0129) that only becomes active when the person signs in with their own phone
 * number, so the owner needs something to hand them. Everything here is built
 * from one address (VITE_APP_URL) and one phone number, so an invitation is
 * never assembled by hand on a screen.
 *
 * The link opens the sign-in screen with the phone already filled in; the code
 * line appears only while the app is in demo mode (see authMode.ts).
 */

/**
 * The public address of this app, or null when it genuinely cannot be shared.
 *
 * VITE_APP_URL wins when configured. Otherwise the browser's own origin is used
 * — which is right for a hosted deployment, but wrong inside the Android shell,
 * where Capacitor serves the bundle from https://localhost: a link to that
 * address only works on the phone that sent it, so we refuse to produce one.
 */
export function appShareUrl(): string | null {
  const configured = (import.meta.env.VITE_APP_URL as string | undefined)?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (typeof window === "undefined") return null;
  if (isNativeShell()) return null;
  return window.location.origin;
}

/** True when running inside the Capacitor Android/iOS shell rather than a browser. */
export function isNativeShell(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  const loc = typeof window === "undefined" ? null : window.location;
  return !!loc && loc.protocol === "https:" && loc.hostname === "localhost";
}

/**
 * Deep link into sign-in: the employee's phone, and the shop that invited them.
 *
 * The shop is part of the link because an invitation is a claim about a specific
 * (shop, phone) pair — "this owner added this number" — and the phone alone cannot say
 * which owner that was. The sign-in screen checks the pair against the database before
 * it sends a code (`resolve_invite`), so an invitation cannot be completed by a
 * different number, and the invitee is told which shop invited them.
 *
 * `shopId` is optional only because a caller without an active shop has nothing to put
 * in it; with no shop the link still pre-fills the number, it just cannot be validated.
 *
 * TWO SHAPES, ONE CLAIM. With a public address configured the link is https — messaging
 * apps linkify it, and Android opens it in this app once the domain is verified against
 * `.well-known/assetlinks.json`. With no address configured — which is every launch of the
 * bundled Android app, since Capacitor serves the bundle from https://localhost — an https
 * link would be dead on arrival, so the app's own scheme is used instead. That one needs no
 * domain and no hosting, and it is the only link that can reach the app on a phone today.
 * Both are parsed in one place (`deepLink.ts`) and both end on the same screen.
 */

/** The app's own URL scheme. Must match the scheme declared in AndroidManifest.xml. */
export const APP_SCHEME = "agrishop";

export function inviteLink(phone: string, shopId?: string | null): string {
  const base = appShareUrl();
  // Normalized, so the link is always in the form the sign-in field accepts —
  // stored numbers appear as "923001234567", "+923001234567" and "0300…".
  const query = `phone=${encodeURIComponent(normalizePhone(phone))}`;
  const shop = shopId ? `&shop=${encodeURIComponent(shopId)}` : "";
  const target = base ? `${base}/login` : `${APP_SCHEME}://login`;
  return `${target}?${query}${shop}`;
}

/**
 * The shop an invitation belongs to, held for the walk from sign-in to the code screen.
 *
 * `navigate("/login/otp")` carries no query string, so without this the shop would be
 * dropped the moment the invitee pressed "Send code" — and the code screen is exactly
 * where the pair has to be re-checked, because that is where the number can still be
 * changed. sessionStorage (not localStorage): it belongs to this sign-in attempt, not to
 * the device.
 */
const PENDING_SHOP_KEY = "agri_invite_shop";

export function rememberInviteShop(shopId: string | null): void {
  try {
    if (shopId) sessionStorage.setItem(PENDING_SHOP_KEY, shopId);
    else sessionStorage.removeItem(PENDING_SHOP_KEY);
  } catch {
    // Storage unavailable. The invite still works; it just cannot be pair-checked.
  }
}

export function pendingInviteShop(): string | null {
  try {
    return sessionStorage.getItem(PENDING_SHOP_KEY);
  } catch {
    return null;
  }
}

/** The number as a human writes it, for the message text. */
export function internationalPhone(phone: string): string {
  return `+${normalizePhone(phone)}`;
}

/**
 * The message body the owner sends. `link` may be null (see appShareUrl).
 *
 * `shopCode` is the shop's short, sayable code (0169). It is carried in the text even when a
 * link is present, because the link is device-bound (it lands in one app on one phone) while the
 * code is the part that survives being read out loud, written on paper, or forwarded to a second
 * employee. `shopId` remains the last-resort fallback for a shop whose code could not be read:
 * signing in still checks the (shop, number) pair before a code is spent (`resolve_invite`).
 */
export function buildInviteMessage(input: {
  name: string;
  phone: string;
  link: string | null;
  /** The shop the invitation is for. Ignored when a link is present, which already carries it. */
  shopId?: string | null;
  /** The shop's short code, if we could read it. Preferred over the id in the text. */
  shopCode?: string | null;
  t: TranslateFn;
}): string {
  const { name, phone, link, shopId, shopCode, t } = input;
  const lines = [t("invite.msgBody", { name, phone })];
  if (link) lines.push(link);
  if (shopCode) lines.push(t("invite.msgShopCode", { code: shopCode }));
  else if (!link && shopId) lines.push(t("invite.msgShopId", { shopId }));
  if (isDemoOtpMode) lines.push(t("invite.msgDemoCode", { code: DEMO_OTP_CODE }));
  return lines.join("\n");
}

/** WhatsApp deep link to the employee's number. wa.me needs digits with no "+". */
export function whatsappShareUrl(phone: string, message: string): string {
  const digits = normalizePhone(phone).replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * Device SMS composer, pre-filled. Works on phones, including the Android app.
 * The number keeps its "+": an sms: URI with a bare national-style number is
 * ambiguous between countries.
 */
export function smsShareUrl(phone: string, message: string): string {
  return `sms:${internationalPhone(phone)}?body=${encodeURIComponent(message)}`;
}
