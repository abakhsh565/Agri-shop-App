/**
 * How the phone verification code reaches a person.
 *
 *   "demo" — no SMS provider is configured. The app accepts DEMO_OTP_CODE, and the invitation an
 *     owner shares carries that code so an invited employee can actually sign in today.
 *
 *   "sms" — Supabase Auth phone OTP with a real provider. The code is delivered by SMS, the app
 *     never accepts a shared constant, and the invitation does NOT contain a code (sending
 *     someone their own login code by chat would defeat the second factor).
 *
 * WHY THE SWITCH IS NOT A DEFAULT ANY MORE
 *   This used to read `VITE_OTP_DELIVERY === "sms" ? "sms" : "demo"` — so anything that was not
 *   exactly "sms", including *unset*, meant the shared code `123456` was accepted for any
 *   registered phone number, and a real Supabase session followed. `VITE_OTP_DELIVERY` is set
 *   nowhere in this repository, so every build — web preview, staging, release APK — shipped that
 *   way. Knowing a phone number was enough to sign in as its owner.
 *
 *   The mode is now derived from the environment this build belongs to, and a production build
 *   that is not explicitly `sms` is refused at start-up by src/lib/envGuard.ts before this module
 *   is ever consulted. Demo mode remains available where it is useful (development, staging) and
 *   nowhere else.
 *
 * To go live: configure the SMS provider in Supabase, then build with VITE_OTP_DELIVERY=sms.
 */

import { isDemoOtpAllowed, resolveEnvironment } from "@/lib/envGuard";
import { readEnvironmentInput } from "@/lib/environmentContract";
import type { EnvironmentVerdict, OtpDelivery } from "@/lib/environmentContract";

export type OtpDeliveryMode = OtpDelivery;

/** The accepted demo code. Honoured only where `isDemoOtpMode` is true. */
export const DEMO_OTP_CODE = "123456";

/**
 * Which delivery mode a verdict implies. Pure, so the production rule can be proven in a test
 * without a network call or a rebuild.
 *
 * A configuration we would refuse to run at all resolves to `sms`, never `demo`: "demo" accepts a
 * shared code for any phone number, so it is the permissive outcome. A broken configuration must
 * not be answered with the permissive outcome.
 */
export function otpModeFor(verdict: EnvironmentVerdict): OtpDeliveryMode {
  return verdict.ok ? verdict.otpDelivery : "sms";
}

function resolveMode(): OtpDeliveryMode {
  return otpModeFor(
    resolveEnvironment(readEnvironmentInput(import.meta.env as Record<string, unknown>)),
  );
}

export const OTP_DELIVERY_MODE: OtpDeliveryMode = resolveMode();

/**
 * Is this token accepted as the shared demo code, in this mode?
 *
 * The single place the decision is made, so no screen or helper can disagree with the sign-in
 * path about whether `123456` works here. Pass `mode` explicitly in tests.
 */
export function demoCodeAccepted(
  token: string,
  mode: OtpDeliveryMode = OTP_DELIVERY_MODE,
): boolean {
  if (mode !== "demo") return false;
  return token === DEMO_OTP_CODE;
}

/**
 * Is the shared demo code accepted by this build?
 *
 * True only where a demo is intended. A production build resolves to "sms" whatever
 * `VITE_OTP_DELIVERY` says, so no env value and no persisted state can switch this back on.
 */
export const isDemoOtpMode = OTP_DELIVERY_MODE === "demo";

export { isDemoOtpAllowed as demoOtpAllowed };

/**
 * Called at the auth boundary before a demo code is honoured.
 *
 * `isDemoOtpMode` is already false in production, so this is the second lock on the same door —
 * deliberately, because this is the check whose absence let anyone sign in as anyone.
 */
export function assertDemoOtpAllowed(): void {
  if (!isDemoOtpAllowed()) {
    throw new Error(
      "[AUTH] Refusing to honour the shared demo verification code outside a development or " +
        "staging build. Production authenticates with real codes.",
    );
  }
}
