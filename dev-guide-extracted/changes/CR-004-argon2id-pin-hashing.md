# CR-004 — Server-side Argon2id PIN hashing

**Status:** Deferred
**Priority:** Medium
**Type:** Data
**Requested by:** Owner
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Hash login PINs with Argon2id server-side instead of the current device-only SHA-256.

## Current behavior
PIN is hashed with SHA-256 on the device (ROADMAP #2 notes this as interim).

## Desired behavior
PIN verification moves server-side with Argon2id, so a stolen device can't reveal the PIN.

## Impact Map
- **Screens:** `/login/pin-set`
- **Flows:** Auth
- **Data & stores:** `authStore`
- **Content / i18n:** 
- **Backend / DB & Security:** Supabase RPC / edge function, `users` table PIN column

## Dependencies & conflicts
ROADMAP #2. Non-Negotiable: enforce authz in the DB, never trust client values.

## Open questions
Confirm this is the next security slice, or keep deferred until after APK.

## Implementation notes


## Verification

