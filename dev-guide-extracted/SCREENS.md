# Screen Inventory — Agri Shop Management System

All 59 screens with IDs, roles, navigation flows, and key data.
Node IDs to be filled in once Figma design file is shared.

---

## Screen ID Convention

Format: `[ROLE]-[MODULE]-[VIEW]`
- `AUTH` — unauthenticated
- `ADM` — Admin only
- `EMP` — Employee only
- `SHR` — Shared (role-dependent data visibility)

---

## Authentication (2 screens)

| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 1 | AUTH-LOGIN | Login / PIN Entry | — | Role detected after PIN; routes to Admin or Employee dashboard |
| 2 | AUTH-LOCKED | Session Locked / Re-authenticate | — | Appears after inactivity timeout |

---

## Admin Screens (38 screens)

### Dashboard (3)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 3 | ADM-DASH-HOME | Admin Dashboard | — | Default: Today. Metrics: Total Sales, Paid, Credit, Gross Profit, Outstanding, Supplier Payable, Low Stock, Expiring |
| 4 | ADM-DASH-DAILY-CASH | Daily Cash Summary | — | **Enhancement** — Breakdown of cash collected today vs outstanding |
| 5 | ADM-DASH-REPORTS | Reports / Analytics | — | Filter by date, employee, company, product, category, payment status |

### Sales (6)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 6 | ADM-SALES-LIST | Sales List | — | Tabs: All / Paid / Credit. Summary widgets per tab. Filter by date, employee, customer |
| 7 | ADM-SALES-DETAIL | Sale Detail | — | Full line items, payment info, employee, customer. Void Sale button (Admin only) |
| 8 | ADM-SALES-NEW | New Sale (Admin) | — | **Enhancement** — Admin can also create a sale. Same cart flow as Employee |
| 9 | ADM-SALES-VOID | Void Sale Confirmation | — | **Enhancement** — Reason required. Sale marked voided, inventory restored |
| 10 | ADM-SALES-RECEIPT | Sale Receipt / Print View | — | **Enhancement** — Printable receipt format |
| 11 | ADM-SALES-PAYMENT | Record Payment on Sale | — | **Enhancement** — Admin records payment against an existing credit sale |

### Customers (4)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 12 | ADM-CUST-LIST | Customers List | — | Search by name/phone. Shows outstanding badge |
| 13 | ADM-CUST-DETAIL | Customer Detail | — | Profile, purchase history, payment history, outstanding balance, credit limit |
| 14 | ADM-CUST-ADD | Add / Edit Customer | — | Name, phone, address, credit limit |
| 15 | ADM-CUST-PAYMENT | Record Customer Payment | — | Reduces outstanding. Creates permanent payment record |

### Products (4)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 16 | ADM-PROD-LIST | Products List | — | Filter by category, company. Search by name |
| 17 | ADM-PROD-DETAIL | Product Detail | — | Variants, current stock, selling prices, expiry status |
| 18 | ADM-PROD-ADD | Add Product | — | Company, category, name, variants (spray) or KG rate (seed), selling price, expiry |
| 19 | ADM-PROD-EDIT | Edit Product | — | Same form as Add. Cannot change category after creation |

### Inventory (5)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 20 | ADM-INV-LIST | Inventory List | — | Filter by status, category, company. Low stock / expiring highlighted |
| 21 | ADM-INV-DETAIL | Inventory Item Detail | — | Batch history, stock movements, expiry |
| 22 | ADM-INV-ADJUST | Stock Adjustment | — | Select variant, qty change, reason (Damaged/Missing/Expired/Manual/Other), confirm |
| 23 | ADM-INV-REORDER | Reorder Alerts | — | **Enhancement** — List of low-stock/out-of-stock items with reorder action |
| 24 | ADM-INV-EXPIRY | Expiry Monitor | — | Products expiring within warning window + already expired |

### Companies / Suppliers (4)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 25 | ADM-COMP-LIST | Companies List | — | Company name, logo, outstanding payable badge |
| 26 | ADM-COMP-DETAIL | Company Detail | — | Products supplied, purchase history, total paid, payable, payment history |
| 27 | ADM-COMP-ADD | Add / Edit Company | — | Name, logo, phone, address |
| 28 | ADM-COMP-PAYMENT | Record Supplier Payment | — | Reduces payable. Creates permanent payment record |

