# Agri Shop Management System — PRD v1.0 (Final Baseline)

> Written product baseline for AI-assisted design and development.
> Authority hierarchy: `Agri_Shop_Management_PRD_Final.pdf` (see `PRD-1.md`) is
> the ultimate source; this document is the structured baseline derived from it.
> If they ever disagree, the PDF wins and this file is corrected.

| Field | Value |
|---|---|
| Product | Agri Shop Management System |
| Product Type | Internal Retail / POS + Inventory + Credit & Payables |
| Primary Users | Shop Owner / Admin and Shop Employees |
| Initial Categories | Sprays and Seeds |
| Version | 1.0 — Final Baseline |
| Status | Requirements aligned with finalized discussion |

---

## 1. Product Overview

Internal management application for a small agricultural retail shop (~3–4 employees). Sells agricultural products (initially sprays and seeds) from different companies treated as suppliers/manufacturers.

Combines: retail sales, inventory management, customer management, customer credit, supplier purchases and payables, payment histories, employee sales tracking, product expiry monitoring, stock alerts, and admin-only profitability reporting.

**Feel:** Simple, fast retail POS and inventory system — not a complex ERP.

---

## 2. Product Goals

- Maintain accurate inventory and stock movement
- Process customer sales quickly
- Automatically deduct sold quantities from inventory
- Track customer purchases, payments, credit, and outstanding balances
- Track supplier purchases, payments, and amounts payable
- Monitor product expiry and low-stock conditions
- Track employee sales performance
- Calculate and report gross profit to Admin
- Reduce manual calculations and manual record keeping
- Give the Shop Owner complete operational and financial visibility

---

## 3. Users and Permissions

### 3.1 Shop Owner / Admin
- Full access: products, inventory, companies/suppliers, purchases, sales, customers, employees, payments, returns, adjustments, reports, settings
- Can add/manage products and companies/suppliers
- Can add stock and record purchases
- Can manage selling prices and product information
- Can manage employees and deactivate employee accounts
- Can view supplier purchase cost, supplier payable, payment history, and shop profit
- Can view all customer financial information and all employee activity
- Can manually adjust inventory with a recorded reason

### 3.2 Employee
- Primary responsibility: sales and customer operations
- Can create sales, select products/variants, record quantities/payments, handle customer-related operations
- Can view customers, their purchase history, payment history, total purchased amount, total paid, and total outstanding balance
- All employees have customer visibility across the shop (not restricted to their own sales)
- **Cannot:** add/modify products, change product prices, add/manage companies or suppliers, view supplier financial information, view base/purchase cost or gross profit, manually adjust inventory, perform administrative controls

---

## 4. Company / Supplier Model

Company = Supplier = Manufacturer (same entity, no separate model).

Fields:
- Company name
- Company logo
- Products supplied
- Purchase history
- Quantities supplied
- Purchase cost
- Total paid
- Outstanding payable
- Supplier payment history

Employees may see company/product info needed for sales; supplier financial info is Admin-only.

---

## 5. Product Management

- Admin creates and manages products
- Every product belongs to a company/supplier
- Initial categories: **Spray** and **Seed**
- Category model must be extensible for future agricultural categories
- Products must be searchable and filterable by category and company/supplier
- Product details must support the appropriate measurement/pricing model for its category

---

## 6. Product Units, Variants and Pricing

### 6.1 Spray
- Sold as pack-size variants; inventory tracked separately per sellable variant
- Examples: 1 Liter, 500ml, 200ml
- Each variant has its own sellable quantity and current selling price
- Example: Janja Spray — 1L: 20 units; 500ml: 35 units; 200ml: 10 units
- Selling 3 × 500ml reduces only the 500ml stock
- Admin can calculate proportional prices from base pack size but must be able to define/override actual selling price per variant
- Business does not require smaller packs to always have mathematically proportional retail pricing

