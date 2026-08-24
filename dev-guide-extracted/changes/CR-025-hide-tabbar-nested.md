# CR-025 — Hide bottom tab bar on deeper / nested screens

**Status:** Done
**Priority:** Medium
**Type:** UX
**Requested by:** Owner
**Persona:** Both
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Keep the bottom tab bar on primary navigation screens, but hide it once the user goes into deeper/nested screens so it isn't visible throughout the whole flow.

## Current behavior
The fixed bottom tab bar shows on every screen, including nested screens opened via subsequent taps.

## Desired behavior
Show the tab bar on main/top-level screens. When the user goes into a deeper/nested screen (e.g. home → product → product details), hide it. Apply consistently to both Admin/Co-admin and Owner/Employee shells. Rule is based on navigation depth, not literally counting taps — after ~2–3 levels deep the tab bar is not shown.

## Impact Map
- **Screens:** `src/components/layout/AdminLayout.tsx`, `src/components/layout/EmployeeLayout.tsx` (♻️ both shells' chrome)
- **Flows:** none — visibility responds to route depth only
- **Data & stores:** none
- **Content / i18n:** none
- **Backend / DB & Security:** none

### Details from your sheet
♻️ Navigation/layout chrome. Flows: navigation depth drives tab-bar visibility. Data & stores: none expected. Depends on the existing tab-bar + routing structure.

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. 

## Reviewer comments
Rule based on nesting depth, not tap counting. Tab bar available on primary screens, hidden on deeper ones.

## Open questions

## Implementation notes
- New helper `src/lib/navDepth.ts` → `isTopLevel(pathname)`: top-level = exactly two path
  segments (`/{shell}/{section}`); 3+ segments (details/forms) or the sale flow (`/…/sale…`)
  return false.
- `AdminLayout.tsx` / `EmployeeLayout.tsx`: compute `showTabBar = isTopLevel(location.pathname)`;
  render the bottom tab bar only when true, and drop the content `paddingBottom` reservation when
  hidden so nested screens use full height.

## Verification
- `npx tsc --noEmit` clean; `pnpm run build` succeeds.
- On-screen: tab bar shows on `/admin/dashboard`, `/admin/sales`, `/admin/inventory`,
  `/admin/customers`, `/admin/more` (and employee equivalents); hidden on detail/form routes
  (`sales/:id`, `inventory/new`, `customers/:id`, product details) and throughout the sale flow.