### Purchases / Stock-In (3)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 29 | ADM-PURCH-LIST | Purchases List | — | History of all stock-in events |
| 30 | ADM-PURCH-DETAIL | Purchase Detail | — | Company, product, qty, base price, selling price, payment recorded |
| 31 | ADM-PURCH-NEW | New Purchase / Stock-In | — | Full stock-in flow: company → product → variant → qty → base price → selling price → payment |

### Employees (4)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 32 | ADM-EMP-LIST | Employees List | — | Active/inactive toggle. Name, role, sales count |
| 33 | ADM-EMP-DETAIL | Employee Detail | — | Sales performance, transaction history, active status |
| 34 | ADM-EMP-ADD | Add / Edit Employee | — | Name, phone, role, PIN |
| 35 | ADM-EMP-DEACTIVATE | Deactivate Employee | — | Confirmation. Account deactivated, records preserved |

### Payments (2)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 36 | ADM-PAY-LIST | Payments List | — | All customer payments + supplier payments. Filter by type, date |
| 37 | ADM-PAY-DETAIL | Payment Detail | — | Individual payment record — customer or supplier |

### Reports (2)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 38 | ADM-RPT-SALES | Sales Report | — | Revenue, paid, credit, outstanding. Drill down by employee/company/product |
| 39 | ADM-RPT-PROFIT | Gross Profit Report | — | Admin-only. Profit by period, product, company |

### Settings (1)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 40 | ADM-SET-HOME | Settings | — | Low-stock threshold, expiry warning days, shop name, currency, default credit limit |

---

## Employee Screens (17 screens)

### Dashboard (2)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 41 | EMP-DASH-HOME | Employee Dashboard | — | Today's sales, transactions, customers served, paid/credit counts. No profit/supplier data |
| 42 | EMP-DASH-RANGE | Dashboard — Date Filter | — | Yesterday, This Week, This Month, Custom Range view |

### New Sale / Cart (6)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 43 | EMP-SALE-CART | Cart / New Sale | — | Customer header showing outstanding balance. Product search. Line items with qty counters (delete on qty=1 behavior) |
| 44 | EMP-SALE-CART-PRODUCT | Product Search / Picker | — | Search + filter by category/company. Shows stock status |
| 45 | EMP-SALE-CART-VARIANT | Variant / Unit Selector | — | Select pack size (spray) or enter KG (seed) |
| 46 | EMP-SALE-REVIEW | Sale Review | — | Full order summary before payment |
| 47 | EMP-SALE-PAYMENT | Payment Entry | — | Full / Partial / Credit. Amount paid input. Outstanding calculated |
| 48 | EMP-SALE-CONFIRM | Sale Complete / Success | — | Summary, receipt option |

### Sales History (3)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 49 | EMP-SALES-LIST | Sales List | — | **Enhancement** — Tabs: All / Credit / Paid. Summary widget per tab (total, count, amount) |
| 50 | EMP-SALES-DETAIL | Sale Detail | — | Line items, payment, customer. Employee sees their own sales + all customer history |
| 51 | EMP-SALES-RECEIPT | Sale Receipt | — | **Enhancement** — Printable receipt view |

### Customers (3)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 52 | EMP-CUST-LIST | Customers List | — | Search. Shows outstanding balance. Shop-wide visibility |
| 53 | EMP-CUST-DETAIL | Customer Detail | — | Purchase + payment history, outstanding. No supplier/profit data |
| 54 | EMP-CUST-ADD | Add Customer | — | Name, phone, address (no credit limit — Admin only) |

### Products (3)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 55 | EMP-PROD-LIST | Products List | — | Browse by category/company. No prices/costs — shows selling price only |
| 56 | EMP-PROD-DETAIL | Product Detail | — | Stock status, variants available. No purchase cost visible |
| 57 | EMP-PROD-SEARCH | Product Search | — | Inline search used within cart flow |

---

## Shared / Utility Screens (2)
| # | Screen ID | Screen Name | Figma Node ID | Notes |
|---|---|---|---|---|
| 58 | SHR-NOTIF | Notifications / Alerts | — | Low stock, expiring products (Admin sees all; Employee sees none by default) |
| 59 | SHR-EMPTY | Empty State | — | Reusable empty state pattern used across all list views |

---

## Navigation Map

