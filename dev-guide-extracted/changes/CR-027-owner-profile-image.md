# CR-027 — Owner profile image upload and persistence

**Status:** Proposed
**Priority:** Medium
**Type:** UX
**Requested by:** Owner
**Persona:** Admin/co-admin
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Let the Owner upload a profile image and have it persist across the app rather than being UI-only.

## Current behavior
The Owner cannot upload a persistent profile image; any avatar is UI-only.

## Desired behavior
Allow the Owner to upload a profile image from the Profile screen, store it persistently in the appropriate storage/DB, and display the saved image wherever the Owner profile/avatar shows, including the Dashboard.

## Impact Map
- **Screens:** Admin profile / dashboard avatar
- **Flows:**
- **Data & stores:**
- **Content / i18n:**
- **Backend / DB & Security:**

### Details from your sheet
Flows: Profile update. Data & stores: User/profile data + profile-image state (`photoUrl`). Backend: storage/DB persistence, scoped to the user's own profile. Uses the shared image-upload infra (plan Step 2).

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. 

## Reviewer comments
The Dashboard profile icon should use the saved profile image when one exists.

## Open questions

## Implementation notes

## Verification
