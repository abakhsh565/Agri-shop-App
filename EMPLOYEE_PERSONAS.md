# Employee personas and role-specific workspaces

This document records the employee personas implemented in the app, the work each can actually
do, and the dashboard/navigation each receives. It is a map of **implemented capabilities**, not a
wish list. Payroll, attendance, HR records and approval engines are not present and are not
pretended to be.

## 1. One Employee account, many role-driven workspaces

Every persona below is an **Employee**. There is no separate Sales login, Finance login or
Inventory login. The active membership and the role assigned in the active branch decide the
experience:

```text
membership → active branch → branch role (membership_branch_roles)
           → role_permissions → effective permissions
           → role_dashboards → get_my_dashboards()
           → individual user_permissions overrides
           → dashboard + navigation
```

The owner remains the only authority that grants a permission. A template is recommendation
metadata under `src/lib/roleTemplates.ts`; saving a template creates a separate business-owned
role. Department, category, level and role name never grant anything by themselves.

## 2. What the employee experience resolves

- **Primary workspace** — `src/lib/employeeWorkspace.ts` chooses the first tab from the work the
  role can do: sell → stock work → purchasing → finance → customers → team. It is shared by the
  employee tab bar and the dashboard.
- **Dashboard** — the selected widget keys are filtered by the database against effective
  permissions, then drawn only when their data permission is also present.
- **Navigation** — sales, products, customers, purchases, finance and team appear only when their
  read permission is held. The More hub adds suppliers, reports, activity and account screens.
- **Data scope** — sales, stock, customers and purchases are read in the active branch. Switching
  branches reloads the scoped stores and re-reads effective permissions, so a different branch
  role produces a different tab bar, dashboard and direct-URL decision.
- **No record is written by a dashboard.** The dashboard is a read surface; the existing RPCs and
  permission guards remain the only write path.

## 3. Persona matrix

| Persona | Department / level | Primary workspace | Daily work | Default dashboard blocks |
|---|---|---|---|---|
| Sales Employee | Sales · individual contributor | Sales | Make sales, add customers, view returns | Sales overview, customer credit |
| Sales Supervisor | Sales · supervisor | Sales | Sell, process returns, record customer payments, watch daily sales | Sales overview, revenue, customer credit, action needed |
| Sales Manager | Sales · manager | Sales | Oversee sales, team performance, credit limits and profit | Sales overview, revenue, customer credit, team performance, profit, action needed |
| Store Manager | Operations · manager | Inventory | Run branch stock, purchases, suppliers, payments and team | Sales overview, inventory, supplier bills, money in, team performance, action needed |
| Inventory Clerk | Inventory · individual contributor | Inventory | Maintain products, adjust stock, record purchases and suppliers | Inventory, supplier bills, purchases this month, money in, action needed |
| Inventory Manager | Inventory · manager | Inventory | Manage stock health, replenishment, supplier records and team | Inventory, supplier bills, purchases this month, team performance, action needed |
| Finance Employee | Finance · individual contributor | Finance | Record customer payments, watch credit and spending | Money in, customer credit, purchases this month, action needed |
| Finance Manager | Finance · manager | Finance | Oversee payments, credit, spending, supplier bills and profit | Money in, customer credit, purchases this month, profit, supplier bills, action needed |
| Purchase Officer | Purchases · individual contributor | Purchases | Record purchases, manage suppliers, settle supplier bills | Supplier bills, purchases this month, inventory, action needed |
| Purchase Manager | Purchases · manager | Purchases | Oversee purchasing, suppliers, replenishment and team | Supplier bills, purchases this month, inventory, team performance, action needed |
| Credit & Customer Officer | Operations · individual contributor | Customers | Manage customer credit, collections and follow-up | Customer credit, sales overview, action needed |

