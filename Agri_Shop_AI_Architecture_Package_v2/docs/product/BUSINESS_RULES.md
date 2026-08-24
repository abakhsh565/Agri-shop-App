# Business Rules — Consolidated

Extracted from `docs/product/PRD.md` for quick reference. The PRD remains authoritative; if this file and the PRD ever disagree, the PRD wins and this file needs correcting.

## Pricing
- Sprays: pack-size variants (1L/500ml/200ml etc.), each with its own sellable quantity and current selling price. Admin can override proportional pricing — smaller packs need not be mathematically proportional to the base size.
- Seeds: fixed price-per-KG; sale amount = quantity × configured rate.
- Historical sales retain the price effective at the time of sale — a later price change never recalculates old sales.
- Existing stock keeps its recorded base/purchase cost; a new purchase can have a different base cost; existing cost is never retroactively changed.

## Inventory
- Tracked at product/variant/measurement level.
- Cannot become negative (enforced at the database layer, not just app logic).
- Statuses: In Stock, Limited Stock, Low Stock, Out of Stock, Expired, Not Sellable.
- Low-stock threshold and expiry warning window are configurable per shop.
- Expired stock is retained for reconciliation but not sellable.
- Batch-level expiry is explicitly future scope — do not build in MVP.

## Sales
- Every sale ties to a customer and an employee (or Admin, per D11).
- A sale may contain multiple line items; totals/outstanding are calculated server-side, never trusted from the client.
- Full payment: paid == total, outstanding = 0. Partial/credit: paid < total, outstanding calculated automatically.
- Sales History has All/Credit/Paid tabs; a sale's tab classification is fixed at completion time and does not retroactively move even if later fully paid (the customer's live balance is the source of truth for current debt, not the tab).

## Customer Credit
- Customer-level outstanding is cumulative across unpaid transactions.
- Credit limit is Admin-configurable per customer; undefined = uncapped.
- If a sale's unpaid portion would push outstanding over the limit: Employee sees a warning and can proceed with the sale logged for Admin review (default policy; Admin-configurable); Admin sees the same warning but can override directly.
- The warning never blocks a fully-paid line — only the unpaid/credit portion.
- Payments are permanent, append-only records; a later payment never overwrites history.

## Supplier Payables
- Mirrors customer credit in the opposite direction: unpaid purchases accumulate as payable.
- Every supplier payment is a permanent record.

## Returns
- Must originate from an original completed sale — no arbitrary returns.
- Return quantity cannot exceed the quantity originally sold/eligible.
- Refund (money back) or Credit Adjustment (against outstanding balance) — Admin/Employee choose per return.
- Original sale remains intact; the return is a separate linked transaction.

## Voids (v1.1)
- Admin-only.
- Only within the configured void window (default: same business day).
- Reverses the entire sale (all lines, inventory, financial effect) — no partial void; use Return instead for partial corrections.
- Never hard-deletes — flags the sale as Voided, fully preserved.

## Inventory Adjustments
- Admin-only, requires a reason (Damaged, Missing, Expired, Manual Correction, Other).
- Every adjustment is a permanent, auditable record.

## Roles
- **Admin/Owner:** full access — products, suppliers, cost, profit, employees, adjustments, voids, settings.
- **Co-Admin:** same as Owner except cannot remove/demote the original Owner.
- **Employee:** sales, customer operations, full shop-wide customer financial visibility; cannot see cost/profit/supplier financials, cannot adjust inventory, cannot void sales.

## Record Integrity
- No hard deletes on financial, sales, purchase, payment, return, inventory-movement, or void records — ever.
- Corrections happen via reversal/return/adjustment/void mechanisms, never edits to historical facts.
- Employee deactivation preserves all historical references — never hard-delete an employee.

## Barcode Sale Mode (Phase 8, not MVP)
- A distinct scan-loop flow: scan → variant auto-matched (barcode is variant-specific) → quantity entry → add to cart → repeat → Review & Pay reuses Manual Sale's existing cart/payment/confirmation screens.
- Client-side stock check during scanning is advisory only; authoritative validation happens server-side at final submit.