### Admin Flow
```
LOGIN
 └── ADM-DASH-HOME
      ├── ADM-DASH-DAILY-CASH
      ├── ADM-DASH-REPORTS
      │
      ├── SALES ──────────────────────────────────────────────────
      │    ├── ADM-SALES-LIST (All/Paid/Credit tabs)
      │    │    └── ADM-SALES-DETAIL
      │    │         ├── ADM-SALES-VOID
      │    │         ├── ADM-SALES-RECEIPT
      │    │         └── ADM-SALES-PAYMENT (record payment)
      │    └── ADM-SALES-NEW (New Sale button)
      │         └── → same cart flow as employee
      │
      ├── CUSTOMERS ──────────────────────────────────────────────
      │    ├── ADM-CUST-LIST
      │    │    └── ADM-CUST-DETAIL
      │    │         └── ADM-CUST-PAYMENT
      │    └── ADM-CUST-ADD
      │
      ├── PRODUCTS ───────────────────────────────────────────────
      │    ├── ADM-PROD-LIST
      │    │    └── ADM-PROD-DETAIL
      │    │         └── ADM-PROD-EDIT
      │    └── ADM-PROD-ADD
      │
      ├── INVENTORY ──────────────────────────────────────────────
      │    ├── ADM-INV-LIST
      │    │    └── ADM-INV-DETAIL
      │    ├── ADM-INV-ADJUST
      │    ├── ADM-INV-REORDER
      │    └── ADM-INV-EXPIRY
      │
      ├── COMPANIES ──────────────────────────────────────────────
      │    ├── ADM-COMP-LIST
      │    │    └── ADM-COMP-DETAIL
      │    │         └── ADM-COMP-PAYMENT
      │    └── ADM-COMP-ADD
      │
      ├── PURCHASES ──────────────────────────────────────────────
      │    ├── ADM-PURCH-LIST
      │    │    └── ADM-PURCH-DETAIL
      │    └── ADM-PURCH-NEW
      │
      ├── EMPLOYEES ──────────────────────────────────────────────
      │    ├── ADM-EMP-LIST
      │    │    └── ADM-EMP-DETAIL
      │    │         └── ADM-EMP-DEACTIVATE
      │    └── ADM-EMP-ADD
      │
      ├── PAYMENTS ───────────────────────────────────────────────
      │    └── ADM-PAY-LIST
      │         └── ADM-PAY-DETAIL
      │
      ├── REPORTS ────────────────────────────────────────────────
      │    ├── ADM-RPT-SALES
      │    └── ADM-RPT-PROFIT
      │
      └── SETTINGS ───────────────────────────────────────────────
           └── ADM-SET-HOME
```

### Employee Flow
```
LOGIN
 └── EMP-DASH-HOME
      ├── EMP-DASH-RANGE
      │
      ├── NEW SALE ───────────────────────────────────────────────
      │    ├── EMP-SALE-CART
      │    │    ├── EMP-SALE-CART-PRODUCT (product picker)
      │    │    │    └── EMP-SALE-CART-VARIANT (variant/unit select)
      │    │    └── [cart header shows customer outstanding balance]
      │    ├── EMP-SALE-REVIEW
      │    ├── EMP-SALE-PAYMENT
      │    └── EMP-SALE-CONFIRM → EMP-SALES-RECEIPT (optional)
      │
      ├── SALES ──────────────────────────────────────────────────
      │    ├── EMP-SALES-LIST (All/Credit/Paid tabs + summary widgets)
      │    └── EMP-SALES-DETAIL
      │         └── EMP-SALES-RECEIPT
      │
      ├── CUSTOMERS ──────────────────────────────────────────────
      │    ├── EMP-CUST-LIST
      │    │    └── EMP-CUST-DETAIL
      │    └── EMP-CUST-ADD
      │
      └── PRODUCTS ───────────────────────────────────────────────
           ├── EMP-PROD-LIST
           └── EMP-PROD-DETAIL
```

---

## Enhancement Screens Summary

| Screen ID | Enhancement | Description |
|---|---|---|
| ADM-DASH-DAILY-CASH | Daily Cash Summary | Cash collected today vs outstanding |
| ADM-SALES-VOID | Void Sale | Admin-only. Reason required, inventory restored |
| ADM-SALES-RECEIPT | Receipt View | Printable receipt for any completed sale |
| ADM-SALES-PAYMENT | Record Payment | Admin records payment on existing credit sale |
| ADM-INV-REORDER | Reorder Alerts | List of items needing restock |
| EMP-SALES-LIST (tabs) | Sales History Tabs | All / Credit / Paid with summary widgets |
| EMP-SALE-CART | Cart Enhancements | Customer outstanding in header, qty counters with delete-on-1 |