### 6.2 Seed
- Fixed price-per-kilogram model
- Example: Rs. 1,000/kg → 10kg = Rs. 10,000; 500g = Rs. 500
- System calculates sale amount from quantity × configured per-KG rate
- Seed pricing is NOT treated like arbitrary spray pack variants

---

## 7. Inventory Management

- Admin adds stock through a stock-in/purchase workflow
- Inventory tracked at the **product/variant/measurement** level
- Records: quantity, base/purchase price, selling price, expiry date, stock status
- Completed sales automatically reduce inventory
- Approved returns automatically increase inventory
- Admin stock adjustments update inventory and create a permanent adjustment record
- **Inventory cannot become negative**

### 7.1 Stock Status
| Status | Meaning |
|---|---|
| In Stock | Normal sellable stock |
| Limited Stock | Getting low |
| Low Stock | Below configured threshold |
| Out of Stock | Zero quantity |
| Expired | Past expiry date |
| Not Sellable | Marked as not available |

Low-stock thresholds are configurable. Warnings primarily visible in Inventory, not repeated across every screen.

### 7.2 Expiry
- Applicable products have an expiry date
- System surfaces products approaching expiry and expired products
- Expired stock remains represented for accurate reconciliation but is marked Expired / Not Sellable
- Expired stock must not be available for normal sale
- Expiry warning window is configurable

### 7.3 Batch-wise Expiry — Pending / Future
Same product/variant may eventually have multiple batches with different expiry dates. Architecture must remain extensible to support batch-level stock and expiry without rebuilding the core product.

---

## 8. Stock Purchase / Stock-In

**Flow:** Admin → Purchase/Stock In → Select Company/Supplier → Select Product → Select Unit/Variant → Enter Quantity → Enter Base/Purchase Price → Enter Selling Price → Record Payment → Save

- System adds purchased quantity to inventory
- Separately records supplier's financial position
- Example: 100 units × Rs. 2,000 base price = Rs. 200,000 purchase cost. If Rs. 100,000 is paid, inventory still receives all 100 units and supplier payable becomes Rs. 100,000.

---

## 9. Supplier Payables and Payments

Mirrors the customer-credit concept in the opposite direction (shop owes supplier when purchase is unpaid).

- Existing payable + new unpaid purchase = new cumulative payable
- Supplier payments reduce payable
- Every supplier payment is permanently recorded
- Supplier history shows purchases, amounts, payments, and remaining payable

**Flow:** Supplier → Outstanding → Record Payment → Payable Reduced → Permanent Payment History

Example: Previous payable Rs. 300,000; payment Rs. 50,000; remaining payable Rs. 250,000.

---

## 10. Customer Management and Credit

Customer profile fields:
- Name, phone number, address
- Purchase history, payment history
- Total purchases, total paid, outstanding amount
- Credit limit

Rules:
- All employees can access the customer's complete shop-wide financial history
- Employees cannot access Admin-only supplier cost/profit information
- Customer can have multiple outstanding sales/credit transactions
- Customer-level outstanding = cumulative unpaid amount

### 10.1 Payment Types
- **Full Payment:** total paid = total sale amount; outstanding = zero
- **Partial Payment / Credit:** amount paid < total; system calculates outstanding automatically

### 10.2 Credit Limit
Admin can define a credit limit per customer. If a new credit transaction would exceed the limit, system warns the user and applies the configured permission/business rule.

### 10.3 Credit Settlement
A later customer payment creates a new permanent payment record and reduces outstanding balance. System must NOT overwrite historical transactions.

---

## 11. Customer Financial History

Full transaction trail preserved. Each sale/payment context allows the user to understand:
- What was purchased
- How much it cost
- How much was paid
- What remained outstanding
- When it occurred
- Which employee processed the original sale

New payment → new transaction/history record → updates customer's current balance.

---

## 12. Sales Management

**Flow:** Employee → Select Customer → Select Product → Select Variant/Unit → Enter Quantity → Review Sale → Select Payment Type → Enter Amount Paid → Complete Sale

