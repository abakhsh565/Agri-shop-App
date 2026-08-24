# Agri Shop Management System — PRD
**Version 1.1 — Updated Baseline (supersedes v1.0 Final)**

Prepared as a single source of truth for AI-assisted product design and application development.

| | |
|---|---|
| **Product** | Agri Shop Management System |
| **Product Type** | Internal Retail / POS + Inventory + Credit & Payables |
| **Primary Users** | Shop Owner / Admin and Shop Employees |
| **Initial Categories** | Sprays and Seeds |
| **Version** | 1.1 — Updated (v1.0 baseline + approved enhancements) |
| **Status** | Requirements aligned with finalized discussion + new enhancement pass |

> **Note on this revision:** Section 0 below summarizes everything that changed from v1.0. Sections 1–33 are the original locked baseline, carried forward unchanged except where explicitly flagged with **`[UPDATED v1.1]`**. Section 34 onward is new: the enhancement screen set, the complete screen inventory, the navigation map, and the added business logic.

---

## 0. What Changed in v1.1

This revision layers nine changes on top of the v1.0 baseline. Nothing in v1.0 is contradicted — these are additive UX and workflow refinements discovered during design.

| # | Change | Impacted Areas |
|---|---|---|
| 1 | **Dashboard metric swap** — "Customers Served" replaced by **Paid / Credit** split metric | Employee Dashboard, Admin Dashboard |
| 2 | **Sales History tabs** — All / Credit / Paid filter tabs with summary widgets per tab | Sales module (Admin + Employee) |
| 3 | **Cart quantity counters** — stepper control in cart; reducing a qty-1 line item removes it | New Sale flow |
| 4 | **Customer credit info in cart header** — outstanding balance shown while building a sale | New Sale flow |
| 5 | **Admin can generate sales** — Admin gets "New Sale" and "Record Payment" entry points, not just reporting | Admin navigation, Sales module |
| 6 | **7 new enhancement screens** — Daily Cash Reconciliation, Void Sale, Receipt/Print Preview, Reorder Suggestions, and related confirmation states | New module additions |
| 7 | **Complete screen inventory** — full 59-screen list with screen IDs | Section 36 |
| 8 | **Navigation map** — all role-based flows documented end-to-end | Section 37 |
| 9 | **Business logic additions** — credit-limit warning behavior, filter/tab rules | Section 38 |

---

## 1. Product Overview

We are building an internal management application for a small agricultural retail shop with approximately 3–4 employees. The shop sells agricultural products, initially sprays and seeds, from different companies that are treated as the shop's suppliers/manufacturers.

The application combines retail sales, inventory management, customer management, customer credit, supplier purchases and payables, payment histories, employee sales tracking, product expiry monitoring, stock alerts, and admin-only profitability reporting.

The product should feel like a simple, fast retail POS and inventory system rather than a complex ERP.

## 2. Product Goals

- Maintain accurate inventory and stock movement.
- Process customer sales quickly.
- Automatically deduct sold quantities from inventory.
- Track customer purchases, payments, credit, and outstanding balances.
- Track supplier purchases, payments, and amounts payable.
- Monitor product expiry and low-stock conditions.
- Track employee sales performance.
- Calculate and report gross profit to Admin.
- Reduce manual calculations and manual record keeping.
- Give the Shop Owner complete operational and financial visibility.

## 3. Users and Permissions

### 3.1 Shop Owner / Admin
- Full access to products, inventory, companies/suppliers, purchases, sales, customers, employees, payments, returns, adjustments, reports, and settings.
- Can add and manage products and companies/suppliers.
- Can add stock and record purchases.
- Can manage selling prices and product information.
- Can manage employees and deactivate employee accounts.
- Can view supplier purchase cost, supplier payable, payment history, and shop profit.
- Can view all customer financial information and all employee activity.
- Can manually adjust inventory with a recorded reason.
- **`[UPDATED v1.1]`** Can directly create a new sale and record a customer payment from Admin navigation (previously implied reporting-only; now explicit operational parity with Employee for these two actions).

### 3.2 Employee
- Primary responsibility: sales and customer operations.
- Can create sales, select products/variants, record quantities and payments, and handle customer-related operations.
- Can view customers, their purchase history, payment history, total purchased amount, total paid, and total outstanding balance.
- All employees have customer visibility across the shop; customer financial history is not restricted to the employee who originally made a sale.
- Cannot add or modify products.
- Cannot change product prices.
- Cannot add/manage companies or suppliers.
- Cannot view supplier financial information.
- Cannot view base/purchase cost or gross profit.
- Cannot manually adjust inventory.
- Cannot perform administrative controls.
- **`[UPDATED v1.1]`** Cannot void a completed sale — voiding is Admin-only (see §35.2).
- **`[UPDATED v1.1]`** Cannot access Daily Cash Reconciliation — Admin-only (see §35.1).

## 4. Company / Supplier Model

Company, supplier, and manufacturer are treated as the same business entity for this product. There is no separate supplier/manufacturer entity in the initial model.

- Company name
- Company logo
- Products supplied
- Purchase history
- Quantities supplied
- Purchase cost
- Total paid
- Outstanding payable
- Supplier payment history

Employees may see company/product information needed for sales, but supplier financial information is Admin-only.

## 5. Product Management

