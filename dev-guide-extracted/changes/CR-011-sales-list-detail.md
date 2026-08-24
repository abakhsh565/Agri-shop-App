# CR-011 — Sales list & detail — data ownership, filtering and actions

**Status:** Proposed
**Priority:** High
**Type:** Mixed
**Requested by:** Owner
**Persona:** Admin/co-admin
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Make Sales List and Sale Detail correctly reflect the logged-in persona, preserve sale/customer information, and provide useful actions from the sale detail screen.

## Current behavior
Sale info and detail generally work, but employee-related data can appear shared instead of tied to the logged-in employee. The Sale Detail note field does not reliably persist. The Admin Sale Detail header has extra Sales/Admin labels. No export/share actions.

## Desired behavior
Admin/Owner sees business-wide sales, each showing who performed it (Sold by: Employee/Owner). Employees see only their own permitted sales/info. Customer info stays linked to its persisted record. Sale notes persist after save/navigation/refresh (explicit Save or auto-persist per existing pattern). Remove the Sales/Admin labels from the Admin Sale Detail header (keep Back). Add actions: download the sale, export to Excel, share via WhatsApp.

## Impact Map
- **Screens:** `sales`, `sales/:saleId` (admin + employee versions)
- **Flows:**
- **Data & stores:**
- **Content / i18n:**
- **Backend / DB & Security:**

### Details from your sheet
Flows: Sale / history & detail. Data & stores: `salesStore`, sale/customer/user/employee relationships, sale notes. Content: `sales.*`. Backend: verify RLS — admin business-wide, employee own-only; persist notes against the correct sale record; keep records linked to persisted rows. UI/UX: header, notes interaction, download/export/share.

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. 

## Reviewer comments
Existing sale-detail info unchanged unless listed. Verify the employee data/visibility issue carefully against the app's authorization model before implementing.

## Open questions

## Implementation notes

## Verification
