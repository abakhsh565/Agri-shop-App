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

/** Deep link into sign-in with the employee's phone pre-filled. */
export function inviteLink(phone: string): string | null {
  const base = appShareUrl();
  if (!base) return null;
  // Normalized, so the link is always in the form the sign-in field accepts —
  // stored numbers appear as "923001234567", "+923001234567" and "0300…".
  return `${base}/login?phone=${encodeURIComponent(normalizePhone(phone))}`;
}

/** The number as a human writes it, for the message text. */
export function internationalPhone(phone: string): string {
  return `+${normalizePhone(phone)}`;
}

/** The message body the owner sends. `link` may be null (see appShareUrl). */
export function buildInviteMessage(input: {
  name: string;
  phone: string;
  link: string | null;
  t: TranslateFn;
}): string {
  const { name, phone, link, t } = input;
  const lines = [t("invite.msgBody", { name, phone })];
  if (link) lines.push(link);
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
