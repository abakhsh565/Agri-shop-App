# Business Rules — Agri Shop Management System

All finalized business logic, validation rules, permission gates, and enhancement-specific rules.
Build every feature to satisfy these rules exactly. Do not invent rules not listed here.

---

## 1. Authentication & Sessions

- Login uses a 4-digit PIN per user
- PIN entry identifies the role (Admin vs Employee) automatically
- Session locks after inactivity (configurable, default 15 min)
- Re-authentication re-enters PIN without full logout
- Only one active session per device assumed (no multi-session management in MVP)

---

## 2. Role Permissions Matrix

| Action | Admin | Employee |
|---|---|---|
| View dashboard | ✅ Full (profit, supplier) | ✅ Operational only |
| Create sale | ✅ | ✅ |
| Void sale | ✅ | ❌ |
| View all sales | ✅ | ✅ own sales + all customer history |
| View purchase cost | ✅ | ❌ |
| View gross profit | ✅ | ❌ |
| Add/edit products | ✅ | ❌ |
| Change selling price | ✅ | ❌ |
| Add/manage companies | ✅ | ❌ |
| View supplier financials | ✅ | ❌ |
| Record supplier payment | ✅ | ❌ |
| Add stock / purchase | ✅ | ❌ |
| Adjust inventory | ✅ | ❌ |
| View customers | ✅ | ✅ (no cost/profit) |
| Record customer payment | ✅ | ❌ (MVP — Admin only) |
| Add customer | ✅ | ✅ |
| Set customer credit limit | ✅ | ❌ |
| Create employee | ✅ | ❌ |
| Deactivate employee | ✅ | ❌ |
| View reports | ✅ | ❌ |
| Change settings | ✅ | ❌ |
| Generate receipt | ✅ | ✅ |
| Process return | ✅ | ✅ (basic) |

---

## 3. Product & Pricing Rules

### 3.1 General
- Every product belongs to exactly one company/supplier
- Products cannot be hard-deleted; use `isActive = false`
- Category cannot be changed after product creation
- Products are searchable by name, category, company

### 3.2 Spray Variants
- Each pack size is a separate `ProductVariant`
- Each variant has its own selling price (not automatically proportional)
- Inventory tracked independently per variant
- Example: 1L and 500ml of the same spray are separate inventory items
- Admin sets selling price per variant independently

### 3.3 Seed Pricing
- Seeds have a single variant with a `pricePerKg` rate
- System calculates: `saleAmount = quantity_in_kg × pricePerKg`
- Quantity entry for seeds accepts decimal (e.g. 0.5 kg = 500g)
- Seed quantity is displayed in kg with grams precision

### 3.4 Selling Price Changes
- Selling price on a variant can be updated by Admin at any time
- Price change applies to new sales only
- All historical `SaleItem.unitPrice` values are preserved as snapshots — never recalculated
- Each stock-in purchase records the selling price at that point in time

### 3.5 Base/Purchase Price
- Base price is set per stock-in event (per `InventoryBatch`)
- Base price is never retroactively changed on existing batches
- New stock-in for the same variant can have a different base price
- Base price is Admin-only; never exposed in Employee views

---

## 4. Inventory Rules

### 4.1 Stock Movement
- Stock increases on: `Purchase/Stock-In`, `Approved Return`
- Stock decreases on: `Completed Sale`, `Admin Inventory Adjustment (negative)`
- Stock can never go below zero — system blocks the action with an error

### 4.2 Stock Status Logic
```
quantityRemaining === 0                        → OUT_OF_STOCK
expiryDate !== null && expiryDate < today      → EXPIRED (overrides all)
expiryDate within expiryWarningDays            → approaching_expiry (flag, not a status override)
quantityRemaining <= lowStockThreshold         → LOW_STOCK
quantityRemaining <= lowStockThreshold × 2    → LIMITED_STOCK  (configurable)
isActive === false                             → NOT_SELLABLE
else                                           → IN_STOCK
```