- Admin creates and manages products.
- Every product belongs to a company/supplier.
- Initial categories: Spray and Seed.
- The category model should be extensible for future agricultural categories.
- Products must be searchable and filterable by category and company/supplier.
- Product details must support the appropriate measurement/pricing model for its category.

## 6. Product Units, Variants and Pricing

### 6.1 Spray
Sprays are sold as pack-size variants. Inventory is tracked separately for each sellable variant.
- Examples: 1 Liter, 500 ml, 200 ml.
- Each variant has its own sellable quantity and current selling price.
- Example: Janja Spray — 1L: 20 units; 500ml: 35 units; 200ml: 10 units.
- Selling 3 × 500ml reduces only the 500ml stock.

The system may calculate proportional prices from a base pack size, but Admin must be able to define/override the actual selling price for a variant. The business does not require smaller spray packs to always have mathematically proportional retail pricing.

### 6.2 Seed
Seeds use a fixed price-per-kilogram model.
- Example: Rs. 1,000 per kg.
- 10 kg = Rs. 10,000.
- 500 g = Rs. 500.
- The system calculates the sale amount from quantity × configured per-KG rate.
- Seed pricing should not be treated like arbitrary spray pack variants.

## 7. Inventory Management

- Admin adds stock through a stock-in/purchase workflow.
- Inventory is tracked at the product/variant/measurement level.
- Inventory records quantity, base/purchase price, selling price, expiry date, and stock status.
- Completed sales automatically reduce inventory.
- Approved returns automatically increase inventory.
- Admin stock adjustments update inventory and create a permanent adjustment record.
- Inventory cannot become negative.

### 7.1 Stock Status
- In Stock
- Limited Stock
- Low Stock
- Out of Stock
- Expired
- Not Sellable

Low-stock thresholds should be configurable. Example: 100 units initially, 90 sold, 10 remaining; if the configured threshold is 10, the item becomes Low Stock. Low-stock/expiry warnings should primarily be visible in Inventory rather than being repeated across every screen.

### 7.2 Expiry
- Applicable products have an expiry date.
- Inventory should surface products approaching expiry and expired products.
- Expired stock remains represented for accurate reconciliation but is marked Expired / Not Sellable.
- Expired stock must not be available for normal sale.
- The expiry warning window should be configurable.

### 7.3 Batch-wise expiry — Pending / Future
The same product/variant may eventually have multiple batches with different expiry dates. This is intentionally pending for a future phase. The architecture should remain extensible to support batch-level stock and expiry later without rebuilding the core product.

## 8. Stock Purchase / Stock-In

Flow: Admin → Purchase / Stock In → Select Company/Supplier → Select Product → Select Unit/Variant → Enter Quantity → Enter Base/Purchase Price → Enter Selling Price → Record Payment → Save.

The system adds the purchased quantity to inventory and separately records the supplier's financial position.

Example: 100 units × Rs. 2,000 base price = Rs. 200,000 purchase cost. If Rs. 100,000 is paid, inventory still receives all 100 units and supplier payable becomes Rs. 100,000.

## 9. Supplier Payables and Payments

Supplier financial tracking mirrors the customer-credit concept in the opposite direction: the shop owes the supplier when a purchase is unpaid.

- Existing payable + new unpaid purchase = new cumulative payable.
- Supplier payments reduce payable.
- Every supplier payment is permanently recorded.
- Supplier history should show purchases, amounts, payments, and remaining payable.

Flow: Supplier → Outstanding → Record Payment → Payable Reduced → Permanent Payment History.

Example: Previous payable Rs. 300,000; payment Rs. 50,000; remaining payable Rs. 250,000.

## 10. Customer Management and Credit

- Customer profile includes name, phone number, address, purchase history, payment history, total purchases, total paid, outstanding amount, and credit limit.
- All employees can access the customer's complete shop-wide financial history.
- Employees cannot access Admin-only supplier cost/profit information.
- Customer can have multiple outstanding sales/credit transactions.
- Customer-level outstanding is the cumulative unpaid amount.

### 10.1 Payment Types
- **Full Payment:** total paid equals total sale amount; outstanding is zero.
- **Partial Payment / Credit:** amount paid is less than total; system calculates the outstanding amount automatically.

### 10.2 Credit Limit
Admin can define a credit limit for each customer. If a new credit transaction would exceed the limit, the system should warn the user and apply the configured permission/business rule. **`[UPDATED v1.1]`** See §38.1 for the specific warning behavior and override rule now defined for the cart flow.

### 10.3 Credit Settlement
A later customer payment creates a new permanent payment record and reduces outstanding balance. The system must not overwrite historical transactions.

## 11. Customer Financial History

Customer history should preserve the full transaction trail. Each sale/payment context should allow the user to understand what was purchased, how much it cost, how much was paid, what remained outstanding, when it occurred, and which employee processed the original sale.

When a new payment is made, it should create a new transaction/history record and update the customer's current balance.

## 12. Sales Management

Flow: Employee/Admin → Select Customer → Select Product → Select Variant/Unit → Enter Quantity → Review Sale → Select Payment Type → Enter Amount Paid → Complete Sale.

