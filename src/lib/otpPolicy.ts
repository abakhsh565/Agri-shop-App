/**
 * How long a phone verification code is actually valid, and how long a screen waits before
 * offering a new one.
 *
 * WHY THE CLOCK IS NOT THE SCREEN'S TO CHOOSE
 *   The countdown under the code boxes is a promise about the SERVER's copy of the code, and
 *   Supabase Auth keeps an SMS code only as long as the project's `sms_otp_exp`
 *   (Auth → Providers → Phone). Measured on 2026-10-27, the hosted projects keep it for
 *   **60 seconds**, while these screens counted down from **2:00** — so anyone who typed the code
 *   in its second minute was told the code had expired by the server and had a live clock saying
 *   otherwise.
 *
 *   Raising the displayed window without raising the project's `sms_otp_exp` is therefore a lie,
 *   not a longer grace period: change both together, and keep the server value recorded in
 *   tests/unit/otpPolicy.test.ts so the next person sees what they are moving away from.
 *
 * `OTP_RESEND_DELAY_SECONDS` is a screen affordance only — it stops "Resend" being hammered. The
 * server enforces its own throttle (`sms_max_frequency`), and a send it refuses is reported rather
 * than absorbed (see `sendOTP` in src/lib/auth.ts).
 */
export const OTP_VALIDITY_SECONDS = 60;

export const OTP_RESEND_DELAY_SECONDS = 30;
