# Changelog

## 2026-08-21 — CR-016 Companies, Products & Purchases (actions + UI consistency)
- CR-016 (Done): Add Company is now a floating action and company logos show in
  the list and detail; Company Detail offers Record Payment at all times (existing
  supplier-payment flow). Product Detail gained an admin-only Edit action (opens
  the Add Product form in edit mode from CR-013); the read-only notice now shows
  for employees only. Purchases consolidated its duplicate Stock-In/Record buttons
  into one floating "Record Purchase" action. Record Stock Purchase's native
  supplier/product dropdowns were replaced with a new reusable in-app `SelectSheet`
  bottom-sheet picker (added a `slideUp` animation). No schema/RPC changes.

## 2026-08-21 — CR-014 Customers (floating add, profile cleanup, photo)
- CR-014 (Done): Add Customer is now a floating action (matching Add Product);
  Customer Profile uses a clean vertical hero and drops the redundant Contact
  Info card (phone/address moved into the hero). Admins can upload/replace a
  customer photo from the profile — persisted via new `customers.image_url`
  (migration `0008_customer_image.sql`) and `customersStore.updateCustomerImage`,
  shown in the list and profile; employees see it read-only. Removed the
  "Customer" back label on Payment History. Record Payment / Payment History
  behavior unchanged.

## 2026-08-21 — CR-013 Inventory & Products (edit/delete/floating add)
- CR-013 (Done): Products can now be **edited** and **deleted** from Inventory.
  Add Product became a floating action pinned above the tab bar; each product row
  gained Edit (reuses `AddProductPage` in prefilled edit mode) and Delete (with a
  confirmation dialog). New migration `0007_product_update_delete.sql` adds
  `products.is_active` + admin-only `update_product`/`delete_product` RPCs:
  delete hard-removes only when the product has no sale history, otherwise it
  **archives** (ADR-004); edits never touch stock or historical sale prices.
  `productsStore` now loads active products only, so archives disappear app-wide
  while records are preserved. Added reusable `ConfirmDialog`. Image persistence
  verified through Supabase Storage on both add and edit.

## 2026-08-21 — Status-bar contrast fix, registry reconciliation, CR-025
- Fixed status-bar icon contrast: status-bar content colour is now theme-driven
  (`applyTheme` in `src/stores/themeStore.ts`) — light theme → dark icons, dark
  theme → white icons — instead of the hardcoded `Style.Dark` in `src/main.tsx`;
  web `theme-color` meta now follows the in-app theme too.
- Change Registry: reconciled the Owner's uploaded sheet into clean, unique CRs
  (CR-008/010/011/013/014/016 filled with approved content; new CR-025 tab-bar
  hide, CR-026 OTP UX, CR-027 owner profile image); no ID collisions with the
  Done CR-001; fixed a `Created` typo in CR-002.
- CR-025 (Done): bottom tab bar now hides on nested/detail/form screens and
  throughout the sale flow, showing only on top-level navigation screens in both
  shells (`src/lib/navDepth.ts`, `AdminLayout.tsx`, `EmployeeLayout.tsx`).
- CR-008 (Done): Admin Dashboard reworked — personalized greeting (saved name +
  current date, Owner label removed), single period filter (All/Today/Yesterday/
  Week/Month) above the summary controlling all figures, Total Sales card
  (Total/Gross Profit/Transactions) with **real gross profit** from cost vs.
  selling price, Paid/Credit/Outstanding cards, and a new Recent Sales section;
  removed duplicated metric cards. Added `common.viewAll` (en + ur).

## Initial Architecture Package
- Created portable AI-agent instructions.
- Defined cross-platform/mobile architecture baseline.
- Defined backend/database/API/security baselines.
- Added threat model.
- Added ADR system.
- Added implementation roadmap.

## 2026-08-18 — Delivery stack confirmed (React PWA + Supabase)
- ADR-006 accepted: ship as an installable PWA (React + Vite) on Supabase
  (PostgreSQL + Auth + Realtime); supersedes ADR-001 (Flutter) and ADR-002 (NestJS).
- Goals recorded: cross-platform Android/iPhone via PWA, real-time sync, and
  future inventory automation (ROADMAP Phase 8).
- Added PWA support: `public/manifest.json`, `public/sw.js`, service-worker
  registration in `src/main.tsx`.
- Added `@supabase/supabase-js`; connected Supabase project; added
  `src/lib/supabase.ts` (Realtime-enabled client).
- AGENTS.md merged: runtime facts + engineering governance; fixed doc
  cross-references from a nonexistent `docs/` tree to the flat root files.
- Clarified PRD authority: PDF is ultimate source, `PRD.md` is the written baseline.

## 2026-08-18 — Shell isolation, admin sections, and users-schema alignment
- Fixed cross-shell navigation: all shared pages (customers, sale flow, products,
  activity log) now resolve links through `useShellBase()`, so the admin/owner
  shell never falls through to `/employee/*` and vice versa.
- Mounted the sale-creation flow under `/admin` so the owner can ring up a sale
  without leaving the admin shell.
- Admin "Products" now opens the real product catalog; "Purchases", "Reports",
  and "Payments" show honest Coming-soon placeholders instead of silently
  reusing the inventory screen.
- Added migration `0002_align_users_and_rls.sql`: idempotently adds the
  login/deactivation timestamp columns some deployments were missing (root cause
  of the "Could not find the 'first_login_at' column" error), adds the
  employee-safe `product_variants_public` view (omits `cost_price`), and enables
  realtime on `users`.
- Login now records `first_login_at` / `last_login_at` best-effort (failures are
  swallowed so a stale schema can never block sign-in).

Future entries must record meaningful product, architecture, security, and operational changes.