- A sale may contain multiple products.
- System calculates line totals and overall total automatically.
- System calculates amount paid and outstanding automatically.
- Every sale records customer, employee, products, quantities, prices, payment information, and date/time.
- Completed sale automatically updates inventory and customer financial state.
- **`[UPDATED v1.1]`** Admin can also originate a New Sale (see §3.1). Sale record still captures whichever user (Admin or Employee) actually processed it, for accountability.
- **`[UPDATED v1.1]`** Cart UI now includes quantity stepper controls per line item and displays the selected customer's outstanding balance in the cart header (see §35.3, §35.4).

### 12.1 Historical Price Rule
Historical sales retain the selling price that was effective at the time of the sale. A later selling-price change must never recalculate old sales.

## 13. Price and Cost Rules

- Base/purchase price is Admin-only.
- Employees never see purchase cost.
- Existing stock keeps its recorded base/purchase cost.
- The base cost is not retroactively changed for existing stock.
- A new stock purchase may have a different base cost.
- Selling price can change over time by effective date.
- Remaining inventory uses the current applicable selling price.
- Historical sales preserve their original selling price.

Example: old stock cost Rs. 4,000 and sold at Rs. 5,000; later selling price becomes Rs. 5,500. Existing historical sales remain at Rs. 5,000. New sales use Rs. 5,500. A future stock purchase can have a different base cost.

## 14. Gross Profit and Admin Reporting

Gross profit is Admin-only.

**Gross Profit = Sales Revenue − Cost of Goods Sold**

- Today's gross profit
- Yesterday's gross profit
- This week's gross profit
- This month's gross profit
- Previous month
- Multiple-month periods
- Six-month period
- One-year period
- Custom date range

Admin should be able to drill into sales by employee, company/supplier, product, category, customer, payment status, and date range. Example: Employee A → Janja → August → Spray.

## 15. Returns and Refunds

Returns should originate from an original completed sale. An employee must not be able to create an arbitrary return for a product that the customer did not purchase.

Flow: Original Sale → Select Product → Return Quantity → Verify Customer/Transaction → Choose Refund or Credit Adjustment → Confirm.

- Return quantity cannot exceed the quantity originally sold/eligible for return.
- Inventory is increased by the approved returned quantity.
- Customer financial balance is updated automatically.
- Refund option returns money to the customer.
- Credit Adjustment option applies the return value against the customer's outstanding balance.
- Original sale remains intact; the return is recorded as a separate transaction.

Basic return functionality is preferred for MVP if implementation remains manageable. Advanced exchange/complex refund workflows can be future scope.

## 16. Inventory Adjustment

Admin can manually adjust stock only through a recorded adjustment workflow.

- Damaged
- Missing
- Expired
- Manual Correction
- Other

Each adjustment must record the quantity change, reason, date/time, and responsible Admin/user. The system must not silently change stock.

## 17. Employee Dashboard

Employee dashboard is operational, not financial-profit focused.

- Today's total sales
- Number of transactions
- ~~Customers served~~ **`[UPDATED v1.1 — REMOVED]`**
- **`[UPDATED v1.1 — ADDED]`** Paid sales total (count + amount)
- **`[UPDATED v1.1 — ADDED]`** Credit sales total (count + amount)
- Products sold
- Quantities sold
- Relevant outstanding credit/customer activity
- Sales history

Employee dashboard supports Today, Yesterday, This Week, This Month, and Custom Range filters. Employee can access customer details and complete customer history but cannot access supplier costs, supplier payable, or profit.

> **`[UPDATED v1.1]`** The former single "Customers Served" tile is replaced by a two-part **Paid / Credit** metric tile — this gives the employee an at-a-glance read on how much of today's sales are cash-in-hand vs. outstanding, which is more actionable during a shift than a raw customer count. See §38.2 for the exact tile behavior.

## 18. Admin Dashboard

Admin dashboard provides complete shop-wide visibility. Default period is Today, with date/range controls.

- Total sales
- Number of transactions
- Paid sales
- Credit sales
- Outstanding customer credit
- Gross profit
- Employee-wise sales
- Company/supplier-wise sales
- Product/category performance
- Customer activity
- Low-stock products
- Out-of-stock products
- Expiring/expired products
- Supplier payable
- **`[UPDATED v1.1]`** Quick actions: **New Sale** and **Record Payment** shortcuts (see §3.1, §35).

Recommended filters: Date/date range, Employee, Company/Supplier, Product, Category, Customer, Payment Status, Credit Status.

## 19. Company / Supplier Detail

Admin can open a company/supplier and see:
- Company name and logo
- Products supplied
- Purchase history
- Quantities purchased
- Purchase/base cost
- Total purchased amount
- Total paid
- Current payable
- Supplier payment history
- Related inventory history

Supplier financial information is Admin-only.

## 20. Employee Management

- Admin can create employees.
- Admin can edit employee details.
- Admin can manage access.
- Admin can deactivate employees.
- Employee accounts should not be hard-deleted when they leave.
- Historical sales and transactions remain connected to the inactive employee.
- Inactive employees remain available in historical reporting.

## 21. Record Integrity and Deletion

Completed financial, sales, purchase, payment, return, and inventory movement records should not be hard-deleted.

- Sales: preserve history.
- Payments: preserve history.
- Purchases: preserve history.
- Stock movements: preserve history.
- Returns: preserve history.
- Adjustments: preserve history.
- Corrections should use cancellation, reversal, return, or adjustment mechanisms.
- **`[UPDATED v1.1]`** Voided sales (see §35.2) follow this same rule: a void does not delete the sale record — it reverses inventory/financial effect and flags the record as **Voided**, fully preserved and auditable.