The existing Store Manager covers branch operations. There is no separate Cashier persona because
the sales flow does not have a cash-drawer/shift capability distinct from Sales Employee. There is
no separate Accounts Officer beyond Finance Employee because customer payments and supplier
payments are the implemented finance operations.

## 4. Persona definitions

### Sales Employee

- **Purpose:** counter sales and the customer relationship at the point of sale.
- **Workflows:** new sale, customer creation, sale receipt, return view. Payment recording is not
  granted by this template.
- **Dashboard:** today's sales, paid/credit, transactions, customers served and customer credit.
- **Restrictions:** no void, no credit-limit change, no team view, no finance or purchasing.

### Sales Supervisor

- **Purpose:** a working supervisor who still sells but can resolve returns and take payments.
- **Workflows:** sale, return, customer payment, customer edit, daily sales review.
- **Dashboard:** sales overview, seven-day revenue, customer credit and action needed.
- **Restrictions:** no credit-limit change, no team management and no profit report by default.
  A void is allowed only because the template holds `sales.void`; the owner can remove it.

### Sales Manager

- **Purpose:** own sales performance, the sales team and the branch's credit exposure.
- **Workflows:** all sales work, returns, customer credit limit, team read, reports.
- **Dashboard:** sales overview, revenue, customer credit, team performance, profit and action
  needed. Profit is drawn from the branch's sales and reported as unknown when costs are missing.
- **Restrictions:** no inventory adjustment, purchasing or supplier payment. Team is read-only.

### Store Manager

- **Purpose:** run a branch's selling, stock and supplier relationship.
- **Workflows:** sales view, products, stock adjustment, purchase creation, supplier records,
  supplier payments, team read.
- **Dashboard:** sales, inventory position, supplier bills, money in, team performance and action
  needed.
- **Restrictions:** no employee-role editing (`employees.manage` is not granted), no credit-limit
  change and no business-wide settings.

### Inventory Clerk

- **Purpose:** keep the physical stock and its records correct.
- **Workflows:** add/edit products, adjust stock, record purchases, add/edit suppliers, supplier
  payments.
- **Dashboard:** inventory position, supplier bills, purchases this month, money in and action
  needed.
- **Restrictions:** no sales creation, no customer credit authority and no team management.

### Inventory Manager

- **Purpose:** manage stock policy and replenishment, not only individual adjustments.
- **Workflows:** everything the clerk can do, plus reports and team read; purchases are created
  through the same purchase screen.
- **Dashboard:** inventory position, supplier bills, purchases this month, team performance and
  action needed.
- **Restrictions:** no sales creation, no customer credit limit and no employee management.

### Finance Employee

- **Purpose:** record the money that comes in and keep the customer ledger accurate.
- **Workflows:** record customer payment, read customers, read sales for cash figures, read
  purchases and suppliers, read reports.
- **Dashboard:** money in, customer credit, purchases this month and action needed.
- **Restrictions:** finance entries are read-only; there is no employee finance-write screen. No
  supplier payment (`payments.supplier`) and no credit-limit change.

### Finance Manager

- **Purpose:** oversee the branch's cash, credit, spending and supplier obligations.
- **Workflows:** all Finance Employee work plus supplier payments, customer edit, credit limit,
  sales read, profit report and supplier bills.
- **Dashboard:** money in, customer credit, purchases this month, profit, supplier bills and
  action needed.
- **Restrictions:** no sales creation, no inventory adjustment and no employee management. The
  dashboard does not claim a reconciliation workflow that the app does not have.

### Purchase Officer

- **Purpose:** buy stock and keep supplier records and bills moving.
- **Workflows:** create purchase, add/edit suppliers, supplier payment, read inventory and products.
- **Dashboard:** supplier bills, purchases this month, inventory and action needed.
- **Restrictions:** no sales, customer credit, team view or employee management. `payments.view`
  exists only so the supplier-payment screen can open; it is not a finance workspace.

### Purchase Manager