- A sale may contain multiple products
- System calculates line totals and overall total automatically
- System calculates amount paid and outstanding automatically
- Every sale records: customer, employee, products, quantities, prices, payment information, date/time
- Completed sale automatically updates inventory and customer financial state

### 12.1 Historical Price Rule
Historical sales retain the selling price that was effective at the time of the sale. A later selling-price change must never recalculate old sales.

---

## 13. Price and Cost Rules

- Base/purchase price is Admin-only
- Employees never see purchase cost
- Existing stock keeps its recorded base/purchase cost (not retroactively changed)
- A new stock purchase may have a different base cost
- Selling price can change over time by effective date
- Remaining inventory uses the current applicable selling price
- Historical sales preserve their original selling price

Example: Old stock cost Rs. 4,000, sold at Rs. 5,000. Later selling price becomes Rs. 5,500. Existing historical sales remain at Rs. 5,000. New sales use Rs. 5,500. A future stock purchase can have a different base cost.

---

## 14. Gross Profit and Admin Reporting

**Gross Profit = Sales Revenue − Cost of Goods Sold** (Admin-only)

Reporting periods:
- Today / Yesterday / This Week / This Month / Previous Month
- Multiple-month periods / Six-month period / One-year period / Custom date range

Admin can drill into sales by: employee, company/supplier, product, category, customer, payment status, and date range.
Example: Employee A → Janja → August → Spray

---

## 15. Returns and Refunds

Returns must originate from an original completed sale. Employee cannot create an arbitrary return for a product the customer did not purchase.

**Flow:** Original Sale → Select Product → Return Quantity → Verify Customer/Transaction → Choose Refund or Credit Adjustment → Confirm

Rules:
- Return quantity cannot exceed the quantity originally sold/eligible for return
- Inventory is increased by the approved returned quantity
- Customer financial balance is updated automatically
- **Refund option:** returns money to the customer
- **Credit Adjustment option:** applies return value against the customer's outstanding balance
- Original sale remains intact; return is recorded as a separate transaction

Basic return functionality is preferred for MVP if implementation remains manageable. Advanced exchange/complex refund workflows are future scope.

---

## 16. Inventory Adjustment

Admin can manually adjust stock only through a recorded adjustment workflow.

Adjustment reasons:
- Damaged
- Missing
- Expired
- Manual Correction
- Other

Each adjustment must record: quantity change, reason, date/time, responsible Admin/user. System must not silently change stock.

---

## 17. Employee Dashboard

Operational focus — not financial/profit focused.

Shows:
- Today's total sales
- Number of transactions
- Customers served
- Products sold
- Quantities sold
- Paid sales / Credit sales
- Relevant outstanding credit/customer activity
- Sales history

Filters: Today, Yesterday, This Week, This Month, Custom Range.

Employee can access customer details and complete customer history but **cannot** access supplier costs, supplier payable, or profit.

---

## 18. Admin Dashboard

Complete shop-wide visibility. Default period: Today, with date/range controls.

Shows:
- Total sales / Number of transactions
- Paid sales / Credit sales
- Outstanding customer credit
- Gross profit
- Employee-wise sales
- Company/supplier-wise sales
- Product/category performance
- Customer activity
- Low-stock products / Out-of-stock products / Expiring/expired products
- Supplier payable

Recommended filters: Date/date range, Employee, Company/Supplier, Product, Category, Customer, Payment Status, Credit Status.

---

## 19. Company / Supplier Detail

Admin can open a company/supplier and see:
- Company name and logo
- Products supplied
- Purchase history / Quantities purchased
- Purchase/base cost / Total purchased amount
- Total paid / Current payable
- Supplier payment history
- Related inventory history

Supplier financial information is Admin-only.

---

## 20. Employee Management

- Admin can create, edit, and manage employee access
- Admin can deactivate employees
- Employee accounts must NOT be hard-deleted when they leave
- Historical sales and transactions remain connected to the inactive employee
- Inactive employees remain available in historical reporting

