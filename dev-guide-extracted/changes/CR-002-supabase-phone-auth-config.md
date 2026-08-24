# CR-002 — Supabase phone-auth provider + test numbers

**Status:** Proposed
**Priority:** High
**Type:** Data
**Requested by:** Owner
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Turn on phone-OTP login end-to-end so real owners/employees can sign in on-device.

## Current behavior
Auth flow (Splash → Login → OTPVerify → PINSet) is built, but the Supabase phone provider / SMS sender is not fully configured, so live OTP delivery is unverified.

## Desired behavior
Phone provider enabled with a working SMS sender (or Supabase test numbers) so the OTP arrives and login completes on a real device.

## Impact Map
- **Screens:** `/login`, `/login/otp`, `/login/pin-set`
- **Flows:** Auth
- **Data & stores:** `authStore`
- **Content / i18n:** 
- **Backend / DB & Security:** Supabase Auth (phone provider), `src/lib/auth.ts`

## Dependencies & conflicts
Ops/deploy config, not app code. No clash with Non-Negotiable Rules.

## Open questions
Which SMS sender? Use Supabase test numbers for now, or a real provider (Twilio/etc.)?

## Implementation notes


## Verification