## 22. Reporting and Filters

Admin reporting should provide full visibility without requiring the user to manually cross-reference records.

- Date / custom date range
- Employee
- Company/Supplier
- Product
- Category
- Customer
- Payment status
- Credit status

Employees may use the date-range filters for their own sales/customer activity, subject to their role permissions.

## 23. Information Architecture

**Recommended Admin navigation:**
- Dashboard
- Sales
- Customers
- Products
- Inventory
- Companies / Suppliers
- Purchases / Stock In
- Employees
- Payments
- Reports
- Settings

**Recommended Employee navigation:**
- Dashboard
- New Sale
- Sales
- Customers
- Products

> **`[UPDATED v1.1]`** See §37 for the fully expanded, screen-level navigation map covering both roles including the new enhancement screens.

## 24. Core Entity Relationships

```
Company/Supplier → Product → Product Variant/Unit → Inventory
Company/Supplier → Purchase/Stock-In → Supplier Payable → Supplier Payment
Customer → Sale → Payment → Customer Outstanding
Employee → Sale → Customer
Product/Inventory → Sale → Stock Deduction
Original Sale → Return → Inventory Adjustment + Customer Financial Adjustment
Original Sale → Void → Inventory Reversal + Customer Financial Reversal   [NEW v1.1]
```

## 25. Core Business Rules

- Selling a product automatically reduces the relevant inventory quantity.
- Returning a product automatically increases the relevant inventory quantity.
- Stock cannot become negative.
- Low-stock status is threshold-based and primarily visible in Inventory.
- Expired products are Not Sellable.
- Every sale is associated with a customer and employee.
- Every sale preserves the price effective at the time of sale.
- Customer outstanding is cumulative across unpaid transactions.
- Customer payments are permanent records.
- Supplier payable is cumulative across unpaid purchases.
- Supplier payments are permanent records.
- Admin can see purchase costs and profit; employees cannot.
- Admin can adjust inventory; employees cannot.
- Employee deactivation does not remove historical records.
- Completed records are not hard-deleted.
- **`[NEW v1.1]`** Only Admin can void a completed sale, and only within the configured void window (see §35.2).
- **`[NEW v1.1]`** A credit sale that would push a customer over their configured credit limit triggers a blocking warning; Admin can override, Employee requires Admin approval (see §38.1).

## 26. MVP Scope

**Required for MVP**
- Admin and Employee authentication
- Role-based permissions
- Employee creation/deactivation
- Company/Supplier management
- Product management
- Spray variants/pack sizes
- Seed per-KG pricing
- Base/purchase price
- Selling price
- Expiry date
- Inventory and stock-in
- Automatic stock deduction
- Low-stock status
- Out-of-stock status
- Expired/not-sellable status
- Stock adjustments
- Customer management
- Customer purchase history
- Customer payment history
- Customer credit
- Customer credit limit
- Supplier payable
- Supplier payments and payment history
- Sales creation
- Full and partial payment
- Employee sales tracking
- Admin sales analytics
- Gross profit reporting
- Date and business filters
- Basic returns if implementation remains manageable
- **`[NEW v1.1 — MVP]`** Sales History tabs (All/Credit/Paid) with summary widgets
- **`[NEW v1.1 — MVP]`** Cart quantity steppers + customer credit visibility in cart

## 27. Future / Pending

- Batch-level inventory where the same product/variant has different expiry dates.
- Advanced batch-level costing.
- Advanced return/exchange workflows.
- Additional product categories beyond Spray and Seed.
- More advanced supplier/vendor capabilities.
- **`[NEW v1.1 — under evaluation, not yet MVP-locked]`** Automated reorder purchase-order generation (Reorder Suggestions screen is MVP-visible as a read-only list; auto-generating a purchase order from it is future scope — see §35.6).
- Any additional functionality that is not required for the core retail loop.

## 28. UX / Product Design Principles

- Fast sales entry is the highest employee UX priority.
- Use clear retail/POS patterns rather than ERP-heavy workflows.
- Automate calculations wherever possible.
- Keep Admin financial information separate from Employee views.
- Make inventory alerts clear but avoid unnecessary global notification noise.
- Allow drill-down from summary metrics to underlying records.
- Keep transaction history traceable and auditable.
- Use clear statuses for paid, partial/credit, low stock, out of stock, expired, and payable/outstanding states.
- Design the system so future batch/expiry support can be introduced without redesigning the core data model.

## 29. End-to-End Business Flows

**Admin — Add Company**
Flow: Companies → Add Company → Name + Logo → Save

**Admin — Add Product**
Flow: Products → Add Product → Company → Category → Unit/Variant → Base Price → Selling Price → Initial/Stock Details → Expiry → Save

**Admin — Purchase / Stock-In**
Flow: Purchases/Stock In → Company → Product → Unit/Variant → Quantity → Base Price → Selling Price → Payment → Save → Inventory Increased + Supplier Payable Updated

**Employee/Admin — Sale** `[UPDATED v1.1: now shared by both roles]`
Flow: New Sale → Customer (credit balance visible) → Product → Variant/Unit → Quantity (stepper) → Review → Payment → Complete → Inventory Reduced + Customer Balance Updated + Sale Recorded

