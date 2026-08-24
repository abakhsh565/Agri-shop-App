# Database Model — Logical Baseline (v2, Supabase/Postgres)

## Core Entities
- Shop (new — multi-tenancy root, see ARCHITECTURE.md §10)
- User (Admin / Co-Admin / Employee, linked to Supabase Auth phone identity)
- Role
- Company (supplier/manufacturer)
- Product
- ProductVariant / SellableUnit
- InventoryItem
- InventoryMovement
- InventoryAdjustment
- Purchase
- PurchaseLine
- SupplierPayment
- Customer
- Sale
- SaleLine
- CustomerPayment
- Return
- ReturnLine
- Void (v1.1 — references the sale it reverses)
- PriceHistory / effective pricing record
- AuditEvent
- AppSetting (per-shop configurable thresholds: low-stock, expiry window, void window, credit-limit policy)
- CashReconciliation (v1.1)

## Key Relationships
```
Shop → (every table, via shop_id)
Company → Product → ProductVariant → InventoryItem
Company → Purchase → SupplierPayment
Customer → Sale → CustomerPayment
Employee/User → Sale
Product/Variant → SaleLine → InventoryMovement
Sale → Return → InventoryMovement + Customer financial adjustment
Sale → Void → InventoryMovement (reversal) + Customer financial adjustment (reversal)
```

## Integrity Rules
- Every table includes `shop_id`; every RLS policy filters on it.
- Inventory cannot become negative — enforced by a Postgres `CHECK` constraint or trigger, not just app logic.
- Historical sale price is stored on `SaleLine`, never recalculated from current `Product` price.
- Existing stock cost is not retroactively changed.
- Payments are append-only records (no `UPDATE` on amount, only new rows).
- Sales/purchases/returns/adjustments/movements/voids are not hard-deleted — use status flags (`voided`, `reversed`) instead.
- Employee deactivation preserves historical references (`ON DELETE RESTRICT` or soft-delete flag, never cascade-delete).
- Return quantity cannot exceed eligible sold quantity — enforced in the `create_return_v1` function, re-validated against `SaleLine`, not trusted from the client.
- Expired stock is retained but marked not sellable via `InventoryItem.status`.
- All monetary columns use `numeric`/`decimal` types — never `float`/`double` for money.

## Row Level Security — Baseline Policy Shape
Every table:
1. RLS enabled by default (deny-all until explicit policy).
2. `shop_id = current_shop_id()` on every policy (multi-tenancy isolation).
3. Role-scoped column/row visibility, e.g.:
   - `products`: Employees can `SELECT` all columns except `base_cost`.
   - `companies`: Employees cannot `SELECT` payable/payment columns at all.
   - `sales`: Employees can see all shop sales (per PRD §10 — shop-wide customer visibility), but cannot see `gross_profit` fields.
4. All `INSERT`/`UPDATE` on financial/inventory tables denied directly at the RLS layer — only the `SECURITY DEFINER` RPC functions (which bypass RLS intentionally, after their own internal checks) can write.

## Future Batch Support
Do not implement full batch costing in MVP. `InventoryMovement` includes a nullable `batch_id` column reserved for future use so this can be added without a breaking migration later.

## Future Barcode Support
Do not implement barcode lookup in MVP (see `docs/BARCODE_INTEGRATION.md` — Phase 8). `product` and `product_variant` will get a nullable `barcode` column (unique per `shop_id`) when that phase starts; no schema change is required now, just noted so the migration is anticipated.

## Required Database Behaviors
- Migrations are mandatory (Supabase CLI migration files) — no manual schema edits in the dashboard for anything beyond initial prototyping.
- Foreign keys and indexes on all relationship columns and frequently filtered columns (`shop_id`, `customer_id`, `employee_id`, dates).
- Unique constraints where the business requires uniqueness (e.g. one active Admin phone number per shop).
- Every write-heavy multi-record operation happens inside a single Postgres function/transaction, never as sequential client calls.
- `created_at`/`updated_at` timestamps and actor metadata (`created_by`) on every table.
