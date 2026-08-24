# Implementation Roadmap (v2)

Ordering principle: get the real business loop working end-to-end fast, harden progressively — not "build everything then secure it." Basic security (RLS, auth, no-hard-delete) is present from Phase 1 onward, not deferred to the end; what's deferred is *advanced* hardening (pen testing, load testing) until there's a working product worth hardening.

## Phase 0 — Foundation
- Create Supabase project (dev + production).
- Enable Phone Auth (OTP).
- Set up multi-tenancy (`shop_id`) from the first migration.
- Scaffold Expo/React Native app, connect Supabase client.
- Set up EAS Build for APK output.
- Set up `docs/LEARNINGS.md` (already present) and confirm the AI agent references it.

## Phase 1 — Identity and Foundation
- Admin signup (phone + OTP), Co-Admin support.
- Employee creation by Admin (no self-signup), deactivation check at login.
- Roles/permissions baseline + RLS policies for `users`.
- Core settings (thresholds).
- Audit event foundation.

## Phase 2 — Master Data
- Companies, Products, Spray variants, Seed pricing, Customers.
- RLS policies proven for cost/price visibility (Employee vs Admin) before moving on — this is the highest-risk area to get wrong and is cheapest to test now.

## Phase 3 — Inventory and Purchases
- Stock-in (`create_purchase_v1`), Inventory, Supplier payable, Supplier payments.
- Expiry/stock statuses, Adjustments (`adjust_inventory_v1`).

## Phase 4 — Sales and Customer Credit
- New Sale (`create_sale_v1`) — multi-line, cart qty steppers, credit-limit warning, customer credit header.
- Full/partial payment, Customer outstanding, Customer payments.
- Employee sales tracking, Sales History tabs (All/Credit/Paid).

## Phase 5 — Returns and Voids
- Original-sale-based returns, refund/credit adjustment, inventory restoration.
- Void Sale (Admin-only, time-windowed).

## Phase 6 — Dashboards and Reports
- Employee dashboard (Paid/Credit tile), Admin dashboard.
- Gross profit, filters/drill-down, Daily Cash Reconciliation.
- Receipt/Print preview, Reorder Suggestions.

## Phase 7 — Real-World Readiness
- Offline queue for sales/stock (device-local queue + sync).
- Data export (Excel/PDF) for Admin.
- Security review pass: re-check every RLS policy against the permission matrix.
- Backup/restore test on the Supabase project.
- Only after this phase: consider public Play Store listing (private APK distribution is fine before this).

## Future (post-MVP, requires new ADR to start)
**Post-MVP Awareness Sequence** — this is the order the agent should expect these to come up, so it's mentally prepared and doesn't build against outdated assumptions. None of this is scheduled or committed except Phase 8; everything after it is direction, not a deadline.

1. **Phase 8 — Barcode Integration** (committed next step, see `docs/BARCODE_INTEGRATION.md` for full plan): scan-to-add in New Sale, barcode assignment in Add/Edit Product, internal barcode generation for unbranded products.
2. **Likely next candidates (not committed, order not fixed):** Multi-Shop/Franchise Mode (one owner, multiple locations — schema already ready via `shop_id` + future `organization_id`), a Web App using the same Supabase backend/RPC functions.
3. **Long-term vision (context only, see `docs/FUTURE_VISION.md`):** Multi-Business Platform (other retail verticals beyond Agriculture), Farmer App, Agricultural Marketplace. No architecture work needed for these now — the "generic core, isolated vertical module" naming discipline already in place (see `FUTURE_VISION.md` §3) is what keeps this door open.

Everything else previously listed:
- Batch-level inventory/expiry.
- Advanced batch costing.
- Advanced returns/exchanges.
- Additional categories.
- Multi-shop billing/onboarding flow (when actively selling to a second shop).