---

## 21. Record Integrity and Deletion

Completed financial, sales, purchase, payment, return, and inventory movement records must NOT be hard-deleted.

Preserved permanently:
- Sales, Payments, Purchases, Stock movements, Returns, Adjustments

Corrections use: cancellation, reversal, return, or adjustment mechanisms.

---

## 22. Reporting and Filters

Admin reporting provides full visibility without requiring manual cross-referencing.

Filters:
- Date / custom date range
- Employee
- Company/Supplier
- Product
- Category
- Customer
- Payment status
- Credit status

Employees may use date-range filters for their own sales/customer activity (subject to role permissions).

---

## 23. Information Architecture

### Admin Navigation
Dashboard · Sales · Customers · Products · Inventory · Companies/Suppliers · Purchases/Stock In · Employees · Payments · Reports · Settings

### Employee Navigation
Dashboard · New Sale · Sales · Customers · Products

---

## 24. Core Entity Relationships

```
Company/Supplier → Product → Product Variant/Unit → Inventory
Company/Supplier → Purchase/Stock-In → Supplier Payable → Supplier Payment
Customer → Sale → Payment → Customer Outstanding
Employee → Sale → Customer
Product/Inventory → Sale → Stock Deduction
Original Sale → Return → Inventory Adjustment + Customer Financial Adjustment
```

---

## 25. Core Business Rules

1. Selling a product automatically reduces the relevant inventory quantity
2. Returning a product automatically increases the relevant inventory quantity
3. Stock cannot become negative
4. Low-stock status is threshold-based and primarily visible in Inventory
5. Expired products are Not Sellable
6. Every sale is associated with a customer and employee
7. Every sale preserves the price effective at the time of sale
8. Customer outstanding is cumulative across unpaid transactions
9. Customer payments are permanent records
10. Supplier payable is cumulative across unpaid purchases
11. Supplier payments are permanent records
12. Admin can see purchase costs and profit; employees cannot
13. Admin can adjust inventory; employees cannot
14. Employee deactivation does not remove historical records
15. Completed records are not hard-deleted

---

## 26. MVP Scope

### Required for MVP
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
- Low-stock / Out-of-stock / Expired/not-sellable status
- Stock adjustments
- Customer management
- Customer purchase history / payment history / credit / credit limit
- Supplier payable / payments / payment history
- Sales creation (full and partial payment)
- Employee sales tracking
- Admin sales analytics and gross profit reporting
- Date and business filters
- Basic returns (if implementation remains manageable)

---

## 27. Future / Pending (Out of MVP Scope)

- Batch-level inventory (same product/variant with different expiry dates)
- Advanced batch-level costing
- Advanced return/exchange workflows
- Additional product categories beyond Spray and Seed
- More advanced supplier/vendor capabilities
- Any additional functionality not required for the core retail loop

---

## 28. UX / Product Design Principles

- Fast sales entry is the highest employee UX priority
- Use clear retail/POS patterns rather than ERP-heavy workflows
- Automate calculations wherever possible
- Keep Admin financial information separate from Employee views
- Make inventory alerts clear but avoid unnecessary global notification noise
- Allow drill-down from summary metrics to underlying records
- Keep transaction history traceable and auditable
- Use clear statuses for: paid, partial/credit, low stock, out of stock, expired, payable/outstanding
- Design so future batch/expiry support can be introduced without redesigning the core data model

---

## 29. End-to-End Business Flows

