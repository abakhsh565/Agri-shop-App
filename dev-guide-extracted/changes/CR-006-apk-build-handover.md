# CR-006 — APK build + handover

**Status:** Proposed
**Priority:** High
**Type:** Data
**Requested by:** Owner
**Created:** 2026-08-21
**Depends on:** CR-005
**Blocks:** —

## Goal
Produce an installable Android APK and hand it over so the Owner can install and test on their phone.

## Current behavior
Capacitor 7 is configured; `BUILD_MOBILE.md` documents the steps; APK not yet built/handed over.

## Desired behavior
A signed/debug APK built via Android Studio and delivered, with install instructions.

## Impact Map
- **Screens:** 
- **Flows:** 
- **Data & stores:** 
- **Content / i18n:** 
- **Backend / DB & Security:** Capacitor (`cap:sync`, `cap:android`), `BUILD_MOBILE.md`

## Dependencies & conflicts
Depends on CR-005 verification passing.

## Open questions
Debug APK for personal testing first, or go straight to a signed release?

## Implementation notes


## Verification