- **Purpose:** own purchasing, supplier relationships and replenishment performance.
- **Workflows:** purchase creation and payment, supplier management, inventory read, reports and
  team read.
- **Dashboard:** supplier bills, purchases this month, inventory, team performance and action
  needed.
- **Restrictions:** no sales creation, no customer credit authority and no employee management.

### Credit & Customer Officer

- **Purpose:** collect outstanding customer money and maintain credit records.
- **Workflows:** customer view/create/edit, customer payment, credit-limit change, sales read,
  action alerts.
- **Dashboard:** customer credit, sales overview and action needed.
- **Restrictions:** cannot create or void a sale, cannot adjust stock or purchasing, and cannot
  manage employees. The credit-limit action is held only because the template grants
  `customers.credit_limit`; the owner can remove it.

## 5. Dashboard blocks and truthfulness

The app has ten existing widget keys. No new widget key was invented for this work.

| Key | What the employee dashboard actually draws |
|---|---|
| `sales_overview` | today's sales, paid/credit, transactions and customers served |
| `revenue_analysis` | seven-day branch revenue and this month's total |
| `expense_analysis` | purchases recorded this month, grouped by supplier |
| `profit_loss` | branch revenue, known cost and gross profit; no figure when cost is unknown |
| `customer_outstanding` | branch customer balances and overdue count |
| `inventory_position` | in-stock/low/out counts, units on hand and restock list |
| `supplier_payables` | suppliers with an outstanding payable |
| `team_performance` | branch sales by employee for the current month |
| `money_movements` | counter cash, credit collected and new credit for the month |
| `quick_alerts` | overdue customers, low/out stock and supplier bills the role can see |

A widget is drawn only when both answers are yes:

1. `get_my_dashboards()` says the role selected it; and
2. the employee holds the permission the widget's data needs.

There are no dummy metrics. An unknown cost is shown as unknown, not as full profit. A role
without `sales.view` is not shown counter cash. A role without `purchases.view` is not shown
purchases or supplier bills.

## 6. Special actions and restrictions

This repository has no separate approval engine for employee actions. The implemented control is
the permission boundary:

- `sales.void` — voiding a sale; granted to Sales Supervisor/Manager by template, removable.
- `customers.credit_limit` — changing a credit limit; Sales Manager, Finance Manager and Credit
  Officer by template.
- `inventory.adjust` — stock adjustment; Inventory Clerk/Manager and Store Manager.
- `purchases.create` — recording a purchase; Inventory Clerk/Manager, Purchase Officer/Manager and
  Store Manager.
- `payments.supplier` — paying a supplier; Finance Manager, Purchase Officer/Manager and Store
  Manager.
- `employees.manage` — employee/role administration is **not** granted by any employee template.

If a future action needs a second-person approval, it needs a real server-side approval workflow
and an audit trail. A disabled button is not an approval system.

## 7. Owner and Co-Owner boundaries

This work does not change the Owner or Co-Owner experience. Employees cannot inherit Owner or
Co-Owner authority through a template, role category or level. The Owner's Roles & Access screen
still decides which role exists, which permissions it holds, which dashboard blocks it sees and
which employees/branches receive it.

## 8. Verification

The persona implementation was checked with:

```bash
npx tsc --noEmit
npx vitest run tests/unit/employeePersonas.test.ts \
  tests/unit/i18nCoverage.test.ts tests/unit/i18nParity.test.ts \
  tests/unit/microcopy.test.ts tests/unit/typeScaleGuard.test.ts \
  tests/unit/listPrimitiveGuard.test.ts tests/unit/featureRegistryGuard.test.ts
npm run build
```

The tests cover template uniqueness, implemented widget keys, no owner-only grants, finance's
sales read dependency, and the shared workspace resolver (notably Purchase Officer → Purchases,
not Finance). Browser verification of every persona against the local stack is recorded in the
delivery report; a persona that was not exercised is not claimed as PASS.
