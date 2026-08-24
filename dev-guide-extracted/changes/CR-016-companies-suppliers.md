# CR-016 — Companies, Products & Purchases — management actions and UI consistency

**Status:** Done
**Priority:** High
**Type:** Mixed
**Requested by:** Owner
**Persona:** Admin/co-admin
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Improve management actions in Companies, Products and Purchases while keeping existing functionality intact and consistent with the app UI.

## Current behavior
Companies, Products and Purchases provide their main info/functionality. Some actions sit within existing layouts, and company/product selection in Purchase uses UI that doesn't match the app design.

## Desired behavior
Companies: Add Company becomes a fixed floating action above the bottom nav; persist company image + keep it synced; add Record Payment directly from Company Detail using the existing supplier-payment flow. Products: add Edit Product in Product Detail that opens the Add Product form in edit mode with current data. Purchases: make Record Stock Purchase the primary floating action above the bottom nav and remove the redundant Stock In / Stock Payment action there; the Company and Product selection dialogs in Record Stock Purchase must use the app's own UI, not native/system dialogs.

## Impact Map
- **Screens:** `CompaniesListPage` (floating Add + logos), `CompanyDetailPage` (always-on Record Payment + logo), `ProductDetailPage` ♻️ (admin Edit action), `AdminPurchasesPage` (single floating action), `RecordPurchasePage` (in-app pickers)
- **Flows:** Add company, supplier payment (existing `payments/supplier/:companyId`), edit product (reuses `inventory/:id/edit` from CR-013), record stock purchase — all reached via consistent actions
- **Data & stores:** `companiesStore` (logo_url already mapped/persisted on create), `productsStore`, existing `rpcCreatePurchase` / supplier-payment RPC — no new writes
- **Content / i18n:** reused `admin.*`; action labels inline (matching surrounding code)
- **Backend / DB & Security:** no schema/RPC change. Company logos use existing `company-logos` Storage bucket. Purchases + supplier payments remain admin-only via existing RLS; employee product detail stays read-only (Edit shown only when `useShellBase()==="/admin"`); no cost/financial exposure added

### Details from your sheet
Flows: Add company, supplier payment, edit product, record stock purchase. Data & stores: `companiesStore`, `productsStore`, purchase/stock data → existing RPCs. Backend: company images persist + linked to record; reuse existing supplier-payment + product-update flows. UI/UX: floating actions, Company Detail action, Product Edit action, consistent in-app selection dialogs.

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. 

## Reviewer comments
Keep existing company/product/purchase functionality unchanged unless listed. Avoid duplicate actions where a floating action replaces an existing one.

## Open questions

## Implementation notes
- **Companies:** Add Company is now a floating action (matching Add Product/Customer); list rows and the
  detail header show the company logo when present (persisted on create via `company-logos`). Company
  Detail now offers **Record Payment always** (not only when a payable exists), routing to the existing
  supplier-payment flow.
- **Products:** Product Detail shows an **Edit** action for admins that opens the Add Product form in edit
  mode (`inventory/:id/edit`, from CR-013); the "editing restricted" notice now shows for employees only.
- **Purchases:** consolidated the duplicate header "Stock In" pill + bottom button into a **single floating
  "Record Purchase"** action; "Pay suppliers" summary shortcut kept.
- **Record Stock Purchase:** replaced the native `<select>` supplier/product dropdowns with a new reusable
  in-app `SelectSheet` bottom-sheet picker (searchable), matching the app's design. Added a `slideUp`
  animation.

## Verification
- `npx tsc --noEmit` clean; `pnpm run build` succeeds (1.33s).
- Store/DB sync: logos read from `companies.logo_url`; Record Payment reaches the real supplier-payment
  RPC screen (`payments/supplier/:companyId` route confirmed); Edit reaches the persisting product-update
  flow; purchase creation unchanged (`rpcCreatePurchase`).
- Security: purchases/supplier payments admin-only (existing RLS); employee product detail read-only; no
  new cost/financial exposure; no schema change.