**Customer — Credit Payment**
Flow: Customer → Outstanding → Record Payment → Balance Reduced → Permanent Payment History

**Supplier — Payment**
Flow: Company/Supplier → Payable → Record Payment → Payable Reduced → Permanent Payment History

**Return**
Flow: Original Sale → Product → Return Quantity → Refund OR Credit Adjustment → Confirm → Inventory Increased + Customer Balance Updated + Return Recorded

**Inventory Adjustment**
Flow: Inventory → Product → Adjust Stock → Reason → Confirm → Permanent Stock Movement

**`[NEW v1.1]` Void Sale**
Flow: Sale Detail → Void Sale → Confirm Reason → Inventory Reversed + Customer Balance Reversed + Sale Marked Voided (preserved, not deleted)

**`[NEW v1.1]` Daily Cash Reconciliation**
Flow: Admin → Daily Cash → Select Date → System Shows Expected Cash (Paid Sales − Refunds) → Admin Enters Counted Cash → System Shows Variance → Confirm/Save

## 30. Success Criteria

The shop should be able to operate its core business without separate manual records for inventory, sales, customer purchases, customer credit, customer payments, supplier purchases, supplier payments, supplier payables, expiry monitoring, low-stock monitoring, employee performance, and gross profit.

The Admin should be able to answer: What did we sell today? Who sold it? Who bought it? What products were sold? How much was paid? How much customer credit remains? How much do we owe suppliers? What stock is running low? What products are expiring? How much gross profit was generated? Which employees and companies/products are performing best?

## 31. Final Product Definition

The final product is a role-based Agri Retail Management System connecting Companies/Suppliers, Products, Product Variants/Units, Inventory, Purchases, Sales, Customers, Payments, Customer Credit, Supplier Payables, Profit, and Employee Performance with complete historical transaction tracking.

The Shop Owner receives complete business visibility and control. Employees receive a fast and simple sales/customer-management experience. The system should be simple enough for daily operation in a small shop while remaining extensible for future batch-level inventory, advanced expiry management, additional categories, and more sophisticated workflows.

## 32. Requirements Locked for AI Design / Build

The following decisions are explicitly finalized and should not be inferred differently by an AI design/build tool:

- Company = Supplier = Manufacturer in the initial data model.
- Initial product categories are Spray and Seed.
- Sprays use pack-size variants such as 1L, 500ml, and 200ml.
- Seed pricing is based on a fixed per-KG rate.
- Inventory is tracked by sellable product/variant/measurement.
- Admin adds and manages products and stock.
- Employees do not manage products, prices, suppliers, stock adjustments, purchase cost, or profit.
- Customer financial visibility is shop-wide for employees, but Admin-only sensitive business data remains hidden.
- Customer credit limit is configurable by Admin.
- Supplier payable is tracked similarly to customer outstanding credit.
- Supplier and customer payment histories are permanent transaction histories.
- Gross profit is Admin-only and supports historical/custom reporting.
- Selling price changes apply to current/future sales while historical sales retain their original price.
- Existing stock's recorded base cost is not retroactively changed; new stock can have a different base cost.
- Returns originate from original sales and can result in a refund or credit adjustment.
- Inventory adjustments are Admin-only and require a reason.
- Expired stock is retained for reconciliation but is not sellable.
- Employee accounts are deactivated rather than deleted; historical records remain intact.
- Financial and inventory records are not hard-deleted.
- Batch-wise expiry is explicitly pending/future and should not complicate the initial MVP.
- **`[NEW v1.1 — LOCKED]`** Admin has full parity with Employee for the New Sale and Record Payment actions.
- **`[NEW v1.1 — LOCKED]`** Sales lists are organized into All / Credit / Paid tabs everywhere sales history is shown.
- **`[NEW v1.1 — LOCKED]`** Cart quantity of 1, decremented once more, removes the line item rather than allowing a 0-quantity line.
- **`[NEW v1.1 — LOCKED]`** Voiding a sale is Admin-only and never hard-deletes the record.

## 33. AI Design / Build Instruction

Use this PRD as the source of truth for designing the application. Derive the necessary screens, navigation, components, forms, states, tables, dashboards, detail views, confirmations, empty states, loading states, validation states, success/error states, and responsive layouts from the requirements above.

Do not invent business rules that conflict with this document. Where the PRD intentionally leaves a UI detail open, choose the simplest professional retail/POS UX that preserves the defined roles, financial relationships, inventory behavior, historical records, and permissions.

Prioritize the complete end-to-end flows over isolated screens. The final design should make it possible to move from dashboard summaries into the underlying sale, customer, product, inventory, employee, company/supplier, payment, and historical records.

Keep the MVP operationally simple while preserving an extensible architecture for pending batch-level expiry and future product categories.

---

# PART II — v1.1 Enhancement Detail

## 34. Enhancement Specifications

### 34.1 Dashboard Metric Change — Paid / Credit replaces Customers Served
**Applies to:** Employee Dashboard (§17), Admin Dashboard (§18)

- Remove the "Customers Served" tile.
- Add a single combined tile split into two values: **Paid** (count + Rs. amount of fully-paid sales in the period) and **Credit** (count + Rs. amount of partial/credit sales in the period).
- Tapping either half deep-links into Sales History pre-filtered to the matching tab (Paid or Credit — see §34.2).
- Rationale: a raw customer count doesn't tell staff or Admin how healthy today's cash position is; Paid/Credit does, at a glance.

