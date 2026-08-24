# CR-001 — Bottom tab-bar horizontal padding

<!-- Example of a completed change, filled end-to-end, so the format is clear. -->

**Status:** Done
**Priority:** Low
**Type:** UX
**Requested by:** Owner
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Give the bottom navigation tab bar a little breathing room on the left/right edges so the tab
icons/labels aren't flush against the screen edge, and tidy the vertical padding.

## Current behavior
The fixed bottom tab bar spanned edge-to-edge with no horizontal padding. (Admin bar also had
`padding-bottom: var(--safe-bottom)`.)

## Desired behavior
- Both tab bars: `16px` left/right padding.
- Admin tab bar: `padding-top: 8px`, `padding-bottom: 0px` (applied from the visual editor).

## Impact Map
- **Screens:** `src/components/layout/AdminLayout.tsx` (admin tab bar),
  `src/components/layout/EmployeeLayout.tsx` (employee tab bar). ♻️ Both shells' chrome.
- **Flows:** none — layout chrome only, no flow logic touched.
- **Data & stores:** none.
- **Content / i18n:** none.
- **Backend / DB & Security:** none.

## Dependencies & conflicts
None. Presentational only; no clash with Non-Negotiable Rules. Note: setting admin
`padding-bottom` to `0px` drops the safe-area inset on that bar — acceptable per the explicit
visual-editor request; revisit if labels sit too close to the gesture bar on-device.

## Open questions
None.

## Implementation notes
- `AdminLayout.tsx` bottom-bar `style`: added `paddingLeft: "16px"`, `paddingRight: "16px"`;
  set `paddingBottom: "0px"` (was `var(--safe-bottom)`). Top padding stays `8px` via `pt-2`.
- `EmployeeLayout.tsx` bottom-bar `style`: added `paddingLeft: "16px"`, `paddingRight: "16px"`;
  `paddingBottom` left as `var(--safe-bottom)`.

## Verification
- `npx tsc --noEmit` clean; `pnpm run build` succeeds.
- On-screen: open any admin screen and any employee screen → tab bar has 16px side padding;
  admin bar sits with no extra bottom inset.
