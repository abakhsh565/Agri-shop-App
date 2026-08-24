# Acceptance Criteria / Test Plan

Organized by flow, derived directly from locked business rules (`docs/product/BUSINESS_RULES.md`). Each item should become an automated test where practical (RPC-level tests especially) or a manual verification step before a phase is marked done, per `DEFINITION_OF_DONE.md`.

## Auth
- [ ] Admin signup: phone → OTP → verified → account created as Owner.
- [ ] Employee login with a number NOT in the employee list → clear "not registered" message, no account created.
- [ ] Employee login with a DEACTIVATED number → "access revoked" message, cannot enter app.
- [ ] Employee login with a valid, active number → enters Employee app with correct role permissions.
- [ ] Co-Admin cannot remove/demote the original Owner.
- [ ] Session persists after first login; app does not re-prompt OTP on normal reopen.

## Products & Inventory
- [ ] Adding a Spray product with 3 variants (1L/500ml/200ml) creates 3 independently trackable inventory rows.
- [ ] Selling 3× 500ml reduces only the 500ml stock, not 1L or 200ml.
- [ ] Seed sale of 500g at Rs.1000/kg calculates Rs.500 correctly.
- [ ] Attempting to sell more than available stock is rejected server-side, even if the client's cached view was stale.
- [ ] Inventory never goes negative under concurrent sale attempts on the last unit.
- [ ] Item at/below configured low-stock threshold shows Low Stock status.
- [ ] Expired item cannot be added to a new sale, but still appears in inventory records.

## Sales (Manual Flow)
- [ ] A sale with 2+ line items calculates line totals and overall total correctly server-side.
- [ ] Full payment sale: outstanding = 0, appears in Paid tab.
- [ ] Partial payment sale: outstanding calculated correctly, appears in Credit tab.
- [ ] Employee-created sale and Admin-created sale both record correctly with the right "processed by" user (D11).
- [ ] A later price change does not alter the price recorded on a completed sale.

## Sales (Barcode Mode, Phase 8 — for when that phase starts)
- [ ] Scanning a known barcode matches the exact variant with no extra selection step.
- [ ] Scanning the same barcode twice in one session increments quantity rather than duplicating the line.
- [ ] Scanning an unrecognized barcode does not dead-end — falls back to manual search.
- [ ] A stock conflict not caught during scanning (e.g. concurrent sale) is still caught and surfaced clearly at final submit.

## Customer Credit
- [ ] A credit sale that would exceed the customer's configured credit limit shows the warning for both Employee and Admin.
- [ ] Employee can still complete the sale per the configured override policy; Admin can override directly.
- [ ] Customer with no credit limit configured never triggers the warning.
- [ ] A later customer payment reduces outstanding balance and creates a new permanent payment record — does not alter the original sale record.

## Supplier Payables
- [ ] A purchase with partial payment correctly adds the unpaid portion to supplier payable.
- [ ] Recording a supplier payment reduces payable and creates a permanent record.

## Returns
- [ ] A return cannot exceed the quantity originally sold on the referenced sale.
- [ ] An arbitrary return not tied to a real sale is rejected.
- [ ] Approved return correctly increases inventory and updates customer balance depending on Refund vs. Credit Adjustment choice.

## Voids
- [ ] Employee cannot access void — Admin-only, enforced server-side (RLS/RPC check), not just hidden in UI.
- [ ] Voiding within the window correctly reverses inventory and customer balance, and flags the sale Voided — record still visible in history.
- [ ] Attempting to void a sale outside the configured window is rejected with a clear message pointing to Return instead.

## Roles & Permissions (test both positive and negative cases)
- [ ] Employee query for a product's `base_cost` returns nothing/null (RLS-enforced), not just hidden client-side.
- [ ] Employee query for gross profit / supplier payable data returns nothing.
- [ ] Employee attempting to call an Admin-only RPC (e.g. `adjust_inventory_v1`, `void_sale_v1`) is rejected server-side even if called directly (not through the UI).

## Multi-Tenancy (even with one shop live)
- [ ] A query scoped to `shop_id` A never returns rows belonging to `shop_id` B, even if attempted directly against the API.

## Data Integrity
- [ ] No UI path exists to hard-delete a completed sale, purchase, payment, or return record.
- [ ] Deactivating an employee preserves all their historical sales records intact.
