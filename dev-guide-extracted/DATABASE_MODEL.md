# Database Model — Logical Baseline

## Core Entities
- User
- Role
- Company (supplier/manufacturer)
- Product
- ProductVariant / SellableUnit
- InventoryItem
- Purchase
- PurchaseLine
- SupplierPayment
- Customer
- Sale
- SaleLine
- CustomerPayment
- Return
- ReturnLine
- InventoryMovement
- InventoryAdjustment
- PriceHistory / effective pricing record
- AuditEvent
- AppSetting

## Key Relationships
Company → Product → ProductVariant → InventoryItem
Company → Purchase → SupplierPayment
Customer → Sale → CustomerPayment
Employee/User → Sale
Product/Variant → SaleLine → InventoryMovement
Sale → Return → InventoryMovement + Customer financial adjustment

## Integrity Rules
- Inventory cannot become negative.
- Historical sale price is stored on SaleLine.
- Existing stock cost is not retroactively changed.
- Payments are append-only records.
- Sales/purchases/returns/adjustments/movements are not hard-deleted.
- Employee deactivation preserves historical references.
- Return quantity cannot exceed eligible sold quantity.
- Expired stock is retained but marked not sellable.
- All monetary persistence uses decimal-safe money types; do not use binary floating point for stored money.

## Future Batch Support
Do not implement full batch costing in MVP. Keep inventory representation extensible so batch identity and expiry can be introduced later.

## Required Database Behaviors
- Migrations are mandatory.
- Foreign keys and indexes are mandatory where appropriate.
- Use unique constraints where business rules require uniqueness.
- Use database transactions for multi-record financial/inventory operations.
- Track created/updated timestamps and relevant actor/timing metadata.
