# CR-014 — Customers & customer payments — actions, profile and detail UI

**Status:** Done
**Priority:** Medium
**Type:** Mixed
**Requested by:** Owner
**Persona:** Admin/co-admin
**Created:** 2026-08-21
**Depends on:** —
**Blocks:** —

## Goal
Improve customer management: make Add Customer easier to reach, simplify the Customer Profile layout, and let the Admin manage the customer's profile image with persistent sync.

## Current behavior
Add Customer sits within the page layout. Customer Profile repeats contact info (a separate Contact Info card shows the phone). The customer image/placeholder has no persistent upload/update behavior.

## Desired behavior
Add Customer uses the same fixed floating-action pattern as Add Product, above the bottom nav, accessible while scrolling. Remove the separate Contact Info phone card (the number already shows in the main profile info). Reorganize the top profile section from horizontal into a cleaner vertical layout. On the Admin side, allow uploading/replacing the customer's profile image from Customer Profile (placeholder + upload action when none); the image persists and syncs to the customer's DB/storage record wherever shown. Remove the unnecessary Customer label beside Back in Payment History.

## Impact Map
- **Screens:** ♻️ `CustomersListPage` (floating Add), `CustomerProfilePage` (vertical hero, admin image upload, Contact card removed), `CustomerPaymentHistoryPage` (back label removed)
- **Flows:** Add customer (unchanged target, reached via floating action), customer profile image upload (admin), Payment history/Record payment (unchanged)
- **Data & stores:** `customersStore` — maps `image_url`, new `updateCustomerImage()` (direct RLS update); image via existing `uploadImage("employee-photos")`
- **Content / i18n:** reused `customers.*` / `customerProfile.*`; removed the Contact-card heading usage
- **Backend / DB & Security:** migration `0008_customer_image.sql` adds `customers.image_url`. Reads/writes use existing `customers` RLS (authenticated). Image is non-financial → safe for both personas to read; **upload UI is admin-only** (gated on `useShellBase() === "/admin"`). No cost/financial exposure touched.

### Details from your sheet
Flows: Add customer, edit customer/profile, payment history. Data & stores: `customersStore`, customer profile/image data. Content: `customers.*`, `addCustomer.*`, `customerProfile.*`, `recordPayment.*`. Backend: customer image persisted + linked to the correct record; stores/screens read the same source of truth. UI/UX: floating Add Customer, profile layout, image upload, Payment History header.

## Dependencies & conflicts
Agent fills the structured Impact Map bullets during per-CR Analyze. 

## Reviewer comments
Keep Customer Payment History and Record Payment behavior unchanged. No other customer-detail changes unless identified later.

## Open questions

## Implementation notes
- **Add Customer** is now the same floating-action pill as Add Product (pinned above the tab bar,
  RTL-aware); the inline header button was removed. List rows show the customer photo when present.
- **Customer Profile** hero is a clean vertical stack: photo → name → phone → address → credit badge.
  The redundant Contact Info card was removed (phone/address now live in the hero).
- **Admin** sees an `ImageUpload` in place of the avatar (placeholder when none) that uploads to Storage
  and persists via `updateCustomerImage`; employees see a read-only avatar/photo. Toast confirms save.
- **Payment History** header no longer shows the "Customer" back label (plain back arrow).

## Verification
- `npx tsc --noEmit` clean; `pnpm run build` succeeds (737ms).
- Store/DB sync: image saved to `customers.image_url` and reflected in the store + list + profile;
  realtime `customers` subscription re-loads on external change.
- Security: upload UI admin-only; image non-financial; no employee financial exposure; Record Payment /
  Payment History behavior unchanged.
