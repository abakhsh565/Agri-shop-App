# CR-005 — Live end-to-end on-device verification

**Status:** Proposed
**Priority:** High
**Type:** Bugfix
**Requested by:** Owner
**Created:** 2026-08-21
**Depends on:** CR-002
**Blocks:** —

## Goal
Walk every core flow on a real phone before shipping the APK, to catch anything the emulator hides.

## Current behavior
Flows pass typecheck/build and in-preview checks; not yet all confirmed on a physical device.

## Desired behavior
Sale, Returns, payments, inventory, auth, and realtime notifications all verified on-device for both personas.

## Impact Map
- **Screens:** 
- **Flows:** Sale, Returns, Customer/Supplier payment, Purchase, Stock adjust, Auth
- **Data & stores:** all stores + Realtime
- **Content / i18n:** 
- **Backend / DB & Security:** 

## Dependencies & conflicts
Depends on CR-002 (auth) being live.

## Open questions


## Implementation notes


## Verification