| Flow | Steps |
|---|---|
| **Admin — Add Company** | Companies → Add Company → Name + Logo → Save |
| **Admin — Add Product** | Products → Add Product → Company → Category → Unit/Variant → Base Price → Selling Price → Initial Stock Details → Expiry → Save |
| **Admin — Purchase/Stock-In** | Purchases/Stock In → Company → Product → Unit/Variant → Quantity → Base Price → Selling Price → Payment → Save → Inventory Increased + Supplier Payable Updated |
| **Employee — Sale** | New Sale → Customer → Product → Variant/Unit → Quantity → Review → Payment → Complete → Inventory Reduced + Customer Balance Updated + Employee Sale Recorded |
| **Customer — Credit Payment** | Customer → Outstanding → Record Payment → Balance Reduced → Permanent Payment History |
| **Supplier — Payment** | Company/Supplier → Payable → Record Payment → Payable Reduced → Permanent Payment History |
| **Return** | Original Sale → Product → Return Quantity → Refund OR Credit Adjustment → Confirm → Inventory Increased + Customer Balance Updated + Return Recorded |
| **Inventory Adjustment** | Inventory → Product → Adjust Stock → Reason → Confirm → Permanent Stock Movement |

---

## 30. Success Criteria

The shop should be able to operate its core business without separate manual records for: inventory, sales, customer purchases, customer credit, customer payments, supplier purchases, supplier payments, supplier payables, expiry monitoring, low-stock monitoring, employee performance, and gross profit.

The Admin should be able to answer:
- What did we sell today? Who sold it? Who bought it?
- What products were sold? How much was paid?
- How much do we owe suppliers?
- What stock is running low? What products are expiring?
- How much gross profit was generated?
- Which employees and companies/products are performing best?

---

## 31. Final Product Definition

A role-based Agri Retail Management System connecting:
Companies/Suppliers → Products → Product Variants/Units → Inventory → Purchases → Sales → Customers → Payments → Customer Credit → Supplier Payables → Profit → Employee Performance with complete historical transaction tracking.

- **Shop Owner:** complete business visibility and control
- **Employees:** fast and simple sales/customer-management experience
- **Architecture:** simple enough for daily operation in a small shop; extensible for future batch-level inventory, advanced expiry management, additional categories, and more sophisticated workflows

---

## 32. Requirements Locked for AI Design / Build

These decisions are explicitly finalized — do not infer differently:

- Company = Supplier = Manufacturer in the initial data model
- Initial product categories are Spray and Seed
- Sprays use pack-size variants (1L, 500ml, 200ml)
- Seed pricing is based on a fixed per-KG rate
- Inventory is tracked by sellable product/variant/measurement
- Admin adds and manages products and stock
- Employees do not manage products, prices, suppliers, stock adjustments, purchase cost, or profit
- Customer financial visibility is shop-wide for employees, but Admin-only sensitive business data remains hidden
- Customer credit limit is configurable by Admin
- Supplier payable is tracked similarly to customer outstanding credit
- Supplier and customer payment histories are permanent transaction histories
- Gross profit is Admin-only and supports historical/custom reporting
- Selling price changes apply to current/future sales while historical sales retain their original price
- Existing stock's recorded base cost is not retroactively changed; new stock can have a different base cost
- Returns originate from original sales and can result in a refund or credit adjustment
- Inventory adjustments are Admin-only and require a reason
- Expired stock is retained for reconciliation but is not sellable
- Employee accounts are deactivated rather than deleted; historical records remain intact
- Financial and inventory records are not hard-deleted
- Batch-wise expiry is explicitly pending/future and must not complicate the initial MVP

---

## 33. AI Design / Build Instruction

Use this PRD as the source of truth for designing the application. Derive the necessary screens, navigation, components, forms, states, tables, dashboards, detail views, confirmations, empty states, loading states, validation states, success/error states, and responsive layouts from the requirements above.

Do not invent business rules that conflict with this document. Where the PRD intentionally leaves a UI detail open, choose the simplest professional retail/POS UX that preserves the defined roles, financial relationships, inventory behavior, historical records, and permissions.

Prioritize the complete end-to-end flows over isolated screens. The final design should make it possible to move from dashboard summaries into the underlying sale, customer, product, inventory, employee, company/supplier, payment, and historical records.

Keep the MVP operationally simple while preserving an extensible architecture for pending batch-level expiry and future product categories.