### 4.3 Expiry
- Expired stock is marked `EXPIRED` and `NOT_SELLABLE`
- Expired stock cannot be selected during a sale
- Expired records are preserved for reconciliation — never deleted
- Expiry warning window defaults to 30 days (configurable in Settings)

### 4.4 Inventory Adjustments
- Admin-only
- Requires a reason from: `Damaged | Missing | Expired | Manual Correction | Other`
- Every adjustment creates a permanent `InventoryAdjustment` record
- System must not allow silent stock changes

### 4.5 Reorder Alerts (Enhancement)
- Shows all variants where `stockStatus` is `LOW_STOCK` or `OUT_OF_STOCK`
- Grouped by company/supplier for easy reorder reference
- Admin-only view

---

## 5. Sales Rules

### 5.1 Sale Creation
- A sale must be linked to a customer (customer selection is mandatory)
- A sale must be linked to an employee (auto-set from logged-in user)
- Admin can also create a sale (records Admin's user ID as the employee)
- A sale must have at least one line item
- System auto-calculates: line totals, subtotal, total, outstanding

### 5.2 Cart Behaviour (Enhancement)
- Each product/variant in cart shows a quantity counter (+ / −)
- Tapping − when quantity = 1 removes the item from the cart (delete-on-1)
- Cart header displays the selected customer's current outstanding balance
- Outstanding balance in cart header updates if customer is changed

### 5.3 Payment Logic
```
amountPaid === totalAmount   → paymentType = 'full',    outstandingAmount = 0
amountPaid === 0             → paymentType = 'credit',  outstandingAmount = totalAmount
0 < amountPaid < totalAmount → paymentType = 'partial', outstandingAmount = totalAmount − amountPaid
```

### 5.4 Credit Limit Warning (Enhancement)
- If `customer.outstandingBalance + sale.outstandingAmount > customer.creditLimit` (and `creditLimit > 0`):
  - Show warning: "This sale will exceed [Customer Name]'s credit limit of Rs. [X]"
  - Admin: can override and proceed
  - Employee: can override and proceed (warning only, not a hard block — per PRD)
- If `creditLimit === 0`: no limit check applied

### 5.5 Inventory Deduction on Sale
- On sale completion, `InventoryBatch.quantityRemaining` is reduced for the relevant variant
- FIFO batch selection: oldest batch by `createdAt` is depleted first
- If quantity requested exceeds available stock, system blocks with error: "Insufficient stock"
- Stock cannot go negative

### 5.6 Historical Price Preservation
- `SaleItem.unitPrice` is a snapshot of the selling price at sale time
- Future selling price changes never affect completed sales

### 5.7 Void Sale (Enhancement — Admin Only)
- Only Admin can void a completed sale
- Void requires a reason (free-text)
- On void:
  - `Sale.status` → `voided`
  - `Sale.voidedAt`, `Sale.voidedBy`, `Sale.voidReason` recorded
  - Inventory is restored (batch quantities reversed)
  - Customer outstanding balance is recalculated
- Voided sales are preserved in history — not deleted
- Voided sales are excluded from profit and revenue calculations

### 5.8 Sales History Tabs (Enhancement)
- Sales list has three tabs: **All** | **Credit** | **Paid**
- **All**: every non-voided sale
- **Credit**: sales where `paymentType = 'credit' OR 'partial'` (outstanding > 0)
- **Paid**: sales where `paymentType = 'full'` (outstanding = 0)
- Each tab shows a summary widget: total count + total amount for the filtered set
- Voided sales shown in All tab with a "Voided" badge, excluded from totals

---

## 6. Customer Credit Rules

### 6.1 Outstanding Balance
- `customer.outstandingBalance = SUM of all non-voided sale.outstandingAmount`
- Recalculated whenever a payment is recorded or a sale is voided

### 6.2 Customer Payments (Enhancement — Admin can also record)
- Admin records payment against a customer's outstanding balance
- Payment creates a permanent `CustomerPayment` record
- Payment amount applied to reduce overall outstanding balance
- System does NOT automatically match payment to a specific sale (lump-sum credit model)
- Historical transactions are never modified

### 6.3 Customer Financial Visibility
- All employees can see customer outstanding balance, purchase history, payment history
- Employees cannot see: purchase cost, base price, gross profit, supplier data

---

## 7. Supplier Payables Rules

- `supplierPayable.outstandingPayable = SUM(purchase.totalPurchaseCost) − SUM(supplierPayment.amount)`
- Each supplier payment creates a permanent `SupplierPayment` record
- Supplier financial data is Admin-only
- Supplier payment history cannot be deleted or modified

---

## 8. Returns Rules

- Return must originate from an existing completed (non-voided) sale
- Return quantity per item cannot exceed the original sale quantity for that item
- On return approval:
  - Inventory restored by returned quantity
  - Customer financial balance updated automatically
- **Refund**: customer receives money back — `customer.outstandingBalance` unaffected, cash returned
- **Credit Adjustment**: return value applied to reduce `customer.outstandingBalance`
- Original sale record is NOT modified; return is a separate transaction
- Returns are permanent records — not deletable

---

## 9. Employee Management Rules

- Employee accounts are deactivated, never hard-deleted
- Deactivated employee's historical sales, payments, and transactions remain intact
- Inactive employees still appear in historical reports
- Employee PIN must be unique across all users

---

## 10. Record Integrity Rules

**Nothing is ever hard-deleted:**

| Record Type | Correction Method |
|---|---|
| Sale | Void (Admin only) |
| Sale Item | Cannot modify — void the sale |
| Customer Payment | Immutable — new adjustment record if needed |
| Supplier Payment | Immutable |
| Purchase/Stock-In | Immutable — adjustment to inventory if correction needed |
| Inventory Adjustment | Immutable — new adjustment to counter |
| Return | Immutable |

---

## 11. Gross Profit Rules (Admin Only)

```
Gross Profit = SUM(saleItem.lineTotal) − SUM(cost of items sold)
Cost of item sold = inventoryBatch.basePurchasePrice × quantity_sold (FIFO allocation)
```

- Calculated only for completed, non-voided sales
- Gross profit is never shown to employees
- Available by period: Today, Yesterday, This Week, This Month, Previous Month, 6 Months, 1 Year, Custom Range
- Drillable by: employee, company, product, category

---

## 12. Daily Cash Summary Rules (Enhancement)

- Admin-only screen
- Shows for selected date (default: today):
  - Total sales value
  - Cash collected (sum of `amountPaid` across all sales that day)
  - Outstanding created (sum of `outstandingAmount` across all sales that day)
  - Customer payments received that day
  - Net cash position for the day
- Excludes voided sales

---

## 13. Receipt Rules (Enhancement)

- Available for any completed (non-voided) sale
- Receipt contains: shop name, date/time, employee name, customer name, line items, total, amount paid, outstanding
- Base price and gross profit are NEVER shown on receipt
- Employee and Admin can both view/print a receipt

---

## 14. Filtering Rules

### Sales List Filters
- Date range (Today, Yesterday, This Week, This Month, Custom)
- Employee (Admin only)
- Customer
- Payment status (Paid / Credit / Partial)
- Company / Product (Admin only)

### Inventory Filters
- Stock status
- Category
- Company
- Expiry status

### Customer List Filters
- Outstanding balance (has outstanding / no outstanding)
- Search by name / phone

### Report Filters (Admin)
- All of the above plus:
- Gross profit period
- Category
- Credit status

---

## 15. Notification / Alert Rules

- Low-stock and expiry alerts are shown in Inventory view (not as global popups)
- Admin dashboard shows counts: "X items low stock", "Y items expiring soon"
- Employees do not see inventory alerts
- Alert thresholds configured in Settings:
  - `lowStockThreshold` (default: 10 units)
  - `expiryWarningDays` (default: 30 days)
