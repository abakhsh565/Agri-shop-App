# CR-026 — Improve phone OTP input and verification flow

**Status:** Proposed
**Priority:** Medium
**Type:** UX
**Requested by:** Owner
**Persona:** Both
**Created:** 2026-08-21
**Depends on:** CR-002
**Blocks:** —

## Goal
Make the phone-number and OTP steps easier to use with the keyboard open, and remove the unnecessary manual Verify action.

## Current behavior
On the Welcome Back screen the Send Code button can sit behind the keyboard. On the Verification screen the user must press a separate Verify button after entering the OTP.

## Desired behavior
When the keyboard opens on the phone-number screen, move the Send Code button up so it stays accessible (without moving the whole screen). On the OTP screen remove the Verify button and auto-verify once the required digits are entered: valid → continue; invalid → existing error behavior. If the OTP expires, keep the existing Resend option.

## Impact Map
- **Screens:** `/login`, `/login/otp`
- **Flows:**
- **Data & stores:**
- **Content / i18n:**
- **Backend / DB & Security:**

### Details from your sheet
Flows: Phone authentication. Data & stores: existing auth flow only. Backend: no change to auth logic; verification continues through the existing mechanism. Related to CR-007 (broader auth UX); depends on CR-002 (phone provider live).

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. Depends on CR-002.

## Reviewer comments
Keep the existing phone input, OTP timer, error handling and resend. Only change keyboard positioning and remove the manual Verify step.

## Open questions

## Implementation notes

## Verification