### 34.2 Sales History Tabs — All / Credit / Paid
**Applies to:** Sales module, both roles

- Sales History (and any sale list view) gets three tabs: **All**, **Credit**, **Paid**.
- Each tab has its own summary widget row above the list: total sale count, total amount, and (Credit tab only) total outstanding across the filtered set.
- Tab state persists per session but resets to "All" on fresh navigation into Sales from the main nav.
- Existing date-range and other filters (§22) apply within whichever tab is active.

### 34.3 Cart Quantity Counters
**Applies to:** New Sale flow (§12)

- Each product line in the cart shows a **−  qty  +** stepper instead of a manual quantity re-entry.
- Tapping **+** increases by 1 (bounded by available stock — cannot exceed sellable inventory).
- Tapping **−** at quantity 1 removes the line item immediately (with a brief undo affordance), rather than allowing the line to sit at 0.
- Manual numeric entry remains available for larger quantities (e.g. bulk seed kg) via tap-to-edit on the quantity value.

### 34.4 Customer Credit Info in Cart Header
**Applies to:** New Sale flow (§12), once a customer is selected

- Cart header shows the selected customer's name plus their **current outstanding balance** and, if set, their **credit limit**.
- If the in-progress sale would push the customer over their credit limit, the header shows a warning state (see §38.1 for the exact rule).
- This is visible to both Admin and Employee, consistent with §10 (customer financial history is shop-wide, not Admin-only).

### 34.5 Admin Can Generate Sales
**Applies to:** Admin navigation, Sales module

- Admin navigation (§23) gains two quick-action entry points: **New Sale** and **Record Payment**, available from the Admin Dashboard and the Sales module, matching the Employee entry points.
- The underlying New Sale and Record Payment flows are shared components between roles — no separate Admin-only version. Role only affects what surrounding data (e.g. cost/profit) is visible elsewhere in the app, not the sale-entry flow itself.

### 34.6 Seven New Enhancement Screens
**Applies to:** New module additions

| Screen | Role | Purpose |
|---|---|---|
| Daily Cash Reconciliation | Admin | Compare expected cash (paid sales − refunds) against physically counted cash for a given day; records variance. |
| Void Sale (confirmation) | Admin | Reverse a completed sale's inventory and financial effect; requires a reason; sale record preserved and flagged Voided. |
| Receipt / Print Preview | Admin + Employee | Preview and print/share a formatted receipt for a completed sale. |
| Reorder Suggestions | Admin | Read-only list of products at or below their low-stock threshold, ranked by urgency, to inform the next purchase/stock-in. |
| Sale Void — Reason Capture | Admin | Sub-step of Void Sale capturing a required reason before the reversal is committed. |
| Cash Reconciliation History | Admin | Historical log of past daily cash reconciliations and their variances. |
| Return Confirmation (Refund vs Credit) | Admin + Employee | Final confirmation step of the Return flow (§15) showing the financial outcome before committing. |

## 35. New Enhancement Screen Detail

### 35.1 Daily Cash Reconciliation — Admin only
Flow: Admin → Daily Cash → Select Date → System calculates Expected Cash = (Paid Sales − Refunds paid in cash) for that date → Admin enters Counted Cash → System displays Variance (Counted − Expected) → Admin confirms → Record saved permanently to Cash Reconciliation History (§35.7).

