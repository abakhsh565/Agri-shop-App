/**
 * How the phone verification code reaches a person.
 *
 * This is the ONE switch between the current demo setup and a live SMS setup.
 * Everything else in the app reads it, so going live does not restructure
 * anything:
 *
 *   "demo" (default) — no SMS provider is configured. The app accepts
 *     DEMO_OTP_CODE, and the invitation an owner shares carries that code so an
 *     invited employee can actually sign in today.
 *
 *   "sms" — Supabase Auth phone OTP with a real provider. The code is delivered
 *     by SMS, the app never accepts a shared constant, and the invitation does
 *     NOT contain a code (sending someone their own login code by chat would
 *     defeat the second factor).
 *
 * To go live: configure the SMS provider in Supabase, then build with
 * VITE_OTP_DELIVERY=sms. No other change is required.
 */
export type OtpDeliveryMode = "demo" | "sms";

export const OTP_DELIVERY_MODE: OtpDeliveryMode =
  import.meta.env.VITE_OTP_DELIVERY === "sms" ? "sms" : "demo";

export const isDemoOtpMode = OTP_DELIVERY_MODE === "demo";

/** Accepted only while OTP_DELIVERY_MODE === "demo" (see above). */
export const DEMO_OTP_CODE = "123456";
