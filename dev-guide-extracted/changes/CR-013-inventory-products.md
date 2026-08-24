# CR-013 — Inventory & Products — product actions, Add Product and image persistence

**Status:** Done
**Priority:** High
**Type:** Mixed
**Requested by:** Owner
**Persona:** Admin/co-admin
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Improve product management actions and Add Product accessibility while ensuring product images and data remain persistently synchronized with the database.

## Current behavior
Inventory/product list works. Add Product sits near the Inventory header. List items support stock adjustment but not Edit/Delete. Product actions and image persistence aren't consistently connected to the data.

## Desired behavior
Add Product becomes a fixed floating action above the bottom nav, standard size, visible while scrolling. Keep list + stock-adjust; add Edit and Delete. Delete shows a confirmation prompt, then a success state, and actually deletes/updates the persistent record (respect ADR-004: if the product has sales history, deactivate rather than hard-delete). Edit shows a success state and persists + reflects across the app. Product images uploaded during Add/Edit persist in DB/storage and appear wherever the product shows — never UI/local-state only. Product data, actions and images stay synchronized across DB, stores and screens.

## Impact Map
- **Screens:** `AdminInventoryPage` (Edit/Delete + floating Add), `AddProductPage` (now dual-mode add/edit), new route `inventory/:productId/edit`
- **Flows:** Add Product, **Edit Product** (new), **Delete/Archive Product** (new, with confirm), Stock Adjust (unchanged)
- **Data & stores:** `productsStore` (now filters `is_active=true`; reloaded after edit/delete); `db.ts` `rpcUpdateProduct` + `rpcDeleteProduct`; image via existing `uploadImage("product-images")`
- **Content / i18n:** reused `admin.*` / `products.*`; user-facing action strings inline (English) matching surrounding code
- **Backend / DB & Security:** migration `0007_product_update_delete.sql` — `products.is_active` flag + admin-only `update_product` / `delete_product` SECURITY DEFINER RPCs. `delete_product` hard-deletes only when no `sale_items` reference the product's variants; otherwise deactivates (ADR-004). `update_product` never touches stock (no negative stock) and never rewrites historical sale prices (those live on `sale_items`). Both guard with `app_is_admin()`.

### Details from your sheet
Flows: Add/Edit/Delete Product, Stock Adjust. Data & stores: `productsStore` → `rpcCreateProduct`, `rpcAdjustStock`, plus product update/delete + image storage. Content: `products.*`. Backend: verify create/update/delete persistence and image storage retrievable from the app's source. UI/UX: floating Add Product, action controls, delete confirmation, success states.

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. 

## Reviewer comments
Existing list + stock-adjust unchanged unless required. Double-verify image persistence at every place a product image appears. Delete/edit success must reflect the real DB operation, not just a UI toast. Never hard-delete records with financial/sales history (ADR-004).

## Open questions

## Implementation notes
- **Add Product** moved to a fixed floating action (52px pill) pinned above the bottom tab bar
  (`fixed … bottom: calc(var(--tabbar-height) + 16px)`), visible while scrolling; header pill removed.
- Each product row now has **Adjust · Edit (pencil) · Delete (trash)**. Edit routes to the reused
  `AddProductPage` in edit mode (prefilled; opening-stock read-only per-variant since stock changes go
  through Adjust Stock); Save calls `rpcUpdateProduct` then reloads the store and toasts success.
- **Delete** opens a `ConfirmDialog` (new reusable component); on confirm calls `rpcDeleteProduct`.
  The RPC returns `deactivated` so the toast honestly says "deleted" vs "archived (has sales history)".
- Product **images persist** via Supabase Storage (`uploadImage` / `products.image_url`) on both add and
  edit and are re-read by `productsStore.load()`, so they show everywhere the product appears.
- `productsStore.load()` now selects only `is_active=true`, so archived products drop out of catalogue,
  sale flow, and inventory automatically while their historical records remain intact.

## Verification
- `npx tsc --noEmit` clean; `pnpm run build` succeeds (750ms).
- Store/DB sync: edit/delete reload from Supabase; image round-trips through Storage; `is_active` filter
  hides archived products app-wide.
- Security: admin-only RPCs (`app_is_admin()`); ADR-004 respected (no hard-delete of products with sales
  history); stock never made negative; historical sale prices untouched; no employee cost exposure (edit
  screen is admin-only).