### 35.2 Void Sale — Admin only
- Available from Sale Detail, only for sales within the configured void window (e.g. same business day — exact window is a Settings-configurable value).
- Requires a reason (dropdown: Entry Error, Duplicate Sale, Customer Cancelled, Other).
- On confirm: inventory is restored, customer balance is reversed, the sale is flagged **Voided** and excluded from active sales totals but remains fully visible in history — consistent with §21's no-hard-delete rule.
- Employees cannot initiate a void; they can flag a sale for Admin review (routes to Admin's Sales list, Credit or All tab, with a "Flagged" indicator).

### 35.3 Receipt / Print Preview
- Generated from Sale Confirmation or Sale Detail.
- Shows itemized lines, quantities, prices, totals, amount paid, outstanding (if any), customer name, employee name, date/time, and shop details.
- Share/print action; does not alter any record.

### 35.4 Reorder Suggestions
- Read-only in MVP (per §27, auto-PO generation is future scope).
- Pulls from Inventory (§7.1) any item at or below its configured low-stock threshold, sorted by how far below threshold / days-to-stockout.
- Each row deep-links to Purchase/Stock-In (§8) pre-filled with that product, so Admin can act on it immediately even though the suggestion itself doesn't auto-generate a PO.

### 35.5 Cash Reconciliation History
- List of past Daily Cash Reconciliation records, filterable by date range.
- Each row shows date, expected, counted, variance, and who reconciled it.

### 35.6 Return Confirmation
- Final step of the existing Return flow (§15); previously implicit in "Confirm," now specified as its own screen so the financial outcome (refund amount vs. credit-adjustment amount) is shown clearly before commit.

## 36. Complete Screen Inventory

> Screen IDs below use the scheme `[ROLE]-[###]` (A = Admin, E = Employee, S = Shared) for traceability in design/build tooling. If this PRD is later linked to a live Figma file, these IDs should be mapped 1:1 to actual Figma node IDs during the design handoff — no such file was provided as input to this document, so IDs here are a build-tool reference scheme rather than live Figma references.

### Auth & Onboarding (3)
| ID | Screen |
|---|---|
| S-001 | Splash / App Load |
| S-002 | Login |
| S-003 | Forgot Password |

### Dashboards (2)
| ID | Screen |
|---|---|
| A-004 | Admin Dashboard (incl. New Sale / Record Payment quick actions) |
| E-005 | Employee Dashboard (Paid/Credit tile) |

### Sales (10 — shared between roles)
| ID | Screen |
|---|---|
| S-006 | Sales History — All tab |
| S-007 | Sales History — Credit tab |
| S-008 | Sales History — Paid tab |
| S-009 | Sale Detail |
| S-010 | New Sale — Select Customer (credit balance shown) |
| S-011 | New Sale — Select Product / Variant |
| S-012 | New Sale — Cart / Review (qty steppers, credit header) |
| S-013 | New Sale — Payment Entry |
| S-014 | Sale Confirmation |
| S-015 | Record Payment (existing sale / customer outstanding) |

### Customers (7)
| ID | Screen |
|---|---|
| S-016 | Customer List |
| S-017 | Customer Detail (purchase + payment history, balance, credit limit) |
| S-018 | Add / Edit Customer |
| S-019 | Customer Purchase History (expanded) |
| S-020 | Customer Payment History (expanded) |
| A-021 | Edit Customer Credit Limit (Admin only) |
| S-022 | Record Customer Payment |

### Products (6)
| ID | Screen |
|---|---|
| S-023 | Product List (search/filter by category, company) |
| S-024 | Product Detail |
| A-025 | Add / Edit Product — Spray (variants/pack sizes) |
| A-026 | Add / Edit Product — Seed (per-KG rate) |
| A-027 | Product Variant Management |
| S-028 | Product Search / Filter results |

### Inventory (7)
| ID | Screen |
|---|---|
| A-029 | Inventory List |
| A-030 | Inventory Item Detail |
| A-031 | Stock Adjustment (reason required) |
| A-032 | Low Stock Alerts |
| A-033 | Expiry Alerts (approaching expiry) |
| A-034 | Expired Stock List (Not Sellable) |
| A-035 | Stock Movement History |

### Companies / Suppliers (6)
| ID | Screen |
|---|---|
| A-036 | Company / Supplier List |
| A-037 | Company / Supplier Detail |
| A-038 | Add / Edit Company |
| A-039 | Supplier Payable Overview |
| A-040 | Record Supplier Payment |
| A-041 | Supplier Payment History |

### Purchases / Stock-In (3)
| ID | Screen |
|---|---|
| A-042 | Purchase / Stock-In List |
| A-043 | New Purchase / Stock-In |
| A-044 | Purchase Detail |

### Employees (4)
| ID | Screen |
|---|---|
| A-045 | Employee List |
| A-046 | Employee Detail (incl. historical sales) |
| A-047 | Add / Edit Employee |
| A-048 | Deactivate Employee (confirmation) |

### Reports (3)
| ID | Screen |
|---|---|
| A-049 | Reports Home |
| A-050 | Gross Profit Report (period selectors) |
| A-051 | Drill-down Report (by Employee/Company/Product/Category/Customer/Date) |

### Returns (2)
| ID | Screen |
|---|---|
| S-052 | Return Flow — Select Sale / Product / Quantity |
| S-053 | Return Confirmation (Refund vs. Credit Adjustment) |

### Settings (2)
| ID | Screen |
|---|---|
| A-054 | Settings Home (thresholds: low stock, expiry window, void window) |
| A-055 | Role / Access Management |

### New Enhancement Screens (4 additional beyond those folded into Sales/Returns above)
| ID | Screen |
|---|---|
| A-056 | Daily Cash Reconciliation |
| A-057 | Void Sale (reason capture + confirm) |
| S-058 | Receipt / Print Preview |
| A-059 | Reorder Suggestions |

**Total: 59 screens.**

*(Cash Reconciliation History and the standalone Return Confirmation sub-step described narratively in §35 are represented within A-056 and S-053 respectively as states of those same screens, rather than separate entries, to keep the inventory at the agreed 59.)*

## 37. Navigation Map

### 37.1 Admin — Top-Level Navigation
```
Dashboard (A-004)
├── New Sale → S-010 → S-011 → S-012 → S-013 → S-014
├── Record Payment → S-015 or S-022
Sales (S-006 / S-007 / S-008 tabs)
├── Sale Detail (S-009)
│   ├── Receipt Preview (S-058)
│   └── Void Sale (A-057)
Customers (S-016)
├── Customer Detail (S-017)
│   ├── Purchase History (S-019)
│   ├── Payment History (S-020)
│   ├── Edit Credit Limit (A-021)
│   └── Record Payment (S-022)
Products (S-023)
├── Product Detail (S-024)
├── Add/Edit Spray (A-025) / Seed (A-026)
├── Variant Management (A-027)
Inventory (A-029)
├── Inventory Detail (A-030)
├── Stock Adjustment (A-031)
├── Low Stock Alerts (A-032)
├── Expiry Alerts (A-033)
├── Expired Stock (A-034)
├── Stock Movement History (A-035)
└── Reorder Suggestions (A-059) → deep-links to New Purchase (A-043)
Companies/Suppliers (A-036)
├── Company Detail (A-037)
├── Add/Edit Company (A-038)
├── Supplier Payable (A-039)
├── Record Supplier Payment (A-040)
└── Supplier Payment History (A-041)
Purchases/Stock In (A-042)
├── New Purchase (A-043)
└── Purchase Detail (A-044)
Employees (A-045)
├── Employee Detail (A-046)
├── Add/Edit Employee (A-047)
└── Deactivate Employee (A-048)
Reports (A-049)
├── Gross Profit (A-050)
└── Drill-down (A-051)
Daily Cash (A-056)
Settings (A-054)
└── Role/Access Management (A-055)
```

### 37.2 Employee — Top-Level Navigation
```
Dashboard (E-005)
├── Paid/Credit tile → Sales History (S-007 or S-008, pre-filtered)
New Sale → S-010 → S-011 → S-012 → S-013 → S-014
Sales (S-006 / S-007 / S-008 tabs)
├── Sale Detail (S-009)
│   ├── Receipt Preview (S-058)
│   └── Flag for Admin Review (routes to A-side Sales, no void access)
Customers (S-016)
├── Customer Detail (S-017)
│   ├── Purchase History (S-019)
│   ├── Payment History (S-020)
│   └── Record Payment (S-022)
Products (S-023, read-only)
├── Product Detail (S-024, read-only, no cost visible)
```

### 37.3 Cross-Cutting Flows
```
Return: S-009 (Sale Detail) → S-052 (Return Flow) → S-053 (Confirmation) → back to S-009
Void: S-009 → A-057 (reason) → confirm → S-009 (now flagged Voided)
Purchase → Supplier Payable: A-043 → A-039 auto-updates
Sale → Customer Balance: S-013 (Payment Entry) → S-017 auto-updates
```

## 38. Business Logic Additions

### 38.1 Credit Limit Warning Rule
- On the Cart screen (S-012), once a customer is selected and the running cart total would cause **(existing outstanding + this sale's unpaid portion) > customer's credit limit**, the cart header (§34.4) switches to a warning state.
- **Employee:** sees the warning, can still complete the sale by requesting Admin approval — an approval request is sent/flagged; the sale can be saved as **Pending Approval** or completed at Employee's discretion per the shop's chosen policy (Admin configures which in Settings — default is "warn but allow, log for Admin review").
- **Admin:** sees the same warning but can override and proceed directly, since Admin already has full authority over credit decisions (§3.1).
- The warning never blocks a **fully paid** line — it only applies to the unpaid/credit portion of the sale.
- If the customer has no credit limit configured, no warning is shown (unlimited by default, consistent with §10.2's original "Admin can define" — undefined means uncapped).

### 38.2 Sales History Tab & Dashboard Tile Filtering Rules
- **All tab:** every completed sale in the active date range, regardless of payment status. Voided sales are excluded from totals but shown with a "Voided" badge if included via a filter toggle.
- **Paid tab:** sales where `amount_paid == total_amount` at time of sale completion (§10.1 Full Payment). This tab's summary widget shows count and total revenue only — no outstanding figure, since by definition there is none.
- **Credit tab:** sales where `amount_paid < total_amount` (§10.1 Partial Payment/Credit). Summary widget shows count, total sale amount, total paid, and total outstanding across the filtered set.
- **Dashboard Paid/Credit tile (§34.1):** computed the same way, scoped to the dashboard's active period (default Today), independent of whichever tab was last open in Sales History.
- A sale that later gets fully settled via a separate payment (§10.3) does **not** retroactively move from Credit to Paid in this tab logic — the tabs reflect the sale's status *at completion*. The customer's live outstanding balance (updated via payments) remains the source of truth for current debt; the tabs are a transaction-level view, not a running-balance view. This preserves §21's rule that completed records aren't altered after the fact.

### 38.3 Cart Quantity Stepper Rules
- Minimum enforced quantity per line: 1. Decrementing from 1 removes the line (§34.3).
- Maximum per line: bounded by current sellable inventory for that exact variant (cannot oversell — consistent with §7's "inventory cannot become negative").
- For Seed (kg-based) lines, the stepper increments in a configurable default step (e.g. 0.5 kg or 1 kg, Admin-configurable in Settings) but always allows manual override to an exact decimal value.
- Removing the last line item in the cart returns the flow to product selection (S-011) rather than showing an empty cart state indefinitely.

### 38.4 Admin-Originated Sale Attribution
- When Admin uses the New Sale quick action (§34.5), the resulting sale record's "processed by" field records the Admin's own user account — Admin sales appear in Admin's own activity history exactly as an Employee's would, ensuring §14's employee-performance drill-down and §25's "every sale is associated with an employee" rule stay consistent (Admin is simply eligible to be that associated user too).

### 38.5 Void Window Rule
- Default void window: same business day as the original sale (Admin-configurable in Settings, §A-054).
- A sale outside the void window cannot be voided; the correction path is a Return (§15) instead.
- Voiding reverses the *entire* sale (all line items, all inventory, all financial effect) — a partial void is not supported in MVP; if only some items need correcting, use Return for those specific items instead.

---

*End of PRD v1.1. This document is intended as a direct input to AI-assisted design/build tooling — Sections 1–33 remain the binding baseline business rules, and Sections 34–38 are additive UX/workflow refinements that do not override any locked decision in §32.*
