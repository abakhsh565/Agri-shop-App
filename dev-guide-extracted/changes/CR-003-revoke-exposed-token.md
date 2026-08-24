# CR-003 — Revoke previously exposed access token

**Status:** Proposed
**Priority:** High
**Type:** Bugfix
**Requested by:** Owner
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Rotate/revoke the Supabase access token that was shared in chat, to close a security exposure.

## Current behavior
A personal access token was pasted in chat during setup and must be treated as compromised.

## Desired behavior
Old token revoked in the Supabase dashboard and a fresh one issued where needed.

## Impact Map
- **Screens:** 
- **Flows:** 
- **Data & stores:** 
- **Content / i18n:** 
- **Backend / DB & Security:** Supabase project settings (access tokens) — no client code

## Dependencies & conflicts
Security/ops action by the Owner. Non-Negotiable: never expose secrets client-side.

## Open questions
Confirm the token has been revoked in the Supabase dashboard.

## Implementation notes


## Verification

